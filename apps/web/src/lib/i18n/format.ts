import type { Locale } from './messages';

/**
 * Display formatting for the storefront (SAHEL V18 handoff §RTL 4, owner decision 2026-10-18):
 * the Arabic storefront shows prices, totals, quantities, counts and dates in Arabic-Indic digits with the Arabic
 * thousands separator (٣٬٣٢٠) and «ج.م» after the amount; English shows Western digits and "EGP 1,050".
 *
 * Display only: API payloads, stored values, calculations and validation never pass through these helpers.
 * Phone numbers, OTP codes, SKU codes and order/transaction references are technical identifiers and are
 * rendered as-is (Western digits, LTR) — never formatted here.
 */

const numberLocale = (locale: Locale) => (locale === 'ar' ? 'ar-EG' : 'en-US');

/** Count, quantity or step number in the active language: ٣ / 3, ١٬٢٥٠ / 1,250. */
export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(numberLocale(locale), { maximumFractionDigits: 2 }).format(value);
}

/** Amount without the currency label, for layouts that set «ج.م» / "EGP" in a smaller, lighter style. */
export function formatAmount(amount: number, locale: Locale): string {
  return new Intl.NumberFormat(numberLocale(locale), { maximumFractionDigits: 2 }).format(amount);
}

/** «ج.م» in Arabic, "EGP" in English. */
export function currencyLabel(locale: Locale): string {
  return locale === 'ar' ? 'ج.م' : 'EGP';
}

/**
 * Storefront price: «٣٬٣٢٠ ج.م» / "EGP 3,320". The catalog is priced in Egyptian pounds only; any other
 * currency means the data is not trustworthy for display, so no price is rendered (returns null).
 */
export function formatEgp(amount: number, currency: string, locale: Locale): string | null {
  if (currency !== 'EGP' || !Number.isFinite(amount)) return null;
  const value = formatAmount(amount, locale);
  return locale === 'ar' ? `${value} ${currencyLabel(locale)}` : `${currencyLabel(locale)} ${value}`;
}

const SIZE_UNITS_AR: Record<string, string> = { ml: 'مل', l: 'لتر', g: 'جم', gm: 'جم', kg: 'كجم', mg: 'ملجم' };

/** «٥٠٠ مل» / "500 ml". Returns null when the SKU has no size. */
export function formatPackSize(size: number | null, unit: string | null, locale: Locale): string | null {
  if (size === null || !Number.isFinite(size) || size <= 0) return null;
  const value = formatNumber(size, locale);
  const normalized = unit?.trim().toLowerCase() ?? '';
  if (!normalized) return value;
  return `${value} ${locale === 'ar' ? SIZE_UNITS_AR[normalized] ?? unit : unit}`;
}

const CAIRO = 'Africa/Cairo';

/** «١٨ أكتوبر ٢٠٢٦» / "Oct 18, 2026" (Cairo time). */
export function formatDate(value: string | Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', {
    day: 'numeric',
    month: locale === 'ar' ? 'long' : 'short',
    year: 'numeric',
    timeZone: CAIRO,
  }).format(new Date(value));
}

/** «٩:١٢ ص» / "9:12 AM" (Cairo time). */
export function formatTime(value: string | Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: CAIRO,
  }).format(new Date(value));
}

/** Countdown «m:ss» in the interface digits («١:٠٥» / "1:05"); announced once per state, never every second. */
export function formatClock(totalSeconds: number, locale: Locale): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const fmt = new Intl.NumberFormat(numberLocale(locale), { minimumIntegerDigits: 2, useGrouping: false });
  const minutes = new Intl.NumberFormat(numberLocale(locale), { useGrouping: false }).format(Math.floor(s / 60));
  return `${minutes}:${fmt.format(s % 60)}`;
}

/** «منتج واحد» / «منتجين» / «٣ منتجات» / «١٢ منتج» — Arabic number agreement; "1 product" / "3 products". */
export function formatProductCount(count: number, locale: Locale): string {
  if (locale === 'en') return `${formatNumber(count, locale)} ${count === 1 ? 'product' : 'products'}`;
  if (count === 1) return 'منتج واحد';
  if (count === 2) return 'منتجين';
  return count <= 10 ? `${formatNumber(count, locale)} منتجات` : `${formatNumber(count, locale)} منتج`;
}

/** Wraps a left-to-right run (a m:ss clock) in Unicode isolates so it keeps its order inside an Arabic sentence. */
export function isolateLtr(text: string): string {
  return `⁦${text}⁩`;
}
