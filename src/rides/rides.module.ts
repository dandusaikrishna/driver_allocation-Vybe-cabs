import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DriversModule } from '../drivers/drivers.module';
import { AllocationService } from './allocation.service';
import { Ride } from './entities/ride.entity';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';

@Module({
  imports: [TypeOrmModule.forFeature([Ride]), DriversModule],
  controllers: [RidesController],
  providers: [RidesService, AllocationService],
  exports: [RidesService, AllocationService],
})
export class RidesModule {}
