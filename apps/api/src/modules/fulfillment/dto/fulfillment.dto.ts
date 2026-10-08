import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
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
  @IsString()
  @IsNotEmpty()
  operatorId: string;
}

export class ScanItemDto {
  @IsOptional()
  @IsString()
  skuId?: string;

  @IsOptional()
  @IsString()
  barcodeScanned?: string;
}

export class RecordShipmentEventDto {
  @IsString()
  @IsNotEmpty()
  type: string;

  @IsOptional()
  @IsString()
  actorId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
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
