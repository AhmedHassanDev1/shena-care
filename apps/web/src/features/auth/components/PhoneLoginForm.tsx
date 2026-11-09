'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AsyncButton, type AsyncState } from '@/components/ui/button';
import { PhoneField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { MessageBox } from '@/components/ui/message-box';
import { useCart } from '@/features/cart/hooks/useCart';
import { auth } from '@/lib/auth';
import { formatClock, formatProductCount, isolateLtr } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { useAuth } from '../AuthContext';
import {
  apiErrorCode,
  apiRetryAfter,
  displayMobile,
  isForeignNumber,
  normalizeEgyptianMobile,
  registerHref,
  safeReturnTo,
  toLatinDigits,
} from '../lib/auth-helpers';
import { challengeFrom, readOtpChallenge, saveOtpChallenge, secondsUntil, type OtpChallengeResponse } from '../lib/otp-challenge';
import { AuthHeader } from './auth-ui';

/**
 * Phone step (AuthEntryD, AuthMobile, SAHEL Design System).
 * Egyptian mobile number input with +20 selector, validation, and OTP request.
 */
export function PhoneLoginForm() {
  const m = useMessages();
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { cart } = useCart();

  const returnTo = searchParams.get('returnTo');
  const target = safeReturnTo(returnTo);
  const fromCheckout = target.startsWith(routes.checkout);
  const sessionExpired = searchParams.get('reason') === 'expired';

  const [phone, setPhone] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [state, setState] = useState<AsyncState>('idle');
  const [blockedUntil, setBlockedUntil] = useState(0);
  const [blockedNotice, setBlockedNotice] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const sendingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Back from «غيّر الرقم»: the number is still filled in.
  useEffect(() => {
    const pending = readOtpChallenge();
    if (pending) setPhone(displayMobile(pending.phoneNumber));
  }, []);

  // Desktop: focus on load. Phone: auto-focus only when arriving from checkout.
  useEffect(() => {
    if (fromCheckout || window.matchMedia('(min-width: 1024px)').matches) inputRef.current?.focus();
  }, [fromCheckout]);

  // Already signed in: continue where the customer was going.
  useEffect(() => {
    if (!isAuthLoading && isAuthenticated) router.replace(target);
  }, [isAuthLoading, isAuthenticated, target, router]);

  const waitSeconds = secondsUntil(blockedUntil, now);
  useEffect(() => {
    if (waitSeconds <= 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [waitSeconds]);

  const toVerification = () => {
    const params = new URLSearchParams();
    if (returnTo) params.set('returnTo', target);
    router.push(params.size ? `${routes.verify}?${params}` : routes.verify);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (sendingRef.current || waitSeconds > 0) return;

    const typed = toLatinDigits(phone).replace(/[\s-]/g, '');
    const national = normalizeEgyptianMobile(typed);
    if (!national) {
      setFieldError(!typed ? m.authPhoneEmpty : isForeignNumber(typed) ? m.authPhoneForeign : m.authPhoneInvalid);
      inputRef.current?.focus();
      return;
    }
    const phoneNumber = `+20${national}`;

    sendingRef.current = true;
    setState('pending');
    setFieldError('');

    try {
      const challenge = await auth.sendOtp(phoneNumber, returnTo ? target : undefined);
      saveOtpChallenge(challengeFrom(phoneNumber, challenge));
      toVerification();
    } catch (err) {
      sendingRef.current = false;
      const code = apiErrorCode(err);
      const retryAfter = apiRetryAfter(err);

      if (code === 'OTP_COOLDOWN' && retryAfter) {
        const data = (err as { data?: Partial<OtpChallengeResponse> & { message?: Partial<OtpChallengeResponse> } }).data;
        const active = { ...data?.message, ...data } as Partial<OtpChallengeResponse>;
        if (active.codeLength && active.expiresAt) {
          saveOtpChallenge(challengeFrom(phoneNumber, { codeLength: active.codeLength, expiresAt: active.expiresAt, retryAfter }));
          toVerification();
          return;
        }
      }
      if (code === 'OTP_PHONE_NOT_EGYPTIAN' || code === 'OTP_PHONE_INVALID') {
        setState('idle');
        setFieldError(code === 'OTP_PHONE_NOT_EGYPTIAN' ? m.authPhoneForeign : m.authPhoneInvalid);
        inputRef.current?.focus();
        return;
      }
      if (retryAfter) {
        setState('idle');
        setNow(Date.now());
        setBlockedUntil(Date.now() + retryAfter * 1000);
        setBlockedNotice(fillMessage(m.authRateLimited, { time: isolateLtr(formatClock(retryAfter, locale)) }));
        return;
      }
      // Network, server, or SMS gateway failure
      setState('error');
    }
  };

  const savedCount = fromCheckout ? (cart?.itemCount ?? 0) : 0;

  return (
    <div className="flex flex-col gap-5">
      {sessionExpired ? (
        <MessageBox tone="warn" role="status">
          {m.authSessionExpired}
        </MessageBox>
      ) : null}

      <AuthHeader
        title={m.authMobileTitle}
        desktopTitle={
          <>
            {m.authCardWelcome}{' '}
            <span className="font-serif italic text-cobalt">ShinaCare</span>
          </>
        }
        description={m.authCardSubtitle}
      />

      {savedCount > 0 ? (
        <div role="status" className="flex items-start gap-3 rounded-16 bg-linen px-4 py-3.5 shadow-outline-hairline">
          <span aria-hidden="true" className="grid size-10 flex-none place-items-center rounded-image bg-sand text-ink">
            <Icon name="bag" size={22} />
          </span>
          <p className="m-0 flex min-w-0 flex-col gap-0.5">
            <span className="text-14.5 font-bold leading-22 text-ink">
              {fillMessage(m.authCartSaved, { count: formatProductCount(savedCount, locale) })}
            </span>
            <span className="text-13 leading-20 text-stone">{m.authCartSavedBody}</span>
          </p>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <PhoneField
          ref={inputRef}
          id="phone"
          name="phone"
          withCountrySelector
          label={m.authPhoneLabel}
          hint={m.authPhoneHint}
          error={fieldError || undefined}
          maxLength={16}
          value={phone}
          onChange={(event) => {
            setPhone(event.target.value.replace(/[^\d٠-٩۰-۹\s+-]/g, ''));
            if (fieldError) setFieldError('');
            if (state === 'error') setState('idle');
          }}
          placeholder={m.authPhonePlaceholder}
          readOnly={state === 'pending'}
        />

        <div className="flex flex-col gap-3 pt-1">
          <AsyncButton
            type="submit"
            size="l"
            state={state}
            pendingLabel={m.authSending}
            disabled={waitSeconds > 0}
            className="w-full bg-cobalt text-white hover:bg-cobalt-deep rounded-pill h-control-xl font-bold text-17 shadow-elevation-1 transition-colors"
          >
            {m.authSendCta}
          </AsyncButton>

          {state === 'error' ? (
            <MessageBox tone="err" role="alert">
              {m.authSendFailed}
            </MessageBox>
          ) : null}

          {waitSeconds > 0 ? (
            <MessageBox tone="warn" aria-hidden="true">
              {fillMessage(m.authRateLimited, { time: isolateLtr(formatClock(waitSeconds, locale)) })}
            </MessageBox>
          ) : null}
        </div>

        <p role="alert" className="sr-only">
          {waitSeconds > 0 ? blockedNotice : ''}
        </p>
      </form>

      {/* Switch to registration link */}
      <div className="pt-1 text-center">
        <span className="text-14 text-stone">{m.authNewUserQuestion} </span>
        <Link
          href={registerHref(target)}
          className="text-14 font-display font-bold text-cobalt hover:text-cobalt-deep transition-colors no-underline"
        >
          {m.authCreateAccountAction}
        </Link>
      </div>

      <p className="m-0 text-center text-12 leading-18 text-stone/80">
        {m.authLegalAgreement}
      </p>
    </div>
  );
}
