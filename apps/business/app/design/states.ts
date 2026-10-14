/* Design-lab state lists (GLO-230). Plain module so server pages and client screens can both import it. */

const label = {
  default: 'المسار الطبيعي',
  loading: 'تحميل',
  empty: 'فاضي',
  error: 'خطأ',
  forbidden: 'ممنوع',
  partial: 'كمية ناقصة / تكلفة اتغيرت',
  confirmed: 'إيصال التأكيد',
  mismatch: 'باركود غلط',
  complete: 'اكتمل + طباعة',
  failed: 'محاولة فشلت',
  delivered: 'اتسلم + تحصيل',
} as const

export type StateId = keyof typeof label

const list = <T extends StateId>(...ids: T[]) => ({ ids, options: ids.map((id) => ({ id, label: label[id] })) })

export const screens = {
  admin: list('default', 'loading', 'empty', 'error', 'forbidden'),
  supplier: list('default', 'partial', 'confirmed', 'empty', 'forbidden'),
  hub: list('default', 'mismatch', 'complete', 'error'),
  driver: list('default', 'delivered', 'failed', 'empty'),
}

export type ScreenState<K extends keyof typeof screens> = (typeof screens)[K]['ids'][number]

export function pickState<T extends string>(value: string | string[] | undefined, allowed: readonly T[]): T {
  const v = Array.isArray(value) ? value[0] : value
  return (allowed as readonly string[]).includes(v ?? '') ? (v as T) : allowed[0]
}
