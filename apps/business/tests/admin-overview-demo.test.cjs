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
const { resolveOverviewSource } = require('../lib/overview-source.ts');
const { orderBuckets, attentionCounts } = require('../lib/admin-overview.ts');
const { buildOverviewFixtures } = require('../lib/mock/overview-fixtures.ts');
const { mockOverviewRequest } = require('../lib/mock/overview-mock-api.ts');

const ORDER_STATUSES = ['placed', 'confirmed', 'packing', 'shipped', 'delivered', 'cancelled', 'returned'];
const PAYMENTS = ['COD', 'CARD', 'MOBILE_WALLET'];
const NOWS = [
  new Date('2026-10-15T12:00:00Z'), // Cairo summer time (UTC+3)
  new Date('2026-10-14T22:30:00Z'), // 01:30 on 15 Oct in Cairo, still 14 Oct in UTC
  new Date('2026-12-10T09:15:00Z'), // Cairo winter time (UTC+2)
];
const call = (path, options = {}) =>
  mockOverviewRequest(path, new AbortController().signal, { delayMs: 0, now: NOWS[0], ...options });

test('production can never select demo data, whatever is requested', () => {
  assert.equal(resolveOverviewSource({ nodeEnv: 'production', requested: 'mock' }), 'api');
  assert.equal(resolveOverviewSource({ nodeEnv: 'production' }), 'api');
  assert.equal(resolveOverviewSource({ nodeEnv: 'development', requested: 'mock' }), 'mock');
  assert.equal(resolveOverviewSource({ nodeEnv: 'development' }), 'api');
  assert.equal(resolveOverviewSource({ nodeEnv: 'development', requested: 'MOCK' }), 'api');
  assert.equal(resolveOverviewSource({}), 'api');
});

test('the build-time flag resolves to the real API unless development opts in', () => {
  const run = (nodeEnv, requested) => {
    const saved = [process.env.NODE_ENV, process.env.NEXT_PUBLIC_ADMIN_OVERVIEW_SOURCE];
    process.env.NODE_ENV = nodeEnv;
    process.env.NEXT_PUBLIC_ADMIN_OVERVIEW_SOURCE = requested;
    delete require.cache[require.resolve('../lib/overview-source.ts')];
    const { MOCK_OVERVIEW } = require('../lib/overview-source.ts');
    [process.env.NODE_ENV, process.env.NEXT_PUBLIC_ADMIN_OVERVIEW_SOURCE] = saved;
    if (saved[1] === undefined) delete process.env.NEXT_PUBLIC_ADMIN_OVERVIEW_SOURCE;
    return MOCK_OVERVIEW;
  };
  assert.equal(run('production', 'mock'), false);
  assert.equal(run('development', 'mock'), true);
  assert.equal(run('development', 'api'), false);
});

