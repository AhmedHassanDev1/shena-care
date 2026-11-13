import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/staff-access.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const { staffAccess } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)

test('missing staff access details stay unknown rather than becoming empty assignments', () => {
  assert.deepEqual(staffAccess({}), { locations: null, activeSessions: null })
  assert.deepEqual(staffAccess({ locations: [], activeSessions: 0 }), { locations: [], activeSessions: 0 })
  assert.deepEqual(staffAccess({ locations: [{ id: '1', name: 'Hub' }], activeSessions: 2 }), {
    locations: [{ id: '1', name: 'Hub' }], activeSessions: 2,
  })
})
