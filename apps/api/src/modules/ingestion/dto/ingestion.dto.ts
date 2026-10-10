import { IsString, IsNotEmpty, IsNumber, IsOptional, ValidateNested, IsArray, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class IngestionItemInput {
  @IsString()
  @IsNotEmpty()
  supplierSkuCode: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  brand: string;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsString()
  @IsNotEmpty()
  currency: string;
}

export class CreateIngestionJobDto {
  @IsString()
  @IsNotEmpty()
  supplierId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IngestionItemInput)
  items: IngestionItemInput[];
}

export class ApproveIngestionItemDto {
  @IsOptional()
  @IsString()
  matchedSkuId?: string;

  @IsOptional()
  createNewProduct?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  verifiedMediaUrls?: string[];
}

export class UpdateCandidateDto {
  @IsOptional()
  @IsString()
  supplierSkuCode?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsString()
  currency?: string;
}
