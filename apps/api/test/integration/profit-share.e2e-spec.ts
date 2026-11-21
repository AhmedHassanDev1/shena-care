/* eslint-disable @typescript-eslint/no-explicit-any -- HTTP response bodies are asserted structurally */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { SupplyPlanService } from '../../src/modules/sourcing/services/supply-plan.service';

/**
 * Finance profit model, end to end on real records: Buy List purchase cost (list price, discount, final unit cost), per-order courier and
 * packaging cost, a cancelled order's loss, recorded expenses, COD kept apart, INCOMPLETE until every actual cost exists, and a closed
 * month that no later setting or cost change can rewrite. The months used (2019-04, 2019-05) belong to this suite alone.
 */
describe('Finance profit share (e2e)', () => {
  const APRIL = '2019-04';
  const MAY = '2019-05';
  let app: INestApplication;
  let prisma: PrismaService;
  let plans: SupplyPlanService;
  let adminAuth: string;
  let operatorAuth: string;
  let customerAuth: string;
  const previousMode = process.env.SOURCING_MODE;
  const http = () => request(app.getHttpServer());

  const register = async (label: string) => {
    const registered = await http().post('/accounts/register').send({ name: label, email: `${label.toLowerCase().replace(/\s/g, '-')}-${randomUUID()}@example.com`, password: 'password123' }).expect(201);
    const auth = `Bearer ${registered.body.token}`;
    const user = (await http().get('/accounts/me').set('Authorization', auth).expect(200)).body;
    return { auth, id: user.id as string };
  };
  const makeSku = async (label: string) => {
    const suffix = randomUUID();
    const brand = await prisma.brand.create({ data: { name: `Profit ${suffix}`, slug: `profit-${suffix}` } });
    const product = await prisma.product.create({ data: { brandId: brand.id, name: `Profit Product ${label} ${suffix}`, slug: `profit-product-${suffix}` } });
    return prisma.sku.create({ data: { productId: product.id, code: `PF-${suffix}`, variantName: label, barcode: `PF-BAR-${suffix}` } });
  };
  /** A COD order of `quantity` units at `price` each, plus the customer's delivery fee. */
  const placeOrder = async (sku: { id: string; code: string; variantName: string }, quantity: number, price: number, shippingFee = 0) => {
    const order = await prisma.order.create({ data: {
      orderNumber: `ORD-${randomUUID().toUpperCase()}`, customerName: 'Profit Customer', customerPhone: '01012345678', shippingAddress: '1 Profit Street',
      totalAmount: quantity * price + shippingFee, shippingFee, subtotal: quantity * price, currency: 'EGP', status: 'placed', paymentMethod: 'COD',
      items: { create: [{ skuId: sku.id, quantity, price, productName: 'Profit Product', skuCode: sku.code, variantName: sku.variantName, currency: 'EGP', lineTotal: quantity * price }] },
    } });
    await plans.initiateForOrder(order.id);
    return order;
  };
  const acquire = (skuId: string, quantity: number, cost?: { listUnitPrice: number; discountPerUnit?: number }, key = randomUUID()) =>
    http().post('/buy-list/acquire').set('Authorization', operatorAuth).send({ skuId, quantity, idempotencyKey: key, ...(cost ? { cost } : {}) });
  const finish = async (orderId: string, status: 'delivered' | 'cancelled', day: string) => {
    await prisma.order.update({ where: { id: orderId }, data: { status } });
    await prisma.orderStatusEvent.create({ data: { orderId, status, createdAt: new Date(`${day}T10:00:00Z`) } });
  };
  const setSetting = (changes: Record<string, unknown>) => http().patch('/operations/settings').set('Authorization', adminAuth).send({ changes });
  const profit = (month: string) => http().get(`/operations/finance/profit?month=${month}`).set('Authorization', adminAuth);
  const recordCosts = (orderId: string, body: Record<string, unknown>, auth = operatorAuth) => http().put(`/order-costs/${orderId}`).set('Authorization', auth).send(body);

  beforeAll(async () => {
    process.env.TEST_BYPASS_AUTH = 'false';
    process.env.SOURCING_MODE = 'INTERNAL_BUY_LIST';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    plans = app.get(SupplyPlanService);

    const admin = await register('Profit Admin');
    adminAuth = admin.auth;
    await prisma.customer.update({ where: { id: admin.id }, data: { roles: ['ADMIN'] } });
    const operator = await register('Profit Operator');
    operatorAuth = operator.auth;
    await prisma.customer.update({ where: { id: operator.id }, data: { roles: ['HUB_OPERATOR'] } });
    customerAuth = (await register('Profit Customer')).auth;
    const location = await http().post('/fulfillment/locations').set('Authorization', adminAuth).send({
      name: `Profit Hub ${randomUUID()}`, address: '1 Hub Street', capabilities: ['RECEIVE_SUPPLIER_GOODS', 'PREPARE_ORDERS'],
    }).expect(201);
    await http().post(`/fulfillment/locations/${location.body.id}/operators`).set('Authorization', adminAuth).send({ operatorId: operator.id }).expect(201);

    // Leftovers of an earlier run must not leak into these private months.
    await prisma.orderStatusEvent.deleteMany({ where: { createdAt: { gte: new Date('2019-04-01'), lt: new Date('2019-06-01') } } });
    await prisma.financeExpense.deleteMany({ where: { incurredOn: { gte: new Date('2019-04-01'), lt: new Date('2019-06-01') } } });
    await prisma.financePeriodClose.deleteMany({ where: { period: { in: [APRIL, MAY] } } });
  });

  afterAll(async () => {
    for (const key of ['finance.profit_share_percent', 'commerce.packaging.bag_cost', 'commerce.packaging.box_cost']) {
      await http().post(`/operations/settings/${encodeURIComponent(key)}/reset`).set('Authorization', adminAuth);
    }
    if (previousMode === undefined) delete process.env.SOURCING_MODE; else process.env.SOURCING_MODE = previousMode;
    await app.close();
  });

  it('keeps the profit-share percentage configurable (default 40) and validates packaging costs and the percentage', async () => {
    const settings = (await http().get('/operations/settings').set('Authorization', adminAuth).expect(200)).body as Array<{ key: string; value: unknown; defaultValue: unknown }>;
    expect(settings.find(s => s.key === 'finance.profit_share_percent')).toMatchObject({ value: 40, defaultValue: 40 });
    await setSetting({ 'finance.profit_share_percent': 120 }).expect(400);
    await setSetting({ 'commerce.packaging.bag_cost': -1 }).expect(400);
    await setSetting({ 'commerce.packaging.bag_cost': 5, 'commerce.packaging.box_cost': 12 }).expect(200);
  });

  it('records Buy List purchase cost: list price, discount and final unit cost, later or with the count, corrected only with a reason', async () => {
    const sku = await makeSku('Cost Entry');
    await placeOrder(sku, 3, 100);
    const key = randomUUID();
    await acquire(sku.id, 2, { listUnitPrice: 50, discountPerUnit: 50 }, key).expect(400); // discount must stay below the list price
    await acquire(sku.id, 2, undefined, key).expect(200); // counted without a cost: it stays pending, never zero
    const pending = (await http().get('/buy-list/costs?pending=true').set('Authorization', operatorAuth).expect(200)).body;
    expect(pending.items.find((row: any) => row.acquireKey === key)).toMatchObject({ skuId: sku.id, quantity: 2, cost: null });

    const recorded = await http().post('/buy-list/costs').set('Authorization', operatorAuth).send({ acquireKey: key, listUnitPrice: 80, discountPerUnit: 12.5 }).expect(200);
    expect(recorded.body.cost).toMatchObject({ listUnitPrice: '80.00', discountPerUnit: '12.50', finalUnitCost: '67.50', version: 1 });
    await http().post('/buy-list/costs').set('Authorization', operatorAuth).send({ acquireKey: key, listUnitPrice: 80, discountPerUnit: 12.5 }).expect(200); // replay
    await http().post('/buy-list/costs').set('Authorization', operatorAuth).send({ acquireKey: key, listUnitPrice: 90 }).expect(409); // different value: correct it instead
    await http().post('/buy-list/costs').set('Authorization', operatorAuth).send({ acquireKey: randomUUID(), listUnitPrice: 10 }).expect(404);

    await http().post('/buy-list/costs/correct').set('Authorization', operatorAuth).send({ acquireKey: key, listUnitPrice: 70, discountPerUnit: 0, expectedVersion: 7, reason: 'invoice reread' }).expect(409);
    await http().post('/buy-list/costs/correct').set('Authorization', operatorAuth).send({ acquireKey: key, listUnitPrice: 70, discountPerUnit: 0, expectedVersion: 1, reason: 'x' }).expect(400);
    const corrected = await http().post('/buy-list/costs/correct').set('Authorization', operatorAuth).send({ acquireKey: key, listUnitPrice: 70, discountPerUnit: 0, expectedVersion: 1, reason: 'invoice reread' }).expect(200);
    expect(corrected.body.cost).toMatchObject({ finalUnitCost: '70.00', version: 2 });
    const batch = await prisma.purchaseCostBatch.findUniqueOrThrow({ where: { acquireKey: key } });
    expect(batch.history).toEqual([expect.objectContaining({ version: 1, finalUnitCost: '67.50', reason: 'invoice reread' })]);

    // Only Hub staff and Admin reach these routes.
    await http().get('/buy-list/costs').set('Authorization', customerAuth).expect(403);
    await http().post('/buy-list/costs').set('Authorization', customerAuth).send({ acquireKey: key, listUnitPrice: 1 }).expect(403);
  });

  it('is INCOMPLETE until every actual cost exists, then applies the owner profit model and keeps cash apart', async () => {
    const goods = await makeSku('Sold');
    const lostGoods = await makeSku('Lost');
    const sold = await placeOrder(goods, 2, 200, 30); // 400 of goods + 30 delivery fee paid by the customer
    const cancelled = await placeOrder(lostGoods, 1, 150);
    await acquire(goods.id, 2, { listUnitPrice: 100, discountPerUnit: 10 }).expect(200); // final 90 x 2 = 180
    await acquire(lostGoods.id, 1, { listUnitPrice: 60 }).expect(200); // 60 bought for an order that will be cancelled
    await finish(sold.id, 'delivered', '2019-04-10');
    await finish(cancelled.id, 'cancelled', '2019-04-12');
    // A platform expense (never shared) and a direct cost (shared, but only once approved).
    await http().post('/operations/finance/expenses').set('Authorization', adminAuth).send({ category: 'OTHER', description: 'Platform hosting', amount: 100, incurredOn: '2019-04-05' }).expect(201);
    const direct = (await http().post('/operations/finance/expenses').set('Authorization', adminAuth).send({ category: 'SUPPLIES', description: 'Direct: sample kits', amount: 40, incurredOn: '2019-04-06', kind: 'DIRECT' }).expect(201)).body;
    expect(direct).toMatchObject({ kind: 'DIRECT', approved: false });
    await prisma.paymentCollection.create({ data: { orderId: sold.id, expectedAmount: 430, declaredAmount: 430, collectedAmount: null, currency: 'EGP', status: 'collected' } });

    // Purchase cost is in, but the courier and the packaging actually used are not, and the direct cost is not approved: no silent zero.
    const before = (await profit(APRIL).expect(200)).body;
    expect(before).toMatchObject({ status: 'INCOMPLETE', distributableProfit: null, split: { platformShare: null, platformPercent: 40 } });
    expect(before.missing).toEqual([{ code: 'COURIER_COST', orders: 1 }, { code: 'PACKAGING_COST', orders: 1 }, { code: 'DIRECT_COST_APPROVAL', orders: 1 }]);
    expect(before.needsCost[0]).toMatchObject({ orderId: sold.id, missing: ['COURIER_COST', 'PACKAGING_COST'] });
    const queue = (await http().get('/order-costs/pending').set('Authorization', operatorAuth).expect(200)).body;
    expect(queue.items.find((row: any) => row.orderId === sold.id)).toMatchObject({ missing: ['courier', 'packaging'], customerDeliveryFee: '30.00' });

    // Hub staff record the packaging type (cost is the configured cost at that moment) and the actual courier cost.
    const box = await recordCosts(sold.id, { packagingType: 'BOX', courierCost: 50 }).expect(200);
    expect(box.body).toMatchObject({ packagingType: 'BOX', packagingCost: '12.00', courierCost: '50.00' });
    await recordCosts(sold.id, { packagingType: 'BOX', courierCost: 50 }).expect(200); // same values: replay
    await recordCosts(sold.id, { courierCost: 60 }).expect(409); // a Hub operator cannot overwrite
    await recordCosts(sold.id, { courierCost: 60 }, adminAuth).expect(400); // an Admin needs a reason
    await recordCosts(sold.id, { packagingType: 'BAG', courierCost: 50, reason: 'switched to a bag' }, adminAuth).expect(200); // bag = 5.00
    const record = await prisma.orderCostRecord.findUniqueOrThrow({ where: { orderId: sold.id } });
    expect(record.corrections).toEqual([expect.objectContaining({ reason: 'switched to a bag' })]);
    await recordCosts(sold.id, { courierCost: 1 }, customerAuth).expect(403);

    // The direct cost needs an Admin; a Hub operator cannot approve and a platform expense can never be approved.
    await http().post(`/operations/finance/expenses/${direct.id}/approve`).set('Authorization', operatorAuth).expect(403);
    await http().post(`/operations/finance/expenses/${direct.id}/approve`).set('Authorization', adminAuth).expect(201);
    await http().post(`/operations/finance/expenses/${direct.id}/approve`).set('Authorization', adminAuth).expect(201); // replay
    const platform = (await http().get('/operations/finance/expenses').set('Authorization', adminAuth).expect(200)).body.find((row: any) => row.description === 'Platform hosting');
    await http().post(`/operations/finance/expenses/${platform.id}/approve`).set('Authorization', adminAuth).expect(400);

    const month = (await profit(APRIL).expect(200)).body;
    // Distributable = net sales 400 + shipping revenue 30 − product cost 180 − delivery 50 − packaging 5 − damages 0 − approved direct cost 40 = 155.
    // The platform's own 100 of hosting is shown, never deducted; the 60 bought for the cancelled order is recoverable, not a loss.
    expect(month).toMatchObject({
      status: 'COMPLETE', eligibleOrders: 1, missing: [],
      revenue: { grossSales: 400, discounts: 0, netSales: 400, productRefunds: 0, netSalesAfterRefunds: 400, shippingRevenue: 30, shippingRevenueNet: 30, total: 430 },
      costs: { products: 180, delivery: 50, packaging: 5, damages: 0, directCosts: 40, total: 275 },
      delivery: { revenue: 30, cost: 50, margin: -20, estimatedOrders: 0 },
      distributableProfit: 155, platformExpenses: 100,
      split: { platformPercent: 40, platformShare: 62, partnerShare: 93 },
      capital: { recovered: 0, tiedUpInUnsettledOrders: 235, tiedUpInRecoverableGoods: 60 },
      closed: null,
    });
    // The cash has not been counted: nothing is payable yet, even though the profit is already known.
    expect(month.pendingCollection).toMatchObject({ orders: 1, profit: 195 });
    expect(month.realisedProfit).toBe(-40);
    expect(month.split).toMatchObject({ platformShareNow: 0 });
    // A month whose delivered orders still have cash with the courier cannot be frozen: the distribution must follow cash that was counted.
    const blocked = await http().post(`/operations/finance/profit/${APRIL}/close`).set('Authorization', adminAuth).expect(409);
    expect(blocked.body).toMatchObject({ code: 'PERIOD_CASH_PENDING', pendingOrders: 1 });
    // Cash is a separate position: declared by the courier, still in his hands.
    expect(month.cash.inCourierCustody).toMatchObject({ amount: expect.any(Number) });

    // Once the hub counts the cash the order is realised: the capital goes back to the partner and the profit becomes payable.
    await prisma.paymentCollection.update({ where: { orderId: sold.id }, data: { status: 'settled', collectedAmount: 430 } });
    const paid = (await profit(APRIL).expect(200)).body;
    expect(paid).toMatchObject({ pendingCollection: { orders: 0 }, realisedProfit: 155, split: { platformShareNow: 62, partnerShareNow: 93 }, capital: { recovered: 235, tiedUpInUnsettledOrders: 0 } });
  });

  it('closes a month with the percentage in force and never rewrites it when settings or costs change later', async () => {
    await profit(APRIL).expect(200);
    await http().post(`/operations/finance/profit/${APRIL}/close`).set('Authorization', operatorAuth).expect(403);
    await http().post('/operations/finance/profit/2099-01/close').set('Authorization', adminAuth).expect(409); // not ended
    const closed = (await http().post(`/operations/finance/profit/${APRIL}/close`).set('Authorization', adminAuth).expect(201)).body;
    expect(closed).toMatchObject({ alreadyClosed: false, distributableProfit: 155, split: { platformShare: 62, partnerShare: 93, platformPercent: 40 } });
    expect(closed.closed.at).toBeDefined();

    // Later: a new percentage, a new packaging price and a corrected purchase cost.
    await setSetting({ 'finance.profit_share_percent': 50, 'commerce.packaging.bag_cost': 9 }).expect(200);
    const batch = await prisma.purchaseCostBatch.findFirstOrThrow({ where: { listUnitPrice: 100 } });
    await http().post('/buy-list/costs/correct').set('Authorization', operatorAuth).send({ acquireKey: batch.acquireKey, listUnitPrice: 100, discountPerUnit: 0, expectedVersion: batch.version, reason: 'late invoice correction' }).expect(200);

    const frozen = (await profit(APRIL).expect(200)).body;
    expect(frozen).toMatchObject({ distributableProfit: 155, split: { platformShare: 62, platformPercent: 40 } });
    expect(frozen.costs.products).toBe(180);
    const again = (await http().post(`/operations/finance/profit/${APRIL}/close`).set('Authorization', adminAuth).expect(201)).body;
    expect(again).toMatchObject({ alreadyClosed: true, split: { platformShare: 62, platformPercent: 40 } });
    expect(await prisma.financePeriodClose.count({ where: { period: APRIL } })).toBe(1);

    // An open month picks up the new percentage immediately.
    expect((await profit(MAY).expect(200)).body).toMatchObject({ status: 'COMPLETE', distributableProfit: 0, split: { platformPercent: 50, platformShare: 0 } });
    await setSetting({ 'finance.profit_share_percent': 40 }).expect(200);
  });

  it('refuses to close a month with unrecorded costs, and leaves the order queue to complete them', async () => {
    const sku = await makeSku('Unfinished');
    const order = await placeOrder(sku, 1, 90);
    await acquire(sku.id, 1).expect(200); // bought, cost never recorded
    await finish(order.id, 'delivered', '2019-05-08');
    const may = (await profit(MAY).expect(200)).body;
    expect(may).toMatchObject({ status: 'INCOMPLETE', distributableProfit: null, split: { platformShare: null } });
    expect(may.missing.map((m: any) => m.code)).toEqual(['PURCHASE_COST', 'COURIER_COST', 'PACKAGING_COST']);
    const refusal = await http().post(`/operations/finance/profit/${MAY}/close`).set('Authorization', adminAuth).expect(409);
    expect(refusal.body).toMatchObject({ code: 'PERIOD_INCOMPLETE' });
    expect(await prisma.financePeriodClose.count({ where: { period: MAY } })).toBe(0);
  });

  it('uses the quote as a labelled estimate until the actual delivery cost is recorded, and splits refunds into goods and delivery fee', async () => {
    const JULY = '2019-07';
    await prisma.orderStatusEvent.deleteMany({ where: { createdAt: { gte: new Date('2019-07-01'), lt: new Date('2019-08-01') } } });
    await prisma.financeExpense.deleteMany({ where: { incurredOn: { gte: new Date('2019-07-01'), lt: new Date('2019-08-01') } } });
    await prisma.refundTransaction.deleteMany({ where: { updatedAt: { gte: new Date('2019-07-01'), lt: new Date('2019-08-01') } } }); // leftovers of an earlier run
    const goods = await makeSku('Refunded');
    const sold = await placeOrder(goods, 2, 200, 30); // 400 of goods; the customer pays 30 of the delivery
    await acquire(goods.id, 2, { listUnitPrice: 100, discountPerUnit: 10 }).expect(200); // 90 x 2 = 180
    const cart = await prisma.cart.create({ data: { guestTokenHash: randomUUID() } });
    await prisma.checkoutQuote.create({ data: { cartId: cart.id, revision: 1, snapshot: { deliveryFeeBase: 50, shippingFee: 30 }, expiresAt: new Date(Date.now() + 3_600_000), orderId: sold.id } });
    await finish(sold.id, 'delivered', '2019-07-10');

    // Only the packaging is missing: the quote's base fee stands in for the delivery cost and is marked as an estimate.
    expect((await profit(JULY).expect(200)).body.missing).toEqual([{ code: 'PACKAGING_COST', orders: 1 }]);
    await recordCosts(sold.id, { packagingType: 'BAG' }).expect(200); // the only thing left for a person to pick: bag or box
    expect((await prisma.orderCostRecord.findUniqueOrThrow({ where: { orderId: sold.id } })).courierCost).toBeNull(); // the estimate is never written as an actual cost
    const estimated = (await profit(JULY).expect(200)).body;
    expect(estimated).toMatchObject({ status: 'COMPLETE', delivery: { cost: 50, estimatedOrders: 1, estimatedAmount: 50 }, distributableProfit: 191 }); // 400 + 30 − 180 − 50 − 9

    const refund = async (amount: number, feePart: number, status: 'succeeded' | 'failed' | 'pending') => {
      const resolution = await prisma.orderResolution.create({ data: { orderId: sold.id, type: 'refund', status: 'resolved', actorId: randomUUID(), reasonCode: 'DEFECTIVE' } });
      await prisma.refundTransaction.create({ data: { resolutionId: resolution.id, orderId: sold.id, amount, deliveryFeeAmount: feePart, currency: 'EGP', status, updatedAt: new Date('2019-07-15T10:00:00Z') } });
    };
    await refund(100, 0, 'succeeded'); await refund(40, 0, 'failed'); await refund(30, 30, 'pending'); await refund(30, 30, 'succeeded');
    // The actual cost arrives: it replaces the estimate.
    await recordCosts(sold.id, { courierCost: 30 }).expect(200);
    const month = (await profit(JULY).expect(200)).body;
    // Goods refund 100 and delivery-fee refund 30 (only succeeded ones count): net sales 300, shipping revenue 0, product cost 180, delivery 30 (actual), bag 9 → 81.
    expect(month).toMatchObject({
      status: 'COMPLETE',
      revenue: { netSales: 400, productRefunds: 100, netSalesAfterRefunds: 300, shippingRevenue: 30, deliveryFeeRefunds: 30, shippingRevenueNet: 0, total: 300 },
      costs: { products: 180, delivery: 30, packaging: 9, damages: 0, directCosts: 0, total: 219 },
      delivery: { revenue: 0, cost: 30, margin: -30, estimatedOrders: 0, estimatedAmount: 0 }, distributableProfit: 81,
    });
  });

  it('is Admin-only to read profit, and serves a compact monthly trend', async () => {
    await http().get(`/operations/finance/profit?month=${APRIL}`).set('Authorization', operatorAuth).expect(403);
    await http().get(`/operations/finance/profit?month=${APRIL}`).set('Authorization', customerAuth).expect(403);
    await http().get('/operations/finance/profit?month=2019-13').set('Authorization', adminAuth).expect(400);
    const trend = (await http().get('/operations/finance/profit/trend?months=6').set('Authorization', adminAuth).expect(200)).body;
    expect(trend.points).toHaveLength(6);
    expect(trend.points[5].period).toMatch(/^\d{4}-\d{2}$/);
    expect(trend.points[0]).toEqual(expect.objectContaining({ status: expect.any(String), closed: false }));
  });
});
