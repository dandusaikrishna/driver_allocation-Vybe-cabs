import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AllocationService } from './allocation.service';
import { AcceptRideDto, CreateRideDto } from './dto/ride.dto';
import { RidesService } from './rides.service';

@Controller()
export class RidesController {
  constructor(
    private readonly ridesService: RidesService,
    private readonly allocationService: AllocationService,
  ) {}

  @Post('rides')
  @HttpCode(HttpStatus.CREATED)
  createRide(@Body() dto: CreateRideDto) {
    return this.ridesService.create(dto);
  }

  @Get('rides')
  listRides() {
    return this.ridesService.findAll();
  }

  @Get('rides/:id')
  getRide(@Param('id', ParseUUIDPipe) id: string) {
    return this.ridesService.findOne(id);
  }

  @Post('rides/:rideId/accept/:driverId')
  acceptRide(
    @Param('rideId', ParseUUIDPipe) rideId: string,
    @Param('driverId', ParseUUIDPipe) driverId: string,
    @Body() dto: AcceptRideDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.allocationService.acceptRide(
      rideId,
      driverId,
      dto.round,
      idempotencyKey,
    );
  }
}
