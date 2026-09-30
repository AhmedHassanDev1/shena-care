import { IsString, IsArray, IsInt, IsOptional, ValidateNested, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { PurchaseOrderLineStatus } from '@prisma/client';

export class CreatePurchaseOrderLineDto {
  @IsString()
  skuId: string;

  @IsInt()
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
