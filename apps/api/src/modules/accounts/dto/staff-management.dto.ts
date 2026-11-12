import { IsBoolean, IsArray, IsEnum, ArrayNotEmpty, ArrayUnique, IsEmail, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Role } from '@prisma/client';

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

  @IsOptional() @IsArray() @ArrayUnique() @IsUUID('all', { each: true })
  locationIds?: string[];
}

export class ResetStaffPasswordDto {
  @IsString() @MinLength(10) @MaxLength(72)
  password: string;
}
