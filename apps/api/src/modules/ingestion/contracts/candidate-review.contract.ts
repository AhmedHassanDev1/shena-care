import { IngestionPriceType } from '@prisma/client';
import { IsOptional, IsString, IsNumber, Min, Max, IsIn, IsInt, Matches, MaxLength } from 'class-validator';

export class CorrectCandidateDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  barcode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.001)
  size?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  sizeUnit?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99)
  price?: number;

  @IsOptional()
  @IsIn([IngestionPriceType.PURCHASE_COST, IngestionPriceType.RETAIL_REFERENCE])
  priceType?: IngestionPriceType;

  @IsOptional()
  @IsInt()
  @Min(0)
  reportedQuantity?: number;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class RequestMoreInfoDto {
  @IsString()
  @MaxLength(1000)
  requestedInfo: string;
}

export interface CandidateAuditEntry {
  action: 'CORRECTED' | 'APPROVED' | 'REJECTED' | 'REQUESTED_MORE_INFO' | 'PUBLISHED';
  actorId: string;
  timestamp: string;
  reason?: string;
  requestedInfo?: string;
  publishedSkuId?: string;
  previousValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
}

export interface CandidateReviewRecord {
  candidateId: string;
  status: string;
  originalSupplierRow: {
    jobId: string;
    supplierId: string;
    supplierSkuCode: string;
    sourceFile?: {
      jobId: string;
      mode: string;
      createdAt: Date;
    };
    price: number;
    priceType: IngestionPriceType | null;
    currency: string;
    reportedQuantity: number | null;
  };
  normalizedIdentity: {
    name: string;
    brand: string;
    barcode: string | null;
    category?: string | null;
    size?: number | null;
    sizeUnit?: string | null;
    fingerprint: string;
    matchClassification: string;
    matchReason?: string;
    matchedSkuId: string | null;
    matchedSku?: unknown;
  };
  dependencies: {
    brand: {
      isCanonical: boolean;
      canonicalBrandId?: string;
      draftStatus?: string;
      name: string;
    };
    productLine?: {
      isCanonical: boolean;
      canonicalLineId?: string;
      draftStatus?: string;
      name?: string;
    };
    ingredients: {
      canonicalCount: number;
      activeIngredients: string[];
      cautions: string[];
      hasForbiddenSubstances: boolean;
    };
    routinePlacement?: {
      stepOrder?: number;
      stepType?: string;
      timing?: string;
      frequency?: string;
      requiresDaytimeSunscreen?: boolean;
      isPhotosensitizing?: boolean;
    };
    research?: {
      sourceCount: number;
      fieldEvidences: any[];
    };
  };
  contentAndMedia: {
    contentDraft?: {
      titleEn?: string | null;
      titleAr?: string | null;
      shortDescriptionEn?: string | null;
      shortDescriptionAr?: string | null;
      benefitsEn: string[];
      benefitsAr: string[];
      usageEn: string[];
      usageAr: string[];
      isApproved: boolean;
      evidenceVersion?: string | null;
    } | null;
    verifiedPackshots: any[];
    hasVerifiedPackshot: boolean;
    officialBrandLogo?: string | null;
  };
  policyAndQualityConflicts: string[];
  canPublish: boolean;
  auditTrail: CandidateAuditEntry[];
  createdAt: Date;
  updatedAt: Date;
}
