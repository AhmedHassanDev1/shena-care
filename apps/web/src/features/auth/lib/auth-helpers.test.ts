import { ApiError } from '@/lib/api-client';
import {
  apiErrorCode,
  apiRetryAfter,
  displayMobile,
  isForeignNumber,
  normalizeEgyptianMobile,
  registerHref,
  safeReturnTo,
  signInHref,
} from './auth-helpers';
import { cartChangedByAdoption } from './auth-return';
import { challengeFrom, secondsUntil } from './otp-challenge';

describe('normalizeEgyptianMobile', () => {
  it('accepts local, international and Arabic-Indic forms of all Egyptian operators (010, 011, 012, 015)', () => {
    for (const typed of [
      '01012345678', // Vodafone
      '01112345678', // Etisalat
      '01212345678', // Orange
      '01512345678', // WE
      '010 1234 5678',
      '+201012345678',
      '00201012345678',
      '٠١٠١٢٣٤٥٦٧٨',
      '٠١١١٢٣٤٥٦٧٨',
      '٠١٢١٢٣٤٥٦٧٨',
      '٠١٥١٢٣٤٥٦٧٨',
    ]) {
      expect(normalizeEgyptianMobile(typed)).toMatch(/^1[0125]\d{8}$/);
    }
  });

  it('rejects short, landline and foreign numbers', () => {
    expect(normalizeEgyptianMobile('0101234')).toBeNull();
    expect(normalizeEgyptianMobile('0223456789')).toBeNull();
    expect(normalizeEgyptianMobile('0345678901')).toBeNull();
    expect(normalizeEgyptianMobile('+447700900123')).toBeNull();
    expect(normalizeEgyptianMobile('+971501234567')).toBeNull();
    expect(isForeignNumber('+447700900123')).toBe(true);
    expect(isForeignNumber('+971501234567')).toBe(true);
    expect(isForeignNumber('+201012345678')).toBe(false);
    expect(isForeignNumber('01012345678')).toBe(false);
  });

  it('shows the number as the boards do, Western and grouped', () => {
    expect(displayMobile('+201000004567')).toBe('010 0000 4567');
    expect(displayMobile('+201198765432')).toBe('011 9876 5432');
  });
});

describe('return targets', () => {
  it('only keeps same-origin paths', () => {
    expect(safeReturnTo('/checkout')).toBe('/checkout');
    for (const unsafe of ['https://evil.test', '//evil.test', '/\\evil.test', null, '']) expect(safeReturnTo(unsafe)).toBe('/');
  });

  it('builds the sign-in link for a task, with the expiry reason', () => {
    expect(signInHref('/checkout')).toBe('/auth?returnTo=%2Fcheckout');
    expect(signInHref('/checkout', 'expired')).toBe('/auth?returnTo=%2Fcheckout&reason=expired');
  });

  it('builds the registration link preserving returnTo', () => {
    expect(registerHref('/checkout')).toBe('/auth/register?returnTo=%2Fcheckout');
    expect(registerHref()).toBe('/auth/register');
  });
});

describe('API error contract', () => {
  it('reads the code and retryAfter wherever the error filter nests them', () => {
    const flat = new ApiError('x', 'CONFLICT', 409, { code: 'OTP_COOLDOWN', retryAfter: 42 });
    const nested = new ApiError('x', 'CONFLICT', 409, { message: { code: 'OTP_RATE_LIMITED', retryAfter: 900 } });
    const invalid = new ApiError('x', 'VALIDATION', 400, { code: 'OTP_INVALID' });
    const expired = new ApiError('x', 'UNKNOWN', 410, { code: 'OTP_EXPIRED' });
    const exhausted = new ApiError('x', 'RATE_LIMITED', 429, { code: 'OTP_ATTEMPTS_EXHAUSTED' });

    expect([apiErrorCode(flat), apiRetryAfter(flat)]).toEqual(['OTP_COOLDOWN', 42]);
    expect([apiErrorCode(nested), apiRetryAfter(nested)]).toEqual(['OTP_RATE_LIMITED', 900]);
    expect(apiErrorCode(invalid)).toBe('OTP_INVALID');
    expect(apiErrorCode(expired)).toBe('OTP_EXPIRED');
    expect(apiErrorCode(exhausted)).toBe('OTP_ATTEMPTS_EXHAUSTED');
    expect(apiErrorCode(new Error('x'))).toBeUndefined();
  });
});

describe('OTP challenge', () => {
  it('takes code length, expiry and the resend moment from the server response', () => {
    const now = Date.parse('2026-10-19T10:00:00Z');
    const challenge = challengeFrom('+201012345678', { codeLength: 6, expiresAt: '2026-10-19T10:05:00Z', retryAfter: 60 }, now);
    expect(challenge).toEqual({ phoneNumber: '+201012345678', codeLength: 6, expiresAt: now + 300_000, resendAt: now + 60_000 });
    expect(secondsUntil(challenge.resendAt, now + 500)).toBe(60);
    expect(secondsUntil(challenge.resendAt, now + 61_000)).toBe(0);
  });

  it('attaches customer registration name when signing up', () => {
    const now = Date.parse('2026-10-19T10:00:00Z');
    const challenge = challengeFrom(
      '+201012345678',
      { codeLength: 6, expiresAt: '2026-10-19T10:05:00Z', retryAfter: 60 },
      'سارة أحمد',
      now
    );
    expect(challenge.name).toBe('سارة أحمد');
    expect(challenge.phoneNumber).toBe('+201012345678');
  });
});

describe('cartChangedByAdoption', () => {
  const line = (skuId: string, quantity: number) => ({ skuId, quantity });
  it('is unchanged only for the same SKUs with the same quantities', () => {
    expect(cartChangedByAdoption([line('a', 1), line('b', 2)], [line('b', 2), line('a', 1)])).toBe(false);
    expect(cartChangedByAdoption([line('a', 1)], [line('a', 2)])).toBe(true);
    expect(cartChangedByAdoption([line('a', 1)], [line('a', 1), line('c', 1)])).toBe(true);
    expect(cartChangedByAdoption([], [line('c', 1)])).toBe(true);
  });
});
