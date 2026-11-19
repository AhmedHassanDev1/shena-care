import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../components/workspace/prep/quantity.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const { clampQuantity, quantityDifferences } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)

test('the quantity never goes below 0 or above the required quantity', () => {
  assert.equal(clampQuantity(3, 3), 3)
  assert.equal(clampQuantity(2, 3), 2)
  assert.equal(clampQuantity(4, 3), 3)
  assert.equal(clampQuantity(-1, 3), 0)
  assert.equal(clampQuantity(Number.NaN, 3), 3)
})

const line = (over = {}) => ({ orderItemId: 'l1', required: 3, received: 3, ...over })

test('no difference when the quantity is the full required one and everything was scanned', () => {
  assert.deepEqual(quantityDifferences([line()], (l) => l.required), [])
})

test('a lowered quantity is a shortage, whatever was scanned', () => {
  const out = quantityDifferences([line()], () => 2)
  assert.equal(out.length, 1)
  assert.equal(out[0].kind, 'short')
  assert.equal(out[0].quantity, 2)
})

test('scan progress is judged separately from the quantity', () => {
  assert.equal(quantityDifferences([line({ received: 1 })], (l) => l.required)[0].kind, 'scanned-short')
  assert.equal(quantityDifferences([line({ received: 4 })], (l) => l.required)[0].kind, 'excess')
})
