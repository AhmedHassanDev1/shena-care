import { apiClient } from '@/lib/api-client';

export interface SavedRoutineStepItem {
  id: string;
  num: string;
  period: 'morning' | 'evening';
  stepName: string;
  productName: string;
  brand: string;
  actives: string;
  usage: string;
  price: number;
  skuId: string;
  productSlug: string;
  isEssential: boolean;
}

export interface CustomerSavedRoutine {
  id: string;
  title: string;
  category: 'skin' | 'hair';
  concern: string;
  savedAt: string;
  morningSteps: SavedRoutineStepItem[];
  eveningSteps: SavedRoutineStepItem[];
  cloudRoutineId?: string;
  syncedAt?: string;
}

export interface SyncRoutineResult {
  status: 'SYNCED' | 'ALREADY_SYNCED' | 'CONFLICT' | 'KEPT_CLOUD' | 'OVERWRITTEN';
  routineId?: string;
  existingRoutine?: unknown;
  routine?: unknown;
}

export interface SyncRoutineOptions {
  force?: boolean;
  conflictResolution?: 'KEEP_CLOUD' | 'OVERWRITE_CLOUD' | 'IMPORT_AS_INACTIVE';
}

const STORAGE_KEY = 'shinacare_saved_customer_routine';
const TRACKER_STORAGE_KEY = 'shinacare_daily_tracker_checks';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getSavedCustomerRoutine(): CustomerSavedRoutine | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CustomerSavedRoutine;
  } catch {
    return null;
  }
}

export function saveCustomerRoutine(routine: CustomerSavedRoutine): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(routine));
  } catch {
    // Ignore storage errors
  }
}

export function clearSavedCustomerRoutine(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TRACKER_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function getDailyTrackerChecks(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(TRACKER_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function setDailyTrackerChecks(checks: Record<string, boolean>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(TRACKER_STORAGE_KEY, JSON.stringify(checks));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Synchronizes local customer routine to the canonical cloud CustomerRoutine via POST /care/me/routines/sync.
 * Ensures guest routines are preserved, prevents duplicate cloud imports, and handles conflicts.
 */
export async function syncSavedRoutineWithCloud(
  token: string,
  options?: SyncRoutineOptions
): Promise<SyncRoutineResult | null> {
  const routine = getSavedCustomerRoutine();
  if (!routine) return null;

  // Idempotency: If already synced to cloud and no forced resolution/re-sync requested, avoid redundant network calls
  if (routine.cloudRoutineId && !options?.force && !options?.conflictResolution) {
    return {
      status: 'ALREADY_SYNCED',
      routineId: routine.cloudRoutineId,
    };
  }

  const steps = [
    ...routine.morningSteps.map((s) => ({
      id: s.id,
      period: 'morning' as const,
      stepName: s.stepName,
      skuId: s.skuId && UUID_REGEX.test(s.skuId) ? s.skuId : undefined,
      roleKey: s.productSlug || undefined,
      isEssential: s.isEssential ?? true,
    })),
    ...routine.eveningSteps.map((s) => ({
      id: s.id,
      period: 'evening' as const,
      stepName: s.stepName,
      skuId: s.skuId && UUID_REGEX.test(s.skuId) ? s.skuId : undefined,
      roleKey: s.productSlug || undefined,
      isEssential: s.isEssential ?? true,
    })),
  ];

  const payload = {
    localId: routine.id,
    title: routine.title,
    category: routine.category,
    concernSlug: routine.concern,
    steps,
    conflictResolution: options?.conflictResolution,
  };

  const response = await apiClient.post<SyncRoutineResult>(
    '/care/me/routines/sync',
    payload,
    { token }
  );

  if (response && (response.status === 'SYNCED' || response.status === 'ALREADY_SYNCED' || response.status === 'OVERWRITTEN')) {
    if (response.routineId) {
      routine.cloudRoutineId = response.routineId;
      routine.syncedAt = new Date().toISOString();
      saveCustomerRoutine(routine);
    }
  }

  return response;
}
