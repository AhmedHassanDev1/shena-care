import { IsArray, IsEnum, IsIn, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { MediaOriginType, MediaRightsStatus, MediaRole } from '@prisma/client';

export class RegisterMediaAssetDto {
  @IsUUID()
  skuId: string;

  @IsEnum(MediaRole)
  role: MediaRole;

  @IsEnum(MediaOriginType)
  originType: MediaOriginType;

  @IsString()
  @MaxLength(2048)
  sourceUrl: string;

  @IsString()
  @MaxLength(200)
  sourcePublisher: string;

  @IsIn(['OFFICIAL_MANUFACTURER', 'TRUSTED_DISTRIBUTOR'])
  sourceType: 'OFFICIAL_MANUFACTURER' | 'TRUSTED_DISTRIBUTOR';

  @IsEnum(MediaRightsStatus)
  rightsStatus: MediaRightsStatus;

  @IsOptional()
  @IsISO8601()
  capturedAt?: string;
}

export class DeriveMediaAssetDto {
  @IsIn(['OPTIMIZED', 'BACKGROUND_REMOVED', 'TEMPLATE_01'])
  transform: 'OPTIMIZED' | 'BACKGROUND_REMOVED' | 'TEMPLATE_01';

  /** Template 01 field colour, supplied by the caller from the design tokens. */
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  fieldColor?: string;
}

export class ReviewMediaAssetDto {
  @IsIn(['APPROVED', 'REJECTED'])
  decision: 'APPROVED' | 'REJECTED';

  @IsString()
  @MaxLength(500)
  reason: string;

  /** Ingredients the visual shows, for INGREDIENT_STORY; each must already be verified on this SKU. */
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  ingredientIds?: string[];

  /** Where the texture was verified, for TEXTURE_SENSORY. */
  @IsOptional()
  @IsObject()
  evidence?: { textureSourceUrl?: string };
}
