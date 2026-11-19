import type { Tone } from '@/components/bw/primitives'

/*
 * Status vocabulary shown to staff. Each label pairs words with a tone so status is never colour alone.
 * Values are the API's own enums; unknown values fall back to the raw value rather than a guess.
 */

type Labelled = Record<string, [string, Tone]>

export const ORDER_STATUS: Labelled = {
  placed: ['اتسجّل — مستني التوفير', 'pending'],
  confirmed: ['اتأكد التوفر', 'neutral'],
  packing: ['في المخزن', 'neutral'],
  shipped: ['مع المندوب', 'neutral'],
  delivered: ['اتسلّم', 'ok'],
  cancelled: ['اتلغى', 'danger'],
  returned: ['رجع للمخزن', 'danger'],
}

export const SHIPMENT_STATUS: Labelled = {
  pending: ['مستني البضاعة', 'pending'],
  ready_to_prepare: ['جاهز للتجهيز', 'warn'],
  preparing: ['بيتجهّز', 'neutral'],
  prepared: ['اتجهّز — محتاج طباعة وتغليف', 'warn'],
  ready_to_pack: ['جاهز للتغليف', 'warn'],
  packing: ['بيتغلّف', 'neutral'],
  packed: ['متغلّف — جاهز للتسليم', 'ok'],
  dispatched: ['خرج مع المندوب', 'neutral'],
  out_for_delivery: ['في الطريق', 'neutral'],
  delivered: ['اتسلّم', 'ok'],
  failed: ['محاولة فاشلة', 'danger'],
  returned: ['رجع للمورد/المخزن', 'danger'],
  cancelled: ['اتلغى', 'danger'],
}

export const PO_STATUS: Labelled = {
  created: ['جديد — محتاج رد', 'warn'],
  sent: ['اتبعت — محتاج رد', 'warn'],
  reviewed: ['اتراجع — محتاج رد', 'warn'],
  expired: ['انتهت مهلة الرد — لا تجهّز أو تسلّم', 'warn'],
  confirmed: ['اتأكد', 'ok'],
  partial: ['اتأكد جزئي', 'warn'],
  ready: ['المورد جهّزه — لسه ماوصلش المخزن', 'neutral'],
  received_at_hub: ['اتستلم في المخزن', 'ok'],
}

export const PO_LINE_STATUS: Labelled = {
  pending: ['مستني رد', 'pending'],
  confirmed_full: ['متوفر بالكامل', 'ok'],
  confirmed_partial: ['متوفر جزئي', 'warn'],
  unavailable: ['مش متوفر', 'danger'],
  price_changed: ['السعر اتغيّر', 'warn'],
}

export const COLLECTION_STATUS: Labelled = {
  expected: ['متوقع تحصيله', 'pending'],
  collected: ['المندوب أعلن التحصيل — مستني العدّ', 'warn'],
  settled: ['اتعدّ واتسوّى', 'ok'],
  short: ['عجز في العدّ', 'danger'],
  over: ['زيادة في العدّ', 'danger'],
  disputed: ['متنازع عليه', 'danger'],
  voided: ['مافيش تحصيل مستحق', 'neutral'],
}

export const RUN_STATUS: Labelled = {
  planning: ['بانتظار الاستلام', 'pending'],
  dispatched: ['جاري التوصيل', 'ok'],
  completed: ['مكتمل', 'ok'],
}

/** The server's settlement state of a run (the same answer the Complete Trip gate uses). */
export const RUN_SETTLEMENT_STATE: Labelled = {
  pending: ['بانتظار التسوية', 'pending'],
  reconciliation_required: ['يتطلب مطابقة', 'warn'],
  settled: ['تمت التسوية', 'ok'],
  completed: ['مغلق', 'ok'],
}

/** What still stands between a run and its closure; `n` is the count the server reports. */
export const RUN_BLOCKER: Record<string, (n: number) => string> = {
  NO_STOPS: () => 'المشوار بدون طرود — لا يمكن تسويته أو إغلاقه',
  NO_OUTCOMES: () => 'لا توجد نتيجة تسليم أو إرجاع مسجّلة بعد',
  STOPS_IN_TRANSIT: (n) => `${n} طرد لسه في الطريق`,
  PENDING_RETURNS: (n) => `${n} طرد مرتجع لسه مع المندوب — امسح باركوده`,
  CASH_UNDECLARED: (n) => `${n} طلب اتسلّم من غير ما المندوب يعلن النقدية`,
  CASH_AWAITING_COUNT: (n) => `نقدية ${n} طلب مستنية العدّ`,
  CASH_DISPUTED: (n) => `${n} تحصيل متنازع عليه — محتاج مراجعة إدارية`,
}

export const PAYABLE_STATUS: Labelled = {
  open: ['مفتوح', 'warn'],
  ready_to_pay: ['جاهز للدفع', 'warn'],
  paid: ['اتدفع', 'ok'],
  disputed: ['متنازع عليه', 'danger'],
  adjusted: ['اتعدّل', 'neutral'],
}

export const FAILURE_REASONS: Record<string, string> = {
  CUSTOMER_UNREACHABLE: 'العميل لا يرد',
  CUSTOMER_REFUSED: 'العميل رفض الاستلام',
  RESCHEDULE_REQUESTED: 'العميل طلب التأجيل',
  ADDRESS_NOT_FOUND: 'العنوان غير صحيح أو غير واضح',
  PIN_MISMATCH: 'تعذر الوصول إلى الموقع',
  NOT_SERVICEABLE: 'المكان خارج نطاق التوصيل',
  PACKAGE_DAMAGED: 'الطرد تالف',
  OTHER: 'مشكلة أخرى',
}

export const SHORTFALL_REASONS: Record<string, string> = {
  NOT_HANDED_OVER: 'المورد ماسلّمش الكمية',
  LOST_IN_TRANSIT: 'ضاعت في الطريق',
  SHORT_SHIPPED: 'وصلت ناقصة',
  DAMAGED_IN_TRANSIT: 'اتلفت في الطريق',
}

export const SUPPLIER_EXCEPTIONS: Record<string, string> = {
  MIN_ORDER_QUANTITY: 'أقل كمية للطلب أكبر من المطلوب',
  PACK_SIZE: 'بيتباع بالكرتونة/العبوة بس',
  PRICE_CHANGED: 'سعر الشراء اتغيّر',
  OUT_OF_STOCK: 'مش متوفر حالياً',
  DISCONTINUED: 'المنتج وقف',
}

export const CANCEL_REASONS: Record<string, string> = {
  CUSTOMER_REQUEST: 'طلب العميل',
  DUPLICATE_ORDER: 'طلب مكرر',
  FRAUD_SUSPECTED: 'اشتباه احتيال',
  UNSERVICEABLE_LOCATION: 'الموقع خارج نطاق التوصيل',
  SUPPLY_UNAVAILABLE: 'المنتج مش متوفر عند الموردين',
  OTHER: 'سبب تاني',
}

export const INSTRUCTION_REASONS: Record<string, string> = {
  ADDRESS_CLARIFICATION: 'توضيح العنوان',
  PIN_CORRECTION: 'تصحيح نقطة اللقاء',
  CUSTOMER_REQUEST: 'طلب العميل',
  ACCESS_INSTRUCTIONS: 'تعليمات الوصول',
}

export function label(map: Labelled, value: string | null | undefined): [string, Tone] {
  if (!value) return ['—', 'neutral']
  return map[value] ?? [value, 'neutral']
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' })
}

export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8).toUpperCase() : '—'
}
