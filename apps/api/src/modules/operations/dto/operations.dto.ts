import { IsString, IsObject, IsOptional, IsEnum } from 'class-validator';

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
