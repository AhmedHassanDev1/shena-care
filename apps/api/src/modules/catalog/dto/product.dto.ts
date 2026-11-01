import {
  IsString,
  IsNotEmpty,
  IsOptional,
  MinLength,
  Matches,
  IsBoolean,
  IsUUID,
  IsArray,
  ArrayUnique,
  ArrayMaxSize,
  MaxLength,
  IsEnum,
  IsInt,
  Min,
  Max,
  IsDateString,
} from 'class-validator';
import { UsageTargetArea, ProductTexture, UvFilterType } from '@prisma/client';

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  name: string;

  @IsUUID()
  @IsNotEmpty()
  brandId: string;

  @IsUUID()
  @IsOptional()
  productLineId?: string;

  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @IsString()
  @IsOptional()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Slug must consist of lowercase alphanumeric characters and single hyphens',
  })
  slug?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  usage?: string;

  @IsString()
  @IsOptional()
  warnings?: string;

  @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(20) @IsString({ each: true })
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { each: true }) @MaxLength(160, { each: true })
  concerns?: string[];

  @IsEnum(UsageTargetArea)
  @IsOptional()
  targetArea?: UsageTargetArea;

  @IsEnum(ProductTexture)
  @IsOptional()
  texture?: ProductTexture;

  @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(20) @IsString({ each: true })
  suitableSkinTypes?: string[];

  @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(20) @IsString({ each: true })
  suitableHairTypes?: string[];

  @IsInt()
  @Min(2)
  @Max(100)
  @IsOptional()
  spf?: number;

  @IsBoolean()
  @IsOptional()
  broadSpectrum?: boolean;

  @IsEnum(UvFilterType)
  @IsOptional()
  uvFilterType?: UvFilterType;

  @IsInt()
  @Min(1)
  @IsOptional()
  waterResistanceMinutes?: number;

  @IsBoolean()
  @IsOptional()
  isFragranceFree?: boolean;

  @IsBoolean()
  @IsOptional()
  isNonComedogenic?: boolean;

  @IsOptional()
  claimsEvidence?: Record<string, unknown>;

  @IsInt()
  @Min(1)
  @IsOptional()
  factVersion?: number;

  @IsDateString()
  @IsOptional()
  lastReviewedAt?: string | Date;

  @IsUUID()
  @IsOptional()
  lastReviewedBy?: string;

  @IsBoolean()
  @IsOptional()
  isPublished?: boolean;
}

export class UpdateProductDto {
  @IsString()
  @IsOptional()
  @MinLength(2)
  name?: string;

  @IsUUID()
  @IsOptional()
  brandId?: string;

  @IsUUID()
  @IsOptional()
  productLineId?: string | null;

  @IsUUID()
  @IsOptional()
  categoryId?: string | null;

  @IsString()
  @IsOptional()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Slug must consist of lowercase alphanumeric characters and single hyphens',
  })
  slug?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  usage?: string;

  @IsString()
  @IsOptional()
  warnings?: string;

  @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(20) @IsString({ each: true })
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { each: true }) @MaxLength(160, { each: true })
  concerns?: string[];

  @IsEnum(UsageTargetArea)
  @IsOptional()
  targetArea?: UsageTargetArea | null;

  @IsEnum(ProductTexture)
  @IsOptional()
  texture?: ProductTexture | null;

  @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(20) @IsString({ each: true })
  suitableSkinTypes?: string[];

  @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(20) @IsString({ each: true })
  suitableHairTypes?: string[];

  @IsInt()
  @Min(2)
  @Max(100)
  @IsOptional()
  spf?: number | null;

  @IsBoolean()
  @IsOptional()
  broadSpectrum?: boolean | null;

  @IsEnum(UvFilterType)
  @IsOptional()
  uvFilterType?: UvFilterType | null;

  @IsInt()
  @Min(1)
  @IsOptional()
  waterResistanceMinutes?: number | null;

  @IsBoolean()
  @IsOptional()
  isFragranceFree?: boolean | null;

  @IsBoolean()
  @IsOptional()
  isNonComedogenic?: boolean | null;

  @IsOptional()
  claimsEvidence?: Record<string, unknown> | null;

  @IsInt()
  @Min(1)
  @IsOptional()
  factVersion?: number;

  @IsDateString()
  @IsOptional()
  lastReviewedAt?: string | Date | null;

  @IsUUID()
  @IsOptional()
  lastReviewedBy?: string | null;

  @IsBoolean()
  @IsOptional()
  isPublished?: boolean;
}
