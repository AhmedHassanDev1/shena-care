import { ArrayUnique, IsArray, IsBoolean, IsEnum, IsIn, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
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
  @IsIn(['OPTIMIZED', 'BACKGROUND_REMOVED', 'TEMPLATE_01', 'SAHEL_EDITORIAL'])
  transform: 'OPTIMIZED' | 'BACKGROUND_REMOVED' | 'TEMPLATE_01' | 'SAHEL_EDITORIAL';

  /** A specific registered template version; omitted, the active template of the SKU's category is used. */
  @IsOptional()
  @IsUUID()
  templateId?: string;

  /** Reviewer's statement that the pack is clear glass or plastic. */
  @IsOptional()
  @IsBoolean()
  transparentPackaging?: boolean;

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

  /** The reviewer looked at the warned-about image and accepts it. */
  @IsOptional()
  @IsBoolean()
  acceptQualityWarnings?: boolean;

  /** Where the texture was verified, for TEXTURE_SENSORY. */
  @IsOptional()
  @IsObject()
  evidence?: { textureSourceUrl?: string; labelText?: string };
}

const parseJsonField = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
};

export class RegisterMediaTemplateDto {
  /** Stable name of the template; registering an existing key adds a new version and retires the old one. */
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, { message: 'templateKey must be lowercase letters, digits and dashes' })
  @MaxLength(80)
  templateKey: string;

  @IsString()
  @MaxLength(200)
  name: string;

  /** Sent as a JSON string in the multipart form. */
  @IsOptional()
  @Transform(parseJsonField)
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  categoryIds?: string[];

  /** Placement and shadow rules, as a JSON string; omitted, the previous version's rules carry over. */
  @IsOptional()
  @Transform(parseJsonField)
  @IsObject()
  rules?: Record<string, unknown>;
}

export class SetMediaTemplateStateDto {
  @IsBoolean()
  isActive: boolean;
}

export class ReprocessMediaTemplateDto {
  @IsString()
  @MaxLength(80)
  templateKey: string;
}
