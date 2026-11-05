import { IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import { PageQueryDto } from '../../../platform/api/paging.dto';

export class CaptureAcquisitionCostDto {
  @IsInt()
  @Min(1)
  quantity: number;

  /** Actual invoice unit cost in EGP. Never derived from a retail price, an assumed discount or a SupplierOffer. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  unitCost: number;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  invoiceRef: string;

  /** Needed only when one invoice carries two lines of this SKU at different costs. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  invoiceLineRef?: string;

  @IsOptional()
  @IsIn(['EGP'])
  currency?: 'EGP';

  /** The barcode scanned on the goods being costed; refused when it is not this line's SKU. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcodeScanned?: string;

  /** The supplier named on the invoice; refused when it is not the supplier of this purchase order. */
  @IsOptional()
  @IsUUID()
  expectedSupplierId?: string;

  @IsUUID()
  idempotencyKey: string;
}

export class CorrectAcquisitionCostDto {
  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  unitCost?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  quantity?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  invoiceRef?: string;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}

export class ListAcquisitionCostsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(['NOT_RECEIVED', 'COST_PENDING', 'COST_CAPTURED', 'COST_SNAPSHOT'])
  status?: 'NOT_RECEIVED' | 'COST_PENDING' | 'COST_CAPTURED' | 'COST_SNAPSHOT';

  @IsOptional()
  @IsUUID()
  purchaseOrderId?: string;
}
