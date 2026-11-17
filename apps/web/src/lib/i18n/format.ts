import type { Locale } from './messages';

/**
 * Display formatting for the storefront:
 * - Prices retain their localized representation (Arabic-Indic digits in Arabic: «٣٬٣٢٠ ج.م»,
 *   Western digits in English: "EGP 3,320").
 * - All other numbers across the entire website (counts, quantities, dates, times, pack sizes,
 *   percentages, and countdowns) are formatted using English / Western digits (0-9).
 *
 * Display only: API payloads, stored values, calculations and validation never pass through these helpers.
 * Phone numbers, OTP codes, SKU codes and order/transaction references are technical identifiers and are
 * rendered as-is (Western digits, LTR) — never formatted here.
 */

const priceNumberLocale = (locale: Locale) => (locale === 'ar' ? 'ar-EG' : 'en-US');

/** Count, quantity or step number in Western digits across all languages: 3, 1,250. */
export function formatNumber(value: number, _locale?: Locale): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

/** Whole percent from 0–100 in Western digits: 83%. */
export function formatPercent(value: number, _locale?: Locale): string {
  return new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 }).format(value / 100);
}

/** Amount for prices without currency label: «٣٬٣٢٠» in Arabic, "3,320" in English. */
export function formatAmount(amount: number, locale: Locale): string {
  return new Intl.NumberFormat(priceNumberLocale(locale), { maximumFractionDigits: 2 }).format(amount);
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

/** «500 مل» / "500 ml" (Western digits for packaging sizes). Returns null when the SKU has no size. */
export function formatPackSize(size: number | null, unit: string | null, locale: Locale): string | null {
  if (size === null || !Number.isFinite(size) || size <= 0) return null;
  const value = formatNumber(size, locale);
  const normalized = unit?.trim().toLowerCase() ?? '';
  if (!normalized) return value;
  return `${value} ${locale === 'ar' ? SIZE_UNITS_AR[normalized] ?? unit : unit}`;
}

const CAIRO = 'Africa/Cairo';

/** «18 أكتوبر 2026» / "Oct 18, 2026" (Cairo time, Western digits). */
export function formatDate(value: string | Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-EG', {
    day: 'numeric',
    month: locale === 'ar' ? 'long' : 'short',
    year: 'numeric',
    timeZone: CAIRO,
  }).format(new Date(value));
}

/** «9:12 ص» / "9:12 AM" (Cairo time, Western digits). */
export function formatTime(value: string | Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-EG', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: CAIRO,
  }).format(new Date(value));
}

/** Countdown «m:ss» in Western digits ("1:05"); announced once per state, never every second. */
export function formatClock(totalSeconds: number, _locale?: Locale): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const fmt = new Intl.NumberFormat('en-US', { minimumIntegerDigits: 2, useGrouping: false });
  const minutes = new Intl.NumberFormat('en-US', { useGrouping: false }).format(Math.floor(s / 60));
  return `${minutes}:${fmt.format(s % 60)}`;
}

/** «منتج واحد» / «منتجين» / «3 منتجات» / «12 منتج» — Arabic number agreement with Western digits; "1 product" / "3 products". */
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

/** «18 أكتوبر · 9:12 ص» / "Oct 18 · 9:12 AM" (Cairo time): a stage time on the order timeline (OrdersD). */
export function formatDayTime(value: string | Date, locale: Locale): string {
  const day = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-EG', {
    day: 'numeric',
    month: locale === 'ar' ? 'long' : 'short',
    timeZone: CAIRO,
  }).format(new Date(value));
  return `${day} · ${formatTime(value, locale)}`;
}
