import { ApiError } from '../api'
import { NotAuthorizedError } from './errors'

/*
 * Arabic copy for every sign-in outcome. Deliberately generic: wrong email and wrong password read the
 * same, and nothing says which roles exist or whether a number belongs to staff.
 */

const SERVER = 'تعذّر إتمام العملية الآن. حاول مرة أخرى بعد قليل.'
const NETWORK = 'تعذّر الاتصال بالخادم. تحقق من الإنترنت وحاول مرة أخرى.'
const RATE = 'محاولات كثيرة. انتظر بضع دقائق ثم حاول مجددًا.'

function minutes(seconds: unknown): string {
  const s = typeof seconds === 'number' && seconds > 0 ? seconds : 0
  if (!s) return 'بضع دقائق'
  return s < 90 ? `${s} ثانية` : `${Math.ceil(s / 60)} دقيقة`
}

export function emailLoginMessage(error: unknown): string {
  if (error instanceof NotAuthorizedError) return 'لا يمكن الدخول بهذا الحساب إلى مساحة الأعمال.'
  if (error instanceof ApiError) {
    if (error.status === 401) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.'
    if (error.status === 429) return RATE
    if (error.code === 'NETWORK') return NETWORK
  }
  return SERVER
}

export function phoneSendMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'INVALID_PHONE') return 'أدخل رقم هاتف مصريًا صحيحًا.'
    if (error.code === 'OTP_UNAVAILABLE') return 'الدخول برقم الهاتف غير متاح حاليًا. استخدم البريد الإلكتروني.'
    if (error.code === 'OTP_RATE_LIMITED') return `تم تجاوز عدد الطلبات المسموح به. حاول مجددًا بعد ${minutes(error.details?.retryAfterSeconds)}.`
    if (error.code === 'OTP_DELIVERY_FAILED') return 'تعذّر إرسال الرمز. حاول مرة أخرى بعد قليل.'
    if (error.status === 429) return RATE
    if (error.code === 'NETWORK') return NETWORK
  }
  return SERVER
}

export type OtpFailure = 'invalid' | 'expired' | 'locked' | 'other'

export function otpVerifyOutcome(error: unknown): { kind: OtpFailure; message: string; attemptsRemaining?: number } {
  if (error instanceof NotAuthorizedError) {
    return { kind: 'other', message: 'لا يمكن الدخول بهذا الحساب إلى مساحة الأعمال.' }
  }
  if (error instanceof ApiError) {
    if (error.code === 'OTP_EXPIRED') return { kind: 'expired', message: 'انتهت صلاحية الرمز. اطلب رمزًا جديدًا.' }
    if (error.code === 'OTP_LOCKED') return { kind: 'locked', message: 'تم إيقاف هذا الرمز بعد محاولات خاطئة. اطلب رمزًا جديدًا.' }
    if (error.code === 'OTP_INVALID') {
      const left = typeof error.details?.attemptsRemaining === 'number' ? error.details.attemptsRemaining : undefined
      return {
        kind: 'invalid',
        attemptsRemaining: left,
        message: left === undefined ? 'الرمز غير صحيح أو لم يعد صالحًا.' : `الرمز غير صحيح. المحاولات المتبقية: ${left}.`,
      }
    }
    if (error.status === 429) return { kind: 'other', message: RATE }
    if (error.code === 'NETWORK') return { kind: 'other', message: NETWORK }
  }
  return { kind: 'other', message: SERVER }
}

export function retryAfterOf(error: unknown): number | null {
  if (error instanceof ApiError && typeof error.details?.retryAfterSeconds === 'number') return error.details.retryAfterSeconds
  return null
}