test('the only import of demo data sits behind the literal production guard', () => {
  const guard = "process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_ADMIN_OVERVIEW_SOURCE === 'mock'";
  const read = (p) => fs.readFileSync(require.resolve(p), 'utf8');
  assert.ok(read('../lib/overview-source.ts').includes(guard), 'MOCK_OVERVIEW uses the same rule');
  const hook = read('../lib/use-overview-api.ts');
  assert.ok(hook.indexOf(guard) !== -1 && hook.indexOf(guard) < hook.indexOf("import('@/lib/mock/overview-mock-api')"));
  // No other module may import demo code statically or dynamically.
  const importers = ['../app/(workspace)/admin/page.tsx', '../lib/session.tsx', '../lib/use-api.ts',
    '../components/workspace/overview/attention-queues.tsx', '../components/workspace/overview/overview-link.tsx'];
  for (const file of importers) {
    const source = read(file);
    const offending = source.split('\n').filter((l) => /(import|require)\b.*\bmock\//.test(l) && !/^\s*import type /.test(l));
    assert.deepEqual(offending, [], `${file} must not import demo code at runtime`);
  }
});

test('fixtures are deterministic and not random per call', () => {
  assert.deepEqual(buildOverviewFixtures(NOWS[0]), buildOverviewFixtures(NOWS[0]));
});

for (const now of NOWS) {
  test(`KPIs, chart and tables agree with each other (${now.toISOString()})`, () => {
    const { orders, attention, kpis } = buildOverviewFixtures(now);
    const buckets = orderBuckets(orders, now);
    assert.equal(kpis.totalOrders, orders.length);
    assert.equal(kpis.ordersToday, buckets[6].total, 'today KPI = today bar in Cairo time');
    assert.ok(kpis.ordersToday > 0);
    assert.ok(buckets.every((b) => b.total > 0), 'every one of the 7 days has orders');
    assert.ok(orders.every((o) => Date.parse(o.createdAt) <= now.getTime()), 'nothing is in the future');
    assert.deepEqual(
      orders.map((o) => o.createdAt),
      [...orders.map((o) => o.createdAt)].sort().reverse(),
      'newest first, like GET /admin/orders',
    );
    assert.equal(new Set(orders.map((o) => o.id)).size, orders.length);
    assert.equal(new Set(orders.map((o) => o.orderNumber)).size, orders.length);

    // Attention queues only reference orders that exist, and only plausible ones.
    const byId = new Map(orders.map((o) => [o.id, o]));
    const rowsWithOrder = [
      ...attention.supplyActionRequired.items,
      ...attention.customerDecisionsPending.items,
      ...attention.failedDeliveries.items,
      ...attention.cashVariances.short.items,
      ...attention.cashVariances.over.items,
      ...attention.deliveredUnsettled.items,
    ];
    for (const row of rowsWithOrder) {
      const order = byId.get(row.orderId);
      assert.ok(order, 'queue row points at a fixture order');
      assert.equal(order.orderNumber, row.orderNumber);
    }
    for (const row of attention.supplyActionRequired.items) assert.equal(byId.get(row.orderId).status, 'placed');
    for (const row of attention.failedDeliveries.items) assert.equal(byId.get(row.orderId).status, 'shipped');
    for (const row of attention.openCases.items) if (row.orderId) assert.ok(byId.has(row.orderId));
    assert.ok(attention.openCases.items.length > 0);

    // COD cash: counts are queue sizes; amounts are EGP strings that match the order.
    for (const row of [
      ...attention.deliveredUnsettled.items,
      ...attention.cashVariances.short.items,
      ...attention.cashVariances.over.items,
    ]) {
      const order = byId.get(row.orderId);
      assert.equal(order.status, 'delivered');
      assert.equal(order.paymentMethod, 'COD');
      assert.equal(row.expectedAmount, order.codAmount.toFixed(2));
    }
    for (const row of attention.deliveredUnsettled.items) {
      assert.equal(row.countedAmount, null);
      assert.equal(row.variance, null);
    }
    for (const row of attention.cashVariances.short.items) assert.ok(Number(row.variance) < 0);
    for (const row of attention.cashVariances.over.items) assert.ok(Number(row.variance) > 0);
    for (const row of [...attention.cashVariances.short.items, ...attention.cashVariances.over.items]) {
      assert.equal(Number(row.variance), Number(row.countedAmount) - Number(row.expectedAmount));
    }

    // Capped lists keep the API contract: ≤ 10 items, never more than the total.
    for (const queue of [
      attention.supplyActionRequired, attention.customerDecisionsPending, attention.distributionRequired,
      attention.failedDeliveries, attention.deliveredUnsettled, attention.openCases,
    ]) {
      assert.ok(queue.items.length <= 10 && queue.items.length <= queue.total);
    }
    const counts = attentionCounts(attention);
    assert.equal(counts.length, 6);
    assert.ok(counts.every((n) => n > 0), 'every founder queue has something to review');
    for (const row of attention.distributionRequired.items) {
      assert.ok(row.confirmedQuantity < row.requestedQuantity && row.orderAllocations > 1);
    }
  });
}

test('orders follow the real enums, money relationships and Cairo/Giza locale', () => {
  const { orders } = buildOverviewFixtures(NOWS[0]);
  for (const o of orders) {
    assert.ok(ORDER_STATUSES.includes(o.status));
    assert.ok(PAYMENTS.includes(o.paymentMethod));
    assert.equal(o.currency, 'EGP');
    assert.equal(o.codAmount === null, o.paymentMethod !== 'COD');
    if (o.codAmount !== null) assert.equal(o.codAmount, o.totalAmount);
    assert.ok(o.totalAmount > 50 && Number.isInteger(o.totalAmount));
    assert.ok(o.itemCount >= 1);
    assert.ok(['القاهرة', 'الجيزة'].includes(o.governorate));
    assert.match(o.orderNumber, /^ORD-[A-F0-9]{16}$/);
  }
  assert.ok(ORDER_STATUSES.every((s) => orders.some((o) => o.status === s)), 'every workflow status is represented');
});

test('demo reads answer like the API: filters, paging, no phone leak, bounded take', async () => {
  const all = await call('/admin/orders?take=100&skip=0');
  assert.equal(all.items.length, 100);
  assert.equal(all.total, buildOverviewFixtures(NOWS[0]).orders.length);
  assert.ok(all.items.every((o) => !('phone' in o)));
  const page2 = await call('/admin/orders?take=20&skip=20');
  assert.deepEqual(page2.items[0], all.items[20]);
  const placed = await call('/admin/orders?status=placed&take=100');
  assert.ok(placed.items.length > 0 && placed.items.every((o) => o.status === 'placed'));
  const byNumber = await call(`/admin/orders?q=${all.items[3].orderNumber.slice(0, 10).toLowerCase()}`);
  assert.ok(byNumber.items.some((o) => o.id === all.items[3].id));
  assert.equal((await call('/admin/orders?q=لا-يوجد-عميل-بهذا-الاسم')).items.length, 0);
  assert.equal((await call('/admin/orders?take=5000')).items.length, 100, 'take is capped at 100 like the DTO');
  assert.equal((await call('/operations/dashboard/kpis')).totalOrders, all.total);
  await assert.rejects(call('/operations/finance/exports'), { status: 404 });
});

test('loading, empty, error and forbidden screens are reachable on demand and never faked as success', async () => {
  const empty = await call('/operations/queues/attention', { state: 'empty' });
  assert.deepEqual(attentionCounts(empty), [0, 0, 0, 0, 0, 0]);
  assert.equal(empty.deliveredUnsettled.total, 0);
  assert.deepEqual((await call('/admin/orders?take=100', { state: 'empty' })).items, []);
  assert.deepEqual(await call('/operations/dashboard/kpis', { state: 'empty' }), { ordersToday: 0, totalOrders: 0 });
  await assert.rejects(call('/operations/dashboard/kpis', { state: 'error' }), { status: 500 });
  await assert.rejects(call('/operations/dashboard/kpis', { state: 'forbidden' }), { status: 403 });

  const controller = new AbortController();
  let settled = false;
  const pending = mockOverviewRequest('/operations/dashboard/kpis', controller.signal, { state: 'loading', delayMs: 0 });
  pending.then(() => (settled = true), () => (settled = true));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(settled, false, 'loading never resolves by itself');
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('the demo layer is read-only: it exposes no write path', () => {
  const api = require('../lib/mock/overview-mock-api.ts');
  assert.deepEqual(Object.keys(api).sort(), ['MOCK_STATES', 'mockOverviewRequest']);
  assert.ok(!/method|POST|PATCH|DELETE|body/.test(fs.readFileSync(require.resolve('../lib/mock/overview-mock-api.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//, '')));
});
