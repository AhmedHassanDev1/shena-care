/* eslint-disable @typescript-eslint/no-explicit-any -- HTTP response bodies are asserted structurally */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { createActor, Actor } from '../fixtures/actors';
import { createSellableSku } from '../fixtures/sellable-sku';
import { attachPurchaseOrderLineage } from '../fixtures/purchase-order-lineage';

/**
 * CAPITAL PARTNER PORTAL. Real HTTP, real (disposable) database. Months far in the past (2024-06 .. 2024-11) so the figures are exact and
 * closeable. Reference scenario (every month's "ideal" is worked out by hand): products 1,000, coupon 100, delivery fee collected 35,
 * purchase cost 700, actual delivery 25, packaging 10 → distributable profit 200; platform 40% = 80, partner 60% = 120.
 */
describe('Capital partner portal (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor; let hub: Actor; let customer: Actor;
  let partner: Actor; let stranger: Actor; let partnerAccount: string;
  let supplierId: string;
  const cleanups: Array<() => Promise<void>> = [];
  const lotIds: string[] = []; const expenseIds: string[] = [];
  const api = () => request(app.getHttpServer());
  const PERIODS = ['2024-06', '2024-07', '2024-08', '2024-09', '2024-10', '2024-11'];

  /** One delivered COD order on `day`: goods 1,000 (2 × 500), coupon 100, fee 35 → billed 935. Optional pieces keep a cost missing on purpose. */
  async function deliveredOrder(day: string, opts: { cost?: number; courier?: number; packaging?: number; settled?: boolean; counted?: number } = {}) {
    const { cost = 350, courier = 25, packaging = 10, settled = true } = opts;
    const sku = await createSellableSku(prisma);
    const po = await prisma.supplierPurchaseOrder.create({ data: { supplierId, status: 'received_at_hub', lines: { create: [{ skuId: sku.id, requestedQuantity: 2, confirmedQuantity: 2 }] } }, include: { lines: true } });
    cleanups.push(await attachPurchaseOrderLineage(prisma, po.id));
    const line = po.lines[0];
    const link = await prisma.purchaseOrderLineAllocation.findFirstOrThrow({ where: { purchaseOrderLineId: line.id } });
    await prisma.purchaseOrderLineAllocation.update({ where: { id: link.id }, data: { receivedQuantity: 2 } });
    await prisma.orderItem.updateMany({ where: { orderId: link.orderId }, data: { price: 500, lineTotal: 1000, quantity: 2 } });
    const order = await prisma.order.update({ where: { id: link.orderId }, data: { status: 'delivered', subtotal: 1000, shippingFee: 35, totalAmount: 935, codAmount: 935 } });
    await prisma.orderStatusEvent.create({ data: { orderId: order.id, status: 'delivered', createdAt: new Date(`${day}T10:00:00Z`) } });
    if (cost !== null) {
      const lot = await prisma.acquisitionCostLot.create({ data: { purchaseOrderId: po.id, purchaseOrderLineId: line.id, supplierId, skuId: sku.id, invoiceRef: `INV-${randomUUID().slice(0, 8)}`, quantity: 2, unitCost: cost, idempotencyKey: randomUUID(), capturedBy: admin.id, capturedAt: new Date(`${day}T11:00:00Z`) } });
      lotIds.push(lot.id);
    }
    await prisma.orderCostRecord.create({ data: { orderId: order.id, ...(opts.courier !== undefined || courier ? { courierCost: courier, courierRecordedBy: 'test', courierRecordedAt: new Date(`${day}T12:00:00Z`) } : {}), ...(packaging !== null ? { packagingType: 'BAG', packagingCost: packaging, packagingRecordedBy: 'test', packagingRecordedAt: new Date(`${day}T12:00:00Z`) } : {}) } });
    let batchId: string | undefined;
    if (settled) {
      const counted = opts.counted ?? 935;
      const batch = await prisma.courierSettlementBatch.create({ data: { reference: `CPP-${randomUUID()}`, courierId: randomUUID(), totalExpected: 935, totalCollected: counted, totalDeclared: 935, variance: counted - 935, fees: 0, netSettled: counted, currency: 'EGP', actorId: admin.id, settledAt: new Date(`${day}T15:00:00Z`) } });
      batchId = batch.id;
      await prisma.paymentCollection.create({ data: { orderId: order.id, expectedAmount: 935, collectedAmount: counted, declaredAmount: 935, currency: 'EGP', status: 'settled', settlementBatchId: batch.id } });
    } else {
      await prisma.paymentCollection.create({ data: { orderId: order.id, expectedAmount: 935, declaredAmount: 935, declaredAt: new Date(`${day}T14:00:00Z`), currency: 'EGP', status: 'collected' } });
    }
    cleanups.push(async () => {
      await prisma.paymentCollection.deleteMany({ where: { orderId: order.id } });
      if (batchId) await prisma.courierSettlementBatch.deleteMany({ where: { id: batchId } });
      await prisma.orderCostRecord.deleteMany({ where: { orderId: order.id } });
      await prisma.orderStatusEvent.deleteMany({ where: { orderId: order.id } });
    });
    return { order, orderNumber: order.orderNumber };
  }

  const statement = async (period: string, as: Actor = partner) => (await api().get(`/capital-partner/statements/${period}`).set(as.auth).expect(200)).body;
  const overview = async (from: string, to: string) => (await api().get(`/capital-partner/overview?from=${from}&to=${to}`).set(partner.auth).expect(200)).body;
  const record = (body: Record<string, unknown>) => api().post('/operations/finance/capital-partner/entries').set(admin.auth).send({ idempotencyKey: randomUUID(), reference: 'Bank transfer', paidOn: '2024-12-01', ...body });
  const setPercent = (value: number | null) => value === null
    ? api().post('/operations/settings/finance.profit_share_percent/reset').set(admin.auth)
    : api().patch('/operations/settings').set(admin.auth).send({ changes: { 'finance.profit_share_percent': value } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    admin = await createActor(prisma, 'ADMIN');
    hub = await createActor(prisma, 'HUB_OPERATOR');
    customer = await createActor(prisma, 'CUSTOMER');
    partner = await createActor(prisma, 'CAPITAL_PARTNER');
    stranger = await createActor(prisma, 'CAPITAL_PARTNER');
    partnerAccount = partner.id;
    supplierId = (await prisma.supplier.create({ data: { name: `Partner ${randomUUID()}`, slug: `partner-${randomUUID()}` } })).id;
    // The suite owns "the" active partner: any leftover from an interrupted run is deactivated first.
    await prisma.capitalPartner.updateMany({ where: { isActive: true }, data: { isActive: false } });
  }, 120000);

  afterAll(async () => {
    await prisma.capitalPartnerEntry.deleteMany({ where: { partner: { accountId: { in: [partner.id, stranger.id] } } } });
    await prisma.capitalPartner.deleteMany({ where: { accountId: { in: [partner.id, stranger.id] } } });
    await prisma.financePeriodClose.deleteMany({ where: { period: { in: PERIODS } } });
    await prisma.financeExpense.deleteMany({ where: { id: { in: expenseIds } } });
    await prisma.acquisitionCostLot.deleteMany({ where: { id: { in: lotIds } } });
    for (const cleanup of cleanups.reverse()) await cleanup().catch(() => undefined);
    await setPercent(null).catch(() => undefined);
    await app.close();
  });

  it('keeps the portal to the capital partner: everyone else, and an undesignated partner login, is refused', async () => {
    const paths = ['me', 'overview', 'movements', 'statements', 'statements/2024-06'];
    for (const path of paths) {
      await api().get(`/capital-partner/${path}`).expect(401);
      for (const actor of [admin, hub, customer]) await api().get(`/capital-partner/${path}`).set(actor.auth).expect(403);
      // Holds the role but no active partner profile yet.
      const res = await api().get(`/capital-partner/${path}`).set(partner.auth).expect(403);
      expect(res.body.code ?? res.body.message?.code).toBe('NOT_A_CAPITAL_PARTNER');
    }
  });

  it('designates exactly one partner (an Admin cannot be one, a second partner is refused)', async () => {
    await api().put('/operations/finance/capital-partner').set(partner.auth).send({ accountId: partner.id, displayName: 'Partner' }).expect(403);
    await api().put('/operations/finance/capital-partner').set(hub.auth).send({ accountId: partner.id, displayName: 'Partner' }).expect(403);
    await api().put('/operations/finance/capital-partner').set(admin.auth).send({ accountId: customer.id, displayName: 'No role' }).expect(400);
    await api().put('/operations/finance/capital-partner').set(admin.auth).send({ accountId: partner.id, displayName: 'شريك رأس المال' }).expect(200);
    await api().put('/operations/finance/capital-partner').set(admin.auth).send({ accountId: stranger.id, displayName: 'Second' }).expect(409);
    const me = (await api().get('/capital-partner/me').set(partner.auth).expect(200)).body;
    expect(me).toMatchObject({ displayName: 'شريك رأس المال', split: { platformPercent: 40, partnerPercent: 60 } });
    // The second login still has no profile → still refused.
    await api().get('/capital-partner/overview').set(stranger.auth).expect(403);
  });

  it('role rules: a capital partner can also be a Hub operator, never an Admin', async () => {
    const make = (roles: string[]) => api().post('/operations/staff').set(admin.auth).send({ name: 'Role Test', email: `rt-${randomUUID()}@fixtures.test`, password: 'Sup3rSecret!pass', roles });
    await make(['CAPITAL_PARTNER', 'ADMIN']).expect(400);
    const dual = (await make(['CAPITAL_PARTNER', 'HUB_OPERATOR']).expect(201)).body;
    expect(dual.roles.sort()).toEqual(['CAPITAL_PARTNER', 'HUB_OPERATOR']);
    await prisma.session.deleteMany({ where: { customerId: dual.id } }); await prisma.identity.deleteMany({ where: { customerId: dual.id } }); await prisma.notificationOutbox.deleteMany({ where: { aggregateId: dual.id } }); await prisma.customer.delete({ where: { id: dual.id } });
    const { assertRoleCombination } = await import('../../src/modules/accounts/services/staff-management.service');
    expect(() => assertRoleCombination(['CAPITAL_PARTNER', 'ADMIN'] as any, null)).toThrow();
    expect(() => assertRoleCombination(['CAPITAL_PARTNER', 'HUB_OPERATOR'] as any, null)).not.toThrow();
    expect(() => assertRoleCombination(['CAPITAL_PARTNER'] as any, null)).not.toThrow();
  });

  it('REFERENCE SCENARIO: 1,000 sales, 100 coupon, 35 delivery fee, cost 700, courier 25, packaging 10 → profit 200 = 80 platform + 120 partner', async () => {
    const o = await deliveredOrder('2024-06-15');
    const s = await statement('2024-06');
    expect(s).toMatchObject({ period: '2024-06', status: 'COMPLETE', deliveredOrders: 1, settlement: 'DUE', closed: null });
    expect(s.sales).toMatchObject({ grossSales: 1000, discounts: 100, netSales: 900, deliveryRevenue: 35 });
    expect(s.costs).toMatchObject({ products: 700, delivery: 25, packaging: 10, confirmedDamages: 0, directCosts: 0, total: 735 });
    expect(s.distributableProfit).toBe(200);
    expect(s.split).toMatchObject({ platformPercent: 40, platformShare: 80, partnerPercent: 60, partnerShare: 120, partnerShareNow: 120 });
    expect(s.profitPayout).toMatchObject({ paid: 0, remaining: 120, payableNow: 120 });
    // Capital recovered is its own number and is NOT part of the profit: cost 735 of a settled order.
    expect(s.capital.recoveredFromSettledOrders).toBe(735);
    expect(s.orders).toHaveLength(1);
    expect(s.orders[0]).toMatchObject({ orderNumber: o.orderNumber, netGoods: 900, productCost: 700, deliveryCost: 25, packaging: 10, profit: 200, cash: 'SETTLED' });

    // The portal and Admin Finance are the same numbers.
    const adminMonth = (await api().get('/operations/finance/profit?month=2024-06').set(admin.auth).expect(200)).body;
    expect(adminMonth.distributableProfit).toBe(s.distributableProfit);
    expect(adminMonth.split).toMatchObject({ platformShare: s.split.platformShare, partnerShare: s.split.partnerShare });
    expect(adminMonth.costs).toMatchObject({ products: 700, delivery: 25, packaging: 10 });
    const adminSummary = (await api().get('/operations/finance/summary?from=2024-06-01&to=2024-06-30').set(admin.auth).expect(200)).body;
    expect(adminSummary.distributableProfit).toBe(200);

    // The portal never exposes the customer.
    const text = JSON.stringify(s);
    for (const secret of ['Portal fixture', '01012345678', 'Local fixture']) expect(text).not.toContain(secret);
  });

  it('overview: capital funded / returned / outstanding stay apart from profit, and match the movements page', async () => {
    const o = await overview('2024-06', '2024-06');
    expect(o.capital.funded).toMatchObject({ total: 735, products: 700, directCosts: { total: 35, delivery: 25, packaging: 10, approvedExpenses: 0 } });
    expect(o.capital.returned).toBe(0);
    expect(o.profit).toMatchObject({ status: 'COMPLETE', distributableProfit: 200, platformShare: 80, partnerShare: 120, paid: 0, remaining: 120, payableNow: 120 });
    expect(o.months).toHaveLength(1);
    expect(o.months[0]).toMatchObject({ period: '2024-06', settlement: 'DUE', partnerShare: 120 });
    expect(o.cash.settlements).toMatchObject({ counted: 935, declared: 935, variance: 0, count: 1 });
    expect(o.capital.unresolvedGoods.status).toMatch(/AVAILABLE|INCOMPLETE|NO_DATA/);

    const m = (await api().get('/capital-partner/movements?from=2024-06-01&to=2024-06-30&limit=200').set(partner.auth).expect(200)).body;
    const types = m.items.map((item: any) => item.type).sort();
    expect(types).toEqual(['CASH_SETTLEMENT', 'DELIVERY_COST', 'PACKAGING_COST', 'PURCHASE']);
    expect(m.totals.funded).toBe(o.capital.funded.total);
    // No double counting: every movement id is unique and every source record gives exactly one.
    expect(new Set(m.items.map((item: any) => item.id)).size).toBe(m.items.length);
    for (const item of m.items) expect(item).toMatchObject({ effect: expect.any(String), status: expect.any(String), source: expect.any(String) });
    const purchase = m.items.find((item: any) => item.type === 'PURCHASE');
    expect(purchase).toMatchObject({ amount: 700, status: 'FUNDED', source: 'SUPPLIER_INVOICE', effect: 'FUNDED' });
    const detail = (await api().get(`/capital-partner/movements/${purchase.id}`).set(partner.auth).expect(200)).body;
    expect(detail).toMatchObject({ id: purchase.id, amount: 700, details: { quantity: 2, unitCost: 350 } });
    await api().get(`/capital-partner/movements/${randomUUID()}`).set(partner.auth).expect(404);
    await api().get(`/capital-partner/movements/purchase:${randomUUID()}`).set(partner.auth).expect(404);

    // Filters and search.
    expect((await api().get('/capital-partner/movements?from=2024-06-01&to=2024-06-30&type=DELIVERY_COST').set(partner.auth).expect(200)).body.items).toHaveLength(1);
    expect((await api().get('/capital-partner/movements?from=2024-06-01&to=2024-06-30&status=SETTLED').set(partner.auth).expect(200)).body.items).toHaveLength(1);
    const order = (await statement('2024-06')).orders[0].orderNumber;
    expect((await api().get(`/capital-partner/movements?from=2024-06-01&to=2024-06-30&q=${order}`).set(partner.auth).expect(200)).body.items).toHaveLength(2);
    await api().get('/capital-partner/movements?type=BONUS').set(partner.auth).expect(400);
    await api().get('/capital-partner/movements?from=2020-01-01&to=2024-06-30').set(partner.auth).expect(400);
    await api().get('/capital-partner/overview?from=2023-01&to=2024-06').set(partner.auth).expect(400);
    await api().get('/capital-partner/statements/2099-01').set(partner.auth).expect(400);
  });

  it('pays profit and returns capital separately; never twice, never above what is payable', async () => {
    const key = randomUUID();
    const first = (await record({ kind: 'PROFIT_PAYOUT', amount: 50, period: '2024-06', idempotencyKey: key }).expect(201)).body;
    expect(first).toMatchObject({ kind: 'PROFIT_PAYOUT', amount: 50, period: '2024-06', alreadyRecorded: false });
    // A retried request is the same payment.
    const again = (await record({ kind: 'PROFIT_PAYOUT', amount: 50, period: '2024-06', idempotencyKey: key }).expect(201)).body;
    expect(again).toMatchObject({ id: first.id, alreadyRecorded: true });
    await record({ kind: 'PROFIT_PAYOUT', amount: 60, period: '2024-06', idempotencyKey: key }).expect(409);
    expect(await prisma.capitalPartnerEntry.count({ where: { idempotencyKey: key } })).toBe(1);

    // Only 70 is left of the 120.
    const over = await record({ kind: 'PROFIT_PAYOUT', amount: 100, period: '2024-06' }).expect(409);
    expect(over.body.code ?? over.body.message?.code).toBe('PAYOUT_EXCEEDS_PAYABLE');
    let s = await statement('2024-06');
    expect(s.settlement).toBe('PARTIAL');
    expect(s.profitPayout).toMatchObject({ paid: 50, remaining: 70, payableNow: 70 });

    await record({ kind: 'PROFIT_PAYOUT', amount: 70, period: '2024-06' }).expect(201);
    s = await statement('2024-06');
    expect(s.settlement).toBe('PAID');
    expect(s.profitPayout).toMatchObject({ paid: 120, remaining: 0, payableNow: 0 });
    expect(s.payouts).toHaveLength(2);

    // Capital: 735 funded, a return of 300 changes the capital numbers and not one profit number.
    const ret = (await record({ kind: 'CAPITAL_RETURN', amount: 300 }).expect(201)).body;
    expect(ret).toMatchObject({ kind: 'CAPITAL_RETURN', amount: 300, period: null });
    const june = await overview('2024-06', '2024-06');
    expect(june.capital.returned).toBe(0); // dated 2024-12-01: outside the June window
  });

  it('keeps capital recovery out of the profit and bounds a return by what is still outstanding', async () => {
    const o = await overview('2024-06', '2024-06');
    expect(o.profit).toMatchObject({ distributableProfit: 200, partnerShare: 120, paid: 120, remaining: 0 });
    const lifetime = o.capital.lifetime;
    expect(lifetime.returned - 300).toBeGreaterThanOrEqual(0);
    expect(o.capital.notReturnedYet).toBeCloseTo(lifetime.funded - lifetime.returned, 2);
    const tooMuch = await record({ kind: 'CAPITAL_RETURN', amount: lifetime.outstanding + 1 }).expect(409);
    expect(tooMuch.body.code ?? tooMuch.body.message?.code).toBe('RETURN_EXCEEDS_OUTSTANDING');
    // The return is dated 2024-12-01: that month's movements list it, as a capital return and not as profit.
    const moves = (await api().get('/capital-partner/movements?from=2024-12-01&to=2024-12-31&type=CAPITAL_RETURN').set(partner.auth).expect(200)).body;
    expect(moves.items).toHaveLength(1);
    expect(moves.items[0]).toMatchObject({ amount: 300, status: 'PAID', effect: 'RETURNED', source: 'PARTNER_LEDGER' });
    expect(moves.totals).toMatchObject({ capitalReturned: 300, profitPaid: 0 });
    const december = await overview('2024-12', '2024-12');
    expect(december.capital.returned).toBe(300);
    expect(december.profit.paid).toBe(0);
  });

  it('validates a payment and refuses what is not payable', async () => {
    await record({ kind: 'PROFIT_PAYOUT', amount: 10 }).expect(400); // no month
    await record({ kind: 'PROFIT_PAYOUT', amount: 10, period: '2024-13' }).expect(400);
    await record({ kind: 'PROFIT_PAYOUT', amount: 0, period: '2024-06' }).expect(400);
    await record({ kind: 'PROFIT_PAYOUT', amount: 10.123, period: '2024-06' }).expect(400);
    await record({ kind: 'CAPITAL_RETURN', amount: 10, paidOn: '2999-01-01' }).expect(400);
    await record({ kind: 'CAPITAL_RETURN', amount: 10, paidOn: '2024-02-30' }).expect(400);
    await record({ kind: 'GIFT', amount: 10 }).expect(400);
    await record({ kind: 'PROFIT_PAYOUT', amount: 10, period: '2024-06' , idempotencyKey: 'not-a-uuid' }).expect(400);
    // Nobody but an Admin records money.
    for (const actor of [partner, hub, customer]) await api().post('/operations/finance/capital-partner/entries').set(actor.auth).send({ kind: 'CAPITAL_RETURN', amount: 5, paidOn: '2024-12-01', reference: 'x1', idempotencyKey: randomUUID() }).expect(403);
    await api().get('/operations/finance/capital-partner').set(partner.auth).expect(403);
    await api().get('/operations/finance/capital-partner/entries').set(partner.auth).expect(403);
  });

  it('voids instead of editing: a voided payment stops counting and the void is idempotent', async () => {
    const entry = (await record({ kind: 'CAPITAL_RETURN', amount: 5 }).expect(201)).body;
    await api().post(`/operations/finance/capital-partner/entries/${entry.id}/void`).set(partner.auth).send({ reason: 'wrong entry' }).expect(403);
    await api().post(`/operations/finance/capital-partner/entries/${entry.id}/void`).set(admin.auth).send({ reason: 'x' }).expect(400);
    await api().post(`/operations/finance/capital-partner/entries/${entry.id}/void`).set(admin.auth).send({ reason: 'Entered by mistake' }).expect(201);
    await api().post(`/operations/finance/capital-partner/entries/${entry.id}/void`).set(admin.auth).send({ reason: 'Entered by mistake' }).expect(201);
    const december = await overview('2024-12', '2024-12');
    expect(december.capital.returned).toBe(300); // the 5 no longer counts
    const listed = (await api().get('/capital-partner/movements?from=2024-12-01&to=2024-12-31&type=CAPITAL_RETURN').set(partner.auth).expect(200)).body;
    expect(listed.items.find((item: any) => item.id === `capital-return:${entry.id}`)).toMatchObject({ status: 'VOIDED', effect: 'INFO' });
    expect(listed.totals.capitalReturned).toBe(300);
  });

  it('a month with a missing cost or an unapproved direct cost shows a pending state, never an estimate', async () => {
    await deliveredOrder('2024-07-10');
    await deliveredOrder('2024-07-11', { cost: null as any }); // purchase cost never recorded
    let s = await statement('2024-07');
    expect(s.status).toBe('INCOMPLETE');
    expect(s.settlement).toBe('PENDING');
    expect(s.distributableProfit).toBeNull();
    expect(s.split.partnerShare).toBeNull();
    expect(s.profitPayout.payableNow).toBeNull();
    expect(s.missing).toEqual(expect.arrayContaining([{ code: 'PURCHASE_COST', orders: 1 }]));
    const refused = await record({ kind: 'PROFIT_PAYOUT', amount: 10, period: '2024-07' }).expect(409);
    expect(refused.body.code ?? refused.body.message?.code).toBe('PERIOD_INCOMPLETE');
    const o = await overview('2024-06', '2024-07');
    expect(o.profit.status).toBe('INCOMPLETE');
    expect(o.profit.incompleteMonths).toEqual(['2024-07']);
    expect(o.profit.partnerShare).toBe(120); // only the complete month adds up
    // Never a number while a sold order lacks its cost (NO_DATA when the database also holds data older than the 36-month window).
    expect(o.capital.unresolvedGoods.amount).toBeNull();
    expect(o.capital.unresolvedGoods.status).toMatch(/INCOMPLETE|NO_DATA/);

    // Direct costs: waiting for approval = shown, not counted; approved = funded and deducted.
    await deliveredOrder('2024-08-12');
    const direct = (await api().post('/operations/finance/expenses').set(admin.auth).send({ category: 'SUPPLIES', description: 'Sample kits', amount: 50, incurredOn: '2024-08-13', kind: 'DIRECT' }).expect(201)).body;
    const platform = (await api().post('/operations/finance/expenses').set(admin.auth).send({ category: 'SOFTWARE', description: 'Hosting', amount: 999, incurredOn: '2024-08-14' }).expect(201)).body;
    expenseIds.push(direct.id, platform.id);
    s = await statement('2024-08');
    expect(s.status).toBe('INCOMPLETE');
    let o8 = await overview('2024-08', '2024-08');
    expect(o8.capital.pendingApprovalDirectCosts).toEqual({ amount: 50, count: 1 });
    expect(o8.capital.funded.directCosts.approvedExpenses).toBe(0);
    await api().post(`/operations/finance/expenses/${direct.id}/approve`).set(admin.auth).expect(201);
    s = await statement('2024-08');
    expect(s.status).toBe('COMPLETE');
    expect(s.costs.directCosts).toBe(50);
    expect(s.distributableProfit).toBe(150);
    expect(s.split).toMatchObject({ platformShare: 60, partnerShare: 90 });
    o8 = await overview('2024-08', '2024-08');
    expect(o8.capital.pendingApprovalDirectCosts.count).toBe(0);
    expect(o8.capital.funded.directCosts).toMatchObject({ approvedExpenses: 50 });
    expect(o8.capital.funded.total).toBe(785);
    // The platform's own expense is not the partner's business: not funded, not listed, not deducted.
    const all = (await api().get('/capital-partner/movements?from=2024-08-01&to=2024-08-31&limit=200').set(partner.auth).expect(200)).body;
    expect(JSON.stringify(all)).not.toContain('Hosting');
    expect(all.items.find((item: any) => item.type === 'DIRECT_EXPENSE')).toMatchObject({ amount: 50, status: 'APPROVED', effect: 'FUNDED' });
  });

  it('cash: counted, declared and unsettled stay apart from profit; a counted shortage belongs to the settlement', async () => {
    // 2024-09: one order settled with a SHORT count (declared 935, counted 900), one still with the courier.
    await deliveredOrder('2024-09-10', { counted: 900 });
    await deliveredOrder('2024-09-11', { settled: false });
    const m = (await api().get('/capital-partner/movements?from=2024-09-01&to=2024-09-30&limit=200').set(partner.auth).expect(200)).body;
    const settlement = m.items.find((item: any) => item.type === 'CASH_SETTLEMENT');
    expect(settlement).toMatchObject({ amount: 900, status: 'SHORT', details: { counted: 900, declared: 935, variance: -35 } });
    const pending = m.items.find((item: any) => item.type === 'CASH_PENDING');
    expect(pending).toMatchObject({ amount: 935, status: 'UNSETTLED', effect: 'INFO' });
    const s = await statement('2024-09');
    // Profit is accounting profit (400); only the order whose cash was counted is payable now (200 → partner 120).
    expect(s.distributableProfit).toBe(400);
    expect(s.pendingCollection.orders).toBe(1);
    expect(s.split).toMatchObject({ partnerShare: 240, partnerShareNow: 120 });
    expect(s.profitPayout).toMatchObject({ remaining: 240, payableNow: 120 });
    expect(s.settlement).toBe('DUE');
    const o = await overview('2024-09', '2024-09');
    expect(o.cash.settlements).toMatchObject({ counted: 900, declared: 935, variance: -35 });
    expect(o.cash.inCourierCustody.amount).toBeGreaterThanOrEqual(935);
    const over = await record({ kind: 'PROFIT_PAYOUT', amount: 120.01, period: '2024-09' }).expect(409);
    expect(over.body.payableNow ?? over.body.message?.payableNow).toBe(120);
  });

  it('closing a month freezes its split: changing the percentage afterwards never touches it', async () => {
    // 2024-06 is complete, ended and fully counted: close it at 40%.
    const closed = (await api().post('/operations/finance/profit/2024-06/close').set(admin.auth).expect(201)).body;
    expect(closed.split.platformPercent).toBe(40);
    await setPercent(30).expect(200);
    try {
      const june = await statement('2024-06');
      expect(june.closed).not.toBeNull();
      expect(june.split).toMatchObject({ platformPercent: 40, platformShare: 80, partnerPercent: 60, partnerShare: 120 });
      expect(june.profitPayout.paid).toBe(120);
      // An open month uses the new 30 / 70 split on the same reference numbers.
      await deliveredOrder('2024-10-10');
      const october = await statement('2024-10');
      expect(october.closed).toBeNull();
      expect(october.distributableProfit).toBe(200);
      expect(october.split).toMatchObject({ platformPercent: 30, platformShare: 60, partnerPercent: 70, partnerShare: 140 });
      const me = (await api().get('/capital-partner/me').set(partner.auth).expect(200)).body;
      expect(me.split).toMatchObject({ platformPercent: 30, partnerPercent: 70 });
      // Admin Finance and the portal still agree on both.
      expect((await api().get('/operations/finance/profit?month=2024-06').set(admin.auth).expect(200)).body.split.partnerShare).toBe(120);
      expect((await api().get('/operations/finance/profit?month=2024-10').set(admin.auth).expect(200)).body.split.partnerShare).toBe(140);
    } finally {
      await setPercent(null).expect(201);
    }
  });

  it('returns, confirmed damage and cancelled orders are shown for what they are', async () => {
    const day = '2024-11-12';
    const sold = await deliveredOrder(day);
    // A sealed return: back in stock. Its cost is unknown on this basis, so no amount is invented.
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: sold.order.id } });
    const location = await prisma.fulfillmentLocation.create({ data: { name: `CPP Hub ${randomUUID()}`, address: '1 Test Street' } });
    const receipt = await prisma.returnReceipt.create({ data: {
      locationId: location.id, resolutionId: randomUUID(), orderId: sold.order.id, orderItemId: item.id, skuId: item.skuId, quantity: 1, identityMethod: 'BARCODE', inspectionResult: 'SEALED_INTACT',
      disposition: 'RETURN_TO_SUPPLIER', idempotencyKey: randomUUID(), actorId: admin.id, receivedAt: new Date(`${day}T16:00:00Z`),
    } });
    // A cancelled order after its goods were bought: recoverable, with one confirmed damage of 40.
    const cancelled = await deliveredOrder(day);
    await prisma.order.update({ where: { id: cancelled.order.id }, data: { status: 'cancelled' } });
    await prisma.orderStatusEvent.deleteMany({ where: { orderId: cancelled.order.id } });
    await prisma.orderStatusEvent.create({ data: { orderId: cancelled.order.id, status: 'cancelled', createdAt: new Date(`${day}T18:00:00Z`) } });
    await prisma.orderCostRecord.update({ where: { orderId: cancelled.order.id }, data: { damagedAmount: 40, damageReason: 'Leaked in transit', damageConfirmedBy: admin.id, damageConfirmedAt: new Date(`${day}T19:00:00Z`) } });
    cleanups.push(async () => { await prisma.returnReceipt.deleteMany({ where: { id: receipt.id } }); await prisma.fulfillmentLocation.deleteMany({ where: { id: location.id } }); });

    const m = (await api().get(`/capital-partner/movements?from=${day}&to=${day}&limit=200`).set(partner.auth).expect(200)).body;
    const byType = (type: string) => m.items.filter((item: any) => item.type === type);
    expect(byType('SOUND_RETURN')[0]).toMatchObject({ status: 'COST_MISSING', amount: null, effect: 'INFO', source: 'HUB_RETURN' });
    expect(byType('DAMAGE')[0]).toMatchObject({ amount: 40, status: 'CONFIRMED', orderNumber: cancelled.orderNumber });
    expect(byType('CANCELLED_ORDER')[0]).toMatchObject({ orderNumber: cancelled.orderNumber, status: expect.stringMatching(/RECOVERABLE|COST_MISSING/), effect: 'INFO' });
    const s = await statement('2024-11');
    expect(s.costs.confirmedDamages).toBe(40);
    expect(s.endedOrders.map((row: any) => row.orderNumber)).toContain(cancelled.orderNumber);
    // The damage is a cost of the month, the recoverable goods are not.
    expect(s.distributableProfit).toBe(200 - 25 - 10 /* cancelled order's own courier + packaging */ - 40);
    const detail = (await api().get(`/capital-partner/movements/${byType('DAMAGE')[0].id}`).set(partner.auth).expect(200)).body;
    expect(detail.details.reason).toBe('Leaked in transit');
  });

  it('IDOR: another partner profile and its payments are invisible, and ids are never trusted', async () => {
    const other = await prisma.capitalPartner.create({ data: { accountId: stranger.id, displayName: 'Other', isActive: false, createdBy: admin.id } });
    const foreign = await prisma.capitalPartnerEntry.create({ data: { partnerId: other.id, kind: 'CAPITAL_RETURN', amount: 777, paidOn: new Date('2024-12-02T00:00:00Z'), reference: 'foreign', idempotencyKey: randomUUID(), recordedBy: admin.id } });
    await api().get(`/capital-partner/movements/capital-return:${foreign.id}`).set(partner.auth).expect(404);
    await api().get(`/capital-partner/movements/profit-payout:${foreign.id}`).set(partner.auth).expect(404);
    const december = (await api().get('/capital-partner/movements?from=2024-12-01&to=2024-12-31&limit=200').set(partner.auth).expect(200)).body;
    expect(JSON.stringify(december)).not.toContain(foreign.id);
    expect(december.totals).toMatchObject({ capitalReturned: 300, profitPaid: 120 });
    // The inactive profile's own login cannot read anything either.
    for (const path of ['overview', 'movements', 'statements']) await api().get(`/capital-partner/${path}`).set(stranger.auth).expect(403);
    // Nothing in the API accepts a partner id: a forged query parameter is ignored.
    const forged = (await api().get(`/capital-partner/overview?from=2024-12&to=2024-12&partnerId=${other.id}&accountId=${stranger.id}`).set(partner.auth).expect(200)).body;
    expect(forged.capital.returned).toBe(300);
  });

  it('the admin ledger lists what was recorded and nothing is paid to an Admin-less partner', async () => {
    const admins = (await api().get('/operations/finance/capital-partner').set(admin.auth).expect(200)).body;
    expect(admins.partner).toMatchObject({ displayName: 'شريك رأس المال', accountId: partnerAccount });
    expect(admins.balances.funded).toBeGreaterThan(0);
    expect(admins.balances.funded - admins.balances.returned).toBe(admins.balances.outstanding);
    const entries = (await api().get('/operations/finance/capital-partner/entries').set(admin.auth).expect(200)).body;
    expect(entries.filter((e: any) => !e.voided).reduce((sum: number, e: any) => sum + (e.kind === 'PROFIT_PAYOUT' ? e.amount : 0), 0)).toBe(120);
  });
});
