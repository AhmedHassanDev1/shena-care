import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const TRI = ['YES', 'NO', 'UNKNOWN'] as const;
export const LOCALES = ['ar', 'en'] as const;

/** Where the customer opened the consultation, so it can start from the concern, category or product they are looking at. */
export class PageContextDto {
  @IsOptional() @IsIn(['home', 'corner', 'category', 'product', 'routine', 'cart', 'other']) kind?: string;
  @IsOptional() @Matches(SLUG) concernSlug?: string;
  @IsOptional() @Matches(SLUG) categorySlug?: string;
  @IsOptional() @Matches(SLUG) productSlug?: string;
}

export class CreateGuidanceSessionDto {
  @IsOptional() @ValidateNested() @Type(() => PageContextDto) page?: PageContextDto;
}

export class SendGuidanceMessageDto {
  @IsString() @IsNotEmpty() @MaxLength(1500) content: string;
  @IsOptional() @IsIn(LOCALES) locale?: 'ar' | 'en';
}

export class SafetyAnswersDto {
  @IsOptional() @IsIn(TRI) pregnant?: 'YES' | 'NO' | 'UNKNOWN';
  @IsOptional() @IsIn(TRI) breastfeeding?: 'YES' | 'NO' | 'UNKNOWN';
  @IsOptional() @IsIn(TRI) prescriptionTopical?: 'YES' | 'NO' | 'UNKNOWN';
  @IsOptional() @IsIn(TRI) oralRetinoid?: 'YES' | 'NO' | 'UNKNOWN';
}

/** A recommendation request from a discovery surface (Corner, a category shelf). Everything is optional except intent. */
export class RecommendationRequestDto {
  @IsOptional() @IsIn(['skin', 'hair']) careArea?: 'skin' | 'hair';
  @IsOptional() @IsArray() @ArrayMaxSize(6) @Matches(SLUG, { each: true }) concerns?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(6) @Matches(SLUG, { each: true }) productTypes?: string[];
  @IsOptional() @IsIn(['normal', 'dry', 'oily', 'combination', 'sensitive']) skinType?: string;
  @IsOptional() @IsString() @MaxLength(40) hairType?: string;
  @IsOptional() @IsBoolean() fragranceFree?: boolean;
  @IsOptional() @IsNumber() @Min(1) @Max(1000000) budgetMax?: number;
  @IsOptional() @ValidateNested() @Type(() => SafetyAnswersDto) safety?: SafetyAnswersDto;
  @IsOptional() @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(80, { each: true }) sensitivities?: string[];
  @IsOptional() @IsInt() @Min(1) @Max(24) limit?: number;
  /** Cap per product type; omit for the engine default (2 when several types are in play). */
  @IsOptional() @IsInt() @Min(1) @Max(24) perTypeLimit?: number;
  @IsOptional() @IsIn(LOCALES) locale?: 'ar' | 'en';
}
