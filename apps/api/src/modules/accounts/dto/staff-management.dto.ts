import { IsBoolean, IsArray, IsEnum, ArrayNotEmpty } from 'class-validator';
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
