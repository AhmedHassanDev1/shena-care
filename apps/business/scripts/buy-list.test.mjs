import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/buy-list.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const m = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)

const item = (over = {}) => ({
  skuId: 'a', productName: 'كريم', skuCode: 'A-50', variantName: '50 مل', size: 50, sizeUnit: 'ml', packCount: null, barcode: '123',
  skuActive: true, toBuy: 5, unavailable: 0, acquired: 0, awaitingHub: 0, orderCount: 2, earliestPromisedDate: null, orders: [], ...over,
})
const data = (items) => ({ mode: 'INTERNAL_BUY_LIST', generatedAt: '2026-11-13T00:00:00Z', totals: { skus: items.length, toBuy: 0, unavailable: 0, awaitingHub: 0, orders: 0 }, items })

test('variant label keeps size/variant apart and never repeats a part', () => {
  assert.equal(m.variantLabel(item()), '50 مل · 50 ml')
  assert.equal(m.variantLabel(item({ variantName: '100 ml', size: 100 })), '100 ml')
  assert.equal(m.variantLabel(item({ packCount: 3 })), '50 مل · 50 ml · ×3')
})

test('only units still to be bought reach the shopping list', () => {
  const rows = m.shoppingRows(data([item(), item({ skuId: 'b', toBuy: 0, awaitingHub: 3 }), item({ skuId: 'c', toBuy: 0, unavailable: 2 })]))
  assert.deepEqual(rows.map((r) => r.skuId), ['a'])
})

test('copy text lists exact quantity, code and order count, with totals', () => {
  const text = m.buyListText(data([item(), item({ skuId: 'b', productName: 'شامبو', skuCode: 'B', barcode: null, toBuy: 1, orderCount: 1 })]), new Date('2026-11-13T10:00:00Z'))
  assert.match(text, /1\. كريم — 50 مل · 50 ml \[A-50 \/ 123\] × 5 {2}\(2 طلب\)/)
  assert.match(text, /2\. شامبو — 50 مل · 50 ml \[B\] × 1/)
  assert.match(text, /الإجمالي: 2 صنف · 6 قطعة/)
  assert.match(m.buyListText(data([]), new Date()), /مفيش حاجة مطلوب شراؤها/)
})

test('printable document escapes product text', () => {
  const html = m.buyListPrintHtml(data([item({ productName: '<img src=x onerror=alert(1)>' })]), new Date())
  assert.ok(!html.includes('<img src=x'))
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'))
})
