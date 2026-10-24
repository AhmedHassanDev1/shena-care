'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Eye,
  EyeOff,
  Globe,
  HelpCircle,
  KeyRound,
  Lock,
  Mail,
  Phone,
  ShieldCheck,
  X,
} from 'lucide-react'
import { ApiError } from '@/lib/api'
import { homeFor, useSession } from '@/lib/session'
import { cn } from '@/lib/utils'

/**
 * ShinaCare Business Unified Authentication Experience.
 *
 * Refined SaaS production-ready design:
 * - 55% / 45% balanced split-screen layout on desktop.
 * - Clean dedicated environmental background asset without baked-in text or UI cards.
 * - Single consistent ShinaCare Business brand identity.
 * - Mutually exclusive Email and Phone login tabs with no redundant duplicate buttons.
 * - Compact, vertically balanced card (420–460px width) with soft elevation.
 * - Full Arabic RTL support, visible focus states, and dev-only credential presets.
 */
export default function LoginPage() {
  const { state, login, logout } = useSession()
  const router = useRouter()

  // Form State
  const [authMethod, setAuthMethod] = React.useState<'password' | 'phone_otp'>('password')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [showPassword, setShowPassword] = React.useState(false)
  const [rememberMe, setRememberMe] = React.useState(false)
  const [language, setLanguage] = React.useState<'ar' | 'en'>('ar')

  // Phone OTP State
  const [phoneNumber, setPhoneNumber] = React.useState('')
  const [otpCode, setOtpCode] = React.useState(['', '', '', '', '', ''])
  const [otpSent, setOtpSent] = React.useState(false)
  const [otpCountdown, setOtpCountdown] = React.useState(0)

  // Feedback & Modals
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [isForgotPasswordOpen, setIsForgotPasswordOpen] = React.useState(false)
  const [isHelpOpen, setIsHelpOpen] = React.useState(false)
  const [showDevPresets, setShowDevPresets] = React.useState(false)

  // OTP Countdown Timer
  React.useEffect(() => {
    if (otpCountdown > 0) {
      const timer = setTimeout(() => setOtpCountdown((c) => c - 1), 1000)
      return () => clearTimeout(timer)
    }
  }, [otpCountdown])

  // Handle Standard Email/Password Login
  const handleEmailSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!email.trim() || !password || pending) return

    setPending(true)
    setError(null)
    try {
      const me = await login(email.trim(), password)
      const targetHome = homeFor(me)
      if (targetHome === '/login') {
        setError(
          language === 'ar'
            ? 'الحساب المسجل لا يمتلك صلاحية نشطة على مساحة أعمال ShinaCare. يرجى مراجعة إدارة العمليات.'
            : 'Your account does not have active permissions for ShinaCare Business. Please contact Operations.'
        )
      } else {
        router.replace(targetHome)
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError(
            language === 'ar'
              ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة. يرجى التأكد من البيانات والمحاولة مجدداً.'
              : 'Invalid email or password. Please verify your credentials and try again.'
          )
        } else if (err.status === 429) {
          setError(
            language === 'ar'
              ? 'تم تجاوز الحد المسموح لمحاولات الدخول. يرجى الانتظار دقيقتين ثم المحاولة.'
              : 'Too many login attempts. Please wait 2 minutes before retrying.'
          )
        } else {
          setError(err.message || (language === 'ar' ? 'تعذر تسجيل الدخول، يرجى المحاولة لاحقاً.' : 'Unable to sign in. Please try again.'))
        }
      } else {
        setError(
          language === 'ar'
            ? 'حدث خطأ في الاتصال بالخادم المركزي. تحقق من اتصالك بالإنترنت.'
            : 'Connection error to the central server. Please check your network.'
        )
      }
    } finally {
      setPending(false)
    }
  }

  // Handle Phone OTP Send
  const handleSendOtp = (e: React.FormEvent) => {
    e.preventDefault()
    const cleanPhone = phoneNumber.trim().replace(/\s+/g, '')
    if (!cleanPhone.match(/^(01[0125][0-9]{8}|1[0125][0-9]{8})$/)) {
      setError(
        language === 'ar'
          ? 'يرجى إدخال رقم هاتف محمول مصري صحيح (مثال: 01012345678)'
          : 'Please enter a valid Egyptian mobile number (e.g. 01012345678)'
      )
      return
    }

    setError(null)
    setOtpSent(true)
    setOtpCountdown(60)
  }

  // Handle Quick Presets
  const setPreset = (presetEmail: string, presetPass: string) => {
    setEmail(presetEmail)
    setPassword(presetPass)
    setError(null)
  }

  return (
    <div
      dir={language === 'ar' ? 'rtl' : 'ltr'}
      className="sc-glow min-h-dvh bg-[#070b09] text-[#f4f4f5] font-sans antialiased flex flex-col justify-between selection:bg-[#34d27b]/30 selection:text-white"
    >
      {/* Background Radial Glow Accents */}
      <div className="pointer-events-none fixed top-0 left-1/3 h-[500px] w-[500px] rounded-full bg-[#34d27b]/10 blur-[150px]" />
      <div className="pointer-events-none fixed bottom-0 right-1/4 h-[400px] w-[400px] rounded-full bg-[#10b981]/8 blur-[130px]" />

      {/* Main Split Layout: 55% Visual, 45% Auth */}
      <div className="w-full flex-1 flex flex-col lg:flex-row min-h-dvh">
        {/* =====================================================================
            LEFT SIDE (Desktop 55%): Clean Cinematic Logistics Visual
            Hidden on mobile, prominently displayed on desktop
            ===================================================================== */}
        <div className="hidden lg:flex lg:w-[55%] relative flex-col justify-between p-8 xl:p-12 border-e border-white/[0.08] overflow-hidden bg-black select-none">
          {/* Pristine Environmental Background Image Layer */}
          <div className="absolute inset-0 z-0">
            <Image
              src="/images/login-ecosystem-clean.jpg"
              alt="ShinaCare Operational Ecosystem"
              fill
              priority
              className="object-cover object-center"
            />
            {/* Elegant Contrast Vignette & Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/75" />
            <div className="absolute inset-0 bg-gradient-to-l from-black/50 via-transparent to-transparent" />
          </div>

          {/* Top Brand Bar */}
          <div className="relative z-10 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {/* Green Two-Leaf Brand Icon */}
              <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-[#34d27b]/15 border border-[#34d27b]/40 shadow-[0_0_16px_rgba(52,210,123,0.3)] backdrop-blur-md">
                <svg className="w-5 h-5 text-[#34d27b]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" opacity="0.3" />
                  <path d="M17 8C8 10 5.9 16.17 3.82 21.34l1.89.66C7.5 17.5 9.5 12 17 10V8z" />
                  <path d="M20.18 3.82C11.18 5.82 9.08 12 7 17.17l1.89.66C10.68 13.33 12.68 7.82 20.18 5.82v-2z" />
                </svg>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-bold tracking-tight text-white">ShinaCare</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#34d27b]/20 text-[#34d27b] border border-[#34d27b]/40">
                    Business
                  </span>
                </div>
                <span className="text-[11px] text-gray-400 block">منظومة تشغيل تجارة الجمال</span>
              </div>
            </div>

            {/* Active System Pill */}
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-black/60 border border-white/10 backdrop-blur-md">
              <span className="h-2 w-2 rounded-full bg-[#34d27b] animate-pulse" />
              <span className="text-[11px] font-mono text-[#34d27b]">نظام لوجستي نشط</span>
            </div>
          </div>

          {/* Hero Headline Copy (Rendered as clean HTML with contrast) */}
          <div className="relative z-10 max-w-lg space-y-2.5 pt-6">
            <h1 className="text-3xl xl:text-4xl font-extrabold tracking-tight leading-tight">
              <span className="text-white block">من المورد إلى العميل</span>
              <span className="text-[#34d27b] block mt-1 drop-shadow-[0_0_24px_rgba(52,210,123,0.35)]">
                منظومة واحدة، عمليات أذكى
              </span>
            </h1>
            <p className="text-sm text-gray-300/90 leading-relaxed max-w-md">
              نربط الموردين والتجهيز والمركز والتوصيل في نظام واحد لعمليات أسرع وتجربة أفضل.
            </p>
          </div>

          {/* Environmental spacer: Clean visual scenery with no promotional clutter */}
          <div className="relative z-10 my-auto min-h-[140px]" />

          {/* Bottom subtle assurance */}
          <div className="relative z-10 text-[11px] text-gray-400/80 flex items-center justify-between border-t border-white/[0.08] pt-3">
            <span>منظومة متكاملة لربط سلاسل التوريد والعمليات اللوجستية الميدانية</span>
            <span className="font-mono text-zinc-500">Cairo · Giza Ops</span>
          </div>
        </div>

        {/* =====================================================================
            RIGHT SIDE (Desktop 45% + Mobile): Staff Authentication Panel
            Compact form card with width ~440px and balanced vertical rhythm
            ===================================================================== */}
        <div className="w-full lg:w-[45%] flex flex-col justify-between p-5 sm:p-8 xl:p-12 relative z-10 min-h-dvh overflow-y-auto">
          {/* Top Bar: Mobile Brand Mark + Language Toggle */}
          <div className="flex items-center justify-between w-full mb-4">
            {/* Mobile-only logo mark */}
            <div className="flex items-center gap-2 lg:hidden">
              <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-[#34d27b]/20 border border-[#34d27b]/40">
                <svg className="w-4 h-4 text-[#34d27b]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" opacity="0.3" />
                  <path d="M17 8C8 10 5.9 16.17 3.82 21.34l1.89.66C7.5 17.5 9.5 12 17 10V8z" />
                  <path d="M20.18 3.82C11.18 5.82 9.08 12 7 17.17l1.89.66C10.68 13.33 12.68 7.82 20.18 5.82v-2z" />
                </svg>
              </div>
              <span className="font-bold text-sm text-white">ShinaCare</span>
              <span className="px-1.5 py-0.2 rounded text-[10px] bg-[#34d27b]/20 text-[#34d27b] border border-[#34d27b]/30">Business</span>
            </div>

            {/* Language Selector */}
            <button
              type="button"
              onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
              className="ms-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/40 border border-white/10 hover:border-[#34d27b]/40 text-xs text-gray-300 transition-colors cursor-pointer"
            >
              <Globe className="h-3.5 w-3.5 text-[#34d27b]" />
              <span>{language === 'ar' ? 'العربية' : 'English'}</span>
              <ChevronDown className="h-3 w-3 text-gray-500" />
            </button>
          </div>

          {/* =====================================================================
              THE AUTHENTICATION CARD (Compact 420–460px with Soft Emerald Elevation)
              ===================================================================== */}
          <div className="w-full max-w-[440px] mx-auto my-auto sc-login-card-emerald p-6 sm:p-7 space-y-5">
            {/* Card Header: Unified Logo, Welcome & Subtitle */}
            <div className="text-center space-y-2">
              <div className="flex flex-col items-center justify-center">
                <div className="flex items-center gap-2">
                  <div className="flex items-center justify-center h-9 w-9 rounded-xl bg-[#34d27b]/15 border border-[#34d27b]/40 shadow-[0_0_16px_rgba(52,210,123,0.3)]">
                    <svg className="w-5 h-5 text-[#34d27b]" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" opacity="0.3" />
                      <path d="M17 8C8 10 5.9 16.17 3.82 21.34l1.89.66C7.5 17.5 9.5 12 17 10V8z" />
                      <path d="M20.18 3.82C11.18 5.82 9.08 12 7 17.17l1.89.66C10.68 13.33 12.68 7.82 20.18 5.82v-2z" />
                    </svg>
                  </div>
                  <span className="text-xl font-bold tracking-tight text-white">ShinaCare</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#34d27b]/20 text-[#34d27b] border border-[#34d27b]/30">
                    Business
                  </span>
                </div>
                <span className="text-[11px] text-[#9ca3af] mt-1">منظومة تشغيل تجارة الجمال</span>
              </div>

              <h2 className="text-2xl font-bold text-white pt-1">
                {language === 'ar' ? 'مرحبًا بعودتك' : 'Welcome back'}
              </h2>
              <p className="text-xs text-gray-400">
                {language === 'ar'
                  ? 'سجل الدخول للوصول إلى لوحة التحكم وإدارة العمليات.'
                  : 'Sign in to access your operations dashboard.'}
              </p>
            </div>

            {/* Error Notification */}
            {error && (
              <div className="flex items-start gap-2.5 rounded-xl border border-[#fb7185]/30 bg-[#fb7185]/10 p-3 text-xs text-[#fb7185] animate-in fade-in">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span className="flex-1 leading-relaxed">{error}</span>
              </div>
            )}

            {/* Active Session Notice & Resume Options */}
            {state.status === 'ready' && (
              <div className="rounded-xl border border-[#34d27b]/40 bg-[#34d27b]/10 p-3.5 text-xs space-y-2.5 animate-in fade-in">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#34d27b] opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-[#34d27b]"></span>
                    </span>
                    <span className="font-semibold text-white">
                      {language === 'ar' ? 'أنت مسجل الدخول حالياً' : 'Currently signed in'}
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] bg-black/50 text-[#34d27b] border border-[#34d27b]/30 font-mono">
                    {state.me.roles.join(', ')}
                  </span>
                </div>
                <div className="text-gray-300 text-[11px]">
                  <span>{state.me.name}</span>
                  <span className="mx-1 text-gray-500">·</span>
                  <span className="text-gray-400 font-mono" dir="ltr">{state.me.email}</span>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => router.push(homeFor(state.me))}
                    className="flex-1 py-2 px-3 rounded-lg bg-[#34d27b] hover:bg-[#2ebc6e] text-black font-semibold text-xs text-center transition-colors shadow-sm cursor-pointer"
                  >
                    {language === 'ar' ? 'المتابعة لمساحة العمل' : 'Go to workspace'}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await logout()
                      setError(null)
                    }}
                    className="py-2 px-3 rounded-lg bg-black/50 hover:bg-black/70 border border-white/10 text-gray-300 hover:text-white text-xs transition-colors cursor-pointer"
                  >
                    {language === 'ar' ? 'تسجيل الخروج' : 'Log out'}
                  </button>
                </div>
              </div>
            )}

            {/* Mutually Exclusive Tabs: البريد الإلكتروني (Email) vs رقم الهاتف (Phone Number) */}
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-black/40 border border-white/10" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={authMethod === 'password'}
                onClick={() => {
                  setAuthMethod('password')
                  setError(null)
                }}
                className={cn(
                  'flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-medium transition-all cursor-pointer',
                  authMethod === 'password'
                    ? 'sc-login-tab-emerald'
                    : 'text-gray-400 hover:text-white hover:bg-white/[0.04]'
                )}
              >
                <Mail className="h-4 w-4" />
                <span>{language === 'ar' ? 'البريد الإلكتروني' : 'Email'}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={authMethod === 'phone_otp'}
                onClick={() => {
                  setAuthMethod('phone_otp')
                  setError(null)
                }}
                className={cn(
                  'flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-medium transition-all cursor-pointer',
                  authMethod === 'phone_otp'
                    ? 'sc-login-tab-emerald'
                    : 'text-gray-400 hover:text-white hover:bg-white/[0.04]'
                )}
              >
                <Phone className="h-4 w-4" />
                <span>{language === 'ar' ? 'رقم الهاتف' : 'Phone Number'}</span>
              </button>
            </div>

            {/* Tab 1: Email & Password (Default Authentication) */}
            {authMethod === 'password' && (
              <form onSubmit={handleEmailSubmit} className="space-y-3.5" noValidate>
                {/* Email Field */}
                <div className="space-y-1.5 text-start">
                  <label htmlFor="login-email" className="block text-xs font-medium text-gray-300">
                    {language === 'ar' ? 'البريد الإلكتروني' : 'Email address'}
                  </label>
                  <div className="relative">
                    <input
                      id="login-email"
                      type="email"
                      dir="ltr"
                      autoComplete="username"
                      required
                      placeholder="name@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="sc-login-input-emerald w-full pe-10"
                    />
                    <div className="absolute inset-y-0 end-3 flex items-center pointer-events-none text-gray-400">
                      <Mail className="h-4 w-4" />
                    </div>
                  </div>
                </div>

                {/* Password Field */}
                <div className="space-y-1.5 text-start">
                  <label htmlFor="login-password" className="block text-xs font-medium text-gray-300">
                    {language === 'ar' ? 'كلمة المرور' : 'Password'}
                  </label>
                  <div className="relative">
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      dir="ltr"
                      autoComplete="current-password"
                      required
                      placeholder="••••••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="sc-login-input-emerald w-full pe-10 ps-10"
                    />
                    <div className="absolute inset-y-0 end-3 flex items-center pointer-events-none text-gray-400">
                      <Lock className="h-4 w-4" />
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 start-3 flex items-center text-gray-400 hover:text-white transition-colors cursor-pointer"
                      aria-label={showPassword ? (language === 'ar' ? 'إخفاء كلمة المرور' : 'Hide password') : (language === 'ar' ? 'إظهار كلمة المرور' : 'Show password')}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Remember Me & Forgot Password Row */}
                <div className="flex items-center justify-between text-xs pt-0.5">
                  <label className="flex items-center gap-2 cursor-pointer select-none text-gray-300 hover:text-white transition-colors">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="h-4 w-4 rounded border-white/20 bg-black text-[#34d27b] focus:ring-[#34d27b] focus:ring-offset-black cursor-pointer"
                    />
                    <span>{language === 'ar' ? 'تذكرني' : 'Remember me'}</span>
                  </label>

                  <button
                    type="button"
                    onClick={() => setIsForgotPasswordOpen(true)}
                    className="text-[#34d27b] hover:text-[#2ebc6e] hover:underline cursor-pointer"
                  >
                    {language === 'ar' ? 'نسيت كلمة المرور؟' : 'Forgot password?'}
                  </button>
                </div>

                {/* Primary Submit Button */}
                <button
                  type="submit"
                  disabled={pending || !email.trim() || !password}
                  className="sc-login-btn-emerald w-full text-sm font-semibold mt-1"
                >
                  {pending ? (
                    <div className="flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-black border-t-transparent" />
                      <span>{language === 'ar' ? 'جاري التحقق...' : 'Signing in...'}</span>
                    </div>
                  ) : (
                    <>
                      <span>{language === 'ar' ? 'تسجيل الدخول' : 'Sign In'}</span>
                      {language === 'ar' ? (
                        <ArrowLeft className="h-4 w-4" />
                      ) : (
                        <ArrowRight className="h-4 w-4" />
                      )}
                    </>
                  )}
                </button>
              </form>
            )}

            {/* Tab 2: Egyptian Phone Number with OTP */}
            {authMethod === 'phone_otp' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-[#34d27b]/25 bg-[#34d27b]/5 p-3 text-xs text-gray-300">
                  <b className="text-[#34d27b] block mb-1">
                    {language === 'ar' ? 'التحقق الميداني لمناديب وموردي العمليات' : 'Field Operations Verification'}
                  </b>
                  {language === 'ar'
                    ? 'أدخل رقم هاتفك المسجل لاستلام رمز التحقق لمرة واحدة (OTP).'
                    : 'Enter your registered Egyptian mobile number to receive a one-time passcode.'}
                </div>

                {!otpSent ? (
                  <form onSubmit={handleSendOtp} className="space-y-3.5">
                    <div className="space-y-1.5 text-start">
                      <label htmlFor="phone-input" className="block text-xs font-medium text-gray-300">
                        {language === 'ar' ? 'رقم الهاتف المحمول' : 'Mobile Number'}
                      </label>
                      <div className="relative flex items-center rounded-xl border border-white/10 bg-[rgba(14,20,17,0.75)] focus-within:border-[#34d27b] focus-within:ring-2 focus-within:ring-[#34d27b]/20 transition-all overflow-hidden" dir="ltr">
                        <span className="px-3 py-2.5 text-xs font-mono font-bold text-[#34d27b] bg-white/[0.04] border-e border-white/10 select-none">
                          +20
                        </span>
                        <input
                          id="phone-input"
                          type="tel"
                          dir="ltr"
                          placeholder="01012345678"
                          value={phoneNumber}
                          onChange={(e) => setPhoneNumber(e.target.value)}
                          className="w-full bg-transparent px-3 py-2.5 text-sm text-[#f4f4f5] placeholder:text-gray-500 focus:outline-none"
                        />
                        <div className="pe-3 text-gray-400">
                          <Phone className="h-4 w-4" />
                        </div>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={!phoneNumber.trim()}
                      className="sc-login-btn-emerald w-full text-sm font-semibold"
                    >
                      <span>{language === 'ar' ? 'إرسال رمز التحقق' : 'Send Code'}</span>
                      <Phone className="h-4 w-4" />
                    </button>
                  </form>
                ) : (
                  <div className="space-y-4">
                    <div className="text-center space-y-1">
                      <span className="text-xs text-gray-400 block">
                        {language === 'ar' ? 'أدخل الرمز المكون من 6 أرقام المرسل إلى:' : 'Enter 6-digit code sent to:'}
                      </span>
                      <b className="font-mono text-sm text-[#34d27b] inline-block" dir="ltr">
                        +20 {phoneNumber}
                      </b>
                    </div>

                    <div className="flex justify-center gap-2" dir="ltr">
                      {otpCode.map((digit, idx) => (
                        <input
                          key={idx}
                          id={`mob-otp-${idx}`}
                          type="text"
                          maxLength={1}
                          inputMode="numeric"
                          value={digit}
                          onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, '')
                            const updated = [...otpCode]
                            updated[idx] = val
                            setOtpCode(updated)
                            if (val && idx < 5) {
                              document.getElementById(`mob-otp-${idx + 1}`)?.focus()
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Backspace' && !otpCode[idx] && idx > 0) {
                              document.getElementById(`mob-otp-${idx - 1}`)?.focus()
                            }
                          }}
                          className="h-11 w-10 sm:w-11 rounded-xl border border-white/20 bg-black/60 text-center font-mono text-lg font-bold text-white focus:border-[#34d27b] focus:outline-none focus:ring-2 focus:ring-[#34d27b]/30 transition-all"
                        />
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setError(
                          language === 'ar'
                            ? 'خدمة تسجيل الدخول برمز الهاتف (OTP) غير مفعّلة على هذا الخادم حالياً. يرجى استخدام البريد الإلكتروني وكلمة المرور المعتمدة.'
                            : 'Phone OTP login is not currently active on this server. Please sign in with your authorized email and password.'
                        )
                      }}
                      className="sc-login-btn-emerald w-full text-sm font-semibold"
                    >
                      <span>{language === 'ar' ? 'تأكيد الرمز والدخول' : 'Verify & Continue'}</span>
                      <ShieldCheck className="h-4 w-4" />
                    </button>

                    <div className="flex items-center justify-between text-xs text-gray-400 pt-1">
                      <button
                        type="button"
                        onClick={() => setOtpSent(false)}
                        className="hover:text-white transition-colors cursor-pointer"
                      >
                        {language === 'ar' ? '← تغيير الرقم' : '← Change number'}
                      </button>
                      {otpCountdown > 0 ? (
                        <span className="font-mono text-gray-400">
                          {language === 'ar' ? `إعادة الإرسال بعد ${otpCountdown}ث` : `Resend in ${otpCountdown}s`}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setOtpCountdown(60)}
                          className="text-[#34d27b] hover:underline cursor-pointer"
                        >
                          {language === 'ar' ? 'إعادة الإرسال' : 'Resend code'}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Dev Test Presets: Visible ONLY in Development Mode */}
            {process.env.NODE_ENV !== 'production' && (
              <div className="pt-2 border-t border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => setShowDevPresets(!showDevPresets)}
                  className="w-full flex items-center justify-between text-[11px] text-gray-400 hover:text-white px-1 py-1 cursor-pointer transition-colors"
                >
                  <span>{language === 'ar' ? 'بيانات الدخول السريع للاختبار (Test Presets)' : 'Quick Test Accounts'}</span>
                  <span className="text-[10px] text-[#34d27b] font-mono">{showDevPresets ? 'إخفاء' : 'عرض'}</span>
                </button>

                {showDevPresets && (
                  <div className="grid grid-cols-2 gap-2 mt-2 text-xs animate-in fade-in">
                    <button
                      type="button"
                      onClick={() => setPreset('admin@shenacare.com', '')}
                      className="p-2.5 rounded-lg bg-black/60 border border-white/10 hover:border-[#34d27b]/50 text-start transition-colors cursor-pointer"
                    >
                      <b className="text-white block text-[11px]">مدير النظام (Admin)</b>
                      <span className="text-[10px] text-gray-400 font-mono">admin@shenacare.com</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreset('hub@shenacare.com', '')}
                      className="p-2.5 rounded-lg bg-black/60 border border-white/10 hover:border-[#34d27b]/50 text-start transition-colors cursor-pointer"
                    >
                      <b className="text-white block text-[11px]">مشرف المخزن (Hub)</b>
                      <span className="text-[10px] text-gray-400 font-mono">hub@shenacare.com</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreset('supplier@shenacare.com', '')}
                      className="p-2.5 rounded-lg bg-black/60 border border-white/10 hover:border-[#34d27b]/50 text-start transition-colors cursor-pointer"
                    >
                      <b className="text-white block text-[11px]">مورد معتمد (Supplier)</b>
                      <span className="text-[10px] text-gray-400 font-mono">supplier@shenacare.com</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreset('driver@shenacare.com', '')}
                      className="p-2.5 rounded-lg bg-black/60 border border-white/10 hover:border-[#34d27b]/50 text-start transition-colors cursor-pointer"
                    >
                      <b className="text-white block text-[11px]">مندوب توصيل (Driver)</b>
                      <span className="text-[10px] text-gray-400 font-mono">driver@shenacare.com</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* =====================================================================
              FOOTER: Security & Help Links
              ===================================================================== */}
          <div className="flex items-center justify-between text-xs text-gray-400 mt-5 pt-3.5 border-t border-white/10">
            {/* Help / مساعدة */}
            <button
              type="button"
              onClick={() => setIsHelpOpen(true)}
              className="flex items-center gap-1.5 hover:text-white transition-colors cursor-pointer"
            >
              <HelpCircle className="h-4 w-4 text-gray-400" />
              <span>{language === 'ar' ? 'مساعدة' : 'Help'}</span>
            </button>

            {/* Platform Branding */}
            <span className="text-[11px] text-gray-500 font-medium">ShinaCare Business</span>

            {/* Secure Login Badge / دخول آمن */}
            <div className="flex items-center gap-1.5 text-gray-300">
              <ShieldCheck className="h-4 w-4 text-[#34d27b]" />
              <span>{language === 'ar' ? 'دخول آمن' : 'Secure Login'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* =====================================================================
          Forgot Password Modal
          ===================================================================== */}
      {isForgotPasswordOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in"
        >
          <div className="sc-login-card-emerald w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-[#34d27b]" />
                <h3 className="text-base font-bold text-white">
                  {language === 'ar' ? 'استعادة كلمة المرور للموظفين' : 'Staff Password Recovery'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsForgotPasswordOpen(false)}
                className="text-gray-400 hover:text-white p-1 cursor-pointer"
                aria-label="إغلاق"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-gray-300 leading-relaxed text-start">
              <p>
                {language === 'ar'
                  ? 'يتم إدارة وتعيين كلمات المرور لجميع موظفي ومناديب وموردي شينا كير مركزياً عبر إدارة العمليات:'
                  : 'Passwords for all operations staff, drivers, and suppliers are centrally managed by Operations:'}
              </p>
              <div className="rounded-xl bg-black/50 p-3 border border-white/10 space-y-1.5 font-mono text-[11px]">
                <div className="text-white font-semibold">{language === 'ar' ? 'قنوات الدعم الفني الداخلي:' : 'Internal Support Channels:'}</div>
                <div className="text-[#34d27b]" dir="ltr">ops-admin@shenacare.com</div>
                <div className="text-gray-300">{language === 'ar' ? 'الخط الساخن للعمليات: 19822 (تحويلة 401)' : 'Operations Hotline: 19822 (Ext. 401)'}</div>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setIsForgotPasswordOpen(false)}
                className="sc-login-btn-emerald px-6 py-2 text-xs"
              >
                {language === 'ar' ? 'حسناً، فهمت' : 'Got it'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          Help Support Modal
          ===================================================================== */}
      {isHelpOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in"
        >
          <div className="sc-login-card-emerald w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <HelpCircle className="h-5 w-5 text-[#34d27b]" />
                <h3 className="text-base font-bold text-white">
                  {language === 'ar' ? 'مركز مساعدة مساحة الأعمال' : 'Business Help Center'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsHelpOpen(false)}
                className="text-gray-400 hover:text-white p-1 cursor-pointer"
                aria-label="إغلاق"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-gray-300 leading-relaxed text-start">
              <p>
                {language === 'ar'
                  ? 'مساحة الأعمال مخصصة فقط للكوادر التشغيلية المعتمدة في القاهرة والجيزة.'
                  : 'The Business Workspace is exclusively for authorized operations personnel in Cairo and Giza.'}
              </p>
              <ul className="list-disc list-inside space-y-1 text-gray-400">
                {language === 'ar' ? (
                  <>
                    <li>مديرو العمليات: تسجيل الدخول لمتابعة لوحة القيادة والموردين.</li>
                    <li>مشرفو المخزن: الدخول لمحطات الاستلام والتجهيز والشحن بالمعادي.</li>
                    <li>مناديب التوصيل: متابعة مسار التوصيل الميداني وتحصيل COD.</li>
                    <li>الموردون: تأكيد أوامر الشراء اليومية ومتابعة الفواتير.</li>
                  </>
                ) : (
                  <>
                    <li>Operations Admins: Access executive dashboard and suppliers.</li>
                    <li>Hub Operators: Ingestion, packing, and dispatch at Maadi hub.</li>
                    <li>Delivery Drivers: Field route management and COD collection.</li>
                    <li>Suppliers: Daily PO confirmation and invoice tracking.</li>
                  </>
                )}
              </ul>
            </div>

            <div className="flex justify-end pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setIsHelpOpen(false)}
                className="sc-login-btn-emerald px-6 py-2 text-xs"
              >
                {language === 'ar' ? 'إغلاق' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
