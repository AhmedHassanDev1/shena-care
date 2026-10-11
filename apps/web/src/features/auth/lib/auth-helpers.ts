import { ApiError } from '@/lib/api-client';
import type { Messages } from '@/lib/i18n/messages';

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
