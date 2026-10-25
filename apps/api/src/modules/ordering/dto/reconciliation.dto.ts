import { IsString, IsNotEmpty, IsOptional, IsEnum, IsArray, IsNumber, ValidateNested, IsUUID, Length, Min, ArrayNotEmpty, IsIn, MaxLength, IsInt, Max, Matches } from 'class-validator';
import { Type } from 'class-transformer';
import { OrderResolutionType, OrderResolutionStatus } from '@prisma/client';
import { LOSS_DISPOSITIONS, LOSS_PARTIES, LossDisposition, LossParty } from '../services/loss-responsibility';

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
  @IsUUID()
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
  /** The driver account whose declared cash is being counted. */
  @IsUUID()
  courierId: string;

  /** Hub where the cash is physically counted; every collection must belong to its runs. */
  @IsUUID()
  locationId: string;

  @IsString()
  @IsNotEmpty()
  @Length(1, 120)
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

export class MonthlyStatementQueryDto {
  /** Cairo calendar month, YYYY-MM. */
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be YYYY-MM' })
  month: string;
}

/** Who bears the loss of a returned/damaged/expired product, and what happens to the goods (owner decision 2026-10-25). */
export class SetResponsibilityDto {
  @IsIn([...LOSS_PARTIES])
  party: LossParty;

  /** Whole percents, only for SPLIT (several at fault); they must add up to 100. */
  @IsOptional() @IsInt() @Min(0) @Max(100)
  supplierShare?: number;

  @IsOptional() @IsInt() @Min(0) @Max(100)
  hubShare?: number;

  @IsOptional() @IsInt() @Min(0) @Max(100)
  shinacareShare?: number;

  @IsOptional()
  @IsIn([...LOSS_DISPOSITIONS])
  disposition?: LossDisposition;

  @IsOptional()
  @IsString()
  note?: string;
}

/** The cashier's count of everything one driver brought back to a hub (owner decision 2026-10-25). */
export class SettleRoundDto {
  @IsUUID()
  courierId: string;

  @IsUUID()
  locationId: string;

  @IsString()
  @IsNotEmpty()
  @Length(1, 120)
  reference: string;

  /** Physical cash counted for the whole round. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  countedTotal: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  fees?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

/** Manual refund obligation; method is how the operator will pay it back (no gateway). */
export class InitiateRefundDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @IsString()
  @Length(3, 3)
  currency: string;

  @IsOptional()
  @IsString()
  @IsIn(['cash', 'bank_transfer', 'vodafone_cash', 'instapay'])
  paymentProvider?: string;
}

export class UpdateRefundStatusDto {
  @IsIn(['processing', 'succeeded', 'failed'])
  status: 'processing' | 'succeeded' | 'failed';

  /** Operator proof of payout (voucher/transfer reference); required for `succeeded`. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  providerRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  errorReason?: string;
}

export class CancelOrderDto {
  @IsString()
  @IsIn(['CUSTOMER_REQUEST', 'DUPLICATE_ORDER', 'FRAUD_SUSPECTED', 'UNSERVICEABLE_LOCATION', 'SUPPLY_UNAVAILABLE', 'OTHER'])
  reasonCode: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
