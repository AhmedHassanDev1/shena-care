'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { auth } from '@/lib/auth';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { cn } from '@/lib/utils';
import { normalizeEgyptianMobile, otpErrorMessage } from '../lib/auth-helpers';

export function PhoneNumberForm() {
  const m = useMessages();
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [phoneNumber, setPhoneNumber] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const returnTo = searchParams.get('returnTo') || '';
  const intent = searchParams.get('intent') || '';

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');

    const national = normalizeEgyptianMobile(phoneNumber);
    if (!national) {
      setError(m.authPhoneInvalid);
      return;
    }
    // Egypt only for now; the country prefix is fixed until the backend supports others.
    const formattedPhone = `+20${national}`;

    setIsLoading(true);
    try {
      await auth.sendOtp(formattedPhone);

      const params = new URLSearchParams();
      params.set('phone', formattedPhone);
      if (returnTo) params.set('returnTo', returnTo);
      if (intent) params.set('intent', intent);

      router.push(`/auth/verify?${params.toString()}`);
    } catch (err) {
      setError(otpErrorMessage(err, m, m.authSendFailed));
      setIsLoading(false);
    }
  };

  const describedBy = error ? 'phone-error' : 'phone-hint';

  return (
    <div>
      <h1 className="text-h1 font-bold text-foreground">{m.authWelcome}</h1>
      <p className="mt-2 text-body text-muted-foreground">{m.authSubtitle}</p>

      <form onSubmit={handleSubmit} noValidate className="mt-8 flex flex-col gap-6">
        <div>
          <Label htmlFor="phone">{m.authPhoneLabel}</Label>
          {/* Phone numbers are always written left-to-right, also on Arabic pages. */}
          <div
            dir="ltr"
            className={cn(
              'mt-2 flex h-12 overflow-hidden rounded-sm border bg-card transition-colors duration-fast ease-standard',
              'focus-within:ring-1',
              error
                ? 'border-destructive focus-within:border-destructive focus-within:ring-destructive'
                : 'border-input focus-within:border-ring focus-within:ring-ring'
            )}
          >
            <span className="flex shrink-0 items-center border-e border-border bg-muted px-3 text-body font-medium text-foreground">
              <span className="sr-only">{m.authCountryName} </span>+20
            </span>
            <input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              value={phoneNumber}
              onChange={(event) => {
                setPhoneNumber(event.target.value.replace(/[^\d٠-٩۰-۹\s+-]/g, ''));
                if (error) setError('');
              }}
              placeholder={m.authPhonePlaceholder}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy}
              className="min-w-0 flex-1 bg-transparent px-3 text-body-lg text-foreground placeholder:text-muted-foreground focus:outline-none"
              autoFocus
            />
          </div>
          {error ? (
            <p id="phone-error" role="alert" className="mt-2 flex items-start gap-1.5 text-support text-destructive">
              <AlertCircle aria-hidden="true" className="mt-1 size-4 shrink-0" />
              {error}
            </p>
          ) : (
            <p id="phone-hint" className="mt-2 text-support text-muted-foreground">
              {m.authPhoneInfo}
            </p>
          )}
        </div>

        <Button type="submit" size="lg" loading={isLoading} className="w-full">
          {m.authContinue}
        </Button>

        <p className="text-center text-caption text-muted-foreground">
          {m.authTermsAgreement}{' '}
          <span className="font-medium text-foreground">{m.termsOfService}</span> {m.and}
          {locale === 'ar' ? '' : ' '}
          <span className="font-medium text-foreground">{m.privacyPolicy}</span>
        </p>
      </form>
    </div>
  );
}
