'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AsyncButton, type AsyncState } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { FieldMessage, PhoneField, TextField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { OtpInput } from '@/components/ui/otp-input';
import { auth, type User } from '@/lib/auth';
import { formatClock, isolateLtr } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';
import { DevEmailLoginPanel } from './DevEmailLoginPanel';
import {
  apiErrorCode,
  apiRetryAfter,
  displayMobile,
  isForeignNumber,
  normalizeEgyptianMobile,
  toLatinDigits,
} from '../lib/auth-helpers';
import { challengeFrom, secondsUntil, type OtpChallenge } from '../lib/otp-challenge';

export interface AuthModalOptions {
  title?: string;
  description?: string;
  mode?: 'login' | 'register';
  intent?: string;
  onAuthenticated?: (user: User) => void | Promise<void>;
  onDismiss?: () => void;
}

export interface AuthModalProps {
  isOpen: boolean;
  options?: AuthModalOptions | null;
  onSuccess: (user: User) => void | Promise<void>;
  onClose: () => void;
}

type Step = 'credentials' | 'otp' | 'success';
type Mode = 'login' | 'register';

export function AuthModal({
  isOpen,
  options,
  onSuccess,
  onClose,
}: AuthModalProps) {
  const m = useMessages();
  const locale = useLocale();

  const [step, setStep] = useState<Step>('credentials');
  const [mode, setMode] = useState<Mode>(options?.mode ?? 'login');
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [code, setCode] = useState('');
  const [otpError, setOtpError] = useState('');

  const [sendState, setSendState] = useState<AsyncState>('idle');
  const [verifyState, setVerifyState] = useState<AsyncState>('idle');
  const [resendState, setResendState] = useState<AsyncState>('idle');

  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [blockedUntil, setBlockedUntil] = useState(0);

  const phoneInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const sendingRef = useRef(false);
  const verifyingRef = useRef(false);

  // Sync mode when modal opens or options change
  useEffect(() => {
    if (isOpen) {
      setStep('credentials');
      setMode(options?.mode ?? 'login');
      setCode('');
      setPhoneError('');
      setNameError('');
      setOtpError('');
      setSendState('idle');
      setVerifyState('idle');
    }
  }, [isOpen, options]);

  // Resend / block countdown timer
  const waitSeconds = secondsUntil(blockedUntil, now);
  const resendIn = challenge ? secondsUntil(challenge.resendAt, now) : 0;

  useEffect(() => {
    if (!isOpen || (waitSeconds <= 0 && resendIn <= 0)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isOpen, waitSeconds, resendIn]);

  // Auto-focus inputs on step/mode changes
  useEffect(() => {
    if (!isOpen) return;
    if (step === 'credentials') {
      const timer = window.setTimeout(() => {
        if (mode === 'register' && !name) {
          nameInputRef.current?.focus();
        } else {
          phoneInputRef.current?.focus();
        }
      }, 50);
      return () => window.clearTimeout(timer);
    }
  }, [isOpen, step, mode, name]);

  const handleSendOtp = async (event: FormEvent) => {
    event.preventDefault();
    if (sendingRef.current || waitSeconds > 0) return;

    const trimmedName = name.trim();
    if (mode === 'register') {
      if (!trimmedName || trimmedName.length < 2) {
        setNameError(m.authNameError);
        nameInputRef.current?.focus();
        return;
      }
    }

    const typed = toLatinDigits(phone).replace(/[\s-]/g, '');
    const national = normalizeEgyptianMobile(typed);
    if (!national) {
      setPhoneError(
        !typed
          ? m.authPhoneEmpty
          : isForeignNumber(typed)
          ? m.authPhoneForeign
          : m.authPhoneInvalid
      );
      phoneInputRef.current?.focus();
      return;
    }
    const phoneNumber = `+20${national}`;

    sendingRef.current = true;
    setSendState('pending');
    setPhoneError('');
    setNameError('');

    try {
      const res = await auth.sendOtp(phoneNumber);
      setChallenge(challengeFrom(phoneNumber, res, mode === 'register' ? trimmedName : undefined));
      setSendState('idle');
      setStep('otp');
      setCode('');
    } catch (err) {
      sendingRef.current = false;
      const errorCode = apiErrorCode(err);
      const retryAfter = apiRetryAfter(err);

      if (errorCode === 'OTP_COOLDOWN' && retryAfter) {
        setBlockedUntil(Date.now() + retryAfter * 1000);
        setPhoneError(
          fillMessage(m.authRateLimited, {
            time: isolateLtr(formatClock(retryAfter, locale)),
          })
        );
      } else if (
        errorCode === 'OTP_PHONE_NOT_EGYPTIAN' ||
        errorCode === 'OTP_PHONE_INVALID'
      ) {
        setPhoneError(
          errorCode === 'OTP_PHONE_NOT_EGYPTIAN'
            ? m.authPhoneForeign
            : m.authPhoneInvalid
        );
      } else {
        setPhoneError(m.authSendFailed);
      }
      setSendState('idle');
    } finally {
      sendingRef.current = false;
    }
  };

  const handleVerifyOtp = async (event?: FormEvent) => {
    if (event) event.preventDefault();
    if (verifyingRef.current || !challenge) return;

    const submitted = toLatinDigits(code).trim();
    if (submitted.length < (challenge.codeLength || 6)) {
      setOtpError(m.authCodeIncomplete);
      return;
    }

    verifyingRef.current = true;
    setVerifyState('pending');
    setOtpError('');

    try {
      await auth.verifyOtp(
        challenge.phoneNumber,
        submitted,
        challenge.name
      );
      setVerifyState('success');
      setStep('success');

      // Fetch user profile
      const user = await auth.getMe();

      window.setTimeout(async () => {
        verifyingRef.current = false;
        await onSuccess(user);
      }, 700);
    } catch (err) {
      verifyingRef.current = false;
      const errorCode = apiErrorCode(err);
      if (errorCode === 'OTP_EXPIRED') {
        setOtpError(m.authCodeExpired);
      } else if (errorCode === 'OTP_ATTEMPTS_EXHAUSTED') {
        setOtpError(m.authCodeExhausted);
      } else if (errorCode === 'OTP_INVALID') {
        setOtpError(m.authCodeInvalid);
      } else {
        setOtpError(m.authVerifyFailed);
      }
      setVerifyState('idle');
    }
  };

  const handleResend = async () => {
    if (!challenge || resendIn > 0 || resendState === 'pending') return;
    setResendState('pending');
    setOtpError('');

    try {
      const res = await auth.sendOtp(challenge.phoneNumber);
      setChallenge(challengeFrom(challenge.phoneNumber, res));
      setCode('');
      setResendState('idle');
    } catch {
      setResendState('idle');
      setOtpError(m.authSendFailed);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        closeLabel="إغلاق"
        className="max-w-[420px] rounded-24 bg-linen p-6 sm:p-7 shadow-elevation-3 font-display border border-sand/40"
      >
        {step === 'credentials' && (
          <div>
            {/* Mode switch tabs */}
            <div className="grid grid-cols-2 rounded-pill bg-sand/60 p-1 mb-5">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setPhoneError('');
                  setNameError('');
                }}
                className={cn(
                  'rounded-pill py-1.5 text-14 font-semibold transition-all duration-200',
                  mode === 'login'
                    ? 'bg-white text-ink shadow-elevation-1'
                    : 'text-stone hover:text-ink'
                )}
              >
                {m.authTabSignIn}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setPhoneError('');
                  setNameError('');
                }}
                className={cn(
                  'rounded-pill py-1.5 text-14 font-semibold transition-all duration-200',
                  mode === 'register'
                    ? 'bg-white text-ink shadow-elevation-1'
                    : 'text-stone hover:text-ink'
                )}
              >
                {m.authTabRegister}
              </button>
            </div>

            {/* Header */}
            <div className="flex items-center gap-2 mb-1.5">
              <span className="font-serif italic text-20 text-cobalt font-bold">
                ShinaCare
              </span>
              <span className="size-2 rounded-full bg-citron" />
            </div>

            <DialogTitle className="text-display-3 font-serif font-bold text-ink mb-1">
              {options?.title ||
                (mode === 'login' ? m.authMobileTitle : m.authRegisterHeading)}
            </DialogTitle>
            <DialogDescription className="text-14 leading-22 text-stone mb-5">
              {options?.description ||
                (mode === 'login'
                  ? m.authCardSubtitle
                  : m.authRegisterSubtitle)}
            </DialogDescription>

            {/* Form */}
            <form onSubmit={handleSendOtp} noValidate className="flex flex-col gap-4">
              {mode === 'register' && (
                <TextField
                  ref={nameInputRef}
                  id="modal-reg-name"
                  name="name"
                  label={m.authNameLabel}
                  placeholder={m.authNamePlaceholder}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameError('');
                  }}
                  error={nameError}
                  required
                />
              )}

              <PhoneField
                ref={phoneInputRef}
                id="modal-phone"
                name="phone"
                label={m.authPhoneLabel}
                hint={m.authPhoneHint}
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setPhoneError('');
                }}
                error={phoneError}
                withCountrySelector
              />

              <AsyncButton
                type="submit"
                variant="cobalt"
                size="l"
                state={sendState}
                pendingLabel={m.authSending}
                disabled={waitSeconds > 0}
                className="w-full mt-2"
              >
                {m.authSendCta}
              </AsyncButton>
            </form>

            {/* Bottom switch link */}
            <div className="text-center mt-4 text-13 font-medium text-stone">
              {mode === 'login' ? (
                <>
                  <span>{m.authNewUserQuestion} </span>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('register');
                      setPhoneError('');
                      setNameError('');
                    }}
                    className="font-bold text-cobalt hover:underline"
                  >
                    {m.authCreateAccountAction}
                  </button>
                </>
              ) : (
                <>
                  <span>{m.authExistingUserQuestion} </span>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setPhoneError('');
                      setNameError('');
                    }}
                    className="font-bold text-cobalt hover:underline"
                  >
                    {m.authSignInAction}
                  </button>
                </>
              )}
            </div>

            <DevEmailLoginPanel onSuccess={onSuccess} />
          </div>
        )}

        {step === 'otp' && (
          <div>
            {/* Top Bar with Brand & Back */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="font-serif italic text-20 text-cobalt font-bold">
                  ShinaCare
                </span>
                <span className="size-2 rounded-full bg-citron" />
              </div>
              <button
                type="button"
                onClick={() => setStep('credentials')}
                className="text-13 font-semibold text-cobalt hover:underline"
              >
                {m.authEditPhone}
              </button>
            </div>

            <DialogTitle className="text-display-3 font-serif font-bold text-ink mb-1">
              {m.authMobileOtpTitle}
            </DialogTitle>
            <DialogDescription className="text-14 leading-22 text-stone mb-5">
              {m.authMobileOtpSubtitle}{' '}
              <span dir="ltr" className="font-bold text-ink">
                {displayMobile(challenge?.phoneNumber || phone)}
              </span>
            </DialogDescription>

            <form onSubmit={handleVerifyOtp} noValidate className="flex flex-col gap-4">
              <OtpInput
                id="modal-otp-input"
                length={challenge?.codeLength ?? 6}
                value={code}
                onChange={(val) => {
                  setCode(val);
                  setOtpError('');
                  if (val.length === (challenge?.codeLength ?? 6)) {
                    // Auto-submit when complete
                    setTimeout(() => {
                      handleVerifyOtp();
                    }, 50);
                  }
                }}
                state={otpError ? 'invalid' : 'default'}
                autoFocus
                disabled={verifyState === 'pending'}
              />

              {otpError && (
                <FieldMessage tone="error" className="justify-center">
                  {otpError}
                </FieldMessage>
              )}

              {/* Resend status */}
              <div className="flex justify-center text-13">
                {resendIn > 0 ? (
                  <span className="text-stone">
                    {fillMessage(m.authResendCountdown, {
                      time: isolateLtr(formatClock(resendIn, locale)),
                    })}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={resendState === 'pending'}
                    className="font-bold text-cobalt hover:underline"
                  >
                    {m.authResend}
                  </button>
                )}
              </div>

              <AsyncButton
                type="submit"
                variant="cobalt"
                size="l"
                state={verifyState}
                pendingLabel={m.authVerifying}
                disabled={code.length < (challenge?.codeLength ?? 6)}
                className="w-full mt-2"
              >
                {m.authVerifyAction}
              </AsyncButton>
            </form>
          </div>
        )}

        {step === 'success' && (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <div className="size-14 rounded-full bg-citron flex items-center justify-center text-ink mb-3 shadow-elevation-1">
              <Icon name="check" size={26} strokeWidth={2.4} />
            </div>
            <DialogTitle className="text-display-3 font-serif font-bold text-ink">
              {m.authSuccessTitle}
            </DialogTitle>
            <DialogDescription className="text-14 leading-22 text-stone mt-1">
              {m.authSuccessSubtitle}
            </DialogDescription>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
