import { IsString, IsArray, IsInt, IsOptional, ValidateNested, IsEnum, IsUUID, Min, Max, MaxLength, IsNotEmpty, ArrayMinSize } from 'class-validator';
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

export class ConfirmPurchaseOrderLineDto {
  @IsString()
  id: string; // Line ID

  @IsEnum(PurchaseOrderLineStatus)
  status: PurchaseOrderLineStatus;

  @IsInt()
  @IsOptional()
  confirmedQuantity?: number;
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
