import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../components/workspace/prep/register.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const { registerUnits } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)

/** A fake one-unit endpoint answering from a script, one answer per call. */
const scripted = (answers) => {
  let calls = 0
  return { run: async () => answers[calls++], calls: () => calls }
}

test('every unit recorded: complete, and the newest order is the one reported', async () => {
  const api = scripted([{ refusal: null, order: 'o1' }, { refusal: null, order: 'o2' }, { refusal: null, order: 'o3' }])
  const out = await registerUnits(3, api.run)
  assert.deepEqual(out, { done: 3, last: 'o3', refusal: null, failed: false, complete: true })
})

test('a refused unit stops the run; only the confirmed units count', async () => {
  const api = scripted([{ refusal: null, order: 'o1' }, { refusal: null, order: 'o2' }, { refusal: 'ALREADY_COMPLETE', order: 'ignored' }, { refusal: null, order: 'never' }])
  const out = await registerUnits(4, api.run)
  assert.equal(out.done, 2)
  assert.equal(out.last, 'o2')
  assert.equal(out.refusal, 'ALREADY_COMPLETE')
  assert.equal(out.complete, false)
  assert.equal(api.calls(), 3, 'nothing is sent after the refusal')
})

test('a failed request stops the run and keeps what was recorded before it', async () => {
  const api = scripted([{ refusal: null, order: 'o1' }, undefined, { refusal: null, order: 'never' }])
  const out = await registerUnits(3, api.run)
  assert.deepEqual(out, { done: 1, last: 'o1', refusal: null, failed: true, complete: false })
  assert.equal(api.calls(), 2)
})

test('the first unit failing records nothing', async () => {
  const out = await registerUnits(2, scripted([undefined]).run)
  assert.equal(out.done, 0)
  assert.equal(out.last, null)
  assert.equal(out.failed, true)
})

test('a recorded unit without an order keeps the previous confirmed order', async () => {
  const out = await registerUnits(2, scripted([{ refusal: null, order: 'o1' }, { refusal: null, order: null }]).run)
  assert.equal(out.done, 2)
  assert.equal(out.last, 'o1')
})
