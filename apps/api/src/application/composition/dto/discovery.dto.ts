import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, Matches } from 'class-validator';

export class DiscoveryQueryDto {
  @IsOptional() @IsString() @MaxLength(120)
  q?: string;

  @IsOptional() @IsString() @MaxLength(160) @Matches(/^[a-z0-9-]+$/)
  category?: string;

  @IsOptional() @IsString() @MaxLength(160) @Matches(/^[a-z0-9-]+$/)
  brand?: string;

  @IsOptional() @IsString() @MaxLength(160) @Matches(/^[a-z0-9-]+$/)
  productLine?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @IsString() @MaxLength(1024) @Matches(/^[A-Za-z0-9_-]+$/)
  cursor?: string;
}

export class ProductListQueryDto extends DiscoveryQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000)
  page?: number;
}
