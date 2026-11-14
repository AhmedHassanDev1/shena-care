import { apiClient, ApiError } from '@/lib/api-client';
import type { Locale } from '@/lib/i18n/messages';
import { auth } from '@/lib/auth';
import type { CompatibilityIssue, KnowledgeView, RecommendedItem } from '@/features/care/api/care-intelligence';
import type {
  CustomerCareProfileSummary,
  ShinaGuidanceType,
  ShinaProduct,
  ShinaRoutinePreview,
  ShinaRoutineStep,
} from './shina-types';

/** One step of an assistant routine: the product the engine chose, the slot, and the manufacturer's own directions. */
export interface ConsultRoutineStep {
  slot: 'AM' | 'PM' | 'AS_NEEDED';
  why: string;
  howToUse: string | null;
  item: RecommendedItem;
}

/** The structured part of an assistant turn (apps/api guidance/consultation ConsultPayload). */
export interface ConsultPayload {
  version: number;
  /** AI = worded by the model from grounded data; FALLBACK = the AI was unavailable, engine output only. */
  source: 'AI' | 'FALLBACK';
  intent: string;
  language: Locale;
  recommendations: Array<RecommendedItem & { why: string }>;
  routine: { title: string; careArea: 'skin' | 'hair'; steps: ConsultRoutineStep[]; issues: CompatibilityIssue[]; canSave: boolean } | null;
  routineNote: string | null;
  citations: KnowledgeView[];
  followUpQuestion: string | null;
  quickReplies: string[];
  escalation: { required: boolean; reasons: Array<{ code: string; text: string }> } | null;
  excluded: Array<{ name: string; text: string }>;
  understood: Record<string, unknown>;
}

export interface GuidanceMessageDto {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  payload?: ConsultPayload | null;
  /** Older stored turns (before the consultation payload) only carry this. */
  type?: ShinaGuidanceType;
  createdAt: string;
}

export interface GuidanceSessionDto {
  id: string;
  status: string;
  understood?: Record<string, unknown>;
  messages?: GuidanceMessageDto[];
  createdAt: string;
}

/** Where the consultation was opened from, so it starts with that concern or product in mind. */
export interface ConsultPageContext {
  kind: 'home' | 'corner' | 'category' | 'product' | 'routine' | 'cart' | 'other';
  concernSlug?: string;
  categorySlug?: string;
  productSlug?: string;
}

function requireToken(): string {
  const token = auth.getToken();
  if (!token) {
    throw new ApiError('Authentication required', 'UNAUTHENTICATED', 401);
  }
  return token;
}

export async function createGuidanceSession(signal?: AbortSignal, page?: ConsultPageContext): Promise<GuidanceSessionDto> {
  const token = requireToken();
  return apiClient.post<GuidanceSessionDto>('/guidance/sessions', page ? { page } : {}, { token, signal });
}

export async function getGuidanceSession(sessionId: string, signal?: AbortSignal): Promise<GuidanceSessionDto> {
  const token = requireToken();
  return apiClient.get<GuidanceSessionDto>(`/guidance/sessions/${encodeURIComponent(sessionId)}`, { token, signal });
}

export async function sendGuidanceMessage(sessionId: string, content: string, signal?: AbortSignal, locale?: Locale): Promise<GuidanceMessageDto> {
  const token = requireToken();
  return apiClient.post<GuidanceMessageDto>(
    `/guidance/sessions/${encodeURIComponent(sessionId)}/messages`,
    locale ? { content, locale } : { content },
    { token, signal },
  );
}

export async function retryGuidanceMessage(sessionId: string, signal?: AbortSignal): Promise<GuidanceMessageDto> {
  const token = requireToken();
  return apiClient.post<GuidanceMessageDto>(`/guidance/sessions/${encodeURIComponent(sessionId)}/retry`, {}, { token, signal });
}

export async function getCustomerCareProfile(signal?: AbortSignal): Promise<CustomerCareProfileSummary | null> {
  const token = auth.getToken();
  if (!token) return null;
  try {
    return await apiClient.get<CustomerCareProfileSummary>('/care/profiles', { token, signal });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 401)) {
      return null;
    }
    throw error;
  }
}

/** A recommended catalog product as a chat card, carrying the reason it was recommended. */
export function recommendedToShinaProduct(item: RecommendedItem, why?: string): ShinaProduct {
  return {
    id: item.productId,
    slug: item.slug,
    name: item.name,
    brand: item.brand,
    price: item.price.amount,
    currency: item.price.currency,
    skuId: item.skuId,
    variantName: item.variantName ?? undefined,
    category: item.category?.name ?? '',
    imageUrl: item.imageUrl ?? undefined,
    canOrder: item.canOrder,
    rationale: why?.trim() || item.reasons[0]?.text,
  };
}

const SLOT_TIMING: Record<ConsultRoutineStep['slot'], ShinaRoutineStep['timing']> = { AM: 'am', PM: 'pm', AS_NEEDED: 'as_needed' };

/**
 * An assistant routine as the chat's routine card. Every step is a product the engine picked and the shared
 * compatibility rules checked; «how to use» is the manufacturer's text or nothing. `save` is only offered when the
 * backend allows it, and saving still needs the customer's own tap.
 */
export function consultRoutineToPreview(
  routine: ConsultPayload['routine'],
  locale: Locale,
  slotLabels: Record<ConsultRoutineStep['slot'], string>,
): ShinaRoutinePreview | undefined {
  if (!routine || routine.steps.length === 0) return undefined;
  const steps: ShinaRoutineStep[] = routine.steps.map((step, index) => ({
    order: index + 1,
    title: step.item.name,
    timing: SLOT_TIMING[step.slot],
    instructions: step.why || null,
    isOptional: false,
    roleLabel: slotLabels[step.slot],
    product: recommendedToShinaProduct(step.item, step.why),
  }));
  const issues = routine.issues
    .filter((issue) => issue.severity !== 'INFO' || issue.code === 'INGREDIENTS_UNVERIFIED')
    .map((issue) => ({ severity: issue.severity, text: locale === 'ar' ? issue.textAr : issue.textEn }));
  return {
    title: routine.title,
    description: null,
    careArea: routine.careArea,
    source: 'ai-guidance',
    steps,
    notes: issues.map((issue) => issue.text),
    save: routine.canSave
      ? {
          title: routine.title.slice(0, 120),
          careArea: routine.careArea,
          steps: routine.steps.map((step) => ({
            title: step.item.name.slice(0, 80),
            timing: step.slot,
            skuId: step.item.skuId,
            reason: step.why ? step.why.slice(0, 280) : undefined,
          })),
          issues,
        }
      : undefined,
  };
}
