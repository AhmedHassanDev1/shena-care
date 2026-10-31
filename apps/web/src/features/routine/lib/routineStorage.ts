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
}

const STORAGE_KEY = 'shinacare_saved_customer_routine';
const TRACKER_STORAGE_KEY = 'shinacare_daily_tracker_checks';

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
