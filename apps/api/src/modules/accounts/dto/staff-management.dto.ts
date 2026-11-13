import { IsBoolean, IsArray, IsEnum, ArrayNotEmpty, ArrayUnique, IsEmail, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { Role } from '@prisma/client';

/** Egyptian mobile, the same format customers use at checkout. */
export const STAFF_PHONE_PATTERN = /^\s*(\+201|01)[0-9]{9}\s*$/;
const PHONE_MESSAGE = 'phone must be an Egyptian mobile number (01xxxxxxxxx or +201xxxxxxxxx)';

export class SetStaffStatusDto {
  @IsBoolean()
  isActive: boolean;
}

export class UpdateStaffRolesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(Role, { each: true })
  roles: Role[];
}

export class CreateStaffDto {
  @IsString() @MinLength(2) @MaxLength(80)
  name: string;

  @IsEmail() @MaxLength(160)
  email: string;

  /** Optional staff contact number. */
  @IsOptional() @Matches(STAFF_PHONE_PATTERN, { message: PHONE_MESSAGE })
  phone?: string;

  /** Initial password the Admin hands over; the staff member signs in with it (an Admin can reset it later). */
  @IsString() @MinLength(10) @MaxLength(72)
  password: string;

  @IsArray() @ArrayNotEmpty() @ArrayUnique() @IsEnum(Role, { each: true })
  roles: Role[];

  /** Required for the SUPPLIER role: the supplier company this login belongs to. */
  @IsOptional() @IsUUID()
  supplierId?: string;

  /** Hubs a HUB_OPERATOR works at. */
  @IsOptional() @IsArray() @ArrayUnique() @IsUUID('all', { each: true })
  locationIds?: string[];
}

export class UpdateStaffProfileDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80)
  name?: string;

  /** A valid mobile sets the number; an empty string clears it; absent leaves it as it is. */
  @IsOptional() @Matches(/^\s*$|^\s*(\+201|01)[0-9]{9}\s*$/, { message: PHONE_MESSAGE + ', or empty to clear it' })
  phone?: string;

  @IsOptional() @IsArray() @ArrayUnique() @IsUUID('all', { each: true })
  locationIds?: string[];
}

export class ResetStaffPasswordDto {
  @IsString() @MinLength(10) @MaxLength(72)
  password: string;
}
