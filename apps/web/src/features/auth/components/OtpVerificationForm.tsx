'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Clock, LoaderCircle, PencilLine, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/auth';
import { formatNumber } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { useAuth } from '../AuthContext';
import {
  OTP_LENGTH,
  classifyVerifyFailure,
  isResendCooldown,
  maskMobile,
  otpErrorMessage,
  safeReturnTo,
  sendOtpErrorMessage,
} from '../lib/auth-helpers';
import {
  clearOtpChallenge,
  readOtpChallenge,
  saveOtpChallenge,
  secondsUntilResend,
  type OtpChallenge,
} from '../lib/otp-challenge';
import { AuthHeader, FieldError, authSubmitClass } from './auth-ui';
import { OtpInput } from './OtpInput';

/** invalid / incomplete: fix the code. expired: a new code is needed. other: retry as is. */
type Failure = { kind: 'invalid' | 'incomplete' | 'expired' | 'other'; message: string };

export function OtpVerificationForm() {
  const m = useMessages();
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshUser } = useAuth();

  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [code, setCode] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const verifyingRef = useRef(false);

  const returnTo = searchParams.get('returnTo');
  const intent = searchParams.get('intent');
  const backParams = new URLSearchParams();
  if (returnTo) backParams.set('returnTo', returnTo);
  if (intent) backParams.set('intent', intent);
  const changeNumberHref = backParams.toString() ? `${routes.login}?${backParams}` : routes.login;

  // The pending code request lives in this tab's session; without one there is nothing to verify.
  useEffect(() => {
    const pending = readOtpChallenge();
    if (pending) setChallenge(pending);
    else router.replace(changeNumberHref);
    // Read once on arrival; later changes come from this page's own resend.
  }, []);

  const resendIn = challenge ? secondsUntilResend(challenge, now) : 0;

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [resendIn]);

  const isExpired = failure?.kind === 'expired';
  const focusCode = () => requestAnimationFrame(() => inputRef.current?.focus());

  const verify = async (submitted: string) => {
    if (!challenge || verifyingRef.current || isExpired) return;
    if (submitted.length !== OTP_LENGTH) {
      setFailure({ kind: 'incomplete', message: fillMessage(m.authCodeIncomplete, { n: formatNumber(OTP_LENGTH, locale) }) });
      focusCode();
      return;
    }

    verifyingRef.current = true;
    setIsVerifying(true);
    setFailure(null);
    setNotice('');
    try {
      const session = await auth.verifyOtp(challenge.phoneNumber, submitted);
      clearOtpChallenge();
      setNotice(m.authSigningIn);
      await refreshUser();
      // The page's own returnTo wins; otherwise the API may echo a pending intent. Both are path-checked.
      router.replace(safeReturnTo(returnTo ?? session.returnTo ?? null));
      // Stay busy until the destination renders.
    } catch (err) {
      const kind = classifyVerifyFailure(err);
      if (kind === 'expired') {
        setFailure({ kind, message: m.authCodeExpired });
      } else if (kind === 'invalid') {
        setFailure({ kind, message: m.authCodeInvalid });
        focusCode();
      } else {
        setFailure({ kind, message: otpErrorMessage(err, m, m.authVerifyFailed) });
        focusCode();
      }
      setCode('');
      verifyingRef.current = false;
      setIsVerifying(false);
    }
  };

  const resend = async () => {
    if (!challenge || resendIn > 0 || isResending || verifyingRef.current) return;
    setIsResending(true);
    setNotice('');
    try {
      await auth.sendOtp(challenge.phoneNumber);
      setChallenge(saveOtpChallenge(challenge.phoneNumber));
      setNow(Date.now());
      setCode('');
      setFailure(null);
      // The API confirms the request, not delivery, so the notice says exactly that.
      setNotice(m.authResent);
      focusCode();
    } catch (err) {
      if (isResendCooldown(err)) {
        setChallenge(saveOtpChallenge(challenge.phoneNumber));
        setNow(Date.now());
      }
      setFailure({ kind: isExpired ? 'expired' : 'other', message: sendOtpErrorMessage(err, m, m.authResendFailed) });
    } finally {
      setIsResending(false);
    }
  };

  if (!challenge) {
    return (
      <div className="flex h-72 items-center justify-center">
        <LoaderCircle aria-hidden="true" className="size-6 text-primary motion-safe:animate-spin" />
        <span className="sr-only">{m.loading}</span>
      </div>
    );
  }

  const codeInvalid = failure?.kind === 'invalid' || failure?.kind === 'incomplete';

  return (
    <>
      <AuthHeader title={m.authOtpTitle} description={m.authOtpDescription} />

      <div className="mt-6 flex min-h-14 items-center gap-3 rounded-md bg-secondary pe-2 ps-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-card text-primary">
          <Smartphone aria-hidden="true" className="size-[1.125rem]" />
        </span>
        <p className="min-w-0 flex-1">
          <span className="sr-only">{m.authOtpSentTo} </span>
          <bdi dir="ltr" className="text-body-lg font-semibold tabular-nums text-foreground">
            {maskMobile(challenge.phoneNumber)}
          </bdi>
        </p>
        <Link
          href={changeNumberHref}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-support font-semibold text-primary underline-offset-4 hover:underline"
        >
          <PencilLine aria-hidden="true" className="size-4" />
          {m.authChangeNumber}
        </Link>
      </div>

      <form
        noValidate
        className="mt-6"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          verify(code);
        }}
      >
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <label htmlFor="otp" className="text-support font-semibold text-foreground">
            {m.authOtpLabel}
          </label>
          <span id="otp-length" className="text-caption text-muted-foreground">
            {fillMessage(m.authOtpLengthHint, { n: formatNumber(OTP_LENGTH, locale) })}
          </span>
        </div>

        <OtpInput
          ref={inputRef}
          id="otp"
          length={OTP_LENGTH}
          value={code}
          onChange={(next) => {
            setCode(next);
            if (failure && failure.kind !== 'expired') setFailure(null);
            // A complete code (typed, pasted or autofilled) is submitted straight away.
            if (next.length === OTP_LENGTH && next !== code) verify(next);
          }}
          invalid={codeInvalid}
          disabled={isExpired}
          readOnly={isVerifying}
          describedBy={failure ? 'otp-length otp-error' : 'otp-length'}
          autoFocus
        />

        {failure ? <FieldError id="otp-error">{failure.message}</FieldError> : null}
        <p role="status" className={cn('text-support text-success', notice ? 'mt-2' : 'sr-only')}>
          {notice}
        </p>

        <Button
          type="submit"
          size="lg"
          loading={isVerifying}
          disabled={isExpired}
          className={cn('mt-6', authSubmitClass)}
        >
          {m.authVerifyCta}
          {isVerifying ? null : <ArrowRight aria-hidden="true" className="rtl-mirror" />}
        </Button>
      </form>

      <div className="mt-6 flex flex-col items-center gap-2 text-center">
        <p className="flex flex-wrap items-center justify-center gap-x-1.5 text-support">
          <span className="text-muted-foreground">{m.authCodeNotReceived}</span>
          <Button
            type="button"
            variant="link"
            loading={isResending}
            disabled={resendIn > 0}
            onClick={resend}
            className={cn('min-h-11 px-1 text-support font-semibold', isExpired && resendIn === 0 && 'underline')}
          >
            {m.authResend}
          </Button>
        </p>
        {resendIn > 0 ? (
          <p className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-caption text-muted-foreground">
            <Clock aria-hidden="true" className="size-3.5" />
            {/* Not a live region: a per-second announcement would drown the form. */}
            {fillMessage(m.authResendIn, { time: formatNumber(resendIn, locale) })}
          </p>
        ) : null}
      </div>
    </>
  );
}
