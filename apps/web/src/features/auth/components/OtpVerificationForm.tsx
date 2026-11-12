'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { AsyncButton, Button, type AsyncState } from '@/components/ui/button';
import { FieldMessage } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { OtpInput } from '@/components/ui/otp-input';
import { CART_QUERY_KEY, useCart } from '@/features/cart/hooks/useCart';
import { auth, type VerifyOtpResponse } from '@/lib/auth';
import { cart as cartApi, type Cart } from '@/lib/cart';
import { formatClock, isolateLtr } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { useAuth } from '../AuthContext';
import { apiErrorCode, apiRetryAfter, displayMobile, safeReturnTo, toLatinDigits } from '../lib/auth-helpers';
import { cartChangedByAdoption, markAuthReturn } from '../lib/auth-return';
import {
  challengeFrom,
  clearOtpChallenge,
  readOtpChallenge,
  saveOtpChallenge,
  secondsUntil,
  type OtpChallenge,
  type OtpChallengeResponse,
} from '../lib/otp-challenge';
import { AuthHeader } from './auth-ui';

/** wrong / incomplete: fix the code. expired / exhausted: only a new code helps. network: retry as is. */
type Failure = 'wrong' | 'incomplete' | 'expired' | 'exhausted' | 'network';

/** Brief success hold before auto-redirecting to destination (approx 1.8s) */
const SUCCESS_AUTO_NAVIGATE_MS = 1800;

/**
 * OTP Verification step (AuthOtpD, AuthMobile, SAHEL Design System).
 * Includes 6-digit OTP input, visible countdown, resend control, ability to edit number,
 * subtle SAHEL loading animation, and clean success state.
 */
