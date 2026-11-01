import { IsString, IsObject, IsOptional, IsEnum, IsIn, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { SupportCaseCategory, SupportCasePriority } from '@prisma/client';

export enum SupportCaseCategoryDto {
  PAYMENT = 'payment',
  SOURCING = 'sourcing',
  DELIVERY = 'delivery',
  DAMAGED_ITEM = 'damaged_item',
  WRONG_ITEM = 'wrong_item',
  CANCELLATION = 'cancellation',
  RETURN = 'return',
  SUPPLIER_DISPUTE = 'supplier_dispute',
  OTHER = 'other',
}

export enum SupportCasePriorityDto {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export class CreateSupportCaseDto {
  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsEnum(SupportCaseCategoryDto)
  @IsOptional()
  category?: SupportCaseCategoryDto;

  @IsEnum(SupportCasePriorityDto)
  @IsOptional()
  priority?: SupportCasePriorityDto;

  @IsString()
  @IsOptional()
  customerId?: string;

  @IsString()
  @IsOptional()
  orderId?: string;

  @IsString()
  @IsOptional()
  supplierId?: string;
}

export class UpdateSupportCaseDto {
  @IsString()
  @IsOptional()
  status?: 'open' | 'in_progress' | 'resolved' | 'closed';

  @IsString()
  @IsOptional()
  internalNotes?: string;

  @IsString()
  @IsOptional()
  assigneeId?: string;
}

/** Support/exception queue filters (GLO-239), bounded paging. */
export class SupportCaseQueryDto {
  @IsOptional()
  @IsIn(['open', 'in_progress', 'resolved', 'closed'])
  status?: 'open' | 'in_progress' | 'resolved' | 'closed';

  @IsOptional()
  @IsIn(['payment', 'sourcing', 'delivery', 'damaged_item', 'wrong_item', 'cancellation', 'return', 'supplier_dispute', 'safety_concern', 'other'])
  category?: SupportCaseCategory;

  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'critical'])
  priority?: SupportCasePriority;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;
}
