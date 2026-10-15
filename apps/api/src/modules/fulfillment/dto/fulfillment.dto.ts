import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { FulfillmentCapability, ReceivedGoodsCondition, ShipmentStatus } from '@prisma/client';

export class CreateLocationDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  address: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(FulfillmentCapability, { each: true })
  capabilities?: FulfillmentCapability[];
}

export class AssignLocationOperatorDto {
  @IsUUID()
  operatorId: string;
}

/** The four things a person checks when no reviewed barcode identifies the unit (GLO-242). */
export const MANUAL_IDENTITY_CHECKS = ['brand', 'variant', 'size', 'pack'] as const;

export class ReceiveAllocatedGoodsDto {
  @IsUUID()
  locationId: string;

  @IsUUID()
  allocationId: string;

  @IsUUID()
  orderId: string;

  @IsUUID()
  orderItemId: string;

  @IsUUID()
  skuId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  variantName: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsEnum(ReceivedGoodsCondition)
  condition: ReceivedGoodsCondition;

  @IsUUID()
  idempotencyKey: string;

  /** Physical identity evidence (GLO-242): the scanned manufacturer barcode … */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcodeScanned?: string;

  /** … or a manual verification with a reason and every identity check performed. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  manualReason?: string;

  @IsOptional()
  @IsArray()
  @IsIn(MANUAL_IDENTITY_CHECKS, { each: true })
  manualChecks?: string[];

  /** Printed lot/batch, when visible on the pack (RT04). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  lotNumber?: string;

  /** Printed expiry (YYYY-MM-DD), when visible. An already-expired unit is never received. */
  @IsOptional()
  @IsDateString({ strict: true })
  expiryDate?: string;
}

export class AllocateShipmentDto {
  @IsString()
  @IsNotEmpty()
  orderId: string;

  @IsString()
  @IsNotEmpty()
  locationId: string;
}

/** Why a delivery attempt failed (GLO-240 / GLO-231 red team); recorded, never auto-cancels. */
export const DELIVERY_FAILURE_REASONS = [
  'CUSTOMER_UNREACHABLE', 'CUSTOMER_REFUSED', 'ADDRESS_NOT_FOUND', 'PIN_MISMATCH',
  'NOT_SERVICEABLE', 'RESCHEDULE_REQUESTED', 'PACKAGE_DAMAGED', 'OTHER',
] as const;

export class UpdateShipmentStatusDto {
  @IsEnum(ShipmentStatus)
  status: ShipmentStatus;

  @IsOptional()
  @IsString()
  trackingNumber?: string;

  /** Typed reason; required when setting `failed` (GLO-240). */
  @IsOptional()
  @IsIn(DELIVERY_FAILURE_REASONS)
  reasonCode?: string;
  /** Cash the driver actually received at the door; required when a driver delivers a COD order (GLO-214). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  collectedAmount?: number;
}

export class StartPreparationDto {
  /** Ignored: the session operator is always the authenticated user. Kept for client compatibility. */
  @IsOptional()
  @IsString()
  operatorId?: string;
}

export class ScanItemDto {
  /** Manufacturer barcode as scanned; resolved through the SKU's primary code or a reviewed alias. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcodeScanned?: string;

  /** Manual identity verification of ONE unit: the SKU the operator checked by hand. */
  @IsOptional()
  @IsUUID()
  skuId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  manualReason?: string;

  @IsOptional()
  @IsArray()
  @IsIn(MANUAL_IDENTITY_CHECKS, { each: true })
  manualChecks?: string[];

  /** Client-generated id of this physical scan; a retry after a timeout returns the original (RT14). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientScanId?: string;
}

/**
 * Events a client may record. LABEL_GENERATED is server-only (written when label data is produced);
 * LABEL_PRINTED / RECEIPT_PRINTED / PRINT_FAILED are the operator's confirmation of the paper outcome.
 */
export const SHIPMENT_EVENT_TYPES = [
  'PACKED', 'LABEL_PRINTED', 'RECEIPT_PRINTED', 'PRINT_FAILED',
  'HANDOFF_SCANNED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'RETURNED', 'RECEIVED_BACK',
] as const;


export class RecordShipmentEventDto {
  @IsString()
  @IsIn(SHIPMENT_EVENT_TYPES)
  type: string;

  /** Ignored: the event actor is always the authenticated user. Kept for client compatibility. */
  @IsOptional()
  @IsString()
  actorId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /** Typed reason; required for FAILED. */
  @IsOptional()
  @IsIn(DELIVERY_FAILURE_REASONS)
  reasonCode?: string;

  /** Label barcode scanned at handoff; required for HANDOFF_SCANNED, RECEIVED_BACK and RETURNED. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string;
  /** Cash the driver actually received at the door; required when a driver delivers a COD order (GLO-214). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  collectedAmount?: number;
}

export class CreateDeliveryBatchDto {
  @IsString()
  @IsNotEmpty()
  hubId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  driverId?: string;
}

export class DeliveryStopInputDto {
  @IsString()
  @IsNotEmpty()
  shipmentId: string;

  @IsOptional()
  sequence?: number; // Optional. If missing, append to end.
}

export class AddStopsToBatchDto {
  @IsNotEmpty()
  stops: DeliveryStopInputDto[];
}

export class UpdateStopSequenceDto {
  @IsNotEmpty()
  stops: DeliveryStopInputDto[]; // { shipmentId, sequence }
}

export class AdjustInventoryDto {
  @IsString()
  @IsNotEmpty()
  locationId: string;

  @IsString()
  @IsNotEmpty()
  skuId: string;

  @IsNotEmpty()
  quantity: number; // positive for adding, negative for removing

  @IsString()
  @IsNotEmpty()
  type: string; // RECEIVE_OWNED, RESERVE, RELEASE, PICK, ADJUST, DAMAGE, RETURN_TO_STOCK

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsString()
  @IsNotEmpty()
  actorId: string;

  @IsOptional()
  @IsString()
  referenceId?: string;
}

/** Hub shipment queue filters (GLO-239). */
export class HubShipmentQueryDto {
  @IsOptional()
  @IsIn(['pending', 'ready_to_prepare', 'preparing', 'prepared', 'ready_to_pack', 'packing', 'packed', 'dispatched', 'out_for_delivery', 'delivered', 'failed', 'returned', 'cancelled'], { each: true })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.split(',') : value))
  status?: ShipmentStatus[];

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  take?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  skip?: number;
}

export class HubRunQueryDto {
  @IsOptional()
  @IsIn(['planning', 'dispatched', 'completed'], { each: true })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.split(',') : value))
  status?: string[];

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  take?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  skip?: number;
}
