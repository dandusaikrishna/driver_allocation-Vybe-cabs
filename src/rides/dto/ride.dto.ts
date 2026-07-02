import { IsNotEmpty, IsNumber, IsString, Max, Min } from 'class-validator';

export class CreateRideDto {
  @IsString()
  @IsNotEmpty()
  riderId: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  pickupLatitude: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  pickupLongitude: number;
}

export class AcceptRideDto {
  @IsNumber()
  @Min(0)
  round: number;
}
