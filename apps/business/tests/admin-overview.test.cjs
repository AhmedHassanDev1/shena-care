const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (mod, file) =>
  mod._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    file,
  );
const { orderBuckets, attentionCounts } = require('../lib/admin-overview.ts');
test('groups by Cairo creation date and keeps current statuses distinct, never delivery throughput', () => {
  const rows = [
    { createdAt: '2026-10-14T22:30:00Z', status: 'delivered' },
    { createdAt: '2026-10-15T08:00:00Z', status: 'shipped' },
    { createdAt: '2026-10-15T09:00:00Z', status: 'cancelled' },
    { createdAt: '2026-10-15T09:00:00Z', status: 'future_status' },
    { createdAt: '2026-10-01T09:00:00Z', status: 'placed' },
  ];
  const buckets = orderBuckets(rows, new Date('2026-10-15T12:00:00Z'));
  assert.equal(buckets.length, 7);
  assert.deepEqual(buckets[6], { date: '2026-10-15', delivered: 1, active: 1, other: 2, total: 4 });
  assert.equal(buckets[5].total, 0);
});
test('empty orders produce zero counts, not invented activity', () => {
  assert.equal(
    orderBuckets([], new Date('2026-10-15T12:00:00Z')).reduce((n, b) => n + b.total, 0),
    0,
  );
});
test('attention totals count queues, exclude cash awaiting count and capped event samples', () => {
  const a = {
    supplyActionRequired: { total: 2 },
    customerDecisionsPending: { total: 3 },
    distributionRequired: { total: 4 },
    failedDeliveries: { total: 5 },
    cashVariances: { short: { total: 6 }, over: { total: 7 } },
    openCases: { total: 8 },
    deliveredUnsettled: { total: 90 },
    eventFailures: { failed: [{}], dead: [{}] },
  };
  assert.deepEqual(attentionCounts(a), [2, 3, 4, 5, 13, 8]);
});
