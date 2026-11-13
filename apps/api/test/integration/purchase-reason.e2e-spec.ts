process.env.DELIVERY_FEE_POLICY = JSON.stringify({ bands: [{ maxKm: null, fee: 50 }], discountTiers: [], freeFrom: 100000 });
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { Role } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { createActor, Actor } from '../fixtures/actors';
import { placeGuestOrder, signInCustomer } from '../fixtures/checkout';
import { createSellableSku } from '../fixtures/sellable-sku';

/** GLO-314: «Why I bought it» — optional, per order line, owner-only, never part of the order snapshot. */
describe('Why I bought it — purchase reason per order item (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor; let hub: Actor; let driver: Actor;
  let a: Awaited<ReturnType<typeof createSellableSku>>; let b: Awaited<ReturnType<typeof createSellableSku>>;
  const http = () => request(app.getHttpServer());

  const checkout = async (lines: Array<{ sku: { id: string }; quantity: number }>) => {
    const customer = await signInCustomer(app);
    const address = { governorate: 'Cairo', area: 'Maadi' };
    for (const line of lines) await http().post('/ordering/cart/add').set(customer.auth).send({ skuId: line.sku.id, quantity: line.quantity }).expect(201);
    const quote = (await http().post('/ordering/checkout/quote').set(customer.auth).send(address).expect(201)).body;
    const placed = (await http().post('/ordering/checkout').set(customer.auth).send({
      ...address, customerName: 'Reason Customer', customerPhone: '01012345678', shippingAddress: '12 Road 9, Maadi',
      latitude: 29.9602, longitude: 31.2569, locationSource: 'map_pin', locationConfirmed: true,
      quoteVersion: quote.quoteVersion, cartRevision: quote.revision, idempotencyKey: randomUUID(),
    }).expect(201)).body as { id: string; orderNumber: string; codAmount: number; totalAmount: number; items: Array<{ id: string; skuId: string }> };
    return { customer, order: placed };
  };

  beforeAll(async () => {
    process.env.TEST_BYPASS_AUTH = 'false';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    admin = await createActor(prisma, Role.ADMIN); hub = await createActor(prisma, Role.HUB_OPERATOR); driver = await createActor(prisma, Role.DRIVER);
    a = await createSellableSku(prisma); b = await createSellableSku(prisma);
  });
  afterAll(async () => { await app.close(); });

  it('stores independent optional reasons per line and leaves the order snapshot untouched', async () => {
    const { customer, order } = await checkout([{ sku: a, quantity: 2 }, { sku: b, quantity: 1 }]);
    const base = `/ordering/orders/${order.orderNumber}`;
    const before = await prisma.orderItem.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } });

    // Nothing was required at checkout: every line starts UNSPECIFIED.
    const initial = (await http().get(`${base}/purchase-reasons`).set(customer.auth).expect(200)).body.items as Array<{ orderItemId: string; status: string }>;
    expect(initial.map(i => i.status)).toEqual(['UNSPECIFIED', 'UNSPECIFIED']);

    const first = order.items.find(i => i.skuId === a.id)!; const second = order.items.find(i => i.skuId === b.id)!;
    const saved = (await http().put(`${base}/items/${first.id}/purchase-reason`).set(customer.auth)
      .send({ reasons: ['OILY_SKIN', 'DAILY_ROUTINE', 'OILY_SKIN'], note: 'بشرتي بتلمع <b>بسرعة</b>', source: 'CHATBOT' }).expect(200)).body;
    expect(saved).toMatchObject({ orderItemId: first.id, status: 'SPECIFIED', reason: { reasons: ['OILY_SKIN', 'DAILY_ROUTINE'], note: 'بشرتي بتلمع بسرعة', source: 'CHATBOT' } });
    await http().put(`${base}/items/${second.id}/purchase-reason`).set(customer.auth).send({ reasons: ['GIFT'] }).expect(200);
    const listed = (await http().get(`${base}/purchase-reasons`).set(customer.auth).expect(200)).body.items as Array<{ orderItemId: string; reason: { reasons: string[] } }>;
    expect(listed.find(i => i.orderItemId === first.id)!.reason.reasons).toEqual(['OILY_SKIN', 'DAILY_ROUTINE']);
    expect(listed.find(i => i.orderItemId === second.id)!.reason.reasons).toEqual(['GIFT']);

    // Editing and clearing (back to UNSPECIFIED); the commercial line is byte-for-byte unchanged.
    await http().put(`${base}/items/${first.id}/purchase-reason`).set(customer.auth).send({ reasons: ['SUN_PROTECTION'] }).expect(200);
    const cleared = (await http().delete(`${base}/items/${first.id}/purchase-reason`).set(customer.auth).expect(200)).body;
    expect(cleared).toMatchObject({ status: 'UNSPECIFIED', reason: null });
    const after = await prisma.orderItem.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } });
    expect(after.map(i => ({ ...i, updatedAt: 0 }))).toEqual(before.map(i => ({ ...i, updatedAt: 0 })));
    const reread = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(Number(reread.codAmount)).toBe(Number(order.codAmount));
  });

  it('keeps the same product bought twice on two orders as two separate reasons', async () => {
    const one = await checkout([{ sku: a, quantity: 1 }]); const two = await checkout([{ sku: a, quantity: 1 }]);
    await http().put(`/ordering/orders/${one.order.id}/items/${one.order.items[0].id}/purchase-reason`).set(one.customer.auth).send({ reasons: ['DRY_SKIN'] }).expect(200);
    await http().put(`/ordering/orders/${two.order.id}/items/${two.order.items[0].id}/purchase-reason`).set(two.customer.auth).send({ reasons: ['GIFT'] }).expect(200);
    expect((await http().get(`/ordering/orders/${one.order.id}/purchase-reasons`).set(one.customer.auth).expect(200)).body.items[0].reason.reasons).toEqual(['DRY_SKIN']);
    expect((await http().get(`/ordering/orders/${two.order.id}/purchase-reasons`).set(two.customer.auth).expect(200)).body.items[0].reason.reasons).toEqual(['GIFT']);
  });

  it('is private to the order owner and invisible to staff, courier and suppliers', async () => {
    const { customer, order } = await checkout([{ sku: a, quantity: 1 }]);
    const stranger = await signInCustomer(app);
    const item = order.items[0].id;
    await http().put(`/ordering/orders/${order.id}/items/${item}/purchase-reason`).set(customer.auth).send({ reasons: ['ACNE_PRONE'], note: 'خاص' }).expect(200);
    // Another account, no account, and every staff role: not found / unauthorized.
    await http().get(`/ordering/orders/${order.id}/purchase-reasons`).expect(401);
    await http().get(`/ordering/orders/${order.id}/purchase-reasons`).set(stranger.auth).expect(404);
    await http().put(`/ordering/orders/${order.id}/items/${item}/purchase-reason`).set(stranger.auth).send({ reasons: ['GIFT'] }).expect(404);
    await http().delete(`/ordering/orders/${order.id}/items/${item}/purchase-reason`).set(stranger.auth).expect(404);
    for (const staff of [admin, hub, driver]) await http().get(`/ordering/orders/${order.id}/purchase-reasons`).set(staff.auth).expect(404);
    // The reason never appears in the staff order projection or the customer's order tracking payload.
    const staffView = JSON.stringify((await http().get(`/admin/orders/${order.id}`).set(admin.auth)).body);
    expect(staffView).not.toContain('ACNE_PRONE');
    expect(staffView).not.toContain('خاص');
    const tracking = await http().get(`/ordering/orders/${order.orderNumber}`).set(customer.auth);
    expect(JSON.stringify(tracking.body)).not.toContain('ACNE_PRONE');
  });

  it('validates codes, sizes and the line it targets', async () => {
    const { customer, order } = await checkout([{ sku: a, quantity: 1 }]);
    const url = `/ordering/orders/${order.id}/items/${order.items[0].id}/purchase-reason`;
    await http().put(url).set(customer.auth).send({ reasons: [] }).expect(400);
    await http().put(url).set(customer.auth).send({ reasons: ['CURES_EVERYTHING'] }).expect(400);
    await http().put(url).set(customer.auth).send({ reasons: ['GIFT'], note: 'x'.repeat(201) }).expect(400);
    await http().put(url).set(customer.auth).send({ reasons: ['GIFT'], diagnosis: 'x' }).expect(400);
    await http().put(`/ordering/orders/${order.id}/items/${randomUUID()}/purchase-reason`).set(customer.auth).send({ reasons: ['GIFT'] }).expect(404);
  });

  it('works for a guest order only with that order\'s own access token', async () => {
    const placed = await placeGuestOrder(app, [{ skuId: a.id, quantity: 1 }]);
    const token = placed.guestAccessToken!;
    const base = `/ordering/guest/orders/${placed.orderNumber}`;
    await http().get(`${base}/purchase-reasons`).expect(401);
    await http().get(`${base}/purchase-reasons`).set('x-order-access-token', 'A'.repeat(43)).expect(404);
    await http().put(`${base}/items/${placed.items[0].id}/purchase-reason`).set('x-order-access-token', token).send({ reasons: ['TRYING_NEW'], source: 'PDP' }).expect(200);
    expect((await http().get(`${base}/purchase-reasons`).set('x-order-access-token', token).expect(200)).body.items[0]).toMatchObject({ status: 'SPECIFIED' });
    // A signed-in customer cannot reach the guest order's reason by its number.
    const stranger = await signInCustomer(app);
    await http().get(`/ordering/orders/${placed.orderNumber}/purchase-reasons`).set(stranger.auth).expect(404);
  });
});
