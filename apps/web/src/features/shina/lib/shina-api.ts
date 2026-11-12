import { apiClient, ApiError } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import type {
  CustomerCareProfileSummary,
  ShinaGuidanceType,
  ShinaProduct,
  ShinaRoutinePreview,
  ShinaRoutineStep,
} from './shina-types';

export interface ApiResolvedProduct {
  productId: string;
  skuId: string;
  slug: string;
  name: string;
  brand: string;
  price: number;
  currency: string;
  variantName: string;
  category: string;
  imageUrl?: string | null;
  canOrder: boolean;
}

export interface GuidanceProposalStep {
  order: number;
  title: string;
  timing: 'am' | 'pm' | 'both' | 'as_needed';
  recommendedProductName?: string | null;
  instructions?: string | null;
  isOptional?: boolean;
}

export interface GuidanceProposal {
  name?: string | null;
  description?: string | null;
  careArea: 'skin' | 'hair';
  concernSlugs?: string[];
  amSteps?: GuidanceProposalStep[];
  pmSteps?: GuidanceProposalStep[];
  reasoning?: string | null;
}

export interface GuidanceMessageDto {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  proposal?: GuidanceProposal | null;
  type?: ShinaGuidanceType;
  resolvedProducts?: ApiResolvedProduct[];
  createdAt: string;
}

export interface GuidanceSessionDto {
  id: string;
  customerId: string;
  status: string;
  messages?: GuidanceMessageDto[];
  createdAt: string;
  updatedAt: string;
}

function requireToken(): string {
  const token = auth.getToken();
  if (!token) {
    throw new ApiError('Authentication required', 'UNAUTHENTICATED', 401);
  }
  return token;
}

export async function createGuidanceSession(signal?: AbortSignal): Promise<GuidanceSessionDto> {
  const token = requireToken();
  return apiClient.post<GuidanceSessionDto>('/guidance/sessions', {}, { token, signal });
}

export async function getGuidanceSession(sessionId: string, signal?: AbortSignal): Promise<GuidanceSessionDto> {
  const token = requireToken();
  return apiClient.get<GuidanceSessionDto>(`/guidance/sessions/${encodeURIComponent(sessionId)}`, {
    token,
    signal,
  });
}

export async function sendGuidanceMessage(
  sessionId: string,
  content: string,
  signal?: AbortSignal,
): Promise<GuidanceMessageDto> {
  const token = requireToken();
  return apiClient.post<GuidanceMessageDto>(
    `/guidance/sessions/${encodeURIComponent(sessionId)}/messages`,
    { content },
    { token, signal },
  );
}

export async function retryGuidanceMessage(sessionId: string, signal?: AbortSignal): Promise<GuidanceMessageDto> {
  const token = requireToken();
  return apiClient.post<GuidanceMessageDto>(
    `/guidance/sessions/${encodeURIComponent(sessionId)}/retry`,
    {},
    { token, signal },
  );
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

export function resolvedProductToShinaProduct(item: ApiResolvedProduct): ShinaProduct {
  return {
    id: item.productId,
    slug: item.slug,
    name: item.name,
    brand: item.brand,
    price: item.price,
    currency: item.currency || 'EGP',
    skuId: item.skuId,
    variantName: item.variantName,
    category: item.category,
    imageUrl: item.imageUrl ?? undefined,
    canOrder: Boolean(item.canOrder),
  };
}

function findMatchingResolvedProduct(
  recommendedName: string | null | undefined,
  resolved: ShinaProduct[],
): ShinaProduct | null {
  if (!recommendedName?.trim() || resolved.length === 0) return null;
  const target = recommendedName.trim().toLowerCase();
  return (
    resolved.find((item) => {
      const name = item.name.toLowerCase();
      const full = `${item.brand} ${item.name}`.toLowerCase();
      return name === target || full === target || target.includes(name) || full.includes(target);
    }) ?? null
  );
}

export function proposalToRoutinePreview(
  proposal: GuidanceProposal | null | undefined,
  resolvedProducts?: ApiResolvedProduct[],
): ShinaRoutinePreview | undefined {
  if (!proposal) return undefined;

  const am = proposal.amSteps ?? [];
  const pm = proposal.pmSteps ?? [];
  if (am.length === 0 && pm.length === 0) return undefined;

  const mappedProducts = (resolvedProducts ?? []).map(resolvedProductToShinaProduct);
  const toStep = (step: GuidanceProposalStep, fallbackTiming: 'am' | 'pm'): ShinaRoutineStep => ({
    order: step.order,
    title: step.title,
    timing: step.timing || fallbackTiming,
    instructions: step.instructions ?? null,
    isOptional: Boolean(step.isOptional),
    product: findMatchingResolvedProduct(step.recommendedProductName, mappedProducts),
  });

  const steps: ShinaRoutineStep[] = [
    ...am.map((step) => toStep(step, 'am')),
    ...pm.map((step) => toStep(step, 'pm')),
  ];

  return {
    title: proposal.name?.trim() || 'ShinaCare Routine',
    description: proposal.description ?? proposal.reasoning ?? null,
    careArea: proposal.careArea || 'skin',
    source: 'ai-guidance',
    steps,
  };
}
