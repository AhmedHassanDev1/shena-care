import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, Matches, IsNotEmpty, MinLength } from 'class-validator';

export const DISCOVERY_SORTS = ['relevance', 'name-asc', 'price-asc', 'price-desc'] as const;
export type DiscoverySort = typeof DISCOVERY_SORTS[number];

export class DiscoveryQueryDto {
  @IsOptional() @IsIn(DISCOVERY_SORTS)
  sort?: DiscoverySort;

  @IsOptional() @IsString() @MaxLength(120)
  q?: string;

  @IsOptional() @IsString() @MaxLength(160) @Matches(/^[a-z0-9-]+$/)
  category?: string;

  @IsOptional() @IsString() @MaxLength(160) @Matches(/^[a-z0-9-]+$/)
  brand?: string;

  @IsOptional() @IsString() @MaxLength(160) @Matches(/^[a-z0-9-]+$/)
  productLine?: string;

  @IsOptional() @IsString() @MaxLength(160) @Matches(/^[a-z0-9-]+$/)
  concern?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @IsString() @MaxLength(1024) @Matches(/^[A-Za-z0-9_-]+$/)
  cursor?: string;
}

export class SuggestQueryDto {
  @IsString() @IsNotEmpty() @MinLength(2) @MaxLength(120) @Matches(/\S/)
  q: string;

  @IsOptional() @IsString() @MaxLength(160) @Matches(/^[a-z0-9-]+$/)
  category?: string;

  @IsOptional() @IsString() @MaxLength(160) @Matches(/^[a-z0-9-]+$/)
  brand?: string;

  @IsOptional() @IsString() @MaxLength(160) @Matches(/^[a-z0-9-]+$/)
  productLine?: string;

  @IsOptional() @IsString() @MaxLength(160) @Matches(/^[a-z0-9-]+$/)
  concern?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10)
  limit?: number;
}

export class ProductListQueryDto extends DiscoveryQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000)
  page?: number;
}
