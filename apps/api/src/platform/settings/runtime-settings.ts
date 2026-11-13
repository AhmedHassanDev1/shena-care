/**
 * In-process view of the operational settings an Admin saved (`operations.app_settings`). The Settings service fills it at start-up,
 * after every change and on a short refresh interval; business code reads it synchronously and falls back to its own deployment default
 * (environment variable or built-in value) when no override exists. Nothing here touches the database, so it is safe to import from any
 * module without creating a dependency on Operations.
 */
const overrides = new Map<string, unknown>();

export function runtimeSetting<T>(key: string): T | undefined {
  return overrides.get(key) as T | undefined;
}

export function setRuntimeSetting(key: string, value: unknown): void {
  overrides.set(key, value);
}

export function clearRuntimeSetting(key: string): void {
  overrides.delete(key);
}

export function replaceRuntimeSettings(entries: Iterable<[string, unknown]>): void {
  overrides.clear();
  for (const [key, value] of entries) overrides.set(key, value);
}

export const SETTING_KEYS = {
  codEnabled: 'commerce.cod.enabled',
  deliveryPolicy: 'commerce.delivery.policy',
  deliveryAreas: 'commerce.delivery.areas',
  deliveryInternalCost: 'commerce.delivery.internal_cost',
  cartonCost: 'commerce.packaging.carton_cost',
  labelCost: 'commerce.packaging.label_cost',
  bagCost: 'commerce.packaging.bag_cost',
  boxCost: 'commerce.packaging.box_cost',
  profitSharePercent: 'finance.profit_share_percent',
  sourcingMode: 'operations.sourcing.mode',
  decisionWindowHours: 'operations.decision_window_hours',
  checkoutEnabled: 'storefront.checkout.enabled',
  businessPhone: 'business.phone',
  whatsappNumber: 'business.whatsapp.number',
  whatsappEnabled: 'business.whatsapp.enabled',
  facebookUrl: 'business.facebook.url',
  facebookEnabled: 'business.facebook.enabled',
} as const;
