import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../app/(workspace)/admin/catalog/catalog-model.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const m = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)

const sku = (over = {}) => ({ id: 's', code: 'C-1', size: 250, sizeUnit: 'ml', currentPrice: { id: 'p', amount: 189, compareAtAmount: null, currency: 'EGP' }, ...over })
const item = (over = {}) => ({ archivedAt: null, isPublished: true, readiness: { status: 'READY', issues: [] }, skus: [sku()], ...over })

test('a healthy published row is quiet; a draft is just a draft (the publish gate is not guessed)', () => {
  assert.deepEqual(m.rowStatus(item()), { label: 'منشور', tone: 'muted', issues: [] })
  assert.deepEqual(m.rowStatus(item({ isPublished: false })), { label: 'مسودة', tone: 'muted', issues: [] })
  assert.equal(m.rowStatus(item({ archivedAt: '2026-01-01' })).label, 'مؤرشف')
})

test('a row with problems shows the most important blocker first and keeps the rest', () => {
  const status = m.rowStatus(item({ readiness: { status: 'NEEDS_ATTENTION', issues: ['SELLING_PRICE_MISSING', 'PRIMARY_PACKSHOT_MISSING', 'CATEGORY_MISSING'] } }))
  assert.equal(status.tone, 'warn')
  assert.deepEqual(status.issues, ['CATEGORY_MISSING', 'PRIMARY_PACKSHOT_MISSING', 'SELLING_PRICE_MISSING'])
  assert.match(status.label, /تصنيف/)
})

test('size and price come from the variants without inventing anything', () => {
  assert.equal(m.productSizeText(item()), '250 ml')
  assert.equal(m.productSizeText(item({ skus: [sku(), sku({ size: 500 })] })), '250 ml +1')
  assert.equal(m.productSizeText(item({ skus: [sku({ size: null, sizeUnit: null })] })), '')
  assert.deepEqual(m.productPrice(item()), { amount: 189, currency: 'EGP' })
  assert.equal(m.productPrice(item({ skus: [sku({ currentPrice: null })] })), null)
})

test('the summary line states only what exists', () => {
  assert.equal(m.summaryLine({ total: 30, published: 16, draft: 13, archived: 0, missingImage: 0 }), '30 منتج · 16 منشور · 13 مسودة')
  assert.match(m.summaryLine({ total: 30, published: 16, draft: 13, archived: 1, missingImage: 5 }), /1 مؤرشف · 5 بلا صورة$/)
})

test('filters round-trip through the URL and invalid values fall back safely', () => {
  const get = (obj) => (key) => (key in obj ? obj[key] : null)
  const f = m.parseProductFilters(get({ q: 'سيرافي', status: 'draft', ready: 'missing_price', page: '3', brand: 'b1' }))
  assert.deepEqual(f, { q: 'سيرافي', brand: 'b1', cat: '', status: 'draft', ready: 'missing_price', page: 3 })
  const bad = m.parseProductFilters(get({ status: 'weird', ready: 'nope', page: '-4' }))
  assert.equal(bad.status, 'all')
  assert.equal(bad.ready, '')
  assert.equal(bad.page, 1)
  assert.equal(m.productsApiQuery(f, 25), 'page=3&limit=25&q=%D8%B3%D9%8A%D8%B1%D8%A7%D9%81%D9%8A&brandId=b1&status=draft&readiness=missing_price')
  assert.equal(m.hasActiveProductFilters(m.parseProductFilters(get({}))), false)
})

test('every blocker maps to the editor section that fixes it, in a stable order', () => {
  assert.equal(m.issueSection('CATEGORY_MISSING'), 'details')
  assert.equal(m.issueSection('PRIMARY_PACKSHOT_PENDING_REVIEW'), 'media')
  assert.equal(m.issueSection('SELLING_PRICE_MISSING'), 'skus')
  assert.deepEqual(m.sortIssues(['SKU_INACTIVE', 'SELLING_PRICE_MISSING', 'UNKNOWN_X', 'CATEGORY_MISSING']), ['CATEGORY_MISSING', 'SELLING_PRICE_MISSING', 'SKU_INACTIVE', 'UNKNOWN_X'])
})

test('error codes become Arabic sentences; duplicates are explained, unknown messages pass through', () => {
  assert.match(m.catalogErrorMessage({ code: 'BRAND_IN_ALLOWLIST_POLICY' }, 'x'), /قائمة السماح/)
  assert.match(m.catalogErrorMessage({ message: "A SKU with code 'X' already exists" }, 'x'), /كود النسخة/)
  assert.match(m.catalogErrorMessage({ message: "A brand with name 'CeraVe' already exists" }, 'x'), /ماركة/)
  assert.equal(m.catalogErrorMessage({ message: 'Something else' }, 'x'), 'Something else')
  assert.equal(m.catalogErrorMessage(null, 'تعذر'), 'تعذر')
})

test('the policy flattens into one list and removal never mutates the original', () => {
  const doc = {
    mode: 'OPEN',
    brands: [{ id: 'b1', name: 'CeraVe', effect: 'ALLOW', aliases: ['سيرافي'] }, { name: 'Acme', effect: 'DENY', aliases: [] }],
    categories: [{ id: 'c1', name: 'Body Care', effect: 'DENY' }],
    brandCategoryRules: [{ brandId: 'b1', brandName: 'CeraVe', categoryId: 'c2', categoryName: 'Sunscreens', effect: 'ALLOW' }],
    excludedTerms: ['tester'],
    disabledExcludedClasses: ['MAKEUP'],
  }
  const rules = m.flattenPolicy(doc, [{ key: 'MEDICINE' }, { key: 'MAKEUP' }])
  assert.deepEqual(rules.map((r) => r.kind), ['brand', 'brand', 'category', 'pair', 'term', 'system', 'system'])
  assert.equal(m.ruleEffectText(rules[0].effect).text, 'مسموح')
  assert.equal(m.ruleEffectText(rules[1].effect).text, 'مستبعد')
  assert.equal(m.ruleEffectText(rules[5].effect).text, 'مستبعد تلقائيًا')
  assert.equal(m.ruleEffectText(rules[6].effect).text, 'الاستبعاد معطّل')
  const without = m.withRuleRemoved(doc, rules[1])
  assert.equal(without.brands.length, 1)
  assert.equal(doc.brands.length, 2)
  assert.equal(m.withRuleRemoved(doc, rules[4]).excludedTerms.length, 0)
})
