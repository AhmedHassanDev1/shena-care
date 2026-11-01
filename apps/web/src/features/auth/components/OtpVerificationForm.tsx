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
import { auth } from '@/lib/auth';
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

/** How long the verified state (green cells, «اتأكد») holds before the return (Addendum: about 1 s). */
const VERIFIED_HOLD_MS = 900;

/**
 * Code step (AuthOtpD, AuthMobile ٢–٢د, AuthStates §٣–§٥). Cells, expiry and the resend countdown come from the stored
 * challenge (server contract), never from client defaults. After verification the customer returns to the exact task
 * that started sign-in; if adoption changed the cart, the cart opens first for review.
 */
export function OtpVerificationForm() {
  const m = useMessages();
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { refreshUser } = useAuth();
  // Loads the guest cart, so the lines before sign-in are known when the code is confirmed.
  useCart();

  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [code, setCode] = useState('');
  const [verifyState, setVerifyState] = useState<AsyncState>('idle');
  const [resendState, setResendState] = useState<AsyncState>('idle');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState('');
  const [limitNotice, setLimitNotice] = useState('');
  const [now, setNow] = useState(() => Date.now());
  // The countdown is announced once per state (started, ended), never every second.
  const [countdownNotice, setCountdownNotice] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const verifyingRef = useRef(false);

  const returnTo = searchParams.get('returnTo');
  const changeNumberHref = returnTo ? `${routes.login}?${new URLSearchParams({ returnTo })}` : routes.login;

  // The pending code request lives in this tab's session; without one there is nothing to verify.
  useEffect(() => {
    const pending = readOtpChallenge();
    if (pending) setChallenge(pending);
    else router.replace(changeNumberHref);
    // Read once on arrival; later changes come from this page's own resend.
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
    // Only when a new countdown starts or the current one ends.
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
    try {
      const session = await auth.verifyOtp(challenge.phoneNumber, submitted);
      clearOtpChallenge();
      setVerifyState('success');
      await Promise.all([
        new Promise((resolve) => window.setTimeout(resolve, VERIFIED_HOLD_MS)),
        finish(session.returnTo, before).catch(() => router.replace(safeReturnTo(returnTo))),
      ]);
      // Stays verified until the destination renders.
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
        // Digits stay written and selected, so the next digit replaces them.
        setVerifyState('idle');
        setFailure('wrong');
        focusCode(true);
      } else {
        // The request itself failed: the code stays typed, «تأكيد» retries it.
        setVerifyState('error');
        setFailure('network');
      }
    }
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
      <p role="status" className="flex h-72 items-center justify-center text-15 text-stone">
        {m.loading}
      </p>
    );
  }

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
  const cellState = verifyState === 'success' ? 'verified' : failure === 'wrong' || failure === 'incomplete' ? 'invalid' : 'default';
  const countdown = formatClock(resendIn, locale);

  return (
    <>
      <Link href={changeNumberHref} className="text-link gap-1 self-start text-14">
        <Icon name="chevron-back" size={18} strokeWidth={1.9} />
        {m.authChangeNumber}
      </Link>

      <AuthHeader
        title={m.authOtpTitle}
        titleId="otp-title"
        descriptionId="otp-help"
        description={
          <>
            {m.authOtpSentTo}{' '}
            <bdi dir="ltr" className="font-semibold tabular-nums text-ink">
              {displayMobile(challenge.phoneNumber)}
            </bdi>
          </>
        }
      />

      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          verify(code);
        }}
      >
        <div className="flex flex-col gap-2">
          <OtpInput
            ref={inputRef}
            id="otp"
            length={challenge.codeLength}
            value={code}
            onChange={(next) => {
              setCode(next);
              if (failure && failure !== 'expired' && failure !== 'exhausted') setFailure(null);
              if (verifyState === 'error') setVerifyState('idle');
              // The last digit (typed, pasted or autofilled) submits.
              if (next.length === challenge.codeLength && next !== code) verify(next);
            }}
            normalize={(raw) => toLatinDigits(raw).replace(/\D/g, '')}
            state={cellState}
            labelledBy="otp-title"
            describedBy={failureMessage ? 'otp-help otp-error' : 'otp-help'}
            disabled={needsNewCode}
            readOnly={verifyState === 'pending' || verifyState === 'success'}
            autoFocus
          />
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

        {needsNewCode ? (
          <AsyncButton
            size="l"
            state={resendState}
            pendingLabel={m.authSending}
            disabled={resendIn > 0}
            onClick={resend}
            className="w-full"
          >
            {m.authResend}
          </AsyncButton>
        ) : (
          <AsyncButton
            type="submit"
            size="l"
            state={verifyState}
            pendingLabel={m.authVerifying}
            successLabel={m.authVerified}
            className="w-full"
          >
            {m.authVerifyCta}
          </AsyncButton>
        )}
      </form>

      <div className="flex flex-col items-center gap-3 text-center">
        {resendState === 'error' ? (
          <FieldMessage tone="error">
            {m.authSendFailed}
          </FieldMessage>
        ) : null}
        {limitNotice && resendIn > 0 ? (
          <p className="m-0 text-14 text-warn" aria-hidden="true">
            {fillMessage(m.authRateLimited, { time: isolateLtr(countdown) })}
          </p>
        ) : resendIn > 0 ? (
          // Not a live region: a per-second announcement would drown the form; the state is announced once below.
          <p className="m-0 text-14 text-stone" aria-hidden="true">
            {fillMessage(m.authResendIn, { time: '' })}
            <bdi dir="ltr" className="font-bold tabular-nums text-ink">
              {countdown}
            </bdi>
          </p>
        ) : !needsNewCode ? (
          <Button variant="text" onClick={resend} loading={resendState === 'pending'} className="min-h-control-s px-1">
            {m.authResend}
          </Button>
        ) : null}
        <p role="status" className="sr-only">
          {limitNotice && cooling ? limitNotice : countdownNotice}
        </p>
        <p className="m-0 text-13 leading-20 text-stone">{m.authNotReceived}</p>
      </div>
    </>
  );
}
