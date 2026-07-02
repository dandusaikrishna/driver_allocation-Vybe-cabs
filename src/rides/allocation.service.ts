import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { DriverStatus } from '../common/enums/driver-status.enum';
import { RideStatus } from '../common/enums/ride-status.enum';
import { DriversService } from '../drivers/drivers.service';
import { RedisService } from '../redis/redis.service';
import { Ride } from './entities/ride.entity';

export interface AcceptResult {
  success: boolean;
  idempotent: boolean;
  message: string;
  ride?: Ride;
}

@Injectable()
export class AllocationService {
  private readonly logger = new Logger(AllocationService.name);
  private readonly timeoutTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    @InjectRepository(Ride)
    private readonly rideRepo: Repository<Ride>,
    private readonly driversService: DriversService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  /** Kick off the first allocation round after a ride is created */
  async startAllocation(ride: Ride): Promise<void> {
    ride.status = RideStatus.SEARCHING;
    ride.allocationRound = 1;
    await this.rideRepo.save(ride);

    await this.redis.initRideAllocation(
      ride.id,
      ride.allocationRound,
      RideStatus.SEARCHING,
    );

    await this.runAllocationRound(ride);
  }

  private async runAllocationRound(ride: Ride): Promise<void> {
    const driversPerRound = this.config.get<number>('allocation.driversPerRound')!;
    const radiusKm = this.config.get<number>('allocation.geoSearchRadiusKm')!;
    const timeoutSeconds = this.config.get<number>('allocation.timeoutSeconds')!;

    const alreadyNotified = await this.redis.getNotifiedDrivers(ride.id);

    const nearbyDrivers = await this.redis.findNearbyAvailableDrivers(
      ride.pickupLatitude,
      ride.pickupLongitude,
      radiusKm,
      driversPerRound,
      alreadyNotified,
    );

    if (nearbyDrivers.length === 0) {
      this.logger.warn(`No drivers found for ride ${ride.id} round ${ride.allocationRound}`);
      await this.handleRoundTimeout(ride.id, ride.allocationRound);
      return;
    }

    await this.redis.addNotifiedDrivers(ride.id, nearbyDrivers);

    const notification = {
      type: 'RIDE_REQUEST',
      rideId: ride.id,
      round: ride.allocationRound,
      pickup: {
        latitude: ride.pickupLatitude,
        longitude: ride.pickupLongitude,
      },
      expiresAt: new Date(Date.now() + timeoutSeconds * 1000).toISOString(),
    };

    for (const driverId of nearbyDrivers) {
      await this.redis.pushDriverNotification(driverId, notification);
      this.logger.log(
        `Notified driver ${driverId} for ride ${ride.id} (round ${ride.allocationRound})`,
      );
    }

    this.scheduleRoundTimeout(ride.id, ride.allocationRound, timeoutSeconds);
  }

  private scheduleRoundTimeout(
    rideId: string,
    round: number,
    timeoutSeconds: number,
  ): void {
    const existing = this.timeoutTimers.get(rideId);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      void this.handleRoundTimeout(rideId, round);
    }, timeoutSeconds * 1000);

    this.timeoutTimers.set(rideId, timer);
  }

  /**
   * Called when a round expires without acceptance.
   * Uses atomic round advancement to avoid racing with a late accept.
   */
  async handleRoundTimeout(rideId: string, expectedRound: number): Promise<void> {
    this.timeoutTimers.delete(rideId);

    const advanced = await this.redis.tryAdvanceRound(
      rideId,
      expectedRound,
      RideStatus.SEARCHING,
    );

    if (!advanced) {
      // Ride was assigned or round already moved on
      return;
    }

    const ride = await this.rideRepo.findOne({ where: { id: rideId } });
    if (!ride || ride.status === RideStatus.ASSIGNED) {
      return;
    }

    const maxRounds = this.config.get<number>('allocation.maxRounds')!;
    const newRound = expectedRound + 1;

    if (newRound > maxRounds) {
      ride.status = RideStatus.TIMEOUT;
      ride.allocationRound = expectedRound;
      await this.rideRepo.save(ride);
      await this.redis.setRideState(rideId, RideStatus.TIMEOUT);
      this.logger.warn(`Ride ${rideId} timed out after ${maxRounds} rounds`);
      return;
    }

    ride.allocationRound = newRound;
    await this.rideRepo.save(ride);
    this.logger.log(`Retrying ride ${rideId}, round ${newRound}`);

    await this.runAllocationRound(ride);
  }

  /**
   * Driver accepts a ride. The Lua script in Redis ensures only one winner.
   */
  async acceptRide(
    rideId: string,
    driverId: string,
    round: number,
    idempotencyKey?: string,
  ): Promise<AcceptResult> {
    await this.driversService.findOne(driverId);

    const ride = await this.rideRepo.findOne({ where: { id: rideId } });
    if (!ride) {
      return { success: false, idempotent: false, message: 'Ride not found' };
    }

    if (ride.status === RideStatus.ASSIGNED) {
      if (ride.assignedDriverId === driverId) {
        return {
          success: true,
          idempotent: true,
          message: 'Already assigned to you',
          ride,
        };
      }
      return {
        success: false,
        idempotent: false,
        message: 'Ride already assigned to another driver',
        ride,
      };
    }

    if (ride.status === RideStatus.TIMEOUT) {
      return {
        success: false,
        idempotent: false,
        message: 'Ride has timed out',
        ride,
      };
    }

    const token = idempotencyKey ?? uuidv4();

    const result = await this.redis.atomicAcceptRide(
      rideId,
      driverId,
      round,
      RideStatus.SEARCHING,
      RideStatus.ASSIGNED,
      token,
      3600,
    );

    if (result === 1 || result === 2) {
      const timer = this.timeoutTimers.get(rideId);
      if (timer) {
        clearTimeout(timer);
        this.timeoutTimers.delete(rideId);
      }

      ride.status = RideStatus.ASSIGNED;
      ride.assignedDriverId = driverId;
      ride.allocationRound = round;
      await this.rideRepo.save(ride);

      await this.driversService.updateStatus(driverId, {
        status: DriverStatus.BUSY,
      });

      this.logger.log(`Ride ${rideId} assigned to driver ${driverId}`);

      return {
        success: true,
        idempotent: result === 2,
        message: result === 2 ? 'Already assigned (idempotent)' : 'Ride accepted',
        ride,
      };
    }

    return {
      success: false,
      idempotent: false,
      message:
        'Acceptance rejected — ride may be assigned, timed out, or round mismatch',
      ride,
    };
  }
}
