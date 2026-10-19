import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AiClient } from '../../src/platform/ai';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { createActor, Actor } from '../fixtures/actors';
import { createSellableSku } from '../fixtures/sellable-sku';
import { placeGuestOrder } from '../fixtures/checkout';

/**
 * C0 W6 customer recovery: self-cancellation only while nothing physical exists, order-linked support
 * requests, and cross-device access by verifying the checkout phone. Ownership is the account or the
 * order's own guest token — never an order number.
 */
describe('C0 customer tracking and recovery', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor;
  let sku: Awaited<ReturnType<typeof createSellableSku>>;
  const http = () => request(app.getHttpServer());
  const phone = `010${Math.floor(10000000 + Math.random() * 89999999)}`;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useValue(new DeterministicAiClient()).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useLogger(false);
    await app.init();
    prisma = app.get(PrismaService);
    sku = await createSellableSku(prisma);
    admin = await createActor(prisma, 'ADMIN');
  });
  afterAll(async () => { if (app) await app.close(); });

  it('a guest cancels a placed order once; replay is idempotent; tracking reflects it', async () => {
    const order = await placeGuestOrder(app, [{ skuId: sku.id, quantity: 1 }]);
    const token = { 'x-order-access-token': order.guestAccessToken! };
    expect((await http().get(`/ordering/guest/orders/${order.orderNumber}/tracking`).set(token).expect(200)).body.canCancel).toBe(true);

    await http().post(`/ordering/guest/orders/${order.orderNumber}/cancel`).expect(401);
    await http().post(`/ordering/guest/orders/${order.orderNumber}/cancel`).set('x-order-access-token', 'x'.repeat(43)).expect(404);
    expect((await http().post(`/ordering/guest/orders/${order.orderNumber}/cancel`).set(token).expect(201)).body).toMatchObject({ status: 'cancelled', alreadyCancelled: false });
    expect((await http().post(`/ordering/guest/orders/${order.orderNumber}/cancel`).set(token).expect(201)).body).toMatchObject({ alreadyCancelled: true });

    const tracking = (await http().get(`/ordering/guest/orders/${order.orderNumber}/tracking`).set(token).expect(200)).body;
    expect(tracking).toMatchObject({ status: 'CANCELLED', canCancel: false });
    expect(await prisma.orderResolution.count({ where: { orderId: order.id, type: 'cancellation' } })).toBe(1);
  });

  it('refuses self-cancellation once goods are physical and routes the customer to support', async () => {
    const order = await placeGuestOrder(app, [{ skuId: sku.id, quantity: 1 }]);
    const token = { 'x-order-access-token': order.guestAccessToken! };
    const hub = await prisma.fulfillmentLocation.create({ data: { name: 'C0 W6 Hub ' + randomUUID(), address: 'Maadi' } });
    await prisma.shipment.create({ data: { orderId: order.id, locationId: hub.id, status: 'ready_to_prepare' } });

    expect((await http().get(`/ordering/guest/orders/${order.orderNumber}/tracking`).set(token).expect(200)).body.canCancel).toBe(false);
    expect((await http().post(`/ordering/guest/orders/${order.orderNumber}/cancel`).set(token).expect(409)).body.code).toBe('CANCELLATION_REQUIRES_SUPPORT');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).not.toBe('cancelled');

    const created = (await http().post(`/ordering/guest/orders/${order.orderNumber}/support`).set(token)
      .send({ message: 'Please cancel, I ordered twice', topic: 'cancellation' }).expect(201)).body;
    expect(await prisma.supportCase.findUniqueOrThrow({ where: { id: created.caseId } })).toMatchObject({ orderId: order.id, category: 'cancellation' });
    await http().post(`/ordering/guest/orders/${order.orderNumber}/support`).set(token).send({ message: 'hi' }).expect(400);
    // The founder sees the case on the order.
    const detail = (await http().get(`/admin/orders/${order.id}`).set(admin.auth).expect(200)).body;
    expect(detail.supportCases.map((c: { id: string }) => c.id)).toContain(created.caseId);
  });

  it('verifying the checkout phone attaches guest orders to the account across devices', async () => {
    const order = await placeGuestOrder(app, [{ skuId: sku.id, quantity: 1 }], { customerPhone: phone });
    const other = await placeGuestOrder(app, [{ skuId: sku.id, quantity: 1 }], { customerPhone: '01155555555' });

    await http().post('/accounts/otp/send').send({ phoneNumber: phone }).expect(201);
    const challenge = await prisma.otpChallenge.findFirstOrThrow({ where: { phoneNumber: `+20${phone.slice(1)}` }, orderBy: { createdAt: 'desc' } });
    const session = (await http().post('/accounts/otp/verify').send({ phoneNumber: phone, code: challenge.code }).expect(201)).body;
    const auth = { Authorization: `Bearer ${session.token}` };

    const mine = (await http().get('/ordering/orders').set(auth).expect(200)).body;
    expect(mine.items.map((o: { orderNumber: string }) => o.orderNumber)).toContain(order.orderNumber);
    expect(mine.items.map((o: { orderNumber: string }) => o.orderNumber)).not.toContain(other.orderNumber);
    expect((await http().get(`/ordering/orders/${order.orderNumber}/tracking`).set(auth).expect(200)).body.orderNumber).toBe(order.orderNumber);
    await http().get(`/ordering/orders/${other.orderNumber}/tracking`).set(auth).expect(404);
    // Once owned by the account, the device's guest link no longer opens or acts on the order.
    await http().get(`/ordering/guest/orders/${order.orderNumber}/tracking`).set('x-order-access-token', order.guestAccessToken!).expect(404);
    await http().post(`/ordering/guest/orders/${order.orderNumber}/cancel`).set('x-order-access-token', order.guestAccessToken!).expect(404);
    // The owner may cancel through the account route; another account may not.
    const stranger = await createActor(prisma, 'CUSTOMER');
    await http().post(`/ordering/orders/${order.orderNumber}/customer-cancel`).set(stranger.auth).expect(404);
    await http().post(`/ordering/orders/${order.orderNumber}/customer-cancel`).set(auth).expect(201);
    await http().get('/ordering/orders').expect(401);
  });
});
