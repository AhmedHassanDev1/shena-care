import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

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
