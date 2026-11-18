import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/purchase-batch.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const m = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)

const line = (over = {}) => ({
  id: 'l1', skuId: 's1', productName: 'Soothing Gel', brandName: 'shaan', skuCode: 'SC-SHAAN-2424A866', variantName: '120 g', size: 120, sizeUnit: 'g', packCount: null,
  barcode: '6221234567890', required: 1, received: 0, remaining: 1, closedOut: 0, orders: [], receipts: [], ...over,
})
const batch = (lines, over = {}) => ({
  id: 'b1', number: 12, kind: 'scheduled', status: 'ready', cutoffAt: '2026-11-14T10:00:00Z', createdAt: '2026-11-14T10:00:01Z', sentAt: null, sentBy: null,
  expectedAt: '2026-11-15T12:00:00Z', note: 'اتصل قبل ما تروح', closedAt: null, closeReason: null, skus: lines.length, orders: 1, units: 5, received: 0, remaining: 4, nextAction: 'send', lines, events: [], ...over,
})

test('the copied text is only "name × quantity" per line, with brand and size in the name and nothing else', () => {
  const text = m.purchaseListText(batch([
    line({ id: 'a', productName: 'Rejuvenation Cream', skuCode: 'SC-SHAAN-DF5C9F53', required: 2, remaining: 2 }),
    line({ id: 'b' }),
    line({ id: 'c', productName: 'Acne Prone Skin Facial Cleanser', brandName: 'StarVille', variantName: '200 ml', size: 200, sizeUnit: 'ml', skuCode: 'SC-STARVI-49343ABD' }),
  ]))
  assert.equal(text, [
    'Shaan Rejuvenation Cream 120 g × 2',
    'Shaan Soothing Gel 120 g × 1',
    'StarVille Acne Prone Skin Facial Cleanser 200 ml × 1',
  ].join('\n'))
})

test('the copied text never carries codes, barcodes, ids, batch numbers, dates, status or notes', () => {
  const text = m.purchaseListText(batch([line()]))
  for (const leaked of ['SC-SHAAN', '6221234567890', 'l1', 's1 ', '#12', 'ShinaCare', 'اتصل', '2026', 'جاهزة', 'الإجمالي']) assert.ok(!text.includes(leaked), leaked)
})

test('only what is still to be bought is listed, using the remaining quantity', () => {
  const text = m.purchaseListText(batch([line({ required: 5, received: 1, remaining: 4 }), line({ id: 'l2', productName: 'Serum', remaining: 0, received: 2, required: 2 })]))
  assert.equal(text, 'Shaan Soothing Gel 120 g × 4')
})

test('size is never repeated when the variant, the product name or the structured size already says it', () => {
  const name = (over) => m.purchaseLineName(line(over)).full
  assert.equal(name({}), 'Shaan Soothing Gel 120 g')
  assert.equal(name({ variantName: '120g' }), 'Shaan Soothing Gel 120 g')
  assert.equal(name({ productName: 'Soothing Gel 120 g', variantName: 'Default' }), 'Shaan Soothing Gel 120 g Default')
  assert.equal(name({ productName: 'Soothing Gel 120g', variantName: '' }), 'Shaan Soothing Gel 120g')
  assert.equal(name({ variantName: 'Rose' }), 'Shaan Soothing Gel Rose 120 g')
  assert.equal(name({ size: null, sizeUnit: null, variantName: '120 g' }), 'Shaan Soothing Gel 120 g')
  assert.equal(name({ size: 12.5, sizeUnit: 'ml', variantName: '' }), 'Shaan Soothing Gel 12.5 ml')
  assert.equal(name({ packCount: 3 }), 'Shaan Soothing Gel 120 g 3-pack')
})

test('the brand is added once, kept as stored when it has its own casing, and missing brands do not break the name', () => {
  const name = (over) => m.purchaseLineName(line(over))
  assert.equal(name({ productName: 'Shaan Soothing Gel' }).full, 'Shaan Soothing Gel 120 g')
  assert.equal(name({ productName: 'Shaan Soothing Gel' }).brand, '')
  assert.equal(name({ brandName: "L'Oréal Paris", productName: 'Hyaluron Moisture Shampoo', variantName: '200 ml', size: 200, sizeUnit: 'ml' }).full, "L'Oréal Paris Hyaluron Moisture Shampoo 200 ml")
  assert.equal(name({ brandName: 'eva cosmetics', productName: 'Niacinamide Facial Serum', variantName: '30 ml', size: 30, sizeUnit: 'ml' }).full, 'Eva Cosmetics Niacinamide Facial Serum 30 ml')
  assert.equal(name({ brandName: undefined }).full, 'Soothing Gel 120 g')
  assert.equal(name({ brandName: null }).brand, '')
})

