import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class EligibilityBrandRuleDto {
  @IsUUID() id: string;
  @IsIn(['ALLOW', 'DENY', null]) effect: 'ALLOW' | 'DENY' | null;
  @IsArray() @ArrayMaxSize(40) @IsString({ each: true }) @MaxLength(200, { each: true }) aliases: string[];
}
export class EligibilityCategoryRuleDto {
  @IsUUID() id: string;
  @IsIn(['ALLOW', 'DENY', null]) effect: 'ALLOW' | 'DENY' | null;
  @IsOptional() @IsArray() @ArrayMaxSize(40) @IsString({ each: true }) @MaxLength(200, { each: true }) aliases?: string[];
}
export class EligibilityCategoryMappingDto {
  @IsUUID() supplierId: string;
  @IsString() @MinLength(1) @MaxLength(200) label: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('all', { each: true }) categoryIds: string[];
}
export class PreviewEligibilityPolicyDto {
  @IsInt() @Min(0) expectedVersion: number;
  @IsString() @MinLength(5) @MaxLength(1000) reason: string;
  @IsArray() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => EligibilityBrandRuleDto)
  brands: EligibilityBrandRuleDto[];
  @IsArray() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => EligibilityCategoryRuleDto)
  categories: EligibilityCategoryRuleDto[];
  @IsArray() @ArrayMaxSize(5000) @ValidateNested({ each: true }) @Type(() => EligibilityCategoryMappingDto)
  mappings: EligibilityCategoryMappingDto[];
}
export class RetryEligibilityDto {
  @IsString() @MinLength(5) @MaxLength(1000) reason: string;
}
export class EligibilityAliasDto {
  @IsUUID() id: string;
  @IsArray() @ArrayMaxSize(40) @IsString({ each: true }) @MaxLength(200, { each: true }) aliases: string[];
}
/** Name interpretation only: intentionally no ALLOW/DENY fields. */
export class PreviewEligibilityMappingsDto {
  @IsInt() @Min(0) expectedVersion: number;
  @IsString() @MinLength(5) @MaxLength(1000) reason: string;
  @IsArray() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => EligibilityAliasDto) brands: EligibilityAliasDto[];
  @IsArray() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => EligibilityAliasDto) categories: EligibilityAliasDto[];
  @IsArray() @ArrayMaxSize(5000) @ValidateNested({ each: true }) @Type(() => EligibilityCategoryMappingDto) mappings: EligibilityCategoryMappingDto[];
}
export class RecheckEligibilityGroupDto extends RetryEligibilityDto {
  @IsUUID() supplierId: string;
  @IsString() @MaxLength(200) brand: string;
  @IsString() @MaxLength(200) category: string;
  @IsInt() @Min(1) expectedVersion: number;
}
/** One Brand's intake rules. Each present field is one explicit change; the server publishes the next approved version. */
export class UpdateBrandPolicyDto {
  @IsInt() @Min(0) expectedVersion: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(300) @IsUUID('all', { each: true }) categoryIds?: string[];
  @IsOptional() @IsUUID() excludeProductId?: string;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
  @IsOptional() @IsUUID() restoreProductId?: string;
  /** Names this brand is also known by (reviewed). Merged into the brand's aliases; never removes one. */
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(120, { each: true }) addAliases?: string[];
}
export class CreatePolicyBrandDto {
  @IsInt() @Min(0) expectedVersion: number;
  @IsString() @MinLength(2) @MaxLength(120) name: string;
}
/** Smart Add Brand step 1: look the name up online. A website, when the Admin already knows it, replaces the web search. */
export class ResearchBrandDto {
  @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(300) websiteUrl?: string;
  /** How suppliers also write this brand (e.g. the Arabic spelling the Admin first typed). Kept as an alias, never researched. */
  @IsOptional() @IsString() @MaxLength(120) alias?: string;
}
/** Smart Add Brand step 2: the reviewed result. Anything left out is simply not stored; the server re-derives which fields are verified. */
export class SaveResearchedBrandDto {
  @IsInt() @Min(0) expectedVersion: number;
  @IsOptional() @IsUUID() draftId?: string;
  @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(300) websiteUrl?: string;
  @IsOptional() @IsString() @MaxLength(600) description?: string;
  @IsOptional() @IsString() @MaxLength(80) countryOfOrigin?: string;
  @IsOptional() @IsString() @MaxLength(160) parentCompany?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(120, { each: true }) aliases?: string[];
  @IsOptional() @IsBoolean() useLogo?: boolean;
}
