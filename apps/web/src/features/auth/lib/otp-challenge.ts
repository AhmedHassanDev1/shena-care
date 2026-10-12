import { OTP_RESEND_COOLDOWN_SECONDS } from './auth-helpers';

/**
 * The code request that the verification step continues. Kept in sessionStorage (this tab only)
 * rather than the URL, so the phone number never lands in browser history, logs or referrers.
 */
export interface OtpChallenge {
  /** International format, exactly as sent to POST /accounts/otp/send. */
  phoneNumber: string;
  /** Epoch ms when the API accepted the code request; drives the resend countdown. */
  requestedAt: number;
}

const STORAGE_KEY = 'shena.otpChallenge';

export function saveOtpChallenge(phoneNumber: string, requestedAt = Date.now()): OtpChallenge {
  const challenge = { phoneNumber, requestedAt };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(challenge));
  } catch {
    // Storage can be unavailable (private mode, quota); the in-memory value still drives this page.
  }
  return challenge;
}

export function readOtpChallenge(): OtpChallenge | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (
      value &&
      typeof value === 'object' &&
      typeof (value as OtpChallenge).phoneNumber === 'string' &&
      typeof (value as OtpChallenge).requestedAt === 'number'
    ) {
      return value as OtpChallenge;
    }
  } catch {
    // Unreadable or malformed: treat as no pending challenge.
  }
  return null;
}

export function clearOtpChallenge(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Whole seconds until the API accepts another code request for this challenge. */
export function secondsUntilResend(challenge: OtpChallenge, now = Date.now()): number {
  const elapsed = (now - challenge.requestedAt) / 1000;
  return Math.max(0, Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - elapsed));
}
