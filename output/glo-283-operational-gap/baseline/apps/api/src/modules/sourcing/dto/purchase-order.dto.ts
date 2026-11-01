import { IsString, IsArray, IsInt, IsOptional, ValidateNested, IsEnum, IsUUID, Min, Max, MaxLength, IsNotEmpty, ArrayMinSize, IsIn, IsNumber, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';
import { PurchaseOrderLineStatus, PurchaseOrderStatus } from '@prisma/client';

export class CreatePurchaseOrderLineDto {
  @IsString()
  skuId: string;

  @IsInt()
  @Min(1)
  requestedQuantity: number;
}

export class CreatePurchaseOrderDto {
  @IsString()
  supplierId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderLineDto)
  lines: CreatePurchaseOrderLineDto[];
}

export const SUPPLIER_LINE_EXCEPTIONS = ['MIN_ORDER_QUANTITY', 'PACK_SIZE', 'PRICE_CHANGED', 'OUT_OF_STOCK', 'DISCONTINUED'] as const;

export class ConfirmPurchaseOrderLineDto {
  @IsString()
  id: string; // Line ID

  @IsEnum(PurchaseOrderLineStatus)
  status: PurchaseOrderLineStatus;

  @IsInt()
  @IsOptional()
  confirmedQuantity?: number;

  /** Why the line cannot be supplied as ordered (GLO-237 red team). Never on a full confirmation. */
  @IsOptional()
  @IsIn(SUPPLIER_LINE_EXCEPTIONS)
  exceptionCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  exceptionNote?: string;

  /** E.g. the minimum or carton quantity the supplier can sell. Never auto-accepted. */
  @IsOptional()
  @IsInt()
  @Min(1)
  proposedQuantity?: number;

  /** The supplier's new unit cost; the PO cost and the customer's price never change from it. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  proposedUnitCost?: number;
}

export class ConfirmPurchaseOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfirmPurchaseOrderLineDto)
  lines: ConfirmPurchaseOrderLineDto[];
}

export class DistributionEntryDto {
  @IsUUID()
  sourceAllocationId: string;

  @IsInt()
  @Min(0)
  quantity: number;
}

/** Explicit split of a shared partial confirmation; who receives scarce stock is a recorded human decision. */
export class DistributePurchaseOrderLineDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DistributionEntryDto)
  allocations: DistributionEntryDto[];

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

export class FlushProcurementBatchDto {
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  /** Stated operational reason for manual / early batch flush (audited). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  /** If true, authorizes force-dispatching even if supplier is currently outside operating window. */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class ListPurchaseOrdersQueryDto {
  @IsOptional()
  @IsEnum(PurchaseOrderStatus)
  status?: PurchaseOrderStatus;

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;
}

/** Confirmed units that did not reach the Hub, and where they were lost (GLO-243). */
export class RecordShortfallDto {
  @IsUUID()
  sourceAllocationId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsIn(['NOT_HANDED_OVER', 'LOST_IN_TRANSIT', 'SHORT_SHIPPED', 'DAMAGED_IN_TRANSIT'])
  reasonCode: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/** Records a disputed physical preparation/handover; never reauthorizes procurement. */
export class PurchaseOrderExpiryDisputeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  note: string;
}
