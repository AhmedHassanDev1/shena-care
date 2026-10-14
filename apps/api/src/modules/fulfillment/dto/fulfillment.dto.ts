import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
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
}

export class AllocateShipmentDto {
  @IsString()
  @IsNotEmpty()
  orderId: string;

  @IsString()
  @IsNotEmpty()
  locationId: string;
}

export class UpdateShipmentStatusDto {
  @IsEnum(ShipmentStatus)
  status: ShipmentStatus;

  @IsOptional()
  @IsString()
  trackingNumber?: string;
}

export class StartPreparationDto {
  /** Ignored: the session operator is always the authenticated user. Kept for client compatibility. */
  @IsOptional()
  @IsString()
  operatorId?: string;
}

export class ScanItemDto {
  @IsOptional()
  @IsString()
  skuId?: string;

  @IsOptional()
  @IsString()
  barcodeScanned?: string;
}

/**
 * Events a client may record. LABEL_GENERATED is server-only (written when label data is produced);
 * LABEL_PRINTED / RECEIPT_PRINTED / PRINT_FAILED are the operator's confirmation of the paper outcome.
 */
export const SHIPMENT_EVENT_TYPES = [
  'PACKED', 'LABEL_PRINTED', 'RECEIPT_PRINTED', 'PRINT_FAILED',
  'HANDOFF_SCANNED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'RETURNED',
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

  /** Label barcode scanned at handoff; required for HANDOFF_SCANNED. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string;
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
