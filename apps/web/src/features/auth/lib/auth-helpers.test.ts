import { ApiError } from '@/lib/api-client';
import {
  apiErrorCode,
  apiRetryAfter,
  displayMobile,
  isForeignNumber,
  normalizeEgyptianMobile,
  safeReturnTo,
  signInHref,
} from './auth-helpers';
import { cartChangedByAdoption } from './auth-return';
import { challengeFrom, secondsUntil } from './otp-challenge';

describe('normalizeEgyptianMobile', () => {
  it('accepts local, international and Arabic-Indic forms of one number', () => {
    for (const typed of ['01012345678', '010 1234 5678', '+201012345678', '00201012345678', '٠١٠١٢٣٤٥٦٧٨']) {
      expect(normalizeEgyptianMobile(typed)).toBe('1012345678');
    }
  });

  it('rejects short, landline and foreign numbers', () => {
    expect(normalizeEgyptianMobile('0101234')).toBeNull();
    expect(normalizeEgyptianMobile('0223456789')).toBeNull();
    expect(normalizeEgyptianMobile('+447700900123')).toBeNull();
    expect(isForeignNumber('+447700900123')).toBe(true);
    expect(isForeignNumber('+201012345678')).toBe(false);
    expect(isForeignNumber('01012345678')).toBe(false);
  });

  it('shows the number as the boards do, Western and grouped', () => {
    expect(displayMobile('+201000004567')).toBe('010 0000 4567');
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
});

describe('API error contract', () => {
  it('reads the code and retryAfter wherever the error filter nests them', () => {
    const flat = new ApiError('x', 'CONFLICT', 409, { code: 'OTP_COOLDOWN', retryAfter: 42 });
    const nested = new ApiError('x', 'CONFLICT', 409, { message: { code: 'OTP_RATE_LIMITED', retryAfter: 900 } });
    expect([apiErrorCode(flat), apiRetryAfter(flat)]).toEqual(['OTP_COOLDOWN', 42]);
    expect([apiErrorCode(nested), apiRetryAfter(nested)]).toEqual(['OTP_RATE_LIMITED', 900]);
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
