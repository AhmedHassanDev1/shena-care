export enum BrandResolutionStatus {
  EXACT_MATCH = 'EXACT_MATCH',
  PENDING_DRAFT = 'PENDING_DRAFT',
  INVALID = 'INVALID',
}

export enum LineResolutionStatus {
  MATCHED = 'MATCHED',
  PENDING_DRAFT = 'PENDING_DRAFT',
  REJECTED_MARKETING_ADJECTIVE = 'REJECTED_MARKETING_ADJECTIVE',
  CROSS_BRAND_COLLISION = 'CROSS_BRAND_COLLISION',
}

export interface OfficialLogoMetadata {
  sourceUrl: string;
  sourceDomain: string;
  mediaType: 'image/svg+xml' | 'image/png' | 'image/webp';
  licenseType: 'EDITORIAL_BRAND_LOGO';
  isVerifiedOfficial: boolean;
  fetchedAt: string;
}

export interface OfficialLogoInput {
  logoUrl: string;
  sourceUrl: string;
  sourceDomain: string;
  mediaType: 'image/svg+xml' | 'image/png' | 'image/webp';
  licenseType: 'EDITORIAL_BRAND_LOGO';
  isVerifiedOfficial: boolean;
}

export interface BrandResolutionResult {
  status: BrandResolutionStatus;
  brandId: string | null;
  brandDraftId: string | null;
  canonicalName: string;
  name: string;
  slug: string;
  isNewDraft: boolean;
  aliases: string[];
}

export interface ProductLineResolutionResult {
  status: LineResolutionStatus;
  lineId: string | null;
  lineDraftId: string | null;
  name: string;
  slug: string;
  reason?: string;
}

export interface EnrichBrandDraftDto {
  websiteUrl?: string;
  countryOfOrigin?: string;
  descriptionEn?: string;
  descriptionAr?: string;
  logoInput?: OfficialLogoInput;
}

export interface OfficialLineImageMetadata {
  sourceUrl: string;
  sourceDomain: string;
  mediaType: 'image/svg+xml' | 'image/png' | 'image/webp' | 'image/jpeg';
  licenseType: string;
  isVerifiedOfficial: boolean;
  fetchedAt: string;
}

export interface OfficialLineImageInput {
  imageUrl: string;
  sourceUrl: string;
  sourceDomain: string;
  mediaType: 'image/svg+xml' | 'image/png' | 'image/webp' | 'image/jpeg';
  licenseType?: string;
  isVerifiedOfficial: boolean;
}

export interface EnrichProductLineDraftDto {
  descriptionEn?: string;
  descriptionAr?: string;
  imageInput?: OfficialLineImageInput;
}

