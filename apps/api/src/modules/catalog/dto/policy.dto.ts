import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class PolicyBrandRuleDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsIn(['ALLOW', 'DENY'])
  effect: 'ALLOW' | 'DENY';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  aliases?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class PolicyCategoryRuleDto {
  @IsUUID()
  id: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsIn(['ALLOW', 'DENY'])
  effect: 'ALLOW' | 'DENY';

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class PolicyBrandCategoryRuleDto {
  @IsOptional()
  @IsUUID()
  brandId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  brandName: string;

  @IsUUID()
  categoryId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  categoryName: string;

  @IsIn(['ALLOW', 'DENY'])
  effect: 'ALLOW' | 'DENY';

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class UpdateCatalogPolicyDto {
  @IsIn(['OPEN', 'ALLOWLIST_ONLY'])
  mode: 'OPEN' | 'ALLOWLIST_ONLY';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PolicyBrandRuleDto)
  brands: PolicyBrandRuleDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PolicyCategoryRuleDto)
  categories: PolicyCategoryRuleDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PolicyBrandCategoryRuleDto)
  brandCategoryRules: PolicyBrandCategoryRuleDto[];

  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  excludedTerms: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  disabledExcludedClasses?: string[];

  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(300)
  reason: string;
}

export class EvaluatePolicyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title: string;

  @IsOptional()
  @IsUUID()
  brandId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  brandName?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string;

  @IsOptional()
  @IsBoolean()
  hasHardIdentifier?: boolean;
}
