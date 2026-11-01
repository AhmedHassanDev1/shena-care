import { IsString, IsNotEmpty, IsBoolean, IsOptional, IsArray, ArrayUnique, IsInt, Min, Max, Matches, IsDateString } from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Working schedule (Cairo time): closed weekdays (0 = Sunday … 6 = Saturday; Friday by default) and optional hours. */
export class SupplierScheduleDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10080)
  pickupLeadMinutes?: number;

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

  /** True if working window crosses midnight into the next day (e.g. 09:00 to 01:00). */
  @IsOptional()
  @IsBoolean()
  crossesMidnight?: boolean;

  /** Explicit closure dates "YYYY-MM-DD" (holidays, special closures). */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { each: true })
  @IsDateString({ strict: true }, { each: true })
  closedDates?: string[];
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
