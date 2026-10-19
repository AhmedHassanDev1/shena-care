import { ApiError } from '@/lib/api-client';

/** Only same-origin paths are valid return targets; anything else falls back to the home page. */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  return value;
}

/**
 * Egyptian mobile number as typed → national number without the leading 0. Accepts Arabic-Indic digits, spaces and
 * dashes, an optional leading 0 and an optional +20 / 0020 prefix. Returns null when it is not 1XXXXXXXXX.
 */
export function normalizeEgyptianMobile(input: string): string | null {
  const digits = toLatinDigits(input).replace(/\D/g, '');
  const national = digits.replace(/^(0020|20)(?=1\d{9}$)/, '').replace(/^0(?=1\d{9}$)/, '');
  return /^1\d{9}$/.test(national) ? national : null;
}

/** A number written with another country code (+44…, 0044…): the API rejects it as non-Egyptian. */
export function isForeignNumber(input: string): boolean {
  const latin = toLatinDigits(input).trim();
  return /^(\+|00)/.test(latin) && !/^(\+|00)\s*20/.test(latin);
}

export function toLatinDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** International (+20…) → local 01… grouped as the boards show it: «010 0000 4567» (always Western digits, LTR). */
export function displayMobile(international: string): string {
  const national = normalizeEgyptianMobile(international);
  if (!national) return international;
  const local = `0${national}`;
  return `${local.slice(0, 3)} ${local.slice(3, 7)} ${local.slice(7)}`;
}

/** The API's machine-readable error code (accounts / ordering), wherever the error filter nested it. */
export function apiErrorCode(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const data = error.data as { code?: string; message?: { code?: string } } | undefined;
  return data?.code ?? (typeof data?.message === 'object' ? data?.message?.code : undefined);
}

/** `retryAfter` (seconds) on a limited response (OTP_COOLDOWN / OTP_RATE_LIMITED). */
export function apiRetryAfter(error: unknown): number | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const data = error.data as { retryAfter?: number; message?: { retryAfter?: number } } | undefined;
  const value = data?.retryAfter ?? (typeof data?.message === 'object' ? data?.message?.retryAfter : undefined);
  return typeof value === 'number' && value > 0 ? value : undefined;
}

/** Network failure (fetch rejects with a TypeError) or a server error: the request itself did not get through. */
export function isTransportFailure(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof ApiError && (error.type === 'NETWORK' || error.type === 'SERVER'));
}

/**
 * The phone sign-in page for a task that needs an account (Addendum §Flow step 1): `returnTo` brings the customer
 * back to it; `reason=expired` explains that the session ran out mid-task.
 */
export function signInHref(returnTo: string, reason?: 'expired'): string {
  const params = new URLSearchParams({ returnTo });
  if (reason) params.set('reason', reason);
  return `/auth?${params}`;
}
