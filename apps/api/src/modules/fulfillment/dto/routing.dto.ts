import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  ValidateNested,
  Min,
  Max,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RouteWaypointDto {
  @IsString()
  @IsOptional()
  id?: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  longitude: number;
}

export class PlanRouteDto {
  @ValidateNested()
  @Type(() => RouteWaypointDto)
  @IsOptional()
  origin?: RouteWaypointDto;

  @IsArray()
  @ArrayMinSize(1, { message: 'At least one destination stop is required' })
  @ArrayMaxSize(24, { message: 'A maximum of 24 destination stops can be routed in one request' })
  @ValidateNested({ each: true })
  @Type(() => RouteWaypointDto)
  destinations: RouteWaypointDto[];

  @IsString()
  @IsOptional()
  @IsIn(['driving', 'driving-traffic'])
  profile?: 'driving' | 'driving-traffic';
}
