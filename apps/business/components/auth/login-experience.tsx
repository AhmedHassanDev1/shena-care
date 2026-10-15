'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { homeFor, useSession, type WorkspaceMe } from '@/lib/session'
import { safeNextPath } from '@/lib/auth/safe-redirect'
import { emailLoginMessage, otpVerifyOutcome, phoneSendMessage, retryAfterOf, type OtpFailure } from '@/lib/auth/messages'
import { toInternational } from '@/lib/auth/phone'
import { Brand } from './chrome'
import { EmailStep, OtpStep, PhoneStep } from './steps'
import { useCountdown } from './use-countdown'
import './auth.css'

interface AuthOptions {
  password: boolean
  phone: { available: boolean; codeLength: number; expiresInSeconds: number; resendCooldownSeconds: number }
}
interface SentCode { sent: true; expiresInSeconds: number; resendCooldownSeconds: number; codeLength: number }

type Step = 'email' | 'phone' | 'otp'

interface OtpSession {
  round: number
  expiresAt: number
  resendAt: number
  outcome: 'idle' | OtpFailure
  message: string | null
  pending: boolean
  resending: boolean
  success: boolean
}

const FALLBACK_POLICY = { codeLength: 6, expiresInSeconds: 300, resendCooldownSeconds: 60 }

/**
 * Business sign-in. Email + password is the primary method; phone code is a separate secondary step.
 * Every decision (who may sign in, which workspace, code validity, cooldowns) is the API's; this only
 * carries the credentials, shows the outcome and moves to the workspace the API says the account may use.
 */
