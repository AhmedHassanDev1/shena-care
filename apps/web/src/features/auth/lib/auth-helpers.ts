import { ApiError } from '@/lib/api-client';
import type { Messages } from '@/lib/i18n/messages';

/**
 * Verification-code contract of the accounts API. The API does not return these values, so they
 * mirror apps/api: `VerifyOtpDto.code` must match /^\d{6}$/, and `AccountsService.sendOtp` rejects a
 * new code for the same number within one minute of the previous one (409).
 */
export const OTP_LENGTH = 6;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

/** Only same-origin paths are valid return targets; anything else falls back to the home page. */
export function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  return value;
}

/**
 * Egyptian mobile number as typed by the customer → national number without the leading 0.
 * Accepts Arabic-Indic digits, spaces and dashes, an optional leading 0 and an optional +20 / 0020 prefix.
 * Returns null when it is not a 10-digit mobile number starting with 1.
 */
export function normalizeEgyptianMobile(input: string): string | null {
  const digits = toLatinDigits(input).replace(/\D/g, '');
  const national = digits.replace(/^(0020|20)(?=1\d{9}$)/, '').replace(/^0(?=1\d{9}$)/, '');
  return /^1\d{9}$/.test(national) ? national : null;
}

export function toLatinDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** International (+20…) number → local 01… format, as Egyptian customers write it. */
export function toLocalMobile(international: string): string {
  const national = normalizeEgyptianMobile(international);
  return national ? `0${national}` : international;
}

/** Local format with the middle digits hidden: 010••••5678. Prefix and ending stay readable for recognition. */
export function maskMobile(international: string): string {
  const local = toLocalMobile(international);
  return local.length > 7 ? `${local.slice(0, 3)}${'•'.repeat(local.length - 7)}${local.slice(-4)}` : local;
}

/**
 * The API answers 409 both for the one-minute resend window and for the hourly limit. It sends no
 * machine-readable code, so the window is recognised by its message ("Please wait before requesting…").
 */
export function isResendCooldown(error: unknown): boolean {
  return error instanceof ApiError && error.type === 'CONFLICT' && /wait/i.test(error.message);
}

/** Localized message for a failed code request (send or resend). */
export function sendOtpErrorMessage(error: unknown, m: Messages, fallback: string): string {
  if (error instanceof ApiError && error.type === 'CONFLICT') {
    return isResendCooldown(error) ? m.authResendWait : m.authTooMany;
  }
  return otpErrorMessage(error, m, fallback);
}

export type VerifyFailure = 'invalid' | 'expired' | 'other';

/**
 * Every rejected code is a 401. A wrong code can be retried; an expired, exhausted or missing
 * challenge ("OTP has expired", "Max attempts reached…", "Invalid or expired OTP") needs a new code.
 */
export function classifyVerifyFailure(error: unknown): VerifyFailure {
  if (!(error instanceof ApiError) || (error.type !== 'UNAUTHENTICATED' && error.type !== 'VALIDATION')) {
    return 'other';
  }
  return /expired|max attempts/i.test(error.message) ? 'expired' : 'invalid';
}

/** Localized message for an OTP request failure. Raw backend text is never shown to customers. */
export function otpErrorMessage(error: unknown, m: Messages, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.type === 'RATE_LIMITED') return m.authTooMany;
    if (error.type === 'NETWORK') return m.authNetwork;
  } else if (error instanceof TypeError) {
    // fetch() rejects with a TypeError when the server cannot be reached.
    return m.authNetwork;
  }
  return fallback;
}
