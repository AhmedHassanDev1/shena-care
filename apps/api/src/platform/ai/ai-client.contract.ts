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
  routineDraft?: any | null;
  catalogProducts?: string[];
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
  type: 'answer' | 'clarification' | 'shortlist' | 'proposal';
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

// ── Care consultation (services/ai: /v1/consult/understand and /v1/consult/respond) ─────────────────────────

export type ConsultTriState = 'YES' | 'NO' | 'UNKNOWN';
export type ConsultIntent =
  | 'recommend_products' | 'build_routine' | 'product_question' | 'ingredient_question'
  | 'routine_question' | 'general_care' | 'smalltalk' | 'out_of_scope';

/** What the consultation knows about the need. Never a name, phone, address or account id. */
export interface ConsultContext {
  careArea: 'skin' | 'hair' | null;
  concerns: string[];
  productTypes: string[];
  skinType: 'normal' | 'dry' | 'oily' | 'combination' | 'sensitive' | null;
  hairType: string | null;
  fragranceFree: boolean | null;
  budgetMax: number | null;
  sensitivities: string[];
  ownedProducts: string[];
  safety: { pregnant: ConsultTriState; breastfeeding: ConsultTriState; prescriptionTopical: ConsultTriState; oralRetinoid: ConsultTriState };
}

export interface ConsultPageContext {
  kind: 'home' | 'corner' | 'category' | 'product' | 'routine' | 'cart' | 'other';
  concernSlug?: string | null;
  categorySlug?: string | null;
  productName?: string | null;
}

export interface ConsultTurn { role: 'user' | 'assistant'; content: string }

export interface ConsultUnderstandRequest {
  /** The customer id; the client replaces it with a keyed pseudonym before it leaves the API. */
  customerId: string;
  locale: 'ar' | 'en';
  messages: ConsultTurn[];
  knownContext: ConsultContext;
  pageContext?: ConsultPageContext | null;
  concernVocabulary: Array<{ slug: string; name: string; careArea: 'skin' | 'hair' }>;
  productTypeVocabulary: string[];
}

export interface ConsultProviderMetadata {
  provider?: string; model?: string; usedFallback?: boolean; promptTokens?: number; completionTokens?: number; costUsd?: number; latencyMs?: number;
}

export interface ConsultUnderstandResult {
  schemaVersion: '1';
  intent: ConsultIntent;
  language: 'ar' | 'en';
  context: ConsultContext;
  mentionedProducts: string[];
  mentionedIngredients: string[];
  redFlags: Array<{ code: string; evidence: string }>;
  missing: string[];
  needsClarification: boolean;
  providerMetadata: ConsultProviderMetadata;
}

export interface ConsultCandidate {
  ref: string;
  name: string;
  brand: string;
  productType?: string | null;
  role?: string | null;
  size?: string | null;
  price?: string | null;
  period?: string | null;
  reasons: Array<{ code: string; text: string; basis: 'VERIFIED' | 'EVIDENCE' | 'RULE' }>;
  keyActives: string[];
  usage?: string | null;
  cautions: string[];
  unknowns: string[];
}

export interface ConsultKnowledgeItem {
  ref: string; subject: string; topic: string; statement: string; evidenceClass: string; source: string; professionallyReviewed: boolean;
}

export interface ConsultRespondRequest {
  customerId: string;
  locale: 'ar' | 'en';
  intent: ConsultIntent;
  messages: ConsultTurn[];
  context: ConsultContext;
  pageContext?: ConsultPageContext | null;
  candidates: ConsultCandidate[];
  excluded: string[];
  knowledge: ConsultKnowledgeItem[];
  routineDraft: Array<{ ref: string; slot: 'am' | 'pm' | 'as_needed'; role?: string | null }>;
  routineIssues: string[];
  escalation: string[];
  mustClarify: boolean;
  missing: string[];
}

export interface ConsultRespondResult {
  schemaVersion: '1';
  message: string;
  followUpQuestion: string | null;
  quickReplies: string[];
  recommendations: Array<{ ref: string; why: string }>;
  routine: { title: string; steps: Array<{ ref: string; slot: 'am' | 'pm' | 'as_needed'; why: string; howToUse: string | null }> } | null;
  citations: string[];
  providerMetadata: ConsultProviderMetadata;
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
  /** The AI gateway refused the call locally (per-minute window or daily cost ceiling). */
  LIMITED: 'ai_limited',
  /** The caller went away (or aborted) while the call was running. */
  CANCELLED: 'ai_cancelled',
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

/** What a streamed consultation answer reports while it is being written. */
export interface ConsultStreamHandlers {
  /** The next piece of the answer text, as the model writes it. */
  onDelta(text: string): void
  /** A retry started after text had been shown: everything shown so far must be discarded. */
  onReset(): void
  /** Aborting stops the call and the model's generation. */
  signal?: AbortSignal
}

export const AI_CLIENT = Symbol('AI_CLIENT');

@Injectable()
export abstract class AiClient implements ProductEnrichmentCaller {
  abstract enrichProduct(input: ProductEnrichmentInput, correlationId?: string): Promise<ProductEnrichmentResult>;
  abstract recommendRoutine(input: GuidanceRecommendationRequest, correlationId?: string): Promise<GuidanceRecommendationResult>;
  abstract generateContent(input: ProductContentGenerationInput, correlationId?: string): Promise<ProductContentGenerationResult>;
  abstract consultUnderstand(input: ConsultUnderstandRequest, correlationId?: string): Promise<ConsultUnderstandResult>;
  abstract consultRespond(input: ConsultRespondRequest, correlationId?: string): Promise<ConsultRespondResult>;

  /**
   * consultRespond that reports the answer text while it is written. A client that cannot stream (test doubles,
   * the offline provider) simply answers at once: the handlers are never called and the result is the same.
   */
  async consultRespondStream(input: ConsultRespondRequest, _handlers: ConsultStreamHandlers, correlationId?: string): Promise<ConsultRespondResult> {
    return this.consultRespond(input, correlationId);
  }
}

export interface ProductEnrichmentCaller {
  enrichProduct(input: ProductEnrichmentInput, correlationId?: string): Promise<ProductEnrichmentResult>;
  generateContent(input: ProductContentGenerationInput, correlationId?: string): Promise<ProductContentGenerationResult>;
}
