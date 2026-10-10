import { Injectable } from '@nestjs/common';

export type AiSizeUnit = 'ml' | 'l' | 'g' | 'kg' | 'oz' | 'unit';

export interface AiSizeSuggestion {
  value: number;
  unit: AiSizeUnit;
}

export interface AiProductEnrichmentSuggestions {
  normalizedTitle?: string | null;
  brand?: string | null;
  description?: string | null;
  size?: AiSizeSuggestion | null;
  barcode?: string | null;
  ingredients: string[];
  benefits: string[];
  usage: string[];
  warnings: string[];
}

export interface ProductEnrichmentInput {
  candidateRef: string;
  sourceType: string;
  rawTitle: string;
  brand?: string | null;
  barcode?: string | null;
  packageText?: string | null;
  description?: string | null;
  sourceUrl?: string | null;
  existingFields?: Record<string, string>;
  imageRefs?: string[];
}

export interface ProductEnrichmentResult {
  schemaVersion: '1';
  suggestions: AiProductEnrichmentSuggestions;
  confidence: Record<string, number>;
  warnings: string[];
  providerMetadata: Record<string, string>;
}

export interface GuidanceRecommendationRequest {
  customerId: string;
  profile: {
    skinType?: string | null;
    sensitivities?: string | null;
    concerns: string[];
  };
  chatHistory: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
}

export interface RoutineStepProposal {
  title: string;
  instructions?: string | null;
  timing: 'am' | 'pm' | 'both' | 'as_needed';
  isOptional: boolean;
  productQuery?: string | null;
}

export interface RoutineProposal {
  title: string;
  description?: string | null;
  careArea: 'skin' | 'hair';
  steps: RoutineStepProposal[];
}

export interface GuidanceRecommendationResult {
  schemaVersion: '1';
  message: string;
  proposal?: RoutineProposal | null;
}

export interface GeneratedContent {
  titleEn: string;
  titleAr: string;
  descriptionEn: string;
  descriptionAr: string;
  shortDescriptionEn: string;
  shortDescriptionAr: string;
  benefitsEn: string[];
  benefitsAr: string[];
  usageInstructionsEn?: string[];
  usageInstructionsAr?: string[];
  routineStepEn?: string | null;
  routineStepAr?: string | null;
  keywords: string[];
  seoTitleEn?: string | null;
  seoTitleAr?: string | null;
  seoDescriptionEn?: string | null;
  seoDescriptionAr?: string | null;
}

export interface ProductContentGenerationInput {
  candidateId: string;
  facts: any;
  researchEvidence?: any;
}

export interface ProductContentGenerationResult {
  schemaVersion: '1';
  content: GeneratedContent;
  providerMetadata: Record<string, string>;
}

export const AI_MODULE_OPTIONS = Symbol('AI_MODULE_OPTIONS');

export interface AiModuleOptions {
  baseUrl: string;
  timeoutMs: number;
}

export const AiErrorKind = {
  UNAVAILABLE: 'ai_unavailable',
  TIMEOUT: 'ai_timeout',
  INVALID_RESPONSE: 'ai_invalid_response',
  INCOMPATIBLE_SCHEMA: 'ai_incompatible_schema',
} as const;

export type AiErrorKindValue = (typeof AiErrorKind)[keyof typeof AiErrorKind];

export class AiClientError extends Error {
  constructor(
    public readonly kind: AiErrorKindValue,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'AiClientError';
  }
}

export const AI_CLIENT = Symbol('AI_CLIENT');

@Injectable()
export abstract class AiClient implements ProductEnrichmentCaller {
  abstract enrichProduct(input: ProductEnrichmentInput, correlationId?: string): Promise<ProductEnrichmentResult>;
  abstract recommendRoutine(input: GuidanceRecommendationRequest, correlationId?: string): Promise<GuidanceRecommendationResult>;
  abstract generateContent(input: ProductContentGenerationInput, correlationId?: string): Promise<ProductContentGenerationResult>;
}

export interface ProductEnrichmentCaller {
  enrichProduct(input: ProductEnrichmentInput, correlationId?: string): Promise<ProductEnrichmentResult>;
  generateContent(input: ProductContentGenerationInput, correlationId?: string): Promise<ProductContentGenerationResult>;
}
