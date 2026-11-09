'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AsyncButton, type AsyncState } from '@/components/ui/button';
import { PhoneField, TextField } from '@/components/ui/field';
import { MessageBox } from '@/components/ui/message-box';
import { auth } from '@/lib/auth';
import { formatClock, isolateLtr } from '@/lib/i18n/format';
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
  safeReturnTo,
  signInHref,
  toLatinDigits,
} from '../lib/auth-helpers';
import { challengeFrom, readOtpChallenge, saveOtpChallenge, secondsUntil, type OtpChallengeResponse } from '../lib/otp-challenge';
import { AuthHeader } from './auth-ui';

/**
 * Registration step (SAHEL Design System).
 * Clear heading: "ابدأ رحلتك مع شينا", Customer Name input, Egyptian mobile number input (+20),
 * OTP verification continuation, and real working navigation links.
 */
export function RegisterForm() {
  const m = useMessages();
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();

  const returnTo = searchParams.get('returnTo');
  const target = safeReturnTo(returnTo);

  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const [phone, setPhone] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [state, setState] = useState<AsyncState>('idle');
  const [blockedUntil, setBlockedUntil] = useState(0);
  const [blockedNotice, setBlockedNotice] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const sendingRef = useRef(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on load
  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  // Pre-fill phone and name if coming back from code step
  useEffect(() => {
    const pending = readOtpChallenge();
    if (pending) {
      setPhone(displayMobile(pending.phoneNumber));
      if (pending.name) setName(pending.name);
    }
  }, []);

  // Already signed in: continue to destination
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

    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length < 2) {
      setNameError(m.authNameError);
      nameInputRef.current?.focus();
      return;
    }

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
    setNameError('');

    try {
      const challenge = await auth.sendOtp(phoneNumber, returnTo ? target : undefined);
      saveOtpChallenge(challengeFrom(phoneNumber, challenge, trimmedName));
      toVerification();
    } catch (err) {
      sendingRef.current = false;
      const code = apiErrorCode(err);
      const retryAfter = apiRetryAfter(err);

      if (code === 'OTP_COOLDOWN' && retryAfter) {
        const data = (err as { data?: Partial<OtpChallengeResponse> & { message?: Partial<OtpChallengeResponse> } }).data;
        const active = { ...data?.message, ...data } as Partial<OtpChallengeResponse>;
        if (active.codeLength && active.expiresAt) {
          saveOtpChallenge(challengeFrom(phoneNumber, { codeLength: active.codeLength, expiresAt: active.expiresAt, retryAfter }, trimmedName));
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
      setState('error');
    }
  };

  const loginHref = signInHref(target);

  return (
    <div className="flex flex-col gap-5">
      <AuthHeader
        title={m.authRegisterHeading}
        desktopTitle={
          <>
            {m.authRegisterHeadingDesktop}{' '}
            <span className="font-serif italic text-cobalt">ShinaCare</span>
          </>
        }
        description={m.authRegisterSubtitle}
      />

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <TextField
          ref={nameInputRef}
          id="register-name"
          name="name"
          label={m.authNameLabel}
          placeholder={m.authNamePlaceholder}
          error={nameError || undefined}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (nameError) setNameError('');
          }}
          autoComplete="name"
          readOnly={state === 'pending'}
        />

        <PhoneField
          ref={inputRef}
          id="register-phone"
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

      {/* Switch to login link */}
      <div className="pt-1 text-center">
        <span className="text-14 text-stone">{m.authExistingUserQuestion} </span>
        <Link
          href={loginHref}
          className="text-14 font-display font-bold text-cobalt hover:text-cobalt-deep transition-colors no-underline"
        >
          {m.authSignInAction}
        </Link>
      </div>

      <p className="m-0 text-center text-12 leading-18 text-stone/80">
        {m.authLegalAgreement}
      </p>
    </div>
  );
}