export function LoginExperience({ heroSrc }: { heroSrc: string | null }) {
  const router = useRouter()
  const params = useSearchParams()
  const { state, endedBy, login, adopt } = useSession()
  const next = params.get('next')

  const [step, setStep] = React.useState<Step>('email')
  const [options, setOptions] = React.useState<AuthOptions | null>(null)

  const [emailPending, setEmailPending] = React.useState(false)
  const [emailError, setEmailError] = React.useState<string | null>(null)

  const [phone, setPhone] = React.useState('')
  const [phonePending, setPhonePending] = React.useState(false)
  const [phoneError, setPhoneError] = React.useState<string | null>(null)

  const [otp, setOtp] = React.useState<OtpSession | null>(null)
  const policy = options?.phone ?? FALLBACK_POLICY

  const destination = React.useCallback(
    (me: WorkspaceMe) => safeNextPath(next, me.roles) ?? homeFor(me),
    [next],
  )

  // Already signed in (or the session was just established): go to the workspace the API allows.
  React.useEffect(() => {
    if (state.status === 'ready') router.replace(destination(state.me))
  }, [state, router, destination])

  React.useEffect(() => {
    const controller = new AbortController()
    api<AuthOptions>('/accounts/staff/auth-options', { public: true, signal: controller.signal })
      .then(setOptions)
      .catch(() => { /* unknown capability: the phone option stays offered and fails honestly if used */ })
    return () => controller.abort()
  }, [])

  const expiresIn = useCountdown(otp?.expiresAt ?? null)
  const resendIn = useCountdown(otp?.resendAt ?? null)

  /* ── email + password ── */
  const signInWithEmail = async (email: string, password: string) => {
    setEmailPending(true)
    setEmailError(null)
    try {
      await login(email, password)
    } catch (error) {
      setEmailError(emailLoginMessage(error))
      setEmailPending(false)
    }
    // On success the session effect navigates; the form stays busy until the page changes.
  }

  /* ── phone code ── */
  const requestCode = async (value: string, mode: 'first' | 'resend') => {
    if (mode === 'first') { setPhonePending(true); setPhoneError(null) }
    else setOtp((current) => current && { ...current, resending: true })
    const now = Date.now()
    try {
      const sent = await api<SentCode>('/accounts/staff/otp/send', { body: { phoneNumber: toInternational(value) }, public: true })
      setOtp((current) => ({
        round: (current?.round ?? 0) + 1,
        expiresAt: now + sent.expiresInSeconds * 1000,
        resendAt: now + sent.resendCooldownSeconds * 1000,
        outcome: 'idle', message: null, pending: false, resending: false, success: false,
      }))
      setStep('otp')
    } catch (error) {
      const wait = error instanceof ApiError && error.code === 'OTP_COOLDOWN' ? retryAfterOf(error) : null
      if (wait !== null) {
        // A code was issued moments ago: continue with it rather than leaving the person stuck.
        const age = policy.resendCooldownSeconds - wait
        setOtp((current) => ({
          round: (current?.round ?? 0) + 1,
          expiresAt: now + (policy.expiresInSeconds - age) * 1000,
          resendAt: now + wait * 1000,
          outcome: 'idle', message: 'تم إرسال رمز قبل لحظات. استخدمه أو انتظر قبل طلب رمز جديد.',
          pending: false, resending: false, success: false,
        }))
        setStep('otp')
      } else if (mode === 'first') {
        setPhoneError(phoneSendMessage(error))
      } else {
        const retry = retryAfterOf(error)
        setOtp((current) => current && {
          ...current,
          resending: false,
          resendAt: retry ? Date.now() + retry * 1000 : current.resendAt,
          outcome: 'other', message: phoneSendMessage(error),
        })
      }
    } finally {
      if (mode === 'first') setPhonePending(false)
    }
  }

  const verifyCode = async (code: string) => {
    setOtp((current) => current && { ...current, pending: true, outcome: 'idle', message: null })
    try {
      const { token } = await api<{ token: string }>('/accounts/staff/otp/verify', {
        body: { phoneNumber: toInternational(phone), code }, public: true,
      })
      const me = await adopt(token)
      setOtp((current) => current && { ...current, pending: false, success: true })
      router.replace(destination(me))
    } catch (error) {
      const result = otpVerifyOutcome(error)
      setOtp((current) => current && { ...current, pending: false, outcome: result.kind, message: result.message })
    }
  }

  const backToEmail = () => { setStep('email'); setOtp(null); setPhoneError(null) }

  const phoneAvailable = options ? options.phone.available : null

  return (
    <main className="bwa">
      <div className="bwa-stage">
        <section className="bwa-panel" aria-label="تسجيل الدخول إلى مساحة الأعمال">
          <Brand />
          {step === 'email' ? (
            <EmailStep
              pending={emailPending}
              error={emailError}
              notice={endedBy === 'expired' ? 'انتهت جلستك. سجّل الدخول مرة أخرى للمتابعة.' : null}
              phoneAvailable={phoneAvailable}
              onSubmit={signInWithEmail}
              onPhone={() => { setPhoneError(null); setStep('phone') }}
            />
          ) : null}
          {step === 'phone' ? (
            <PhoneStep
              pending={phonePending}
              error={phoneError}
              initial={phone}
              onSubmit={(value) => { setPhone(value); void requestCode(value, 'first') }}
              onBack={backToEmail}
            />
          ) : null}
          {step === 'otp' && otp ? (
            <OtpStep
              key={otp.round}
              phone={phone}
              length={policy.codeLength}
              pending={otp.pending}
              outcome={otp.outcome}
              message={otp.message}
              expiresIn={expiresIn}
              resendIn={resendIn}
              resending={otp.resending}
              success={otp.success}
              onSubmit={verifyCode}
              onResend={() => void requestCode(phone, 'resend')}
              onChangePhone={() => { setOtp(null); setPhoneError(null); setStep('phone') }}
              onBack={backToEmail}
            />
          ) : null}
          <p className="bwa-note">
            <ShieldCheck size={18} aria-hidden />
            <span>يتم تحديد مساحة العمل تلقائيًا وفق صلاحيات حسابك. لا يمكن إنشاء حسابات من هذه الصفحة.</span>
          </p>
        </section>

        <div className="bwa-visual" aria-hidden>
          {heroSrc ? <img src={heroSrc} alt="" decoding="async" fetchPriority="high" /> : <div className="bwa-atmosphere" />}
        </div>
      </div>
    </main>
  )
}
