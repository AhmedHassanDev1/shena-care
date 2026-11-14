import { apiClient } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import type { Locale } from '@/lib/i18n/messages';

/**
 * Care intelligence, exactly as the API returns it (apps/api modules/guidance and care/routine-compatibility).
 * The backend decides eligibility, safety, availability and price; the storefront renders.
 */

export type Basis = 'VERIFIED' | 'EVIDENCE' | 'RULE';
export type TriState = 'YES' | 'NO' | 'UNKNOWN';
export type SkinType = 'normal' | 'dry' | 'oily' | 'combination' | 'sensitive';

export interface SourceRef {
  title: string;
  url: string | null;
  professionallyReviewed: boolean;
}

export interface RecommendedItem {
  productId: string;
  skuId: string;
  slug: string;
  name: string;
  brand: string;
  brandSlug: string;
  productType: string | null;
  role: string | null;
  careArea: 'skin' | 'hair' | null;
  variantName: string | null;
  sizeLabel: string | null;
  size: number | null;
  sizeUnit: string | null;
  imageUrl: string | null;
  category: { slug: string; name: string } | null;
  price: { amount: number; currency: string; compareAtAmount: number | null };
  canOrder: true;
  matchLevel: 'STRONG' | 'GOOD' | 'BASIC';
  reasons: Array<{ code: string; basis: Basis; text: string; concernSlug?: string; source?: SourceRef }>;
  cautions: Array<{ code: string; basis: Basis; text: string; source?: SourceRef }>;
  unknowns: Array<{ code: string; text: string }>;
  keyActives: Array<{ name: string; level: 'STATED' | 'FEATURED' | 'NAMED'; concentration: string | null }>;
  usage: { text: string | null; period: string | null; verified: boolean };
}

export type SafetyCondition = 'PREGNANT' | 'BREASTFEEDING' | 'PRESCRIPTION_TOPICAL' | 'ORAL_RETINOID';

export interface RecommendationResult {
  engineVersion: string;
  items: RecommendedItem[];
  excluded: Array<{ productId: string; name: string; code: string; text: string }>;
  needsSafetyAnswer: SafetyCondition[];
  unresolvedSensitivities: string[];
  consideredCount: number;
  generatedAt: string;
}

export interface RecommendationRequest {
  careArea?: 'skin' | 'hair';
  concerns?: string[];
  productTypes?: string[];
  skinType?: SkinType;
  fragranceFree?: boolean;
  safety?: Partial<Record<'pregnant' | 'breastfeeding' | 'prescriptionTopical' | 'oralRetinoid', TriState>>;
  limit?: number;
  perTypeLimit?: number;
  locale?: Locale;
}

export interface ConcernShelfEntry {
  slug: string;
  name: string;
  careArea: 'skin' | 'hair';
  productCount: number;
  heldForSafety: boolean;
  productTypes: string[];
  leadImageUrl: string | null;
}

export interface KnowledgeView {
  id: string;
  topic: string;
  subject: { type: string; key: string };
  concernSlug: string | null;
  statement: string;
  evidenceClass: 'VERIFIED_FACT' | 'EVIDENCE_SUPPORTED' | 'INFERENCE' | string;
  professionallyReviewed: boolean;
  source: { title: string; url: string | null; type: string; retrievedAt: string };
  strength?: 'PRIMARY' | 'SUPPORTIVE' | null;
}

export interface ConcernGuide {
  concernSlug: string;
  overview: KnowledgeView | null;
  whenToSeeAProfessional: KnowledgeView[];
  goodToKnow: KnowledgeView[];
  ingredients: KnowledgeView[];
  productTypes: KnowledgeView[];
}

export interface ReadyRoutineSummary {
  id: string;
  title: string;
  titleEn: string | null;
  description: string | null;
  careArea: string;
  concernSlug: string | null;
  steps: number;
}

export type Slot = 'AM' | 'PM' | 'AS_NEEDED';

export interface CompatibilityIssue {
  code: string;
  severity: 'BLOCK' | 'WARN' | 'INFO';
  textAr: string;
  textEn: string;
  skuIds: string[];
  ruleKey?: string;
  source?: { title: string; url: string | null };
}

export interface CompatibilityResult {
  version: string;
  ok: boolean;
  issues: CompatibilityIssue[];
  order: Record<Slot, string[]>;
}

export const getConcernShelf = () => apiClient.get<ConcernShelfEntry[]>('/guidance/concerns');

export const getConcernGuide = (slug: string, locale: Locale) =>
  apiClient.get<ConcernGuide>(`/guidance/knowledge/concerns/${encodeURIComponent(slug)}?locale=${locale}`);

export function getRecommendations(body: RecommendationRequest, signal?: AbortSignal) {
  // A signed-in customer's saved safety answers apply automatically on the server.
  const token = auth.getToken() ?? undefined;
  return apiClient.post<RecommendationResult>('/guidance/recommendations', body, { token, signal });
}

export const getReadyRoutines = (concernSlug?: string) =>
  apiClient.get<ReadyRoutineSummary[]>(`/care/ready-routines${concernSlug ? `?concern=${encodeURIComponent(concernSlug)}` : ''}`);

export function checkRoutine(steps: Array<{ skuId: string; timing: Slot }>, safety?: RecommendationRequest['safety'], signal?: AbortSignal) {
  const token = auth.getToken() ?? undefined;
  return apiClient.post<CompatibilityResult>('/care/routines/check', { steps, ...(safety ? { safety } : {}) }, { token, signal });
}

export interface SavedRoutine {
  id: string;
  title: string;
  replayed: boolean;
}

/** Saves an assistant routine the customer reviewed. `confirmed: true` is the customer's explicit choice, never implied. */
export function saveAiRoutine(body: {
  idempotencyKey: string;
  title: string;
  careArea: 'skin' | 'hair';
  steps: Array<{ title: string; timing: Slot; skuId: string; reason?: string }>;
}) {
  const token = auth.getToken();
  return apiClient.post<SavedRoutine>('/care/personal-routines/from-proposal', { ...body, confirmed: true }, { token: token ?? undefined });
}

/** Labels for a concern's product types, as the catalog's own product-type keys. */
export const PRODUCT_TYPE_LABELS: Record<Locale, Record<string, string>> = {
  ar: {
    cleanser: 'غسول', moisturizer: 'مرطّب', serum: 'سيروم', sunscreen: 'واقي شمس', toner: 'تونر', mask: 'ماسك', exfoliant: 'مقشّر',
    shampoo: 'شامبو', conditioner: 'بلسم', 'hair-mask': 'ماسك شعر', 'hair-oil': 'زيت شعر', 'hair-serum': 'سيروم شعر', 'leave-in': 'ليف إن',
  },
  en: {
    cleanser: 'Cleanser', moisturizer: 'Moisturizer', serum: 'Serum', sunscreen: 'Sunscreen', toner: 'Toner', mask: 'Mask', exfoliant: 'Exfoliant',
    shampoo: 'Shampoo', conditioner: 'Conditioner', 'hair-mask': 'Hair mask', 'hair-oil': 'Hair oil', 'hair-serum': 'Hair serum', 'leave-in': 'Leave-in',
  },
};

export const productTypeLabel = (type: string, locale: Locale) => PRODUCT_TYPE_LABELS[locale][type] ?? type;
