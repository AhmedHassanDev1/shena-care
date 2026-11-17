import { apiClient } from '@/lib/api-client';
import { auth } from '@/lib/auth';

/**
 * «My Routine» exactly as the API returns it (apps/api modules/care personal-routines). The backend owns product
 * identity, availability, price and every validation; the storefront renders and sends the whole routine back.
 */

export type StepTiming = 'AM' | 'PM' | 'AS_NEEDED';
export type CareArea = 'skin' | 'hair' | 'body';

export type ProductState = 'AVAILABLE' | 'UNAVAILABLE' | 'UNPUBLISHED' | 'INACTIVE' | 'MISSING' | 'UNKNOWN_VARIANT';

export interface RoutineProduct {
  skuId: string | null;
  productId: string;
  state: ProductState;
  productName: string | null;
  brandName: string | null;
  skuCode: string | null;
  variantName: string | null;
  size: number | null;
  sizeUnit: string | null;
  price: { amount: number; currency: string; compareAtAmount: number | null } | null;
}

export interface RoutineStep {
  id: string;
  order: number;
  timing: StepTiming;
  title: string;
  instructions: string | null;
  reason: string | null;
  isOptional: boolean;
  product: RoutineProduct | null;
  alternatives: RoutineProduct[];
}

export interface SavedRoutineView {
  id: string;
  title: string;
  careArea: string;
  origin: 'USER' | 'COPY' | 'AI' | string;
  version: number;
  status: string;
  sourceRoutineId: string | null;
  createdAt: string;
  updatedAt: string;
  steps: RoutineStep[];
}

export interface RoutineListItem {
  id: string;
  title: string;
  careArea: string;
  origin: string;
  sourceRoutineId: string | null;
  version: number;
  steps: number;
  updatedAt: string;
}

/** One step as the editor sends it: the product is identified by SKU only; the server resolves and verifies it. */
export interface StepPayload {
  title: string;
  timing: StepTiming;
  instructions?: string;
  isOptional?: boolean;
  product: { skuId: string };
  alternatives?: Array<{ skuId: string }>;
}

export interface RoutinePayload {
  title: string;
  careArea?: CareArea;
  steps: StepPayload[];
  /** Optimistic concurrency on replace: the version the editor loaded. */
  expectedVersion?: number;
}

export interface RoutineIssue {
  path: string;
  code: string;
  message: string;
  severity?: string;
}

const token = () => auth.getToken() ?? undefined;

export const listRoutines = () => apiClient.get<RoutineListItem[]>('/care/personal-routines', { token: token() });

export const getRoutine = (id: string) => apiClient.get<SavedRoutineView>(`/care/personal-routines/${encodeURIComponent(id)}`, { token: token() });

export const createRoutine = (body: RoutinePayload) => apiClient.post<SavedRoutineView>('/care/personal-routines', body, { token: token() });

export const replaceRoutine = (id: string, body: RoutinePayload) =>
  apiClient.put<SavedRoutineView>(`/care/personal-routines/${encodeURIComponent(id)}`, body, { token: token() });

export const deleteRoutine = (id: string) => apiClient.delete<{ deleted: true }>(`/care/personal-routines/${encodeURIComponent(id)}`, { token: token() });

export interface RoutineCartResult {
  /** Step ids whose product went into the cart. */
  added: string[];
  skipped: Array<{ roleKey: string; skuId: string; reason: string }>;
  unavailable?: Array<{ stepId: string; title: string; timing: string; skuId: string | null; state: string }>;
}

/** Adds the sellable main product of each step (optionally one time of day) to the cart; lines already there are never doubled. */
export const addRoutineToCart = (id: string, timing: StepTiming | 'ALL' = 'ALL') =>
  apiClient.post<RoutineCartResult>(`/care/personal-routines/${encodeURIComponent(id)}/cart`, timing === 'ALL' ? {} : { timing }, { token: token() });

/** Server validation issues of a refused save (422 ROUTINE_INVALID / UNSUPPORTED_CLAIM), if the error carries them. */
export function issuesOf(error: unknown): RoutineIssue[] {
  const data = (error as { data?: { message?: unknown } } | undefined)?.data;
  const body = data && typeof data.message === 'object' && data.message ? (data.message as { issues?: unknown }) : (data as { issues?: unknown } | undefined);
  return Array.isArray(body?.issues) ? (body!.issues as RoutineIssue[]) : [];
}

/** The machine code of a refused request (STALE_VERSION, ROUTINE_LIMIT, ROUTINE_INVALID, …), when the API sent one. */
export function codeOf(error: unknown): string | null {
  const data = (error as { data?: { code?: unknown; message?: unknown } } | undefined)?.data;
  if (!data) return null;
  if (typeof data.code === 'string') return data.code;
  const inner = data.message;
  return inner && typeof inner === 'object' && typeof (inner as { code?: unknown }).code === 'string' ? (inner as { code: string }).code : null;
}
