'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { BeadLoader } from '@/components/ui/bead-loader';
import { Button } from '@/components/ui/button';
import { FieldMessage } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Label } from '@/components/ui/label';
import { OtpInput } from '@/components/ui/otp-input';
import { auth } from '@/lib/auth';
import { formatNumber } from '@/lib/i18n/format';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { useAuth } from '../AuthContext';
import {
  OTP_LENGTH,
  toLatinDigits,
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
import { AuthHeader } from './auth-ui';

/** invalid / incomplete: fix the code. expired: a new code is needed. other: retry as is. */
type Failure = { kind: 'invalid' | 'incomplete' | 'expired' | 'other'; message: string };

export function OtpVerificationForm() {
  const m = useMessages();
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
      setFailure({ kind: 'incomplete', message: fillMessage(m.authCodeIncomplete, { n: formatNumber(OTP_LENGTH) }) });
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
      <div className="flex h-72 items-center justify-center text-primary">
        <BeadLoader label={m.loading} />
      </div>
    );
  }

  const codeInvalid = failure?.kind === 'invalid' || failure?.kind === 'incomplete';

  return (
    <>
      <AuthHeader title={m.authOtpTitle} description={m.authOtpDescription} />

      <div className="mt-6 flex min-h-14 items-center gap-3 rounded-md bg-sand pe-3 ps-3">
        <span className="grid size-control-s shrink-0 place-items-center rounded-pill bg-card text-ink-soft">
          <Icon name="phone" size={20} />
        </span>
        <p className="min-w-0 flex-1">
          <span className="sr-only">{m.authOtpSentTo} </span>
          <bdi dir="ltr" className="text-body-l font-semibold tabular-nums text-foreground">
            {maskMobile(challenge.phoneNumber)}
          </bdi>
        </p>
        <Link
          href={changeNumberHref}
          className="inline-flex min-h-control-m shrink-0 items-center rounded-pill px-2 text-label text-primary underline decoration-transparent underline-offset-4 transition-[text-decoration-color] duration-quick hover:decoration-current"
        >
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
          <Label htmlFor="otp">{m.authOtpLabel}</Label>
          <span id="otp-length" className="text-body-s text-ink-subtle">
            {fillMessage(m.authOtpLengthHint, { n: formatNumber(OTP_LENGTH) })}
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
          normalize={(raw) => toLatinDigits(raw).replace(/\D/g, '')}
          invalid={codeInvalid}
          disabled={isExpired}
          readOnly={isVerifying}
          describedBy={failure ? 'otp-length otp-error' : 'otp-length'}
          autoFocus
        />

        {failure ? (
          <FieldMessage id="otp-error" tone="error" className="mt-2">
            {failure.message}
          </FieldMessage>
        ) : null}
        <div role="status" className={notice ? 'mt-2' : 'sr-only'}>
          {notice ? <FieldMessage tone="success">{notice}</FieldMessage> : null}
        </div>

        <Button
          type="submit"
          size="lg"
          loading={isVerifying}
          disabled={isExpired}
          className="mt-6 w-full"
        >
          {m.authVerifyCta}
          {isVerifying ? null : <Icon name="arrow-forward" size={20} />}
        </Button>
      </form>

      <div className="mt-6 flex flex-col items-center gap-2 text-center">
        <p className="flex flex-wrap items-center justify-center gap-x-1.5 text-body-s">
          <span className="text-ink-soft">{m.authCodeNotReceived}</span>
          <Button
            type="button"
            variant="link"
            loading={isResending}
            disabled={resendIn > 0}
            onClick={resend}
            className={cn('min-h-control-m px-1', isExpired && resendIn === 0 && 'decoration-current')}
          >
            {m.authResend}
          </Button>
        </p>
        {resendIn > 0 ? (
          <Badge variant="neutral" className="text-ink-soft">
            <Icon name="clock" size={16} />
            {/* Not a live region: a per-second announcement would drown the form. */}
            {fillMessage(m.authResendIn, { time: formatNumber(resendIn) })}
          </Badge>
        ) : null}
      </div>
    </>
  );
}
