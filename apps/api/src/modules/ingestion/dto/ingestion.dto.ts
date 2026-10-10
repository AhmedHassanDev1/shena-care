import { IsString, IsNotEmpty, IsNumber, IsOptional, ValidateNested, IsArray, Min, IsIn, IsUrl, ArrayMaxSize, IsBoolean } from 'class-validator';
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

export class CandidateMediaReviewDto {
  @IsString() @IsNotEmpty()
  url: string;
  @IsUrl({ protocols: ['https'], require_protocol: true })
  sourceUrl: string;
  @IsIn(['OFFICIAL_MANUFACTURER', 'TRUSTED_DISTRIBUTOR'])
  sourceType: 'OFFICIAL_MANUFACTURER' | 'TRUSTED_DISTRIBUTOR';
  @IsString() @IsNotEmpty()
  barcode: string;
  @IsNumber() @Min(0.001)
  size: number;
  @IsString() @IsNotEmpty()
  sizeUnit: string;
  @IsString() @IsNotEmpty()
  variantName: string;
}

export class ApproveIngestionItemDto {
  @IsOptional()
  @IsString()
  matchedSkuId?: string;

  @IsOptional()
  @IsBoolean()
  createNewProduct?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  verifiedMediaUrls?: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(20)
  @ValidateNested({ each: true }) @Type(() => CandidateMediaReviewDto)
  mediaReviews?: CandidateMediaReviewDto[];
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
