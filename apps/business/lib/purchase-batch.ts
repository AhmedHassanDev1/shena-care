/** Purchase batches of the internal Buy List: shared types, labels and the plain-text / printable forms taken outside the system. */

export type BatchStatus = 'ready' | 'sent' | 'closed'
export type BatchAction = 'send' | 'receive' | 'close' | null
export type OrderState = 'received' | 'pending' | 'unavailable' | 'cancelled'

export interface BatchSummary {
  id: string; number: number; kind: 'scheduled' | 'manual'; status: BatchStatus
  cutoffAt: string; createdAt: string; sentAt: string | null; sentBy: string | null; expectedAt: string | null; note: string | null
  closedAt: string | null; closeReason: 'completed' | 'cancelled' | null
  skus: number; orders: number; units: number; received: number; remaining: number; nextAction: BatchAction
}

export interface BatchLine {
  id: string; skuId: string; productName: string | null; skuCode: string | null; variantName: string | null
  /** Catalog brand of the SKU (the order snapshot's product name has none). Absent from older API responses. */
  brandName?: string | null
  size: number | null; sizeUnit: string | null; packCount: number | null; barcode: string | null
  required: number; received: number; remaining: number; closedOut: number
  orders: Array<{ orderId: string; orderNumber: string; orderItemId: string; quantity: number; received: number; remaining: number; state: OrderState }>
  receipts: Array<{ quantity: number; receivedAt: string; receivedBy: string }>
}

export interface BatchDetail extends BatchSummary {
  lines: BatchLine[]
  events: Array<{ type: string; actorId: string | null; createdAt: string; data: Record<string, unknown> }>
}

export interface Schedule {
  settings: { intervalMinutes: number; startTime: string; timeZone: string; version: number; updatedBy: string | null; updatedAt: string | null; isDefault: boolean }
  nextCutoffAt: string
  lastCutoffAt: string
}

export interface BatchOverview {
  mode: string
  items: BatchSummary[]
  pending: { skus: number; units: number; orders: number }
  schedule: Schedule
}

export const ACTION_LABEL: Record<Exclude<BatchAction, null>, string> = {
  send: 'تأكيد الطلب',
  receive: 'تسجيل الاستلام',
  close: 'إقفال',
}

export const STATUS_LABEL: Record<BatchStatus, string> = { ready: 'جاهزة للطلب', sent: 'اتطلبت', closed: 'مقفولة' }

/** Capitalises a brand the catalog stored in all lowercase ("shaan" → "Shaan"); a brand with its own casing ("L'Oréal Paris") is left alone. */
function brandLabel(brand: string | null | undefined): string {
  const value = (brand ?? '').trim()
  if (!value || !/[a-z]/.test(value) || value !== value.toLowerCase()) return value
  return value.replace(/(^|[\s-])([a-z])/g, (_, lead: string, ch: string) => lead + ch.toUpperCase())
}

const squash = (value: string) => value.toLowerCase().replace(/\s+/g, '')

export interface PurchaseLineName {
  /** Shown small above the name; empty when the brand is already the first word of the product name. */
  brand: string
  /** Product, variant and size: what a person reads to recognise the item. */
  title: string
  /** Everything together: exactly what goes into the copied / shared text. */
  full: string
}

/**
 * The one way a batch line is named for people: brand + product + variant + size. Each piece is added only when the pieces before it
 * do not already say it, so "Soothing Gel" with variant "120 g" and size 120 g reads "Shaan Soothing Gel 120 g", never "… 120 g 120 g".
 */
export function purchaseLineName(line: Pick<BatchLine, 'productName' | 'brandName' | 'variantName' | 'size' | 'sizeUnit' | 'packCount'>): PurchaseLineName {
  const product = (line.productName ?? '').trim()
  const brandText = brandLabel(line.brandName)
  const brand = brandText && !squash(product).startsWith(squash(brandText)) ? brandText : ''
  const sizeText = line.size != null ? `${Number(line.size)}${line.sizeUnit ? ` ${line.sizeUnit}` : ''}` : ''
  let variant = (line.variantName ?? '').trim()
  if (variant && sizeText && squash(variant) === squash(sizeText)) variant = ''
  const size = sizeText && !squash(product + variant).includes(squash(sizeText)) ? sizeText : ''
  const pack = line.packCount && line.packCount > 1 ? `${line.packCount}-pack` : ''
  const title = [product, variant, size, pack].filter(Boolean).join(' ')
  return { brand, title, full: [brand, title].filter(Boolean).join(' ') }
}

/** Every line of the batch, ordered by brand and name so every list built from it scans the same way. */
export function orderedLines(batch: BatchDetail): BatchLine[] {
  const key = (line: BatchLine) => purchaseLineName(line).full.toLowerCase()
  return [...batch.lines].sort((a, b) => key(a).localeCompare(key(b)))
}

/** What is still to be ordered or collected: only lines with units left. */
export function openLines(batch: BatchDetail): BatchLine[] {
  return orderedLines(batch).filter((line) => line.remaining > 0)
}

/** The numbers that head the purchase list: what is still to buy, or the whole batch once nothing is left to buy. */
export function purchaseTotals(batch: BatchDetail): { products: number; units: number } {
  const open = openLines(batch)
  return open.length ? { products: open.length, units: open.reduce((sum, line) => sum + line.remaining, 0) } : { products: batch.skus, units: batch.units }
}

const WHEN = (value: Date) => value.toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' })

/**
 * The text staff copy or share with a supplier by hand (the system sends nothing): one line per product, `name × quantity`, and
 * nothing else. No codes, barcodes, ids, status, dates or notes, so it can be sent exactly as copied.
 */
export function purchaseListText(batch: BatchDetail): string {
  return openLines(batch).map((line) => `${purchaseLineName(line).full} × ${line.remaining}`).join('\n')
}

export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string)

/** Self-contained printable checklist (no app chrome, no controls): the same names and quantities as the copied text, plus a tick box. */
export function batchPrintHtml(batch: BatchDetail): string {
  const rows = openLines(batch)
  const body = rows.map((line) => `<tr><td dir="auto">${escapeHtml(purchaseLineName(line).full)}</td><td class="n">${line.remaining}</td><td class="box"></td></tr>`).join('')
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>قائمة المشتريات — دفعة #${batch.number}</title><style>
body{font:15px system-ui,sans-serif;margin:24px;color:#111}h1{font-size:18px;margin:0 0 4px}p{margin:0 0 12px;color:#444}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #888;padding:7px 10px;text-align:right;vertical-align:middle}
th{background:#eee}.n{width:64px;text-align:center;font-weight:700;font-size:17px}.box{width:48px}</style></head><body>
<h1>قائمة المشتريات — دفعة #${batch.number}</h1><p>${escapeHtml(WHEN(new Date(batch.cutoffAt)))} — ${rows.length} منتج</p>
${rows.length ? `<table><thead><tr><th>المنتج</th><th>الكمية</th><th>تم</th></tr></thead><tbody>${body}</tbody></table>` : '<p>مفيش حاجة مطلوبة في الدفعة دي.</p>'}
</body></html>`
}

/** `datetime-local` value (local wall clock, minute precision) for a Date. */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Tomorrow at midday: the default expected arrival offered when a batch is confirmed. */
export function tomorrowMidday(now = new Date()): Date {
  const date = new Date(now)
  date.setDate(date.getDate() + 1)
  date.setHours(12, 0, 0, 0)
  return date
}

/** ISO string for a `datetime-local` value, or null when blank/invalid. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
