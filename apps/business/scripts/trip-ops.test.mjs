import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/trip-ops.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const { tripRef, tripCounts, parseAmount, cashDifference, tripSequence, runTab } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`
)

const settlement = (stops) => ({ state: 'pending', stops: { total: 0, delivered: 0, inTransit: 0, pendingReturns: 0, returnedToHub: 0, cancelled: 0, ...stops }, cash: {}, blockers: [] })

test('trip reference is derived from the trip id: stable, unique per id, readable', () => {
  assert.equal(tripRef('1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d'), 'TRP-1A2B3C4D')
  assert.notEqual(tripRef('1a2b3c4d-0000-0000-0000-000000000000'), tripRef('1a2b3c4e-0000-0000-0000-000000000000'))
})

test('trip counts come from the server settlement block: failed = still with courier + back at hub', () => {
  const run = { stops: 7, toAttempt: 2, settlement: settlement({ total: 7, delivered: 4, inTransit: 2, pendingReturns: 1, returnedToHub: 0 }) }
  assert.deepEqual(tripCounts(run), { total: 7, delivered: 4, failed: 1, remaining: 2 })
  assert.deepEqual(tripCounts({ stops: 3, toAttempt: 3 }), { total: 3, delivered: 0, failed: 0, remaining: 3 })
})

test('amounts typed on an Arabic or English keyboard parse to the same cents-exact number', () => {
  assert.equal(parseAmount('1240'), 1240)
  assert.equal(parseAmount('١٢٤٠'), 1240)
  assert.equal(parseAmount('١٬٢٤٠٫٥٠'), 1240.5)
  assert.equal(parseAmount('1,240.50'), 1240.5)
  assert.equal(parseAmount(' 0 '), 0)
})

test('invalid money input is rejected, never guessed', () => {
  for (const bad of ['', '  ', 'abc', '-5', '12.345', '1.2.3', '12٫', '١٢أ']) assert.equal(parseAmount(bad), null, bad)
})

test('difference is matched / shortage / surplus, exact to the cent (no float drift)', () => {
  assert.deepEqual(cashDifference(1240, null), { kind: 'empty' })
  assert.deepEqual(cashDifference(1240, 1240), { kind: 'matched', amount: 0 })
  assert.deepEqual(cashDifference(1240, 1190), { kind: 'shortage', amount: 50 })
  assert.deepEqual(cashDifference(1240, 1300.5), { kind: 'surplus', amount: 60.5 })
  assert.deepEqual(cashDifference(0.3, 0.1 + 0.2), { kind: 'matched', amount: 0 })
})

test('a courier with several trips in one day is numbered in creation order; other days and couriers are independent', () => {
  const runs = [
    { id: 'b', driverId: 'c1', plannedAt: '2026-11-19T12:00:00Z' },
    { id: 'a', driverId: 'c1', plannedAt: '2026-11-19T08:00:00Z' },
    { id: 'c', driverId: 'c2', plannedAt: '2026-11-19T09:00:00Z' },
    { id: 'd', driverId: 'c1', plannedAt: '2026-11-18T09:00:00Z' },
  ]
  const seq = tripSequence(runs)
  assert.deepEqual(seq.get('a'), { n: 1, of: 2 })
  assert.deepEqual(seq.get('b'), { n: 2, of: 2 })
  assert.deepEqual(seq.get('c'), { n: 1, of: 1 })
  assert.deepEqual(seq.get('d'), { n: 1, of: 1 })
})

test('each run lands in exactly one desk tab', () => {
  assert.equal(runTab({ status: 'planning', attempts: {} }), 'assign')
  assert.equal(runTab({ status: 'dispatched', toAttempt: 2, attempts: {} }), 'active')
  assert.equal(runTab({ status: 'dispatched', toAttempt: 0, attempts: { active: 3 } }), 'settle')
  assert.equal(runTab({ status: 'dispatched', attempts: { active: 1 } }), 'active')
  assert.equal(runTab({ status: 'completed', toAttempt: 0, attempts: {} }), 'history')
})
