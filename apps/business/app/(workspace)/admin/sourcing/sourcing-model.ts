/*
 * Suppliers & Sourcing: shapes read from the API and the small pure rules the screen needs (status wording,
 * coverage arithmetic). No business rule lives here: the API decides readiness, awards and allocations.
 */

export interface SupplierRow {
  id: string
  name: string
  slug: string
  isActive: boolean
  rfqEnrolledAt: string | null
  closedWeekdays: number[]
  closedDates: string[]
  opensAt: string | null
  closesAt: string | null
  pickupLeadMinutes: number | null
  scope: Array<{ skuId: string; label: { productName: string; variantName: string; skuCode: string } | null }>
  accountCount: number
  openRequestCount: number
  openCommitmentCount: number
  readiness: { ready: boolean; blockers: string[] }
}

export interface AuditEvent {
  id: string
  action: string
  actorId: string
  reason: string | null
  createdAt: string
}

export type SupplierState = 'receiving' | 'not_ready' | 'inactive'

export const BLOCKER_TEXT: Record<string, string> = {
  INACTIVE: 'المورد متوقف',
  NOT_ENROLLED: 'غير مشترك في طلبات التوريد',
  NO_SUPPLIER_ACCOUNT: 'لا يوجد حساب دخول مربوط به',
  NO_WORKING_DAYS: 'كل أيام الأسبوع إجازة',
}

export const AUDIT_ACTION_TEXT: Record<string, string> = {
  REGISTERED: 'تسجيل المورد',
  ENROLLED: 'الاشتراك في الطلبات',
  WITHDRAWN: 'إيقاف الاشتراك',
  ACTIVATED: 'تفعيل',
  DEACTIVATED: 'إيقاف',
  SCOPE_CHANGED: 'تغيير نطاق المنتجات',
  CALENDAR_CHANGED: 'تغيير المواعيد',
  DETAILS_CHANGED: 'تغيير البيانات',
}

/** Saturday-first week, the order people read it in. Values follow the API: 0 = Sunday … 6 = Saturday. */
export const WEEKDAYS: Array<[number, string]> = [
  [6, 'السبت'], [0, 'الأحد'], [1, 'الإثنين'], [2, 'الثلاثاء'], [3, 'الأربعاء'], [4, 'الخميس'], [5, 'الجمعة'],
]

export function supplierState(supplier: Pick<SupplierRow, 'isActive' | 'readiness'>): SupplierState {
  if (!supplier.isActive) return 'inactive'
  return supplier.readiness.ready ? 'receiving' : 'not_ready'
}

/** The one thing most worth telling about a supplier in a list row. */
export function supplierHeadline(supplier: SupplierRow): { text: string; tone: 'ok' | 'warn' | 'muted' } {
  const blockers = supplier.readiness.blockers.filter((code) => code !== 'INACTIVE')
  if (blockers.length) {
    const extra = blockers.length > 1 ? ` (+${blockers.length - 1})` : ''
    return { text: `${BLOCKER_TEXT[blockers[0]] ?? blockers[0]}${extra}`, tone: 'warn' }
  }
  if (!supplier.isActive) return { text: 'موقوف', tone: 'muted' }
  return { text: 'لا توجد ملاحظات', tone: 'ok' }
}

export function workingDaysText(closedWeekdays: number[]): string {
  const open = WEEKDAYS.filter(([day]) => !closedWeekdays.includes(day))
  if (open.length === 7) return 'كل أيام الأسبوع'
  if (open.length === 0) return 'لا توجد أيام عمل'
  const closed = WEEKDAYS.filter(([day]) => closedWeekdays.includes(day)).map(([, name]) => name)
  return `إجازة: ${closed.join('، ')}`
}

export function slugFromName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) ? slug : ''
}

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

/* ── Broadcast requests (RFQ) and Final POs ───────────────────────────────────────────────── */

export interface RfqListItem {
  id: string
  batchRef: string
  status: 'open' | 'fulfilled' | 'exhausted' | 'closed'
  expedited: boolean
  createdAt: string
  closedAt: string | null
  closeReason: string | null
  lineCount: number
  requiredQuantity: number
  awardedQuantity: number
  recipients: { total: number; pending: number; responded: number; timedOut: number }
}

export interface RfqDetailLine {
  id: string
  skuId: string
  requiredQuantity: number
  awardedQuantity: number
  remainingQuantity: number
  sku: { productName: string; variantName: string; skuCode: string } | null
  sources: Array<{ id: string; orderId: string; quantity: number }>
}

