import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { DriverStatus } from '../common/enums/driver-status.enum';
import { RedisService } from '../redis/redis.service';
import {
  CreateDriverDto,
  UpdateDriverLocationDto,
  UpdateDriverStatusDto,
} from './dto/driver.dto';
import { Driver } from './entities/driver.entity';

@Injectable()
export class DriversService {
  constructor(
    @InjectRepository(Driver)
    private readonly driverRepo: Repository<Driver>,
    private readonly redis: RedisService,
  ) {}

  async create(dto: CreateDriverDto): Promise<Driver> {
    const driver = this.driverRepo.create({
      name: dto.name,
      phone: dto.phone,
      latitude: dto.latitude,
      longitude: dto.longitude,
      status: DriverStatus.AVAILABLE,
    });

    let saved: Driver;
    try {
      saved = await this.driverRepo.save(driver);
    } catch (err) {
      // Postgres unique_violation on the phone column
      if (err instanceof QueryFailedError && (err as any).code === '23505') {
        throw new ConflictException(
          `A driver with phone ${dto.phone} already exists`,
        );
      }
      throw err;
    }

    await this.syncDriverToRedis(saved);
    return saved;
  }

  async findAll(): Promise<Driver[]> {
    return this.driverRepo.find();
  }

  async findOne(id: string): Promise<Driver> {
    const driver = await this.driverRepo.findOne({ where: { id } });
    if (!driver) {
      throw new NotFoundException(`Driver ${id} not found`);
    }
    return driver;
  }

  async updateLocation(
    id: string,
    dto: UpdateDriverLocationDto,
  ): Promise<Driver> {
    const driver = await this.findOne(id);
    driver.latitude = dto.latitude;
    driver.longitude = dto.longitude;
    const saved = await this.driverRepo.save(driver);
    await this.syncDriverToRedis(saved);
    return saved;
  }

  async updateStatus(
    id: string,
    dto: UpdateDriverStatusDto,
  ): Promise<Driver> {
    const driver = await this.findOne(id);
    driver.status = dto.status as DriverStatus;
    const saved = await this.driverRepo.save(driver);
    await this.syncDriverToRedis(saved);
    return saved;
  }

  async getNotifications(id: string): Promise<unknown[]> {
    await this.findOne(id);
    return this.redis.getDriverNotifications(id);
  }

  /** Keep Postgres and Redis geo index in sync */
  private async syncDriverToRedis(driver: Driver): Promise<void> {
    if (driver.status === DriverStatus.AVAILABLE) {
      await this.redis.setDriverLocation(
        driver.id,
        driver.latitude,
        driver.longitude,
      );
      await this.redis.markDriverAvailable(driver.id);
    } else {
      await this.redis.removeDriverFromGeo(driver.id);
      await this.redis.markDriverUnavailable(driver.id);
    }
  }
}
