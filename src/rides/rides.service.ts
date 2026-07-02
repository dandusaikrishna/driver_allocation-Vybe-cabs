import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RideStatus } from '../common/enums/ride-status.enum';
import { AllocationService } from './allocation.service';
import { CreateRideDto } from './dto/ride.dto';
import { Ride } from './entities/ride.entity';

@Injectable()
export class RidesService {
  constructor(
    @InjectRepository(Ride)
    private readonly rideRepo: Repository<Ride>,
    private readonly allocationService: AllocationService,
  ) {}

  async create(dto: CreateRideDto): Promise<Ride> {
    const ride = this.rideRepo.create({
      riderId: dto.riderId,
      pickupLatitude: dto.pickupLatitude,
      pickupLongitude: dto.pickupLongitude,
      status: RideStatus.REQUESTED,
    });

    const saved = await this.rideRepo.save(ride);

    // Fire-and-forget allocation — don't block the HTTP response
    void this.allocationService.startAllocation(saved);

    return saved;
  }

  async findOne(id: string): Promise<Ride> {
    const ride = await this.rideRepo.findOne({
      where: { id },
      relations: { assignedDriver: true },
    });
    if (!ride) {
      throw new NotFoundException(`Ride ${id} not found`);
    }
    return ride;
  }

  async findAll(): Promise<Ride[]> {
    return this.rideRepo.find({ order: { createdAt: 'DESC' } });
  }
}
