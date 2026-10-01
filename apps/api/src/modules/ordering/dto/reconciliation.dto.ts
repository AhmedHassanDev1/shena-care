import { IsString, IsNotEmpty, IsOptional, IsEnum, IsArray, IsNumber, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { OrderResolutionType, OrderResolutionStatus } from '@prisma/client';

export class OrderResolutionItemDto {
  @IsString()
  @IsNotEmpty()
  orderItemId: string;

  @IsNumber()
  quantity: number;
}

export class CreateResolutionDto {
  @IsString()
  @IsNotEmpty()
  orderId: string;

  @IsEnum(OrderResolutionType)
  type: OrderResolutionType;

  @IsString()
  @IsNotEmpty()
  actorId: string;

  @IsOptional()
  @IsString()
  reasonCode?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderResolutionItemDto)
  items?: OrderResolutionItemDto[];
}

export class UpdateResolutionStatusDto {
  @IsEnum(OrderResolutionStatus)
  status: OrderResolutionStatus;

  @IsString()
  @IsNotEmpty()
  actorId: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CollectionItemDto {
  @IsString()
  @IsNotEmpty()
  orderId: string;

  @IsNumber()
  collectedAmount: number;
}

export class CreateSettlementBatchDto {
  @IsString()
  @IsNotEmpty()
  courierId: string;

  @IsString()
  @IsNotEmpty()
  reference: string;

  @IsNumber()
  totalCollected: number;

  @IsOptional()
  @IsNumber()
  fees?: number;

  @IsString()
  @IsNotEmpty()
  currency: string;

  @IsString()
  @IsNotEmpty()
  actorId: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CollectionItemDto)
  collections: CollectionItemDto[];
}
