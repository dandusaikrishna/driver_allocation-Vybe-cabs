import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  CreateDriverDto,
  UpdateDriverLocationDto,
  UpdateDriverStatusDto,
} from './dto/driver.dto';
import { DriversService } from './drivers.service';

@Controller('drivers')
export class DriversController {
  constructor(private readonly driversService: DriversService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateDriverDto) {
    return this.driversService.create(dto);
  }

  @Get()
  findAll() {
    return this.driversService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.driversService.findOne(id);
  }

  @Patch(':id/location')
  updateLocation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDriverLocationDto,
  ) {
    return this.driversService.updateLocation(id, dto);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDriverStatusDto,
  ) {
    return this.driversService.updateStatus(id, dto);
  }

  /** Polling endpoint — drivers check here for ride offers */
  @Get(':id/notifications')
  getNotifications(@Param('id', ParseUUIDPipe) id: string) {
    return this.driversService.getNotifications(id);
  }
}
