import type { Tone } from '@/components/bw/primitives'

/* Catalog Intake contracts as the API returns them. Every decision is made by the API; this only names it. */

export type IntakeOutcome = 'PENDING' | 'SKIPPED' | 'MATCHED' | 'UPDATED' | 'UNMATCHED' | 'INVALID' | 'CRITICAL' | 'DRAFT_CREATED' | 'LINKED_EXISTING' | 'UNRESOLVED'
export type IntakeTotals = Partial<Record<IntakeOutcome, number>> & { total: number }

export type IntakeJob = {
  id: string
  source: 'ADMIN' | 'SUPPLIER'
  supplierId: string | null
  inputKind: 'SINGLE' | 'BULK' | 'FILE'
  sourceFileName: string | null
  status: 'RECEIVED' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
  totals: IntakeTotals | null
  metrics: Record<string, number> | null
  lastError: string | null
  createdAt: string
  completedAt: string | null
}

export type Flag = { ready: boolean; missing: string[] }
export type Readiness = { pdp: Flag; chatbot: Flag; routine: Flag; selling: Flag & { purchaseCost: number | null }; criticalOpen: Array<{ reasonCode: string; summary: string }> }

export type Candidate = { skuId: string; label: string; score: number; measure: string; vetoes: string[] }

export type IntakeRow = {
  id: string
  jobId: string
  rowNumber: number
  rawName: string
  outcome: IntakeOutcome
  reasonCode: string | null
  reason: string | null
  matchedSkuId: string | null
  purchasePrice: string | number | null
  consumerPrice: string | number | null
  quantity: number | null
  candidates: Candidate[] | null
  readiness: Readiness | null
  processingMs: number | null
  cost: { searches?: number; pageFetches?: number } | null
  job?: { id: string; source: 'ADMIN' | 'SUPPLIER'; sourceFileName: string | null; createdAt: string }
}

export const outcomeLabel: Record<IntakeOutcome, { tone: Tone; text: string }> = {
  PENDING: { tone: 'pending', text: 'جاري العمل' },
  SKIPPED: { tone: 'neutral', text: 'خارج النطاق' },
  MATCHED: { tone: 'ok', text: 'مطابق — بدون تغيير' },
  UPDATED: { tone: 'ok', text: 'مطابق — اتحدّث العرض' },
  UNMATCHED: { tone: 'neutral', text: 'مش في الكتالوج' },
  INVALID: { tone: 'danger', text: 'سطر غير صالح' },
  CRITICAL: { tone: 'warn', text: 'محتاج مراجعة' },
  DRAFT_CREATED: { tone: 'ok', text: 'مسودة جديدة موثّقة' },
  LINKED_EXISTING: { tone: 'info', text: 'موجود بالفعل' },
  UNRESOLVED: { tone: 'warn', text: 'الهوية غير مؤكدة' },
}

