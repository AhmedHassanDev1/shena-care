import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/routines.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const m = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)

const draft = (over = {}) => ({
  title: 'روتين البشرة الدهنية', titleEn: '', description: '', careArea: 'skin', concernSlug: 'oily-skin',
  references: [{ title: 'AAD', url: 'https://www.aad.org' }, { title: '', url: '' }],
  steps: [{ key: 'a', title: 'غسول', timing: 'AM', instructions: '', isOptional: false, product: 'CODE-1', alternatives: ['6001234567890', ''] }], ...over,
})

test('a pasted identifier becomes exactly one API field', () => {
  assert.deepEqual(m.productRef('  CODE-1 '), { sku: 'CODE-1' })
  assert.deepEqual(m.productRef('6001234567890'), { barcode: '6001234567890' })
  assert.deepEqual(m.productRef('0a1b2c3d-1111-4222-8333-444455556666'), { skuId: '0a1b2c3d-1111-4222-8333-444455556666' })
})

test('the request body drops blank rows and sends the version only on edit', () => {
  const body = m.bodyFromDraft(draft())
  assert.equal(body.references.length, 1)
  assert.deepEqual(body.steps[0].product, { sku: 'CODE-1' })
  assert.deepEqual(body.steps[0].alternatives, [{ barcode: '6001234567890' }])
  assert.equal('expectedVersion' in body, false)
  assert.equal(m.bodyFromDraft(draft(), 3).expectedVersion, 3)
})

test('moving a step swaps neighbours and ignores out-of-range moves', () => {
  assert.deepEqual(m.moveStep([1, 2, 3], 0, 1), [2, 1, 3])
  assert.deepEqual(m.moveStep([1, 2, 3], 2, -1), [1, 3, 2])
  const list = [1, 2, 3]
  assert.equal(m.moveStep(list, 0, -1), list)
  assert.equal(m.moveStep(list, 2, 1), list)
})

test('save is blocked until title, concern, steps and products are filled', () => {
  assert.deepEqual(m.draftProblems(draft()), [])
  const problems = m.draftProblems(draft({ title: ' ', concernSlug: '', steps: [{ key: 'a', title: '', timing: 'AM', instructions: '', isOptional: false, product: '', alternatives: [] }] }))
  assert.equal(problems.length, 4)
  assert.ok(m.draftProblems(draft({ steps: [] })).includes('أضف خطوة واحدة على الأقل'))
})

test('server issue paths map back to their step row', () => {
  assert.equal(m.issueStep({ path: '$.steps[2].product', code: 'X', message: '', severity: 'error' }), 2)
  assert.equal(m.issueStep({ path: '$.steps[0].alternatives[1]', code: 'X', message: '', severity: 'warning' }), 0)
  assert.equal(m.issueStep({ path: '$.description', code: 'X', message: '', severity: 'error' }), null)
})
