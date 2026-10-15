'use client'

import * as React from 'react'
import {
  ArrowLeft, ArrowRight, Eye, EyeOff, Loader2, Lock, Mail, RotateCw, ShieldCheck, Smartphone, UserPen,
} from 'lucide-react'
import { FieldError, Notice } from './chrome'
import { OtpInput, type OtpState } from './otp-input'
import { clock } from './use-countdown'
import { formatNational, displayInternational, isCompleteEgyptianMobile } from '@/lib/auth/phone'

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/* ── Email + password (primary) ───────────────────────────────────────── */

export function EmailStep({
  pending, error, notice, phoneAvailable, onSubmit, onPhone,
}: {
  pending: boolean
  error: string | null
  notice: string | null
  /** null while the capability is being fetched, false when the API says no delivery channel exists. */
  phoneAvailable: boolean | null
  onSubmit: (email: string, password: string) => void
  onPhone: () => void
}) {
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [reveal, setReveal] = React.useState(false)
  const [touched, setTouched] = React.useState(false)
  const [help, setHelp] = React.useState(false)
  const emailRef = React.useRef<HTMLInputElement>(null)
  const passwordRef = React.useRef<HTMLInputElement>(null)

  const emailError = touched && !EMAIL_SHAPE.test(email.trim()) ? 'أدخل بريدًا إلكترونيًا صحيحًا.' : null
  const passwordError = touched && !password ? 'أدخل كلمة المرور.' : null

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (!EMAIL_SHAPE.test(email.trim())) return emailRef.current?.focus()
    if (!password) return passwordRef.current?.focus()
    onSubmit(email.trim().toLowerCase(), password)
  }

  return (
    <form className="bwa-step" data-dir="back" onSubmit={submit} noValidate aria-labelledby="bwa-email-title">
      <div>
        <h1 id="bwa-email-title" className="bwa-title">تسجيل الدخول</h1>
        <p className="bwa-lead">مرحبًا بعودتك إلى مساحة أعمال شيناكير</p>
      </div>

      {notice ? <Notice tone="warn">{notice}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <div className="bwa-field">
        <label className="bwa-label" htmlFor="bwa-email">البريد الإلكتروني</label>
        <div className="bwa-control" data-invalid={Boolean(emailError)}>
          <Mail className="bwa-lead-icon" size={20} aria-hidden />
          <input
            ref={emailRef}
            id="bwa-email"
            className="bwa-input"
            type="email"
            name="username"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="name@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => email && setTouched(true)}
            aria-invalid={Boolean(emailError) || undefined}
            aria-describedby={emailError ? 'bwa-email-err' : undefined}
            disabled={pending}
            required
          />
        </div>
        {emailError ? <FieldError id="bwa-email-err">{emailError}</FieldError> : null}
      </div>

      <div className="bwa-field">
        <div className="bwa-row">
          <label className="bwa-label" htmlFor="bwa-password">كلمة المرور</label>
          <button type="button" className="bwa-link" aria-expanded={help} aria-controls="bwa-forgot" onClick={() => setHelp((v) => !v)}>
            نسيت كلمة المرور؟
          </button>
        </div>
        <div className="bwa-control" data-invalid={Boolean(passwordError)}>
          <Lock className="bwa-lead-icon" size={20} aria-hidden />
          <input
            ref={passwordRef}
            id="bwa-password"
            className="bwa-input"
            type={reveal ? 'text' : 'password'}
            name="password"
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={Boolean(passwordError) || undefined}
            aria-describedby={passwordError ? 'bwa-password-err' : undefined}
            disabled={pending}
            required
          />
          <button
            type="button"
            className="bwa-toggle"
            onClick={() => setReveal((v) => !v)}
            aria-pressed={reveal}
            aria-label={reveal ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
          >
            {reveal ? <EyeOff key="off" size={20} aria-hidden /> : <Eye key="on" size={20} aria-hidden />}
          </button>
        </div>
        {passwordError ? <FieldError id="bwa-password-err">{passwordError}</FieldError> : null}
        {help ? (
          <p id="bwa-forgot" className="bwa-help">
            <ShieldCheck size={14} aria-hidden />
            <span>حسابات فريق العمل يديرها مسؤول النظام. اطلب منه إعادة تعيين كلمة المرور.</span>
          </p>
        ) : null}
      </div>

      <button type="submit" className="bwa-btn bwa-btn-primary" disabled={pending} aria-busy={pending || undefined}>
        {pending ? <Loader2 className="bwa-spin" size={20} aria-hidden /> : <ArrowLeft size={20} aria-hidden />}
        {pending ? 'جارٍ التحقق…' : 'تسجيل الدخول'}
      </button>

      <div className="bwa-divider" role="separator"><span>أو المتابعة باستخدام</span></div>

      <div className="bwa-field">
        <button
          type="button"
          className="bwa-btn bwa-btn-secondary"
          onClick={() => { if (phoneAvailable !== false) onPhone() }}
          disabled={pending}
          aria-disabled={phoneAvailable === false || undefined}
          aria-describedby={phoneAvailable === false ? 'bwa-phone-off' : undefined}
        >
          <Smartphone size={20} aria-hidden />
          المتابعة برقم الهاتف
        </button>
        {phoneAvailable === false ? (
          <p id="bwa-phone-off" className="bwa-help">الدخول برقم الهاتف غير متاح حاليًا. استخدم البريد الإلكتروني.</p>
        ) : null}
      </div>
    </form>
  )
}

/* ── Phone number ─────────────────────────────────────────────────────── */

export function PhoneStep({
  pending, error, initial, onSubmit, onBack,
}: {
  pending: boolean
  error: string | null
  initial: string
  onSubmit: (phone: string) => void
  onBack: () => void
}) {
  const [phone, setPhone] = React.useState(initial)
  const [touched, setTouched] = React.useState(false)
  const ref = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => ref.current?.focus(), [])

  const invalid = touched && !isCompleteEgyptianMobile(phone) ? 'أدخل رقم هاتف مصريًا صحيحًا (مثل 010 1234 5678).' : null

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (!isCompleteEgyptianMobile(phone)) return ref.current?.focus()
    onSubmit(phone)
  }

  return (
    <form className="bwa-step" data-dir="fwd" onSubmit={submit} noValidate aria-labelledby="bwa-phone-title">
      <button type="button" className="bwa-link" onClick={onBack} style={{ alignSelf: 'flex-start' }}>
        <ArrowRight size={16} aria-hidden />
        العودة لتسجيل الدخول بالبريد
      </button>
      <div>
        <h1 id="bwa-phone-title" className="bwa-title">تسجيل الدخول برقم الهاتف</h1>
        <p className="bwa-lead">أدخل رقم الهاتف المسجّل لدى فريق العمل لاستلام رمز التحقق.</p>
      </div>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <div className="bwa-field">
        <label className="bwa-label" htmlFor="bwa-phone">رقم الهاتف المحمول</label>
        <div className="bwa-control" data-invalid={Boolean(invalid)}>
          <span className="bwa-prefix" dir="ltr">+20</span>
          <input
            ref={ref}
            id="bwa-phone"
            className="bwa-input"
            type="tel"
            name="phone"
            autoComplete="tel-national"
            inputMode="tel"
            placeholder="010 1234 5678"
            value={phone}
            onChange={(e) => setPhone(formatNational(e.target.value))}
            onBlur={() => phone && setTouched(true)}
            aria-invalid={Boolean(invalid) || undefined}
            aria-describedby={invalid ? 'bwa-phone-err' : undefined}
            disabled={pending}
            required
          />
        </div>
        {invalid ? <FieldError id="bwa-phone-err">{invalid}</FieldError> : null}
      </div>

      <button type="submit" className="bwa-btn bwa-btn-primary" disabled={pending} aria-busy={pending || undefined}>
        {pending ? <Loader2 className="bwa-spin" size={20} aria-hidden /> : <Smartphone size={20} aria-hidden />}
        {pending ? 'جارٍ الإرسال…' : 'إرسال رمز التحقق'}
      </button>
    </form>
  )
}

