import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { MANUAL_IDENTITY_CHECKS } from './fulfillment.dto';

/** Actual purchase cost captured at physical receipt (GLO-315): list price and the discount obtained, per unit. */
export class DeskCostDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100000)
  listUnitPrice: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  discountPerUnit?: number;
}

/** One physical scan at the one-person Hub desk (GLO-315). */
export class DeskScanDto {
  /** Client-generated id of this physical scan; a retry returns the original outcome and never counts twice. */
  @IsUUID()
  clientScanId: string;

  /** Manufacturer barcode as scanned; resolved through the SKU's primary code or a reviewed alias. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcodeScanned?: string;

  /** Manual identity verification of ONE unit (no readable barcode): the SKU checked by hand. */
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

  /** Printed lot/batch when visible on the pack. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  lotNumber?: string;

  /** Printed expiry (YYYY-MM-DD); required to receive a unit, checked against the minimum shelf life. */
  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  /** Actual purchase cost of this unit, captured at receipt. Optional; without it the purchase cost stays pending. */
  @IsOptional()
  @ValidateNested()
  @Type(() => DeskCostDto)
  cost?: DeskCostDto;
}

/**
 * Registers the barcode of a product that has none, after the operator physically verified the exact product (brand, variant, size and pack)
 * against the order line. The code becomes an approved identity of that one SKU; it never rewrites catalog identity and is never accepted if
 * it already identifies anything else.
 */
export class RegisterBarcodeDto {
  /** Client-generated id of this registration; a retry returns the original outcome. */
  @IsUUID()
  clientScanId: string;

  /** The SKU of the order line the physical unit was verified as. */
  @IsUUID()
  skuId: string;

  /** The code as scanned or typed from the pack. */
  @IsString()
  @MinLength(8)
  @MaxLength(14)
  barcode: string;

  /** Every identity check the operator performed on the physical pack. */
  @IsArray()
  @IsIn(MANUAL_IDENTITY_CHECKS, { each: true })
  checks: string[];

  /** Why the code is not registered yet / what was compared (kept as audit evidence). */
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  note: string;
}

export const CORRECTION_REASONS = ['WRONG_UNIT_SCANNED', 'DUPLICATE_SCAN', 'DAMAGED_ON_INSPECTION', 'WRONG_ORDER', 'OTHER'] as const;

/** Compensating correction of one committed receipt scan. The original stays; a negative receipt points at it. */
export class ReverseReceiptDto {
  @IsUUID()
  idempotencyKey: string;

  @IsIn(CORRECTION_REASONS)
  reason: typeof CORRECTION_REASONS[number];

  @IsString()
  @MinLength(5)
  @MaxLength(300)
  note: string;
}

export const INSPECTION_RESULTS = ['SEALED_INTACT', 'OPENED_UNUSED', 'USED', 'DAMAGED', 'EXPIRED'] as const;
export const RETURN_DISPOSITIONS = ['RETURN_TO_SUPPLIER', 'WRITE_OFF', 'QUARANTINE'] as const;

/** Physical inspection of one returned line. Records what arrived; never a refund decision. */
export class InspectReturnDto {
  /** Client-generated id of this inspection; a retry replays the original. */
  @IsUUID()
  idempotencyKey: string;

  @IsUUID()
  orderItemId: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcodeScanned?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  manualReason?: string;

  @IsOptional()
  @IsArray()
  @IsIn(MANUAL_IDENTITY_CHECKS, { each: true })
  manualChecks?: string[];

  @IsIn(INSPECTION_RESULTS)
  result: typeof INSPECTION_RESULTS[number];

  /** Defaults from the result (sealed → supplier, anything else → write-off). Quarantine is always allowed and is forced for a safety report. */
  @IsOptional()
  @IsIn(RETURN_DISPOSITIONS)
  disposition?: typeof RETURN_DISPOSITIONS[number];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  lotNumber?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  expiryDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** Corrects an earlier inspection: a new row supersedes it, and the reason is kept. */
export class CorrectInspectionDto extends InspectReturnDto {
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  reason: string;
}
