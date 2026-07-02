import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/** Redis key helpers — keeps naming consistent across the app */
export const RedisKeys = {
  driversGeo: 'drivers:geo',
  driverAvailable: (id: string) => `driver:${id}:available`,
  rideState: (rideId: string) => `ride:${rideId}:state`,
  rideRound: (rideId: string) => `ride:${rideId}:round`,
  rideAssignedDriver: (rideId: string) => `ride:${rideId}:assigned_driver`,
  rideNotified: (rideId: string) => `ride:${rideId}:notified`,
  driverNotifications: (driverId: string) => `driver:${driverId}:notifications`,
  acceptIdempotency: (rideId: string, driverId: string) =>
    `accept:${rideId}:${driverId}`,
} as const;

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;
  private readonly acceptRideScript: string;

  constructor(private readonly config: ConfigService) {
    this.client = new Redis({
      host: this.config.get<string>('redis.host'),
      port: this.config.get<number>('redis.port'),
      maxRetriesPerRequest: 3,
    });

    this.acceptRideScript = readFileSync(this.resolveLuaScriptPath(), 'utf-8');
  }

  /** Locate accept-ride.lua across dev/prod output layouts */
  private resolveLuaScriptPath(): string {
    const candidates = [
      join(__dirname, 'lua', 'accept-ride.lua'),
      join(process.cwd(), 'dist', 'redis', 'lua', 'accept-ride.lua'),
      join(process.cwd(), 'src', 'redis', 'lua', 'accept-ride.lua'),
    ];

    for (const path of candidates) {
      if (existsSync(path)) {
        return path;
      }
    }

    throw new Error(
      `accept-ride.lua not found. Tried: ${candidates.join(', ')}`,
    );
  }

  get redis(): Redis {
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  /** Add or update a driver's position in the geo index */
  async setDriverLocation(
    driverId: string,
    latitude: number,
    longitude: number,
  ): Promise<void> {
    await this.client.geoadd(
      RedisKeys.driversGeo,
      longitude,
      latitude,
      driverId,
    );
  }

  /** Remove driver from geo index (e.g. when going offline) */
  async removeDriverFromGeo(driverId: string): Promise<void> {
    await this.client.zrem(RedisKeys.driversGeo, driverId);
  }

  /**
   * Find nearest available drivers within radius.
   * Filters out drivers already notified for this ride and those marked busy.
   */
  async findNearbyAvailableDrivers(
    latitude: number,
    longitude: number,
    radiusKm: number,
    count: number,
    excludeDriverIds: string[] = [],
  ): Promise<string[]> {
    const excludeSet = new Set(excludeDriverIds);
    const results = await this.client.geosearch(
      RedisKeys.driversGeo,
      'FROMLONLAT',
      longitude,
      latitude,
      'BYRADIUS',
      radiusKm,
      'km',
      'ASC',
      'COUNT',
      count * 3, // fetch extra to account for filtered-out drivers
    );

    const available: string[] = [];
    for (const raw of results) {
      const driverId = String(raw);
      if (excludeSet.has(driverId)) continue;

      const isAvailable = await this.client.get(
        RedisKeys.driverAvailable(driverId),
      );
      if (isAvailable === '1') {
        available.push(driverId);
        if (available.length >= count) break;
      }
    }

    return available;
  }

  async markDriverAvailable(driverId: string): Promise<void> {
    await this.client.set(RedisKeys.driverAvailable(driverId), '1');
  }

  async markDriverUnavailable(driverId: string): Promise<void> {
    await this.client.del(RedisKeys.driverAvailable(driverId));
  }

  async initRideAllocation(
    rideId: string,
    round: number,
    searchingState: string,
  ): Promise<void> {
    const pipeline = this.client.pipeline();
    pipeline.set(RedisKeys.rideState(rideId), searchingState);
    pipeline.set(RedisKeys.rideRound(rideId), String(round));
    pipeline.del(RedisKeys.rideAssignedDriver(rideId));
    await pipeline.exec();
  }

  async getRideRound(rideId: string): Promise<number> {
    const round = await this.client.get(RedisKeys.rideRound(rideId));
    return round ? parseInt(round, 10) : 0;
  }

  async getRideState(rideId: string): Promise<string | null> {
    return this.client.get(RedisKeys.rideState(rideId));
  }

  async addNotifiedDrivers(
    rideId: string,
    driverIds: string[],
  ): Promise<void> {
    if (driverIds.length === 0) return;
    await this.client.sadd(RedisKeys.rideNotified(rideId), ...driverIds);
  }

  async getNotifiedDrivers(rideId: string): Promise<string[]> {
    return this.client.smembers(RedisKeys.rideNotified(rideId));
  }

  async pushDriverNotification(
    driverId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.client.lpush(
      RedisKeys.driverNotifications(driverId),
      JSON.stringify(payload),
    );
    // Keep notification list bounded
    await this.client.ltrim(RedisKeys.driverNotifications(driverId), 0, 49);
  }

  async getDriverNotifications(driverId: string): Promise<unknown[]> {
    const items = await this.client.lrange(
      RedisKeys.driverNotifications(driverId),
      0,
      -1,
    );
    return items.map((item) => JSON.parse(item) as unknown);
  }

  /**
   * Atomically attempt to assign a driver to a ride.
   * Returns: 1 = success, 2 = idempotent (same driver already assigned), 0 = rejected
   */
  async atomicAcceptRide(
    rideId: string,
    driverId: string,
    round: number,
    searchingState: string,
    assignedState: string,
    idempotencyKey: string,
    idempotencyTtlSeconds: number,
  ): Promise<number> {
    const result = await this.client.eval(
      this.acceptRideScript,
      4,
      RedisKeys.rideState(rideId),
      RedisKeys.rideAssignedDriver(rideId),
      RedisKeys.rideRound(rideId),
      RedisKeys.acceptIdempotency(rideId, driverId),
      driverId,
      String(round),
      searchingState,
      assignedState,
      idempotencyKey,
      String(idempotencyTtlSeconds),
    );

    return result as number;
  }

  async setRideState(rideId: string, state: string): Promise<void> {
    await this.client.set(RedisKeys.rideState(rideId), state);
  }

  /**
   * Atomically check if ride is still searching on the expected round.
   * Used by timeout handler to avoid racing with a just-accepted ride.
   */
  async tryAdvanceRound(
    rideId: string,
    expectedRound: number,
    searchingState: string,
  ): Promise<boolean> {
    const script = `
      local state = redis.call('GET', KEYS[1])
      local round = redis.call('GET', KEYS[2])
      local assigned = redis.call('GET', KEYS[3])
      if assigned then return 0 end
      if state ~= ARGV[1] then return 0 end
      if tonumber(round) ~= tonumber(ARGV[2]) then return 0 end
      redis.call('INCR', KEYS[2])
      return 1
    `;

    const result = await this.client.eval(
      script,
      3,
      RedisKeys.rideState(rideId),
      RedisKeys.rideRound(rideId),
      RedisKeys.rideAssignedDriver(rideId),
      searchingState,
      String(expectedRound),
    );

    return result === 1;
  }

  async cleanupRideKeys(rideId: string): Promise<void> {
    await this.client.del(
      RedisKeys.rideState(rideId),
      RedisKeys.rideRound(rideId),
      RedisKeys.rideAssignedDriver(rideId),
      RedisKeys.rideNotified(rideId),
    );
  }
}