export function OtpVerificationForm() {
  const m = useMessages();
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { refreshUser } = useAuth();
  useCart();

  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [code, setCode] = useState('');
  const [verifyState, setVerifyState] = useState<AsyncState>('idle');
  const [resendState, setResendState] = useState<AsyncState>('idle');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState('');
  const [limitNotice, setLimitNotice] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [countdownNotice, setCountdownNotice] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const verifyingRef = useRef(false);
  const redirectTimerRef = useRef<number | null>(null);
  const sessionRef = useRef<VerifyOtpResponse | null>(null);
  const beforeCartRef = useRef<Cart | undefined>(undefined);

  const returnTo = searchParams.get('returnTo');
  const changeNumberHref = returnTo ? `${routes.login}?${new URLSearchParams({ returnTo })}` : routes.login;

  useEffect(() => {
    const pending = readOtpChallenge();
    if (pending) setChallenge(pending);
    else router.replace(changeNumberHref);
  }, []);

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) window.clearTimeout(redirectTimerRef.current);
    };
  }, []);

  const resendIn = challenge ? secondsUntil(challenge.resendAt, now) : 0;
  const expired = challenge !== null && now >= challenge.expiresAt;
  const needsNewCode = failure === 'expired' || failure === 'exhausted' || expired;

  useEffect(() => {
    if (!challenge) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [challenge]);

  const resendAt = challenge?.resendAt ?? 0;
  const cooling = resendIn > 0;
  useEffect(() => {
    if (!resendAt) return;
    setCountdownNotice(cooling ? fillMessage(m.authResendIn, { time: isolateLtr(formatClock(secondsUntil(resendAt), locale)) }) : '');
  }, [resendAt, cooling]);

  const focusCode = (select = false) =>
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      if (select) inputRef.current?.select();
    });

  const finish = async (sessionReturnTo: string | undefined, before: Cart | undefined) => {
    const target = safeReturnTo(returnTo ?? sessionReturnTo ?? null);
    let after: Cart | undefined;
    try {
      after = await cartApi.getCart();
      queryClient.setQueryData(CART_QUERY_KEY, after);
    } catch {
      await queryClient.invalidateQueries({ queryKey: CART_QUERY_KEY });
    }
    await refreshUser();
    if (target.startsWith(routes.checkout)) {
      if (before && after && cartChangedByAdoption(before.items, after.items)) {
        markAuthReturn('cart-merged');
        router.replace(routes.cart);
        return;
      }
      markAuthReturn('signed-in');
    }
    router.replace(target);
  };

  const verify = async (submitted: string) => {
    if (!challenge || verifyingRef.current || needsNewCode) return;
    if (submitted.length !== challenge.codeLength) {
      setFailure('incomplete');
      focusCode();
      return;
    }

    verifyingRef.current = true;
    setVerifyState('pending');
    setFailure(null);
    setNotice('');
    const before = queryClient.getQueryData<Cart>(CART_QUERY_KEY);
    beforeCartRef.current = before;

    try {
      const session = await auth.verifyOtp(challenge.phoneNumber, submitted, challenge.name);
      sessionRef.current = session;
      clearOtpChallenge();
      setVerifyState('success');

      redirectTimerRef.current = window.setTimeout(() => {
        finish(session.returnTo, before).catch(() => router.replace(safeReturnTo(returnTo)));
      }, SUCCESS_AUTO_NAVIGATE_MS);
    } catch (err) {
      verifyingRef.current = false;
      const errorCode = apiErrorCode(err);
      if (errorCode === 'OTP_EXPIRED') {
        setVerifyState('idle');
        setFailure('expired');
      } else if (errorCode === 'OTP_ATTEMPTS_EXHAUSTED') {
        setVerifyState('idle');
        setFailure('exhausted');
      } else if (errorCode === 'OTP_INVALID') {
        setVerifyState('idle');
        setFailure('wrong');
        focusCode(true);
      } else {
        setVerifyState('error');
        setFailure('network');
      }
    }
  };

  const handleManualContinue = () => {
    if (redirectTimerRef.current) window.clearTimeout(redirectTimerRef.current);
    finish(sessionRef.current?.returnTo, beforeCartRef.current).catch(() => router.replace(safeReturnTo(returnTo)));
  };

  const handleGoToAccount = () => {
    if (redirectTimerRef.current) window.clearTimeout(redirectTimerRef.current);
    refreshUser().finally(() => router.replace(routes.account));
  };

  const resend = async () => {
    if (!challenge || resendIn > 0 || resendState === 'pending' || verifyingRef.current) return;
    setResendState('pending');
    setNotice('');
    setLimitNotice('');
    try {
      const next = await auth.sendOtp(challenge.phoneNumber, returnTo ? safeReturnTo(returnTo) : undefined);
      setChallenge(saveOtpChallenge(challengeFrom(challenge.phoneNumber, next)));
      setNow(Date.now());
      setCode('');
      setFailure(null);
      setVerifyState('idle');
      setNotice(m.authResent);
      setResendState('idle');
      focusCode();
    } catch (err) {
      const retryAfter = apiRetryAfter(err);
      if (retryAfter) {
        const data = (err as { data?: Partial<OtpChallengeResponse> & { message?: Partial<OtpChallengeResponse> } }).data;
        const active = { ...data?.message, ...data } as Partial<OtpChallengeResponse>;
        const updated: OtpChallenge = { ...challenge, resendAt: Date.now() + retryAfter * 1000 };
        if (active.codeLength && active.expiresAt) {
          updated.codeLength = active.codeLength;
          updated.expiresAt = new Date(active.expiresAt).getTime();
        }
        setChallenge(saveOtpChallenge(updated));
        setNow(Date.now());
        if (apiErrorCode(err) === 'OTP_RATE_LIMITED') {
          setLimitNotice(fillMessage(m.authRateLimited, { time: isolateLtr(formatClock(retryAfter, locale)) }));
        }
        setResendState('idle');
        return;
      }
      setResendState('error');
    }
  };

  if (!challenge) {
    return (
      <div role="status" className="flex h-72 flex-col items-center justify-center gap-3 text-stone">
        <div className="size-10 rounded-full border-2 border-sand/40 border-t-cobalt animate-spin" />
        <span className="text-14">{m.loading}</span>
      </div>
    );
  }

  // ── State 3: Clean, subtle SAHEL-inspired verification animation ───────
  if (verifyState === 'pending') {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center animate-fade-in" role="status" aria-live="polite">
        <div className="relative size-16 flex items-center justify-center">
          <div className="size-14 rounded-full border-4 border-sand/30 border-t-cobalt animate-spin" />
        </div>
        <h2 className="mt-8 font-display font-extrabold text-24 text-ink leading-tight">
          {m.authVerifyingTitle}
        </h2>
        <p className="mt-2 text-15 text-stone leading-22">
          {m.authVerifyingSubtitle}
        </p>
      </div>
    );
  }

  // ── State 4: Success confirmation screen ───────────────────────────────
  if (verifyState === 'success') {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center animate-fade-in" role="status" aria-live="polite">
        <div className="flex size-20 items-center justify-center rounded-full bg-citron shadow-elevation-1">
          <Icon name="check" size={38} strokeWidth={3} className="text-ink" />
        </div>
        <h2 className="mt-6 font-display font-black text-26 lg:text-28 text-ink leading-tight">
          {m.authSuccessTitle}
        </h2>
        <p className="mt-2 text-15 text-stone leading-22">
          {m.authSuccessSubtitle}
        </p>

        <div className="mt-8 flex flex-col gap-3.5 w-full">
          <Button
            size="l"
            onClick={handleManualContinue}
            className="w-full bg-cobalt text-white hover:bg-cobalt-deep rounded-pill h-control-xl font-bold text-17 shadow-elevation-1 transition-colors"
          >
            {m.authContinueShopping}
          </Button>

          <button
            type="button"
            onClick={handleGoToAccount}
            className="inline-flex items-center justify-center py-2 text-15 font-semibold text-stone hover:text-ink transition-colors bg-transparent border-0 cursor-pointer"
          >
            {m.authGoToAccount}
          </button>
        </div>
      </div>
    );
  }

  // ── State 2: OTP Verification Form ─────────────────────────────────────
  const failureMessage =
    failure === 'wrong'
      ? m.authCodeInvalid
      : failure === 'exhausted'
        ? m.authCodeExhausted
        : failure === 'expired' || (expired && !failure)
          ? m.authCodeExpired
          : failure === 'network'
            ? m.authVerifyFailed
            : failure === 'incomplete'
              ? m.authCodeIncomplete
              : null;
  const cellState = failure === 'wrong' || failure === 'incomplete' ? 'invalid' : 'default';
  const countdown = formatClock(resendIn, locale);

  return (
    <div className="flex flex-col gap-6">
      {/* Top back navigation & security badge */}
      <div className="flex items-center justify-between gap-3">
        <Link
          href={changeNumberHref}
          className="inline-flex items-center gap-1.5 text-13.5 font-bold text-stone hover:text-ink transition-colors"
        >
          <Icon name="chevron-back" size={16} />
          <span>{m.authEditPhone}</span>
        </Link>
        <span className="inline-flex items-center gap-1.5 text-12 font-semibold text-stone bg-sand/40 border border-line-2/20 px-2.5 py-1 rounded-pill">
          <Icon name="lock" size={12} className="text-stone" />
          <span>تأكيد مشفر وآمن</span>
        </span>
      </div>

      {/* Main Title & Context Card */}
      <div className="flex flex-col gap-3">
        <h1 id="otp-title" className="m-0 font-display font-black text-26 lg:text-30 text-ink leading-tight">
          {m.authMobileOtpTitle}
        </h1>

        {/* Highlighted phone recipient card with direct edit button */}
        <div className="flex items-center justify-between gap-3 p-3.5 rounded-20 bg-sand/30 border border-line-2/30">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-14 bg-linen border border-line-2/30 text-cobalt flex items-center justify-center flex-none shadow-elevation-1">
              <Icon name="phone" size={18} />
            </div>
            <div className="flex flex-col text-start">
              <span id="otp-help" className="text-12 text-stone font-display leading-tight">
                {m.authMobileOtpSubtitle}
              </span>
              <bdi dir="ltr" className="text-16 font-bold tabular-nums text-ink mt-0.5">
                {displayMobile(challenge.phoneNumber)}
              </bdi>
            </div>
          </div>
          <Link
            href={changeNumberHref}
            aria-label={m.authEditPhone}
            className="inline-flex items-center px-3 py-1.5 rounded-pill bg-linen hover:bg-white border border-line-2/30 text-12 font-bold text-cobalt hover:text-cobalt-deep transition-all shadow-elevation-1"
          >
            {m.authEditPhone}
          </Link>
        </div>
      </div>

      {/* Verification Code Form */}
      <form
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          verify(code);
        }}
      >
        <div className="flex flex-col gap-3">
          <div className="py-2 flex flex-col items-center justify-center">
            <OtpInput ref={inputRef} id="otp" 
              length={challenge.codeLength}
              value={code}
              onChange={(next) => {
                setCode(next);
                if (failure && failure !== 'expired' && failure !== 'exhausted') setFailure(null);
                if (verifyState === 'error') setVerifyState('idle');
                if (next.length === challenge.codeLength && next !== code) verify(next);
              }}
              normalize={(raw) => toLatinDigits(raw).replace(/\D/g, '')}
              state={cellState}
              labelledBy="otp-title"
              describedBy={failureMessage ? 'otp-help otp-error' : 'otp-help'}
              disabled={needsNewCode}
              autoFocus
            />
          </div>

          {failureMessage ? (
            <FieldMessage id="otp-error" tone="error">
              {failureMessage}
            </FieldMessage>
          ) : null}

          {notice ? (
            <FieldMessage tone="success">
              {notice}
            </FieldMessage>
          ) : null}
        </div>

        {/* Resend Countdown / Trigger */}
        <div className="flex flex-col items-center gap-2 text-center">
          {limitNotice && resendIn > 0 ? (
            <p className="m-0 text-14 text-warn font-semibold" aria-hidden="true">
              {fillMessage(m.authRateLimited, { time: isolateLtr(countdown) })}
            </p>
          ) : resendIn > 0 ? (
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-pill bg-sand/40 border border-line-2/20 text-13.5 text-stone font-display" aria-hidden="true">
              <Icon name="clock" size={15} className="text-stone" />
              <span>{fillMessage(m.authResendCountdown, { time: isolateLtr(countdown) })}</span>
            </div>
          ) : !needsNewCode ? (
            <Button
              variant="text"
              onClick={resend}
              loading={resendState === 'pending'}
              className="min-h-control-s px-4 py-1.5 rounded-pill text-14 font-bold text-cobalt hover:text-cobalt-deep hover:bg-cobalt/5 transition-all"
            >
              <Icon name="retry" size={15} className="me-1.5 inline-block" />
              <span>{m.authResend}</span>
            </Button>
          ) : null}

          {resendState === 'error' ? (
            <FieldMessage tone="error">
              {m.authSendFailed}
            </FieldMessage>
          ) : null}
        </div>

        {needsNewCode ? (
          <AsyncButton
            size="l"
            state={resendState}
            pendingLabel={m.authSending}
            disabled={resendIn > 0}
            onClick={resend}
            className="w-full bg-cobalt text-white hover:bg-cobalt-deep rounded-pill h-control-xl font-bold text-17 shadow-elevation-1 transition-all active:scale-95"
          >
            {m.authResend}
          </AsyncButton>
        ) : (
          <AsyncButton
            type="submit"
            size="l"
            state={verifyState}
            pendingLabel={m.authVerifying}
            disabled={code.length < challenge.codeLength}
            className="w-full bg-cobalt text-white hover:bg-cobalt-deep rounded-pill h-control-xl font-bold text-17 shadow-elevation-1 transition-all disabled:opacity-50 active:scale-95"
          >
            {m.authVerifyAction}
          </AsyncButton>
        )}
      </form>

      <p role="status" className="sr-only">
        {limitNotice && cooling ? limitNotice : countdownNotice}
      </p>

      {/* Security Reassurance note */}
      <div className="pt-3 border-t border-line-2/20 text-center">
        <p className="m-0 text-12.5 leading-20 text-stone flex items-center justify-center gap-1.5">
          <Icon name="shield" size={14} className="text-stone/70 flex-none" />
          <span>{m.authNotReceived}</span>
        </p>
      </div>
    </div>
  );
}
