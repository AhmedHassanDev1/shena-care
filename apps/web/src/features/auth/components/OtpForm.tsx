'use client';

import React, { useState, useRef, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import { formatNumber } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';
import { useAuth } from '../AuthContext';
import { otpErrorMessage, safeReturnTo, toLatinDigits } from '../lib/auth-helpers';

const CODE_LENGTH = 6;
const RESEND_SECONDS = 30;
const emptyCode = () => Array<string>(CODE_LENGTH).fill('');

function OtpFormContent() {
  const m = useMessages();
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshUser } = useAuth();

  const phoneNumber = searchParams.get('phone');
  const returnTo = safeReturnTo(searchParams.get('returnTo'));

  const [code, setCode] = useState(emptyCode);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(RESEND_SECONDS);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!phoneNumber) {
      router.replace('/auth');
    }
  }, [phoneNumber, router]);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  if (!phoneNumber) return null;

  // Back to the phone step, keeping where the customer was going.
  const changeNumberParams = new URLSearchParams();
  const rawReturnTo = searchParams.get('returnTo');
  const intent = searchParams.get('intent');
  if (rawReturnTo) changeNumberParams.set('returnTo', rawReturnTo);
  if (intent) changeNumberParams.set('intent', intent);
  const changeNumberQuery = changeNumberParams.toString();
  const changeNumberHref = changeNumberQuery ? `/auth?${changeNumberQuery}` : '/auth';

  const handleSubmit = async (submittedCode: string) => {
    if (submittedCode.length !== CODE_LENGTH || isLoading) return;

    setIsLoading(true);
    setError('');

    try {
      await auth.verifyOtp(phoneNumber, submittedCode);
      await refreshUser();
      router.push(returnTo);
    } catch (err) {
      const invalid = err instanceof ApiError && (err.type === 'VALIDATION' || err.type === 'UNAUTHENTICATED');
      setError(invalid ? m.authCodeInvalid : otpErrorMessage(err, m, m.authVerifyFailed));
      setCode(emptyCode());
      inputRefs.current[0]?.focus();
      setIsLoading(false);
    }
  };

  const handleKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  /** Writes digits from `start` onwards; a full code (SMS autofill, paste, fast typing) fills every box. */
  const fillFrom = (start: number, digits: string) => {
    const next = [...code];
    const count = Math.min(digits.length, CODE_LENGTH - start);
    for (let i = 0; i < count; i++) next[start + i] = digits[i];
    setCode(next);
    setError('');

    inputRefs.current[Math.min(start + count, CODE_LENGTH - 1)]?.focus();
    if (next.every((digit) => digit !== '')) handleSubmit(next.join(''));
  };

  const handleChange = (index: number, raw: string) => {
    const digits = toLatinDigits(raw).replace(/\D/g, '');
    if (!digits) {
      if (raw === '') {
        const next = [...code];
        next[index] = '';
        setCode(next);
      }
      return;
    }
    fillFrom(index, digits);
  };

  const handlePaste = (index: number, event: React.ClipboardEvent) => {
    event.preventDefault();
    const pasted = toLatinDigits(event.clipboardData.getData('text')).replace(/\D/g, '');
    if (pasted) fillFrom(pasted.length >= CODE_LENGTH ? 0 : index, pasted);
  };

  const handleResend = async () => {
    if (countdown > 0 || isLoading) return;

    setIsLoading(true);
    setError('');
    try {
      await auth.sendOtp(phoneNumber);
      setCountdown(RESEND_SECONDS);
    } catch (err) {
      setError(otpErrorMessage(err, m, m.authResendFailed));
    } finally {
      setIsLoading(false);
    }
  };

  const codeString = code.join('');
  // Plain seconds: an "0:29" clock reorders under RTL bidi.
  const remaining = formatNumber(countdown, locale);

  return (
    <div>
      <h1 className="text-h1 font-bold text-foreground">{m.authVerifyTitle}</h1>
      <p className="mt-2 text-body text-muted-foreground">
        {m.authVerifySubtitle}{' '}
        <bdi dir="ltr" className="font-semibold text-foreground">
          {phoneNumber}
        </bdi>
      </p>
      <Link
        href={changeNumberHref}
        className="mt-1 inline-flex min-h-11 items-center text-support font-semibold text-primary underline-offset-4 hover:underline"
      >
        {m.authChangePhone}
      </Link>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit(codeString);
        }}
        className="mt-6 flex flex-col gap-6"
      >
        <div>
          <div role="group" aria-label={m.authCodeGroup} dir="ltr" className="flex justify-between gap-2">
            {code.map((digit, index) => (
              <input
                key={index}
                ref={(element) => {
                  inputRefs.current[index] = element;
                }}
                type="text"
                inputMode="numeric"
                autoComplete={index === 0 ? 'one-time-code' : 'off'}
                value={digit}
                onFocus={(event) => event.target.select()}
                onChange={(event) => handleChange(index, event.target.value)}
                onKeyDown={(event) => handleKeyDown(index, event)}
                onPaste={(event) => handlePaste(index, event)}
                aria-label={fillMessage(m.authCodeDigit, { n: index + 1 })}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'otp-error' : undefined}
                // readOnly, not disabled: a disabled box cannot take focus back after a failed attempt.
                readOnly={isLoading}
                className={cn(
                  'h-14 w-full min-w-0 max-w-14 rounded-sm border bg-card text-center text-h3 font-semibold text-foreground',
                  'transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-1',
                  'read-only:bg-muted',
                  error
                    ? 'border-destructive focus-visible:border-destructive focus-visible:ring-destructive'
                    : 'border-input focus-visible:border-ring focus-visible:ring-ring'
                )}
                autoFocus={index === 0}
              />
            ))}
          </div>
          {error ? (
            <p id="otp-error" role="alert" className="mt-3 flex items-start gap-1.5 text-support text-destructive">
              <AlertCircle aria-hidden="true" className="mt-1 size-4 shrink-0" />
              {error}
            </p>
          ) : null}
        </div>

        <Button type="submit" size="lg" loading={isLoading} className="w-full">
          {m.authVerifyCode}
        </Button>

        <p className="text-center text-support">
          <span className="text-muted-foreground">{m.authCodeNotReceived}</span>{' '}
          {countdown > 0 ? (
            <span className="font-medium text-muted-foreground" aria-live="off">
              {fillMessage(m.authResendIn, { time: remaining })}
            </span>
          ) : (
            <button
              type="button"
              disabled={isLoading}
              onClick={handleResend}
              className="inline-flex min-h-11 items-center font-semibold text-primary underline-offset-4 hover:underline disabled:text-disabled-foreground"
            >
              {m.authResendNow}
            </button>
          )}
        </p>
      </form>
    </div>
  );
}

export function OtpForm() {
  return (
    <Suspense
      fallback={
        <div className="flex h-80 items-center justify-center">
          <Loader2 aria-hidden="true" className="size-6 text-primary motion-safe:animate-spin" />
        </div>
      }
    >
      <OtpFormContent />
    </Suspense>
  );
}
