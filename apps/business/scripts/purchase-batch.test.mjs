import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/purchase-batch.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const m = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)

const line = (over = {}) => ({
  id: 'l1', skuId: 's1', productName: 'كريم', skuCode: 'A-50', variantName: '50 مل', size: 50, sizeUnit: 'ml', packCount: null, barcode: '6221',
  required: 5, received: 1, remaining: 4, closedOut: 0, orders: [], receipts: [], ...over,
})
const batch = (lines, over = {}) => ({
  id: 'b1', number: 12, kind: 'scheduled', status: 'sent', cutoffAt: '2026-11-14T10:00:00Z', createdAt: '2026-11-14T10:00:01Z', sentAt: null, sentBy: null,
  expectedAt: null, note: null, closedAt: null, closeReason: null, skus: lines.length, orders: 1, units: 5, received: 1, remaining: 4, nextAction: 'receive', lines, events: [], ...over,
})

test('the message only lists what is still to be ordered, with the exact size and the remaining quantity', () => {
  const text = m.batchText(batch([line(), line({ id: 'l2', skuCode: 'B-100', productName: 'سيروم', remaining: 0, received: 2, required: 2 })]))
  assert.match(text, /دفعة #12/)
  assert.match(text, /1\. كريم — 50 مل · 50 ml \[A-50 \/ 6221\] × 4/)
  assert.doesNotMatch(text, /سيروم/)
  assert.match(text, /الإجمالي: 1 صنف · 4 قطعة/)
})

test('a batch with nothing left says so instead of listing zero-quantity rows', () => {
  assert.match(m.batchText(batch([line({ remaining: 0 })])), /مفيش حاجة مطلوبة/)
})

test('the WhatsApp link only carries the typed message (no recipient, no automatic sending)', () => {
  const url = m.whatsappUrl('دفعة #12\n1. كريم × 4')
  assert.ok(url.startsWith('https://wa.me/?text='))
  assert.equal(decodeURIComponent(url.slice('https://wa.me/?text='.length)), 'دفعة #12\n1. كريم × 4')
})

test('the printable checklist escapes product names and keeps a tick box per line', () => {
  const html = m.batchPrintHtml(batch([line({ productName: '<b>x</b> & "y"' })]))
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt; &amp; &quot;y&quot;/)
  assert.match(html, /class="box"/)
})

test('the default expected arrival is tomorrow at midday and round-trips through the datetime-local control', () => {
  const tomorrow = m.tomorrowMidday(new Date(2026, 10, 14, 22, 30))
  assert.equal(tomorrow.getDate(), 15)
  assert.equal(tomorrow.getHours(), 12)
  assert.equal(m.toLocalInput(tomorrow), '2026-11-15T12:00')
  assert.equal(new Date(m.fromLocalInput('2026-11-15T12:00')).getTime(), tomorrow.getTime())
  assert.equal(m.fromLocalInput(''), null)
  assert.equal(m.fromLocalInput('nonsense'), null)
})