export interface RfqDetail {
  id: string
  lines: RfqDetailLine[]
  recipients: Array<{ supplierId: string; status: string; addedReason: string; deadlineAt: string }>
}

export interface PoLine {
  id: string
  skuId: string
  requestedQuantity: number
  confirmedQuantity: number | null
  status: string
  unitCost: string | null
  exceptionCode: string | null
  exceptionNote: string | null
  proposedQuantity: number | null
  proposedUnitCost: string | null
  distributionRequired: boolean
  sku: { productName: string; variantName: string; skuCode: string } | null
  allocations: Array<{ sourceAllocationId: string; orderId: string; quantity: number; confirmedQuantity: number | null; receivedQuantity: number }>
}

export interface StaffPo {
  id: string
  supplierId: string
  status: string
  batchRef: string | null
  createdAt: string
  readyAt: string | null
  receivedAt: string | null
  lines: PoLine[]
}

export interface Payable {
  id: string
  supplierName: string
  purchaseOrderId: string
  amount: number
  grossAmount?: number
  creditApplied?: number
  netAmount?: number
  status: string
  paidAt: string | null
  paymentRef: string | null
}

export const RFQ_STATUS_TEXT: Record<RfqListItem['status'], [string, 'ok' | 'warn' | 'danger' | 'info' | 'neutral' | 'pending']> = {
  open: ['بانتظار الموردين', 'info'],
  fulfilled: ['مغطى بالكامل', 'ok'],
  exhausted: ['انتهى الموردون ولم يُغطَّ', 'danger'],
  closed: ['مغلق', 'pending'],
}

export const CLOSE_REASON_TEXT: Record<string, string> = {
  FULFILLED: 'تمت التغطية',
  DEMAND_WITHDRAWN: 'سُحب الطلب قبل الترسية',
  NO_ELIGIBLE_SUPPLIER_LEFT: 'لا يوجد مورد مؤهل متبقٍ',
}

export type CoverageTotals = { covered: number; waiting: number; uncovered: number; required: number }

/**
 * Overall coverage of broadcast demand. `covered` = awarded to suppliers, `waiting` = still open and suppliers can
 * answer, `uncovered` = every supplier answered or timed out and demand remained (needs a person).
 * Closed requests count only what they awarded.
 */
export function coverageTotals(items: Array<Pick<RfqListItem, 'status' | 'requiredQuantity' | 'awardedQuantity'>>): CoverageTotals {
  const totals: CoverageTotals = { covered: 0, waiting: 0, uncovered: 0, required: 0 }
  for (const item of items) {
    const remaining = Math.max(0, item.requiredQuantity - item.awardedQuantity)
    totals.covered += item.awardedQuantity
    if (item.status === 'open') totals.waiting += remaining
    else if (item.status === 'exhausted') totals.uncovered += remaining
    if (item.status === 'open' || item.status === 'exhausted' || item.status === 'fulfilled') totals.required += item.requiredQuantity
    else totals.required += item.awardedQuantity
  }
  return totals
}

export function percent(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)))
}

export type Attention = { key: string; text: string; target: 'rfq' | 'po'; id?: string }

/** What needs a person right now, derived only from what the API already reports. */
export function attentionItems(rfqs: RfqListItem[], pos: StaffPo[], payables: Payable[]): Attention[] {
  const items: Attention[] = []
  for (const rfq of rfqs.filter((r) => r.status === 'exhausted')) {
    const missing = Math.max(0, rfq.requiredQuantity - rfq.awardedQuantity)
    items.push({ key: `rfq-${rfq.id}`, text: `طلب ${rfq.batchRef} لم يُغطَّ: ${missing} وحدة بلا مورد`, target: 'rfq', id: rfq.id })
  }
  for (const po of pos) {
    const lines = po.lines.filter((line) => line.distributionRequired)
    if (lines.length) items.push({ key: `dist-${po.id}`, text: `أمر شراء يحتاج قرار توزيع (${lines.length} بند)`, target: 'po', id: po.id })
    else if (po.status === 'expired') items.push({ key: `exp-${po.id}`, text: 'أمر شراء انتهت مهلة الرد عليه', target: 'po', id: po.id })
  }
  const unpaidByPo = new Set(payables.filter((p) => p.status !== 'paid').map((p) => p.purchaseOrderId))
  const owed = pos.filter((po) => unpaidByPo.has(po.id)).length
  if (owed) items.push({ key: 'payables', text: `${owed} أمر شراء عليه مستحق غير مسدد`, target: 'po' })
  return items
}

export function shortRef(id: string): string {
  return id.slice(0, 8)
}
