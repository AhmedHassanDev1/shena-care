import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../app/(workspace)/admin/sourcing/sourcing-model.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const m = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)

const supplier = (over = {}) => ({
  id: 's1', name: 'مورد', slug: 'supplier', isActive: true, rfqEnrolledAt: '2026-01-01', closedWeekdays: [5], closedDates: [],
  opensAt: null, closesAt: null, pickupLeadMinutes: null, scope: [], accountCount: 1, openRequestCount: 0, openCommitmentCount: 0,
  readiness: { ready: true, blockers: [] }, ...over,
})

test('supplier state: inactive wins, then readiness', () => {
  assert.equal(m.supplierState(supplier()), 'receiving')
  assert.equal(m.supplierState(supplier({ readiness: { ready: false, blockers: ['NO_SUPPLIER_ACCOUNT'] } })), 'not_ready')
  assert.equal(m.supplierState(supplier({ isActive: false, readiness: { ready: false, blockers: ['INACTIVE'] } })), 'inactive')
})

test('headline names the first real blocker and counts the rest, never INACTIVE twice', () => {
  const h = m.supplierHeadline(supplier({ readiness: { ready: false, blockers: ['NOT_ENROLLED', 'NO_SUPPLIER_ACCOUNT'] } }))
  assert.equal(h.tone, 'warn')
  assert.match(h.text, /غير مشترك/)
  assert.match(h.text, /\(\+1\)/)
  assert.equal(m.supplierHeadline(supplier()).tone, 'ok')
  assert.equal(m.supplierHeadline(supplier({ isActive: false, readiness: { ready: false, blockers: ['INACTIVE'] } })).text, 'موقوف')
})

test('working days text reads as the days off', () => {
  assert.equal(m.workingDaysText([]), 'كل أيام الأسبوع')
  assert.match(m.workingDaysText([5]), /الجمعة/)
  assert.equal(m.workingDaysText([0, 1, 2, 3, 4, 5, 6]), 'لا توجد أيام عمل')
})

test('slugs are only suggested for Latin names and always match the API pattern', () => {
  assert.equal(m.slugFromName('Al Nour Pharma'), 'al-nour-pharma')
  assert.equal(m.slugFromName('مورد النور'), '')
  assert.ok(m.SLUG_PATTERN.test(m.slugFromName("Beauty & Care 2")))
  assert.equal(m.SLUG_PATTERN.test('Bad Slug'), false)
})

test('coverage: awarded is covered, open remainder waits, exhausted remainder is uncovered, closed counts only awards', () => {
  const totals = m.coverageTotals([
    { status: 'open', requiredQuantity: 10, awardedQuantity: 4 },
    { status: 'exhausted', requiredQuantity: 8, awardedQuantity: 3 },
    { status: 'fulfilled', requiredQuantity: 5, awardedQuantity: 5 },
    { status: 'closed', requiredQuantity: 20, awardedQuantity: 2 },
  ])
  assert.deepEqual(totals, { covered: 14, waiting: 6, uncovered: 5, required: 10 + 8 + 5 + 2 })
  assert.deepEqual(m.coverageTotals([]), { covered: 0, waiting: 0, uncovered: 0, required: 0 })
})

test('percent never divides by zero and stays within 0..100', () => {
  assert.equal(m.percent(1, 0), 0)
  assert.equal(m.percent(5, 4), 100)
  assert.equal(m.percent(1, 3), 33)
})

test('attention lists exhausted requests, POs awaiting a decision, expired POs and unpaid payables, nothing else', () => {
  const rfqs = [
    { id: 'r1', batchRef: 'B-1', status: 'exhausted', requiredQuantity: 8, awardedQuantity: 3 },
    { id: 'r2', batchRef: 'B-2', status: 'open', requiredQuantity: 8, awardedQuantity: 0 },
  ]
  const pos = [
    { id: 'p1', status: 'partial', lines: [{ distributionRequired: true }] },
    { id: 'p2', status: 'expired', lines: [{ distributionRequired: false }] },
    { id: 'p3', status: 'received_at_hub', lines: [{ distributionRequired: false }] },
    { id: 'p4', status: 'confirmed', lines: [{ distributionRequired: false }] },
  ]
  const payables = [{ purchaseOrderId: 'p3', status: 'open' }, { purchaseOrderId: 'p4', status: 'paid' }]
  const items = m.attentionItems(rfqs, pos, payables)
  assert.deepEqual(items.map((i) => i.key), ['rfq-r1', 'dist-p1', 'exp-p2', 'payables'])
  assert.match(items[0].text, /5 وحدة/)
  assert.deepEqual(m.attentionItems([], [], []), [])
})
