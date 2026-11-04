import { IsBoolean, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class RecordRetailObservationDto {
  @IsUUID()
  skuId: string;

  @IsString()
  @MaxLength(2048)
  sourceUrl: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  sellerName: string;

  @IsNumber()
  priceEgp: number;

  @IsOptional()
  @IsNumber()
  regularPriceEgp?: number;

  @IsString()
  @MaxLength(3)
  currency: string;

  @IsISO8601()
  observedAt: string;

  /** The seller's own words for what is sold, so the pack can be compared with the SKU. */
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  packText: string;

  @IsOptional()
  @IsBoolean()
  inStock?: boolean;

  @IsNumber()
  @Min(0)
  @Max(1)
  confidence: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  evidenceExcerpt?: string;
}
