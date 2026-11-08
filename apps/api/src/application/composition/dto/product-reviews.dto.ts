import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const REVIEW_SORTS = ['recent', 'helpful', 'rating_high', 'rating_low'] as const;

export class ProductReviewsQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 20, default: 6 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20)
  limit?: number;

  @ApiPropertyOptional({ enum: REVIEW_SORTS, default: 'recent' })
  @IsOptional() @IsIn(REVIEW_SORTS)
  sort?: (typeof REVIEW_SORTS)[number];

  @ApiPropertyOptional({ minimum: 1, maximum: 5, description: 'Only reviews with this star rating' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5)
  rating?: number;
}
