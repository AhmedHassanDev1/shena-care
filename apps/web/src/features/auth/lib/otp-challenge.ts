/**
 * The code request the verification step continues — exactly the server's challenge contract (GLO-200): code length,
 * expiry and the moment a new code may be requested (from `retryAfter`). No client defaults. Kept in sessionStorage
 * (this tab only), never in the URL, so the phone number stays out of history, logs and referrers, and the resend
 * countdown survives a refresh (Addendum §States «Cooldown … survives refresh»).
 */
export interface OtpChallenge {
  /** E.164, exactly as sent to POST /accounts/otp/send. */
  phoneNumber: string;
  codeLength: number;
  /** Epoch ms when the code expires. */
  expiresAt: number;
  /** Epoch ms from which «ابعت كود جديد» is allowed. */
  resendAt: number;
}

export interface OtpChallengeResponse {
  codeLength: number;
  expiresAt: string;
  retryAfter: number;
}

const STORAGE_KEY = 'shena.otpChallenge';

export function challengeFrom(phoneNumber: string, response: OtpChallengeResponse, now = Date.now()): OtpChallenge {
  return {
    phoneNumber,
    codeLength: response.codeLength,
    expiresAt: new Date(response.expiresAt).getTime(),
    resendAt: now + response.retryAfter * 1000,
  };
}

export function saveOtpChallenge(challenge: OtpChallenge): OtpChallenge {
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
    const value = JSON.parse(raw) as Partial<OtpChallenge>;
    if (
      typeof value.phoneNumber === 'string' &&
      Number.isInteger(value.codeLength) &&
      (value.codeLength as number) > 0 &&
      typeof value.expiresAt === 'number' &&
      typeof value.resendAt === 'number'
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

/** Whole seconds until the server accepts another code request. */
export function secondsUntil(epochMs: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((epochMs - now) / 1000));
}
