import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export const ALLOWED_REVIEW_SKIN_TYPES = ['normal', 'dry', 'oily', 'combination', 'sensitive'] as const;
export type ReviewSkinType = (typeof ALLOWED_REVIEW_SKIN_TYPES)[number];

function trimOptionalText({ value }: { value: unknown }): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export class CreateProductReviewDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @Transform(trimOptionalText)
  @IsString()
  @MaxLength(2000)
  body?: string | null;

  @IsOptional()
  @Transform(trimOptionalText)
  @IsString()
  @MaxLength(120)
  title?: string | null;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsIn(ALLOWED_REVIEW_SKIN_TYPES)
  skinType?: ReviewSkinType;

  @IsOptional()
  @IsUUID()
  skuId?: string;
}
