import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../components/workspace/prep/quantity.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const { clampQuantity, quantityDifferences } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)

test('the available quantity stays between what is already received and the required quantity', () => {
  assert.equal(clampQuantity(3, 0, 3), 3)
  assert.equal(clampQuantity(2, 0, 3), 2)
  assert.equal(clampQuantity(5, 0, 3), 3)
  assert.equal(clampQuantity(-1, 0, 3), 0)
  assert.equal(clampQuantity(1, 2, 3), 2, 'never below what was already received')
  assert.equal(clampQuantity(Number.NaN, 0, 3), 3, 'default is the full required quantity')
})

const line = (over = {}) => ({ orderItemId: 'l1', ordered: 3, required: 3, received: 3, shortage: null, ...over })

test('no difference when everything ordered was counted in', () => {
  assert.deepEqual(quantityDifferences([line()]), [])
})

test('an open shortage report, a reduced line, missing scans and excess are each reported, from the server numbers only', () => {
  assert.equal(quantityDifferences([line({ received: 2, shortage: { missing: 1 } })])[0].kind, 'shortage-open')
  assert.equal(quantityDifferences([line({ required: 2, received: 2 })])[0].kind, 'adjusted')
  assert.equal(quantityDifferences([line({ received: 1 })])[0].kind, 'scanned-short')
  assert.equal(quantityDifferences([line({ received: 4 })])[0].kind, 'excess')
})

test('several products are judged independently', () => {
  const out = quantityDifferences([line({ orderItemId: 'a' }), line({ orderItemId: 'b', received: 1 }), line({ orderItemId: 'c', required: 2, received: 2 })])
  assert.deepEqual(out.map((d) => [d.line.orderItemId, d.kind]), [['b', 'scanned-short'], ['c', 'adjusted']])
})
