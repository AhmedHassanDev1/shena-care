import type { Locale } from './messages';

/**
 * Plain number for UI copy (counts, timers, code lengths). Western digits with a comma for thousands in
 * both languages: the design system never mixes Arabic-Indic digits into prices, sizes, codes or quantities.
 */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function formatCurrency(amount: number, currency: string, locale: Locale): string {
  try {
    return new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', {
      style: 'currency',
      currency,
    }).format(amount);
  } catch {
    return `${formatNumber(amount)} ${currency}`;
  }
}

/**
 * Storefront price. The catalog is priced in Egyptian pounds only; any other currency code means the
 * data is not trustworthy for display, so no price is rendered (returns null).
 * Latin digits keep prices aligned across Arabic and English UI and pair with `tabular-nums`.
 */
export function formatEgp(amount: number, currency: string, locale: Locale): string | null {
  if (currency !== 'EGP' || !Number.isFinite(amount)) return null;
  const value = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(amount);
  return locale === 'ar' ? `${value} ج.م` : `EGP ${value}`;
}

const SIZE_UNITS_AR: Record<string, string> = { ml: 'مل', l: 'لتر', g: 'جم', kg: 'كجم', mg: 'ملجم' };

/** "500 مل" / "500 ml". Returns null when the SKU has no size. */
export function formatPackSize(size: number | null, unit: string | null, locale: Locale): string | null {
  if (size === null || !Number.isFinite(size) || size <= 0) return null;
  const value = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(size);
  const normalized = unit?.trim().toLowerCase() ?? '';
  if (!normalized) return value;
  return `${value} ${locale === 'ar' ? SIZE_UNITS_AR[normalized] ?? unit : unit}`;
}

export function formatDate(value: string | Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', {
    dateStyle: 'medium',
  }).format(new Date(value));
}
