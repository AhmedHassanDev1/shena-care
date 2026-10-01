import { IsString, IsNotEmpty, IsBoolean, IsOptional, IsEnum } from 'class-validator';
import { ShipmentStatus } from '@prisma/client';

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
