import { IsString, IsNotEmpty, IsBoolean, IsOptional, IsArray, ArrayUnique, IsInt, Min, Max, Matches } from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Working schedule (Cairo time): closed weekdays (0 = Sunday … 6 = Saturday; Friday by default) and optional hours. */
export class SupplierScheduleDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  closedWeekdays?: number[];

  @IsOptional()
  @Matches(HHMM, { message: 'opensAt must be HH:MM' })
  opensAt?: string;

  @IsOptional()
  @Matches(HHMM, { message: 'closesAt must be HH:MM' })
  closesAt?: string;
}

export class CreateSupplierDto extends SupplierScheduleDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  slug: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateSupplierDto extends SupplierScheduleDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  slug?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
