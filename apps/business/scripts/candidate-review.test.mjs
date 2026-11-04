import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/candidate-review.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const { DECISION_LABELS, evidenceIsEnough, candidateRows, CONFLICT_LABELS, conflictReason, emptyCandidatesText, packagingText, refusalReasons, ROUTE_LABELS, samePackagingLabel } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)

test('new identity codes and decisions have labels in both languages', () => {
  for (const code of ['row_size_missing', 'catalog_size_missing', 'unread_wording', 'invalid_gtin']) {
    assert.ok(CONFLICT_LABELS[code]?.ar && CONFLICT_LABELS[code]?.en, code)
  }
  assert.deepEqual(refusalReasons('identity_evidence_required').map(reason => reason.en), ['State the evidence you checked first'])
  assert.equal(evidenceIsEnough('  ab  '), false)
  assert.equal(evidenceIsEnough('Invoice checked'), true)
  assert.equal(DECISION_LABELS.NEW_PRODUCT.en, 'Marked as a different or new product')
})

const candidate = (skuId, score, extra = {}) => ({ skuId, code: `C-${skuId}`, productName: `P ${skuId}`, size: 50, sizeUnit: 'ml', packCount: 1, score, samePackaging: true, ...extra })
const match = (extra = {}) => ({ route: 'AMBIGUOUS', suggestedSkuId: null, suggestedSku: null, candidates: [], conflicts: [], matchReason: null, matchedAt: null, confirmable: true, ...extra })

test('candidates keep the stored rank order even when scores disagree', () => {
  const rows = candidateRows(match({ candidates: [candidate('low', 0.1), candidate('high', 0.9)], suggestedSkuId: 'high' }))
  assert.deepEqual(rows.map(row => row.skuId), ['low', 'high'])
  assert.deepEqual(rows.map(row => row.suggested), [false, true])
})
test('a suggestion retrieval never ranked is listed first, without an invented score or packaging verdict', () => {
  const [first, second] = candidateRows(match({ candidates: [candidate('ranked', 1)], suggestedSkuId: 'alias',
    suggestedSku: { id: 'alias', code: 'A', productName: 'Alias SKU', brandName: 'B', size: 30, sizeUnit: 'ml', packCount: null } }))
  assert.deepEqual([first.skuId, first.suggested, first.score, first.samePackaging], ['alias', true, null, null])
  assert.equal(second.skuId, 'ranked')
  assert.equal(samePackagingLabel(first.samePackaging), null)
})
test('packaging reads in both languages and never assumes an unrecorded fact', () => {
  assert.deepEqual(packagingText({ size: 236, sizeUnit: 'ml', packCount: 2 }), { ar: '⁦236 ml⁩ · عدد القطع 2', en: '236 ml · pack of 2' })
  const unknown = packagingText({ size: null, sizeUnit: null, packCount: null })
  assert.match(unknown.ar, /الحجم غير مسجل/)
  assert.match(unknown.en, /Size not recorded · pack count not recorded/)
})
test('every label has both languages', () => {
  for (const label of [...Object.values(CONFLICT_LABELS), ...Object.values(ROUTE_LABELS)]) {
    assert.match(label.ar, /[؀-ۿ]/)
    assert.match(label.en, /^[A-Z]/)
  }
  for (const route of [null, 'NEW', 'VERIFIED', 'CONFLICT', 'AMBIGUOUS']) {
    const { title, body } = emptyCandidatesText(route)
    for (const text of [title, body]) { assert.ok(text.ar); assert.ok(text.en) }
  }
})
test('every conflict code the matcher can store has a label', () => {
  const matcher = readFileSync(new URL('../../api/src/modules/ingestion/services/product-identity.service.ts', import.meta.url), 'utf8')
  const stored = [...matcher.matchAll(/conflicts(?:\.push\(|: \[)\s*'([a-z_]+)'/g), ...matcher.matchAll(/\? \['([a-z_]+)'\]/g), ...matcher.matchAll(/\[clearLeader \? '([a-z_]+)' : '([a-z_]+)'\]/g)]
    .flatMap(found => found.slice(1))
  assert.ok(stored.length > 15, `expected the matcher's codes, found ${stored.length}`)
  assert.deepEqual([...new Set(stored)].filter(code => !CONFLICT_LABELS[code]), [])
})
test('an unknown reason shows the server wording instead of a guess, and the collision keeps the SKU codes', () => {
  assert.deepEqual(conflictReason('brand_mismatch'), CONFLICT_LABELS.brand_mismatch)
  assert.equal(conflictReason('something_new').detail, 'something_new')
  const collision = conflictReason('barcode 123 resolves to multiple canonical SKUs: A, B')
  assert.equal(collision.en, CONFLICT_LABELS.barcode_collision_multiple_skus.en)
  assert.match(collision.detail, /A, B/)
})
test('a refused confirmation becomes reasons in words', () => {
  assert.deepEqual(refusalReasons('EXPLICIT_CONFLICT: size_mismatch, pack_count_mismatch'), [CONFLICT_LABELS.size_mismatch, CONFLICT_LABELS.pack_count_mismatch])
  assert.deepEqual(refusalReasons('INSUFFICIENT_EVIDENCE: identity_requires_independent_evidence'), [CONFLICT_LABELS.identity_requires_independent_evidence])
  assert.deepEqual(refusalReasons('EXPLICIT_CONFLICT: supplier code reuse'), [CONFLICT_LABELS.supplier_code_reuse])
  assert.match(refusalReasons('Selected SKU conflicts with canonical identity; resolve identity evidence first')[0].en, /no longer a candidate/)
  assert.equal(refusalReasons('HTTP 500')[0].detail, 'HTTP 500')
})
