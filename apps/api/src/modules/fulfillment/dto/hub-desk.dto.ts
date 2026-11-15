import { IsArray, IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { MANUAL_IDENTITY_CHECKS } from './fulfillment.dto';

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
}
