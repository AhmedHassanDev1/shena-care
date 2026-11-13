/** Internal aggregated Buy List (GLO-296): shared types and the plain-text / printable forms taken outside the system. */

export interface BuyListOrder {
  orderId: string; orderNumber: string; orderItemId: string; required: number; acquired: number
  receivedAtHub: number; outstanding: number; state: 'to_buy' | 'unavailable' | 'covered'
  placedAt: string; promisedDate: string | null
}

export interface BuyListItem {
  skuId: string; productName: string | null; skuCode: string | null; variantName: string | null
  size: number | null; sizeUnit: string | null; packCount: number | null; barcode: string | null; skuActive: boolean
  toBuy: number; unavailable: number; acquired: number; awaitingHub: number; orderCount: number
  earliestPromisedDate: string | null; orders: BuyListOrder[]
}

export interface BuyListData {
  mode: string; generatedAt: string
  totals: { skus: number; toBuy: number; unavailable: number; awaitingHub: number; orders: number }
  items: BuyListItem[]
}

/** The exact size/pack label that keeps two variants of one product visibly apart on paper. */
export function variantLabel(item: Pick<BuyListItem, 'variantName' | 'size' | 'sizeUnit' | 'packCount'>): string {
  const parts = [item.variantName, item.size != null ? `${item.size}${item.sizeUnit ? ` ${item.sizeUnit}` : ''}` : null,
    item.packCount && item.packCount > 1 ? `×${item.packCount}` : null].filter(Boolean) as string[]
  return [...new Set(parts)].join(' · ')
}

/** Only what is still to be bought: unavailable and already-acquired units are not on the shopping list. */
export function shoppingRows(data: BuyListData): BuyListItem[] {
  return data.items.filter((item) => item.toBuy > 0)
}

export function buyListText(data: BuyListData, now = new Date()): string {
  const rows = shoppingRows(data)
  const header = `قائمة مشتريات ShinaCare — ${now.toISOString().slice(0, 16).replace('T', ' ')}`
  if (!rows.length) return `${header}\nمفيش حاجة مطلوب شراؤها دلوقتي.`
  const lines = rows.map((item, index) => {
    const label = [item.productName, variantLabel(item)].filter(Boolean).join(' — ')
    const code = [item.skuCode, item.barcode].filter(Boolean).join(' / ')
    return `${index + 1}. ${label}${code ? ` [${code}]` : ''} × ${item.toBuy}  (${item.orderCount} طلب)`
  })
  const units = rows.reduce((sum, item) => sum + item.toBuy, 0)
  return [header, ...lines, `الإجمالي: ${rows.length} صنف · ${units} قطعة`].join('\n')
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string)

/** Self-contained printable document (no app chrome, no controls). */
export function buyListPrintHtml(data: BuyListData, now = new Date()): string {
  const rows = shoppingRows(data)
  const body = rows.map((item) => `<tr><td>${escapeHtml(item.productName ?? '—')}</td><td>${escapeHtml(variantLabel(item) || '—')}</td>`
    + `<td dir="ltr">${escapeHtml([item.skuCode, item.barcode].filter(Boolean).join(' / '))}</td><td class="n">${item.toBuy}</td><td class="n">${item.orderCount}</td><td class="box"></td></tr>`).join('')
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>قائمة المشتريات</title><style>
body{font:14px system-ui,sans-serif;margin:24px;color:#111}h1{font-size:18px;margin:0 0 4px}p{margin:0 0 12px;color:#444}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #888;padding:6px 8px;text-align:right;vertical-align:top}
th{background:#eee}.n{text-align:center;font-weight:700}.box{width:48px}</style></head><body>
<h1>قائمة مشتريات ShinaCare</h1><p>${escapeHtml(now.toLocaleString('ar-EG'))} — ${rows.length} صنف</p>
${rows.length ? `<table><thead><tr><th>المنتج</th><th>النوع / الحجم</th><th>الكود</th><th>الكمية</th><th>طلبات</th><th>تم</th></tr></thead><tbody>${body}</tbody></table>` : '<p>مفيش حاجة مطلوب شراؤها دلوقتي.</p>'}
</body></html>`
}
