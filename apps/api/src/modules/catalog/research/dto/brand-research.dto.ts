import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

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
