import { IsString, IsNotEmpty, IsOptional, IsEnum, IsArray, IsNumber, ValidateNested, IsUUID, Length, Min, ArrayNotEmpty } from 'class-validator';
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

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  collectedAmount: number;
}

export class InitializePaymentCollectionDto {
  @IsUUID()
  orderId: string;

  /** Must equal the order total; the server never accepts a client-chosen COD amount. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;

  @IsString()
  @Length(3, 3)
  currency: string;
}

export class CreateSettlementBatchDto {
  @IsString()
  @IsNotEmpty()
  courierId: string;

  @IsString()
  @IsNotEmpty()
  reference: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  totalCollected: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  fees?: number;

  @IsString()
  @IsNotEmpty()
  currency: string;

  /** Ignored: the settling actor is always the authenticated user. Kept for client compatibility. */
  @IsOptional()
  @IsString()
  actorId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CollectionItemDto)
  collections: CollectionItemDto[];
}