/* ── Verification code ────────────────────────────────────────────────── */

export function OtpStep({
  phone, length, pending, outcome, message, expiresIn, resendIn, resending, success,
  onSubmit, onResend, onChangePhone, onBack,
}: {
  phone: string
  length: number
  pending: boolean
  outcome: 'idle' | 'invalid' | 'expired' | 'locked' | 'other'
  message: string | null
  /** Seconds until the code expires (local mirror of the server's clock; the server still decides). */
  expiresIn: number
  resendIn: number
  resending: boolean
  success: boolean
  onSubmit: (code: string) => void
  onResend: () => void
  onChangePhone: () => void
  onBack: () => void
}) {
  const [code, setCode] = React.useState('')
  const ref = React.useRef<HTMLInputElement>(null)
  const lastSubmitted = React.useRef('')
  React.useEffect(() => ref.current?.focus(), [])

  // A wrong code is cleared so the next attempt starts clean.
  React.useEffect(() => {
    if (outcome !== 'idle') {
      setCode('')
      lastSubmitted.current = ''
      if (outcome === 'invalid' || outcome === 'other') ref.current?.focus()
    }
  }, [outcome, message])

  const dead = outcome === 'expired' || outcome === 'locked' || (expiresIn <= 0 && !success)
  // The red cells belong to the rejected attempt; typing a new code starts clean.
  const state: OtpState = success ? 'success' : (outcome === 'invalid' && code.length === 0) || dead ? 'error' : 'idle'

  const submit = (value: string) => {
    if (pending || dead || success || value.length !== length || lastSubmitted.current === value) return
    lastSubmitted.current = value
    onSubmit(value)
  }

  const shownMessage = dead && !message ? 'انتهت صلاحية الرمز. اطلب رمزًا جديدًا.' : message

  return (
    <form
      className="bwa-step"
      data-dir="fwd"
      onSubmit={(e) => { e.preventDefault(); submit(code) }}
      noValidate
      aria-labelledby="bwa-otp-title"
    >
      <button type="button" className="bwa-link" onClick={onBack} style={{ alignSelf: 'flex-start' }}>
        <ArrowRight size={16} aria-hidden />
        العودة لتسجيل الدخول بالبريد
      </button>
      <div>
        <h1 id="bwa-otp-title" className="bwa-title">أدخل رمز التحقق</h1>
        <p className="bwa-lead">
          إذا كان الرقم <bdi dir="ltr">{displayInternational(phone)}</bdi> مسجّلًا لدى فريق العمل، فسيصلك رمز من {length} أرقام.
        </p>
      </div>

      {success ? <Notice tone="ok">تم التحقق. جارٍ تحويلك إلى مساحة عملك…</Notice> : null}
      {!success && shownMessage ? <Notice tone={outcome === 'invalid' || outcome === 'other' ? 'danger' : 'warn'}>{shownMessage}</Notice> : null}

      <div className="bwa-field">
        <span id="bwa-otp-label" className="bwa-label">رمز التحقق</span>
        <OtpInput
          ref={ref}
          value={code}
          length={length}
          onChange={setCode}
          onComplete={submit}
          disabled={pending || dead || success}
          state={state}
          labelledBy="bwa-otp-label"
        />
        <div className="bwa-meta">
          {resendIn > 0 ? (
            <span>إعادة الإرسال خلال <bdi dir="ltr">{clock(resendIn)}</bdi></span>
          ) : (
            <button type="button" className="bwa-link" onClick={onResend} disabled={resending || success}>
              {resending ? <Loader2 className="bwa-spin" size={14} aria-hidden /> : <RotateCw size={14} aria-hidden />}
              إعادة إرسال الرمز
            </button>
          )}
          <button type="button" className="bwa-link" onClick={onChangePhone} disabled={pending || success}>
            <UserPen size={14} aria-hidden />
            تعديل الرقم
          </button>
        </div>
      </div>

      <button type="submit" className="bwa-btn bwa-btn-primary" disabled={pending || dead || success || code.length !== length} aria-busy={pending || undefined}>
        {pending ? <Loader2 className="bwa-spin" size={20} aria-hidden /> : <ShieldCheck size={20} aria-hidden />}
        {pending ? 'جارٍ التحقق…' : 'تأكيد الرمز والدخول'}
      </button>
    </form>
  )
}
