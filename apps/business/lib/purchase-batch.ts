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

/** The exact size/pack label that keeps two variants of one product visibly apart on paper. */
export function lineVariant(line: Pick<BatchLine, 'variantName' | 'size' | 'sizeUnit' | 'packCount'>): string {
  const parts = [line.variantName, line.size != null ? `${line.size}${line.sizeUnit ? ` ${line.sizeUnit}` : ''}` : null,
    line.packCount && line.packCount > 1 ? `×${line.packCount}` : null].filter(Boolean) as string[]
  return [...new Set(parts)].join(' · ')
}

/** What is still to be ordered or collected: only lines with units left. */
export function openLines(batch: BatchDetail): BatchLine[] {
  return batch.lines.filter((line) => line.remaining > 0)
}

const WHEN = (value: Date) => value.toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' })

/** Plain text for copying or WhatsApp. It is a message a person sends by hand; the system sends nothing. */
export function batchText(batch: BatchDetail): string {
  const rows = openLines(batch)
  const header = `طلب شراء ShinaCare — دفعة #${batch.number}`
  if (!rows.length) return `${header}\nمفيش حاجة مطلوبة في الدفعة دي.`
  const lines = rows.map((line, index) => {
    const label = [line.productName, lineVariant(line)].filter(Boolean).join(' — ')
    const code = [line.skuCode, line.barcode].filter(Boolean).join(' / ')
    return `${index + 1}. ${label}${code ? ` [${code}]` : ''} × ${line.remaining}`
  })
  const units = rows.reduce((sum, line) => sum + line.remaining, 0)
  return [header, batch.expectedAt ? `الاستلام المتوقع: ${WHEN(new Date(batch.expectedAt))}` : null, ...lines, `الإجمالي: ${rows.length} صنف · ${units} قطعة`,
    batch.note ? `ملاحظة: ${batch.note}` : null].filter(Boolean).join('\n')
}

export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string)

/** Self-contained printable checklist (no app chrome, no controls). */
export function batchPrintHtml(batch: BatchDetail): string {
  const rows = openLines(batch)
  const body = rows.map((line) => `<tr><td>${escapeHtml(line.productName ?? '—')}</td><td>${escapeHtml(lineVariant(line) || '—')}</td>`
    + `<td dir="ltr">${escapeHtml([line.skuCode, line.barcode].filter(Boolean).join(' / '))}</td><td class="n">${line.remaining}</td><td class="box"></td></tr>`).join('')
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>دفعة شراء #${batch.number}</title><style>
body{font:14px system-ui,sans-serif;margin:24px;color:#111}h1{font-size:18px;margin:0 0 4px}p{margin:0 0 12px;color:#444}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #888;padding:6px 8px;text-align:right;vertical-align:top}
th{background:#eee}.n{text-align:center;font-weight:700}.box{width:48px}</style></head><body>
<h1>دفعة شراء #${batch.number} — ShinaCare</h1><p>${escapeHtml(WHEN(new Date(batch.cutoffAt)))} — ${rows.length} صنف${batch.expectedAt ? ` — الاستلام المتوقع ${escapeHtml(WHEN(new Date(batch.expectedAt)))}` : ''}</p>
${rows.length ? `<table><thead><tr><th>المنتج</th><th>النوع / الحجم</th><th>الكود</th><th>الكمية</th><th>تم</th></tr></thead><tbody>${body}</tbody></table>` : '<p>مفيش حاجة مطلوبة في الدفعة دي.</p>'}
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
