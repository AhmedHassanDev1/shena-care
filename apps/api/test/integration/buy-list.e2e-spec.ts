import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { SupplyPlanService } from '../../src/modules/sourcing/services/supply-plan.service';

/**
 * GLO-296 release-proof scenario: the internal aggregated Buy List (no supplier involved).
 * Two orders with overlapping product A and separate B/C → A×5 / B×1 / C×1 → acquired markers → Hub receiving.
 */
describe('Internal Buy List (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let plans: SupplyPlanService;
  let adminAuth: string;
  let operatorAuth: string;
  let driverAuth: string;
  let customerAuth: string;
  let operatorId: string;
  let locationId: string;
  const previousMode = process.env.SOURCING_MODE;

  const http = () => request(app.getHttpServer());

  const register = async (label: string) => {
    const registered = await http().post('/accounts/register').send({
      name: label, email: `${label.toLowerCase().replace(/\s/g, '-')}-${randomUUID()}@example.com`, password: 'password123',
    }).expect(201);
    const auth = `Bearer ${registered.body.token}`;
    const user = (await http().get('/accounts/me').set('Authorization', auth).expect(200)).body;
    return { auth, id: user.id as string };
  };

  const makeSku = async (variantName: string, productId?: string) => {
    const suffix = randomUUID();
    let pid = productId;
    if (!pid) {
      const brand = await prisma.brand.create({ data: { name: `BuyList ${suffix}`, slug: `buylist-${suffix}` } });
      pid = (await prisma.product.create({ data: { brandId: brand.id, name: `BuyList Product ${suffix}`, slug: `buylist-product-${suffix}` } })).id;
    }
    const sku = await prisma.sku.create({ data: { productId: pid, code: `BL-${suffix}`, variantName, barcode: `BL-BAR-${suffix}` } });
    return { ...sku, productId: pid };
  };

  const placeOrder = async (lines: Array<{ sku: { id: string; code: string; variantName: string }; quantity: number }>, extra: Record<string, unknown> = {}) => {
    const order = await prisma.order.create({
      data: {
        orderNumber: `ORD-${randomUUID().toUpperCase()}`, customerName: 'Buy List Customer', customerPhone: '01012345678',
        shippingAddress: '1 Buy List Street', totalAmount: lines.reduce((s, l) => s + l.quantity * 100, 0), currency: 'EGP',
        status: 'placed', paymentMethod: 'COD',
        items: { create: lines.map(l => ({
          skuId: l.sku.id, quantity: l.quantity, price: 100, productName: 'Buy List Product', skuCode: l.sku.code,
          variantName: l.sku.variantName, currency: 'EGP', lineTotal: l.quantity * 100,
        })) },
        ...extra,
      },
      include: { items: true },
    });
    await plans.initiateForOrder(order.id);
    return order;
  };

  const list = async (auth = operatorAuth) => (await http().get('/buy-list').set('Authorization', auth).expect(200)).body as {
    items: Array<{ skuId: string; toBuy: number; unavailable: number; acquired: number; awaitingHub: number; orderCount: number;
      orders: Array<{ orderId: string; orderNumber: string; outstanding: number; acquired: number; state: string }> }>;
  };
  const row = (body: Awaited<ReturnType<typeof list>>, skuId: string) => body.items.find(i => i.skuId === skuId);
  const acquire = (skuId: string, quantity: number, key = randomUUID(), auth = operatorAuth) =>
    http().post('/buy-list/acquire').set('Authorization', auth).send({ skuId, quantity, idempotencyKey: key });

  beforeAll(async () => {
    process.env.TEST_BYPASS_AUTH = 'false';
    process.env.SOURCING_MODE = 'INTERNAL_BUY_LIST';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    plans = app.get(SupplyPlanService);

    const admin = await register('Buy List Admin');
    adminAuth = admin.auth;
    await prisma.customer.update({ where: { id: admin.id }, data: { roles: ['ADMIN'] } });
    const operator = await register('Buy List Operator');
    operatorAuth = operator.auth;
    operatorId = operator.id;
    await prisma.customer.update({ where: { id: operator.id }, data: { roles: ['HUB_OPERATOR'] } });
    const driver = await register('Buy List Driver');
    driverAuth = driver.auth;
    await prisma.customer.update({ where: { id: driver.id }, data: { roles: ['DRIVER'] } });
    customerAuth = (await register('Buy List Customer')).auth;

    const location = await http().post('/fulfillment/locations').set('Authorization', adminAuth).send({
      name: `Buy List Hub ${randomUUID()}`, address: '1 Hub Street', capabilities: ['RECEIVE_SUPPLIER_GOODS', 'PREPARE_ORDERS'],
    }).expect(201);
    locationId = location.body.id;
    await http().post(`/fulfillment/locations/${locationId}/operators`).set('Authorization', adminAuth).send({ operatorId }).expect(201);
  });

  afterAll(async () => {
    if (previousMode === undefined) delete process.env.SOURCING_MODE; else process.env.SOURCING_MODE = previousMode;
    await app.close();
  });

  it('is limited to hub operators and admin', async () => {
    await http().get('/buy-list').expect(401);
    await http().get('/buy-list').set('Authorization', driverAuth).expect(403);
    await http().get('/buy-list').set('Authorization', customerAuth).expect(403);
    await http().get('/buy-list').set('Authorization', adminAuth).expect(200);
    await http().post('/buy-list/acquire').set('Authorization', driverAuth)
      .send({ skuId: randomUUID(), quantity: 1, idempotencyKey: randomUUID() }).expect(403);
  });

  it('sums demand per exact SKU across orders and never merges sizes or variants', async () => {
    const productA = await makeSku('50 ml');
    const a100 = await makeSku('100 ml', productA.productId);
    const b = await makeSku('Plain');
    const c = await makeSku('Plain');
    const order1 = await placeOrder([{ sku: productA, quantity: 2 }, { sku: b, quantity: 1 }]);
    const order2 = await placeOrder([{ sku: productA, quantity: 3 }, { sku: c, quantity: 1 }, { sku: a100, quantity: 1 }]);
    // Cancelled and delivered orders are not demand.
    await placeOrder([{ sku: productA, quantity: 7 }], { status: 'cancelled' });
    await placeOrder([{ sku: b, quantity: 4 }], { status: 'delivered' });

    const body = await list();
    expect(row(body, productA.id)).toMatchObject({ toBuy: 5, orderCount: 2, acquired: 0, unavailable: 0 });
    expect(row(body, productA.id)!.orders.map(o => o.orderId).sort()).toEqual([order1.id, order2.id].sort());
    expect(row(body, b.id)).toMatchObject({ toBuy: 1, orderCount: 1 });
    expect(row(body, c.id)).toMatchObject({ toBuy: 1, orderCount: 1 });
    // The 100 ml variant is its own SKU line.
    expect(row(body, a100.id)).toMatchObject({ toBuy: 1, orderCount: 1 });
    expect(row(body, productA.id)!.toBuy + row(body, a100.id)!.toBuy).toBe(6);
  });

  it('covers the oldest orders first, never double counts a retry and rejects over-counting', async () => {
    const a = await makeSku('Count Me');
    const first = await placeOrder([{ sku: a, quantity: 2 }]);
    const second = await placeOrder([{ sku: a, quantity: 3 }]);
    const key = randomUUID();

    const res = await acquire(a.id, 4, key).expect(200);
    expect(res.body).toMatchObject({ acquired: 4, replayed: false, remainingToBuy: 1 });
    expect(res.body.allocations.map((x: { orderId: string; quantity: number }) => [x.orderId, x.quantity]))
      .toEqual([[first.id, 2], [second.id, 2]]);

    // Same physical count retried: nothing changes.
    const replay = await acquire(a.id, 4, key).expect(200);
    expect(replay.body).toMatchObject({ replayed: true, remainingToBuy: 1 });
    expect(row(await list(), a.id)).toMatchObject({ toBuy: 1, acquired: 4 });
    // The same key for a different count is refused.
    await acquire(a.id, 3, key).expect(409);

    // A second staff member counting the same item again is told the fresh outstanding quantity.
    const over = await acquire(a.id, 2).expect(409);
    expect(over.body).toMatchObject({ code: 'EXCEEDS_OUTSTANDING', outstanding: 1 });

    // Both orders now carry confirmed allocations; the first order is fully covered for the customer.
    expect((await plans.getPlan(first.id)).status).toBe('COVERED');
    expect((await plans.getPlan(second.id)).status).toBe('CONFIRMING');
  });

  it('stays consistent when two staff count the last unit at the same time', async () => {
    const a = await makeSku('Race');
    await placeOrder([{ sku: a, quantity: 1 }]);
    const results = await Promise.all([acquire(a.id, 1), acquire(a.id, 1)]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect(row(await list(), a.id)).toMatchObject({ toBuy: 0, acquired: 1, awaitingHub: 1 }); // counted once, waits for the Hub
    const allocations = await prisma.sourceAllocation.count({ where: { requirement: { skuId: a.id }, evidenceRef: { startsWith: 'buylist:' } } });
    expect(allocations).toBe(1);
  });

  it('drops a cancelled order from the outstanding quantity while a run is open', async () => {
    const a = await makeSku('Cancel Mid Run');
    const keep = await placeOrder([{ sku: a, quantity: 1 }]);
    const cancel = await placeOrder([{ sku: a, quantity: 2 }]);
    expect(row(await list(), a.id)).toMatchObject({ toBuy: 3 });
    await prisma.order.update({ where: { id: cancel.id }, data: { status: 'cancelled' } });
    expect(row(await list(), a.id)).toMatchObject({ toBuy: 1, orderCount: 1 });
    const over = await acquire(a.id, 3).expect(409);
    expect(over.body.outstanding).toBe(1);
    await acquire(a.id, 1).expect(200);
    expect((await plans.getPlan(keep.id)).status).toBe('COVERED');
  });

  it('marks an unavailable product for the customer decision flow and can reopen it', async () => {
    const a = await makeSku('Unavailable');
    const order = await placeOrder([{ sku: a, quantity: 2 }]);
    await acquire(a.id, 1).expect(200); // partially sourced
    const flagged = await http().post('/buy-list/unavailable').set('Authorization', operatorAuth).send({ skuId: a.id }).expect(200);
    expect(flagged.body).toMatchObject({ flagged: 1, units: 1 });
    const body = await list();
    expect(row(body, a.id)).toMatchObject({ toBuy: 0, unavailable: 1, acquired: 1 });
    // The customer-facing availability projection sees an action-required line (existing decision flow).
    const plan = await plans.getPlan(order.id);
    expect(plan.status).toBe('PARTIALLY_UNAVAILABLE');
    expect(plan.lines[0].actionRequirement).toMatchObject({ category: 'BUY_LIST_UNAVAILABLE', unresolvedQuantity: 1 });
    // Idempotent.
    await http().post('/buy-list/unavailable').set('Authorization', operatorAuth).send({ skuId: a.id }).expect(200);
    // Found after all.
    await http().post('/buy-list/reopen').set('Authorization', operatorAuth).send({ skuId: a.id }).expect(200);
    expect(row(await list(), a.id)).toMatchObject({ toBuy: 1, unavailable: 0 });
    await http().post('/buy-list/unavailable').set('Authorization', operatorAuth).send({ skuId: randomUUID() }).expect(404);
  });

  it('hands acquired goods to the Hub: receive by barcode makes the shipment ready to prepare', async () => {
    const a = await makeSku('Hub Receive');
    const order = await placeOrder([{ sku: a, quantity: 2 }]);
    await acquire(a.id, 2).expect(200);

    const receivables = (await http().get(`/fulfillment/locations/${locationId}/receivables`).set('Authorization', operatorAuth).expect(200))
      .body as Array<{ allocationId: string; orderId: string; orderItemId: string; skuId: string; remainingQuantity: number; purchaseOrderId: string | null }>;
    const mine = receivables.filter(r => r.orderId === order.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ skuId: a.id, remainingQuantity: 2, purchaseOrderId: null });
    expect(row(await list(), a.id)).toMatchObject({ toBuy: 0, awaitingHub: 2 });

    // Receiving the wrong product is refused by the existing identity check.
    const other = await makeSku('Other Product');
    await http().post('/fulfillment/receipts').set('Authorization', operatorAuth).send({
      locationId, allocationId: mine[0].allocationId, orderId: order.id, orderItemId: mine[0].orderItemId, skuId: a.id,
      variantName: a.variantName, quantity: 2, condition: 'ACCEPTABLE', expiryDate: '2031-12-31',
      idempotencyKey: randomUUID(), barcodeScanned: other.barcode!,
    }).expect(409);

    await http().post('/fulfillment/receipts').set('Authorization', operatorAuth).send({
      locationId, allocationId: mine[0].allocationId, orderId: order.id, orderItemId: mine[0].orderItemId, skuId: a.id,
      variantName: a.variantName, quantity: 2, condition: 'ACCEPTABLE', expiryDate: '2031-12-31',
      idempotencyKey: randomUUID(), barcodeScanned: a.barcode!,
    }).expect(201);

    const shipment = await prisma.shipment.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(shipment.status).toBe('ready_to_prepare');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('packing');
    expect(row(await list(), a.id)).toBeUndefined();
  });
});