/** The reasons people meet most, in words; anything else falls back to the API's own sentence. */
const reasonText: Record<string, string> = {
  DUPLICATE_ROW: 'نفس السطر متكرر في الملف',
  CONFLICTING_DUPLICATE: 'نفس المنتج متكرر بأسعار مختلفة',
  NAME_MISSING: 'اسم المنتج فاضي',
  PURCHASE_PRICE_MISSING: 'سعر الشراء مش مقروء',
  PURCHASE_PRICE_NOT_POSITIVE: 'سعر الشراء لازم يكون أكبر من صفر',
  CONSUMER_BELOW_PURCHASE: 'سعر المستهلك أقل من سعر الشراء',
  NO_KNOWN_BRAND: 'البراند مش ضمن الكتالوج',
  BRAND_HAS_NO_SKUS: 'البراند مالوش منتجات في الكتالوج',
  NO_CANDIDATE: 'مفيش منتج في الكتالوج بنفس المواصفات',
  SIZE_NOT_IN_CATALOG: 'المنتج موجود بحجم تاني بس',
  SIZE_NOT_STATED: 'الحجم مش مكتوب في الاسم',
  COMPETING_CANDIDATES: 'أكتر من منتج مناسب بنفس الدرجة',
  WEAK_WORDING: 'الاسم مش كفاية لتأكيد المنتج',
  SEVERAL_SIZES_STATED: 'الاسم فيه أكتر من حجم',
  IDENTIFIERS_DISAGREE: 'الباركود والكود بيشاوروا على منتجات مختلفة',
  BARCODE_CONTRADICTED: 'الباركود بيخالف الاسم أو الحجم',
  POLICY_BRAND_DENIED: 'البراند مستبعد من سياسة الكتالوج',
  OUT_OF_SCOPE_MEDICINE: 'دواء — خارج نطاق الكتالوج',
  OUT_OF_SCOPE_BABY_FEEDING_DIAPERS: 'حفاضات أو ألبان أطفال — خارج النطاق',
  OUT_OF_SCOPE_MAKEUP: 'مكياج — خارج النطاق',
  OUT_OF_SCOPE_FRAGRANCE: 'عطور — خارج النطاق',
  OUT_OF_SCOPE_ORAL_CARE: 'عناية بالفم — خارج النطاق',
  OUT_OF_SCOPE_MEDICAL_DEVICE: 'مستلزمات طبية — خارج النطاق',
  OUT_OF_SCOPE_SHAVING: 'حلاقة — خارج النطاق',
  OUT_OF_SCOPE_HAIR_COLOR: 'صبغات شعر — خارج النطاق',
  BRAND_NOT_VERIFIED: 'البراند جديد وموقعه الرسمي ما اتأكدش',
  NO_IDENTITY_SOURCE: 'مفيش صفحة رسمية بتأكد المنتج والحجم',
  SOURCE_CONTRADICTS_IDENTITY: 'الصفحة الرسمية بتوصف منتج أو حجم مختلف',
  SIZE_NOT_CONFIRMED: 'الصفحات الرسمية مش بتحدد حجم واحد',
  RETRY_EXHAUSTED: 'المصدر فضل يفشل بعد محاولات تلقائية',
  IDENTITY_CONFLICT: 'متعارض مع منتج موجود',
  PAGE_NAMES_ANOTHER_VARIANT: 'الصفحة الرسمية لنوع تاني من المنتج — حدّد الاسم بالظبط',
  BRAND_MATCHES_EXISTING: 'البراند موجود باسم تاني',
  NOT_THIS_PRODUCT_IMAGE: 'الصورة مش للمنتج ده',
  ADMIN_DISMISSED: 'اتقفل بقرار الإدارة',
}

export function reasonOf(row: Pick<IntakeRow, 'reasonCode' | 'reason'>): string {
  const code = row.reasonCode ?? ''
  const base = code.includes(':') ? code.split(':')[0] : code
  if (base === 'CREATED') return 'عرض جديد اتسجل'
  if (base === 'CHANGED') return 'السعر أو الرصيد اتحدّث'
  if (base === 'UNCHANGED' || base === 'ALREADY_APPLIED') return 'نفس السعر والرصيد'
  if (base === 'IDENTITY_VERIFIED_DRAFT_CREATED') return 'اتأكدت الهوية من صفحة رسمية واتعملت مسودة'
  if (base === 'EXISTING_SKU') return 'المنتج موجود — اتكملت البيانات الناقصة بس'
  return reasonText[base] ?? row.reason ?? code ?? '—'
}

const vetoText: Record<string, string> = {
  SIZE_DIFFERS: 'حجم مختلف', SIZE_NOT_COMPARABLE: 'وحدة حجم مختلفة', PACK_DIFFERS: 'عبوة مختلفة', STRENGTH_DIFFERS: 'تركيز مختلف', SPF_DIFFERS: 'SPF مختلف',
  STATED_FACTS_CONTRADICT: 'مواصفات متعارضة', BRAND_DIFFERS: 'براند مختلف',
}
export const vetoLabel = (code: string) => vetoText[code] ?? code

export const flagLabel: Record<'pdp' | 'chatbot' | 'routine' | 'selling', string> = {
  pdp: 'صفحة المنتج', chatbot: 'المساعد', routine: 'الروتين', selling: 'البيع',
}

export const jobStatus: Record<IntakeJob['status'], { tone: Tone; text: string }> = {
  RECEIVED: { tone: 'pending', text: 'اتستلم' },
  PROCESSING: { tone: 'info', text: 'جاري المعالجة' },
  COMPLETED: { tone: 'ok', text: 'خلص' },
  FAILED: { tone: 'danger', text: 'فشل' },
}

export const SUPPLIER_OUTCOMES: IntakeOutcome[] = ['UPDATED', 'MATCHED', 'CRITICAL', 'UNMATCHED', 'SKIPPED', 'INVALID']
export const ADMIN_OUTCOMES: IntakeOutcome[] = ['DRAFT_CREATED', 'LINKED_EXISTING', 'UNRESOLVED', 'SKIPPED', 'INVALID', 'PENDING']
