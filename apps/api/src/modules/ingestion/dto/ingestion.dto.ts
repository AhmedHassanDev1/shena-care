import { IsString, IsNotEmpty, IsNumber, IsOptional, ValidateNested, ValidateIf, IsArray, Min, Max, IsIn, IsUrl, ArrayMaxSize, ArrayMinSize, IsBoolean, IsUUID, IsInt, Matches, MaxLength } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { IngestionPriceType, IngestionImportMode } from '@prisma/client';

export class IngestionItemInput {
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MaxLength(200)
  supplierSkuCode: string;

  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MaxLength(300)
  name: string;

  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MaxLength(200)
  brand: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  barcode?: string;

  @IsOptional() @IsInt() @Min(1)
  sourceRow?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99)
  price: number;

  @IsOptional() @IsIn([IngestionPriceType.PURCHASE_COST, IngestionPriceType.RETAIL_REFERENCE])
  priceType?: IngestionPriceType;

  @IsOptional() @IsInt() @Min(0)
  reportedQuantity?: number;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z]{3}$/)
  currency: string;
}

export class CreateIngestionJobDto {
  @IsUUID()
  supplierId: string;

  @IsOptional() @IsUUID()
  sourceJobId?: string;

  @IsOptional() @IsIn([IngestionImportMode.FULL_SNAPSHOT, IngestionImportMode.PARTIAL_UPDATE])
  mode?: IngestionImportMode;

  @IsArray()
  @ArrayMinSize(1) @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => IngestionItemInput)
  items: IngestionItemInput[];
}

export class SupplierSourceUploadDto {
  @IsUUID()
  supplierId: string;

  @IsOptional()
  @IsIn([IngestionImportMode.FULL_SNAPSHOT, IngestionImportMode.PARTIAL_UPDATE])
  mode?: IngestionImportMode;
}

export class ReviewedContentFieldDto {
  @IsIn(['name', 'description', 'ingredients', 'usage', 'warnings'])
  field: 'name' | 'description' | 'ingredients' | 'usage' | 'warnings';
  @IsString() @IsNotEmpty() @MaxLength(10000) @Matches(/[\u0600-\u06ff]/)
  value: string;
  @IsUrl({ protocols: ['https'], require_protocol: true })
  sourceUrl: string;
  @IsIn(['OFFICIAL_MANUFACTURER', 'TRUSTED_DISTRIBUTOR'])
  sourceType: 'OFFICIAL_MANUFACTURER' | 'TRUSTED_DISTRIBUTOR';
}

export class ReviewCandidateContentDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5)
  @ValidateNested({ each: true }) @Type(() => ReviewedContentFieldDto)
  fields: ReviewedContentFieldDto[];
}

export class CandidateSourceEvidenceDto {
  @IsIn(['name', 'brand', 'barcode', 'size', 'description', 'ingredients', 'usage', 'warnings'])
  field: string;
  @ValidateIf(dto => dto.field !== 'size') @IsString() @IsNotEmpty() @MaxLength(10000)
  value?: string;
  @ValidateIf(dto => dto.field === 'size') @IsNumber() @Min(0.001) @Max(9999999.999)
  size?: number;
  @ValidateIf(dto => dto.field === 'size') @IsIn(['ml', 'g', 'kg', 'l', 'oz'])
  sizeUnit?: string;
  @IsUrl({ protocols: ['https'], require_protocol: true })
  sourceUrl: string;
  @IsIn(['OFFICIAL_MANUFACTURER', 'TRUSTED_DISTRIBUTOR'])
  sourceType: 'OFFICIAL_MANUFACTURER' | 'TRUSTED_DISTRIBUTOR';
  @IsString() @IsNotEmpty() @MaxLength(10000)
  excerpt: string;
}

export class RecordCandidateEvidenceDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(8)
  @ValidateNested({ each: true }) @Type(() => CandidateSourceEvidenceDto)
  fields: CandidateSourceEvidenceDto[];
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
  @IsOptional() @IsInt() @Min(1)
  packCount?: number;
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

  @IsOptional() @IsUUID()
  productLineId?: string;

  @IsOptional() @IsUUID()
  categoryId?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true })
  concernSlugs?: string[];

  @IsOptional() @IsUUID()
  routineStepId?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('4', { each: true })
  approvedIngredientIds?: string[];
}

export class UpdateCandidateDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty() @MaxLength(200)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  supplierSkuCode?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty() @MaxLength(300)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty() @MaxLength(200)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  brand?: string;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99)
  price?: number;

  @IsOptional() @IsIn([IngestionPriceType.PURCHASE_COST, IngestionPriceType.RETAIL_REFERENCE])
  priceType?: IngestionPriceType;

  @IsOptional() @IsInt() @Min(0)
  reportedQuantity?: number;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;
}

export class ColumnMappingInput {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  supplierSku: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  price: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  barcode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  quantity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  retailPrice?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  availability?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  discount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  units?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sourceTimestamp?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  currencyColumn?: string;
}

export class ApplyJobMappingDto {
  @ValidateNested()
  @Type(() => ColumnMappingInput)
  mapping: ColumnMappingInput;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  profileName?: string;
}

