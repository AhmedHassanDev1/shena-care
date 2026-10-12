'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, LockKeyhole, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { auth } from '@/lib/auth';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { useAuth } from '../AuthContext';
import {
  isResendCooldown,
  normalizeEgyptianMobile,
  safeReturnTo,
  sendOtpErrorMessage,
  toLocalMobile,
} from '../lib/auth-helpers';
import { readOtpChallenge, saveOtpChallenge } from '../lib/otp-challenge';
import { AuthHeader, AuthHelper, FieldError, authControlClass, authSubmitClass } from './auth-ui';

export function PhoneLoginForm() {
  const m = useMessages();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();

  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // A ref, not state: two taps inside one render must still send a single request.
  const submittingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const returnTo = searchParams.get('returnTo');
  const intent = searchParams.get('intent');

  // Back from "change number": start from the number the customer already typed.
  useEffect(() => {
    const pending = readOtpChallenge();
    if (pending) setPhone(toLocalMobile(pending.phoneNumber));
  }, []);

  // Already signed in: continue to where the customer was going instead of asking again.
  useEffect(() => {
    if (!isAuthLoading && isAuthenticated) router.replace(safeReturnTo(returnTo));
  }, [isAuthLoading, isAuthenticated, returnTo, router]);

  const continueToVerification = () => {
    const params = new URLSearchParams();
    if (returnTo) params.set('returnTo', returnTo);
    if (intent) params.set('intent', intent);
    const query = params.toString();
    router.push(query ? `${routes.verify}?${query}` : routes.verify);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submittingRef.current) return;

    const national = normalizeEgyptianMobile(phone);
    if (!national) {
      setError(m.authPhoneInvalid);
      inputRef.current?.focus();
      return;
    }
    // Egypt only: the API stores numbers as +20…; customers type the local 01… form.
    const phoneNumber = `+20${national}`;

    submittingRef.current = true;
    setIsSubmitting(true);
    setError('');
    try {
      await auth.sendOtp(phoneNumber);
      saveOtpChallenge(phoneNumber);
      continueToVerification();
      // Stay busy until the next step mounts.
    } catch (err) {
      if (isResendCooldown(err)) {
        // A code for this number was requested less than a minute ago and is still valid: use it.
        // Without our own record of when, assume "just now" so the resend wait is never understated.
        const pending = readOtpChallenge();
        saveOtpChallenge(phoneNumber, pending?.phoneNumber === phoneNumber ? pending.requestedAt : Date.now());
        continueToVerification();
        return;
      }
      setError(sendOtpErrorMessage(err, m, m.authSendFailed));
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <AuthHeader title={m.authPhoneTitle} description={m.authPhoneDescription} />

      <form onSubmit={handleSubmit} noValidate className="mt-7">
        <Label htmlFor="phone" className="font-semibold">
          {m.authPhoneLabel}
        </Label>
        <div className={cn('mt-2 flex h-[3.25rem] items-center gap-3 px-4', authControlClass({ invalid: !!error }))}>
          <Smartphone aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
          {/* Phone numbers are always written left to right, also inside the Arabic layout. */}
          <input
            ref={inputRef}
            id="phone"
            name="phone"
            type="tel"
            dir="ltr"
            inputMode="numeric"
            autoComplete="tel-national"
            maxLength={16}
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value.replace(/[^\d٠-٩۰-۹\s+-]/g, ''));
              if (error) setError('');
            }}
            placeholder={m.authPhonePlaceholder}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'phone-error' : undefined}
            readOnly={isSubmitting}
            className="h-full min-w-0 flex-1 bg-transparent text-body-lg font-medium tabular-nums text-foreground placeholder:font-normal placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
        {error ? <FieldError id="phone-error">{error}</FieldError> : null}

        <Button type="submit" size="lg" loading={isSubmitting} className={cn('mt-6', authSubmitClass)}>
          {m.authContinue}
          {isSubmitting ? null : <ArrowRight aria-hidden="true" className="rtl-mirror" />}
        </Button>
      </form>

      <AuthHelper icon={LockKeyhole} className="mt-6">
        {m.authPhoneHelper}
      </AuthHelper>
    </>
  );
}
