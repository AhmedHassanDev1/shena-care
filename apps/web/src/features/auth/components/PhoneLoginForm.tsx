'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { PhoneField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { auth } from '@/lib/auth';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { routes } from '@/lib/routes';
import { useAuth } from '../AuthContext';
import {
  isResendCooldown,
  normalizeEgyptianMobile,
  safeReturnTo,
  sendOtpErrorMessage,
  toLocalMobile,
} from '../lib/auth-helpers';
import { readOtpChallenge, saveOtpChallenge } from '../lib/otp-challenge';
import { AuthHeader, AuthHelper } from './auth-ui';

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
        {/* Phone numbers are always written left to right, also inside the Arabic layout (PhoneField isolates them). */}
        <PhoneField
          ref={inputRef}
          id="phone"
          name="phone"
          label={m.authPhoneLabel}
          error={error || undefined}
          inputMode="numeric"
          autoComplete="tel-national"
          maxLength={16}
          value={phone}
          onChange={(event) => {
            setPhone(event.target.value.replace(/[^\d٠-٩۰-۹\s+-]/g, ''));
            if (error) setError('');
          }}
          placeholder={m.authPhonePlaceholder}
          readOnly={isSubmitting}
        />

        <Button type="submit" size="lg" loading={isSubmitting} className="mt-6 w-full">
          {m.authContinue}
          {isSubmitting ? null : <Icon name="arrow-forward" size={20} />}
        </Button>
      </form>

      <AuthHelper icon="shield" className="mt-6">
        {m.authPhoneHelper}
      </AuthHelper>
    </>
  );
}
