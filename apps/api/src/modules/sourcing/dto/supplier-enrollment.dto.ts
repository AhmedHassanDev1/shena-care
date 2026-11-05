import { ArrayUnique, IsArray, IsBoolean, IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

class EnrollmentCalendarDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  closedWeekdays?: number[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsDateString({ strict: true }, { each: true })
  closedDates?: string[];

  @IsOptional()
  @Matches(HHMM, { message: 'opensAt must be HH:MM' })
  opensAt?: string;

  @IsOptional()
  @Matches(HHMM, { message: 'closesAt must be HH:MM' })
  closesAt?: string;

  @IsOptional()
  @IsBoolean()
  crossesMidnight?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10080)
  pickupLeadMinutes?: number;

  /** Canonical SKU codes or barcodes. An empty list means every SKU. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopeSkuCodes?: string[];
}

export class RegisterSupplierEnrollmentDto extends EnrollmentCalendarDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, { message: 'slug must be lowercase letters, digits and dashes' })
  @MaxLength(120)
  slug: string;

  @IsOptional()
  @IsBoolean()
  enroll?: boolean;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}

export class UpdateSupplierEnrollmentDto extends EnrollmentCalendarDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  rfqEnrolled?: boolean;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}