test('the list is ordered by brand and name, and the header counts match the copied text', () => {
  const b = batch([line({ id: 'z', productName: 'Zinc Cream', brandName: 'Bobai', remaining: 3 }), line({ id: 'a', productName: 'Aloe Gel', brandName: 'Bobai', remaining: 2 }), line({ id: 'x', brandName: 'Alpha', productName: 'Mask', remaining: 1 }),
    line({ id: 'd', productName: 'Done', remaining: 0, received: 1 })])
  assert.deepEqual(m.openLines(b).map((l) => l.id), ['x', 'a', 'z'])
  assert.deepEqual(m.purchaseTotals(b), { products: 3, units: 6 })
  assert.equal(m.purchaseListText(b).split('\n').length, 3)
})

test('a batch with nothing left to buy has an empty copy text and falls back to the batch totals in the header', () => {
  const b = batch([line({ remaining: 0, received: 1 })], { skus: 1, units: 1 })
  assert.equal(m.purchaseListText(b), '')
  assert.deepEqual(m.purchaseTotals(b), { products: 1, units: 1 })
})

test('the WhatsApp link carries exactly the copied text (no recipient, no automatic sending)', () => {
  const text = m.purchaseListText(batch([line(), line({ id: 'l2', productName: 'Rejuvenation Cream', remaining: 2 })]))
  const url = m.whatsappUrl(text)
  assert.ok(url.startsWith('https://wa.me/?text='))
  assert.equal(decodeURIComponent(url.slice('https://wa.me/?text='.length)), 'Shaan Rejuvenation Cream 120 g × 2\nShaan Soothing Gel 120 g × 1')
})

test('the printable checklist escapes product names, keeps a tick box per line and carries no codes', () => {
  const html = m.batchPrintHtml(batch([line({ productName: '<b>x</b> & "y"' })]))
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt; &amp; &quot;y&quot;/)
  assert.match(html, /class="box"/)
  const clean = m.batchPrintHtml(batch([line()]))
  assert.match(clean, /Shaan Soothing Gel 120 g/)
  assert.doesNotMatch(clean, /SC-SHAAN|6221234567890/)
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

test('the name is split into brand, name and size tags for the page, while the copied text keeps one string', () => {
  const n = m.purchaseLineName(line())
  assert.deepEqual({ brand: n.brand, name: n.name, tags: n.tags, full: n.full }, { brand: 'Shaan', name: 'Soothing Gel', tags: ['120 g'], full: 'Shaan Soothing Gel 120 g' })
  // A size the product name already carries is not repeated as a tag.
  assert.deepEqual(m.purchaseLineName(line({ productName: 'Soothing Gel 120 g', variantName: '' })).tags, [])
  assert.deepEqual(m.purchaseLineName(line({ packCount: 3 })).tags, ['120 g', '3-pack'])
  assert.equal(m.purchaseLineName(line({ variantName: 'Rose' })).name, 'Soothing Gel Rose')
})

test('textures read in English like the storefront, and unknown or missing ones add nothing', () => {
  assert.equal(m.textureLabel('GEL'), 'Gel')
  assert.equal(m.textureLabel('GEL_CREAM'), 'Gel-cream')
  assert.equal(m.textureLabel('SOMETHING_NEW'), '')
  assert.equal(m.textureLabel(null), '')
  assert.equal(m.textureLabel(undefined), '')
})

test('the product link opens the exact variant on the storefront, and is absent when the API sent no slug', () => {
  assert.equal(m.productUrl({ productSlug: 'soothing gel/120', skuId: 's1' }), 'http://localhost:3000/products/soothing%20gel%2F120?sku=s1')
  assert.equal(m.productUrl({ productSlug: null, skuId: 's1' }), null)
  assert.equal(m.productUrl({ skuId: 's1' }), null)
})

test('copying only the selected lines keeps the same clean format, and an empty selection yields nothing', () => {
  const b = batch([line({ id: 'a', productName: 'Rejuvenation Cream', remaining: 2 }), line({ id: 'b' }), line({ id: 'c', productName: 'Aloe Gel', brandName: 'Bobai', remaining: 3 })])
  assert.equal(m.purchaseListText(b, new Set(['b', 'c'])), 'Bobai Aloe Gel 120 g × 3\nShaan Soothing Gel 120 g × 1')
  assert.equal(m.purchaseListText(b, new Set()), '')
  assert.equal(m.purchaseListText(b).split('\n').length, 3)
})

test('the category is shown as the catalog names it, and adds nothing when missing', () => {
  assert.equal(m.categoryLabel('Cleansers'), 'Cleansers')
  assert.equal(m.categoryLabel('  Moisturizers '), 'Moisturizers')
  assert.equal(m.categoryLabel(null), '')
  assert.equal(m.categoryLabel(undefined), '')
})
