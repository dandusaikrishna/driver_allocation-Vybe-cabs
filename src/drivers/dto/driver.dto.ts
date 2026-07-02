import { IsNotEmpty, IsNumber, IsString, Max, Min } from 'class-validator';

export class CreateDriverDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;
}

export class UpdateDriverLocationDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;
}

export class UpdateDriverStatusDto {
  @IsString()
  @IsNotEmpty()
  status: 'AVAILABLE' | 'BUSY' | 'OFFLINE';
}
