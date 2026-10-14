import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AiClient } from '../../src/platform/ai';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { createActor, Actor } from '../fixtures/actors';

/**
 * GLO-206 GAP-09 / W22: expected COD cash derives from the order, drivers cannot set or settle it,
 * and a collection is settled exactly once with exact totals.
 */
describe('GLO-206 COD collection and settlement integrity (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor; let hub: Actor; let driver: Actor;
  const orderIds: string[] = []; const batchRefs: string[] = [];
  const http = () => request(app.getHttpServer());

  const makeOrder = async (codAmount: number, status: 'placed' | 'cancelled' = 'placed') => {
    const order = await prisma.order.create({ data: {
      orderNumber: 'ORD-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(),
      customerName: 'COD Customer', customerPhone: '01012345678', shippingAddress: '1 Cash Street',
      totalAmount: codAmount, codAmount, subtotal: codAmount - 50, shippingFee: 50, currency: 'EGP', status,
    } });
    orderIds.push(order.id);
    return order.id;
  };
  const init = (auth: Actor, orderId: string, amount: number, currency = 'EGP') =>
    http().post('/ordering/settlements/initialize').set(auth.auth).send({ orderId, amount, currency });
  const settle = (auth: Actor, body: Record<string, unknown>) => {
    const reference = 'SET-' + randomUUID();
    batchRefs.push(reference);
    return http().post('/ordering/settlements/batch').set(auth.auth).send({ courierId: 'courier-1', reference, currency: 'EGP', ...body });
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useValue(new DeterministicAiClient()).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useLogger(false);
    await app.init();
    prisma = app.get(PrismaService);
    admin = await createActor(prisma, 'ADMIN');
    hub = await createActor(prisma, 'HUB_OPERATOR');
    driver = await createActor(prisma, 'DRIVER');
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.paymentCollection.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.courierSettlementBatch.deleteMany({ where: { reference: { in: batchRefs } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (app) await app.close();
  });

  it('drivers cannot initialize expected cash or settle batches', async () => {
    const orderId = await makeOrder(250);
    await init(driver, orderId, 1).expect(403);
    await init(driver, orderId, 250).expect(403);
    await settle(driver, { totalCollected: 250, collections: [{ orderId, collectedAmount: 250 }] }).expect(403);
    expect(await prisma.paymentCollection.count({ where: { orderId } })).toBe(0);
  });

  it('expected cash must equal the order COD amount and is never overwritten', async () => {
    const orderId = await makeOrder(250);
    await init(hub, orderId, 1).expect(400);
    await init(hub, orderId, 250, 'USD').expect(400);
    const created = await init(hub, orderId, 250).expect(201);
    expect(Number(created.body.expectedAmount)).toBe(250);
    const again = await init(admin, orderId, 250).expect(201);
    expect(again.body.id).toBe(created.body.id);
    await init(admin, orderId, 10).expect(409);
    const stored = await prisma.paymentCollection.findUniqueOrThrow({ where: { orderId } });
    expect(Number(stored.expectedAmount)).toBe(250);
  });

  it('rejects malformed and cancelled-order requests', async () => {
    const cancelled = await makeOrder(100, 'cancelled');
    await init(admin, cancelled, 100).expect(400);
    await http().post('/ordering/settlements/initialize').set(admin.auth).send({ orderId: 'x', amount: 'lots', currency: 'EGP' }).expect(400);
    await init(admin, randomUUID(), 100).expect(404);
  });

  it('settles each collection once with exact totals', async () => {
    const a = await makeOrder(250.1);
    const b = await makeOrder(99.9);
    await init(admin, a, 250.1).expect(201);
    await init(admin, b, 99.9).expect(201);

    await settle(admin, { totalCollected: 999, collections: [{ orderId: a, collectedAmount: 250.1 }] }).expect(400);
    await settle(admin, { totalCollected: 500.2, collections: [{ orderId: a, collectedAmount: 250.1 }, { orderId: a, collectedAmount: 250.1 }] }).expect(400);
    await settle(admin, { totalCollected: 10, fees: 11, collections: [{ orderId: a, collectedAmount: 10 }] }).expect(400);
    await settle(admin, { totalCollected: 0, collections: [] }).expect(400);

    const batch = await settle(hub, { totalCollected: 340, fees: 5,
      collections: [{ orderId: a, collectedAmount: 250.1 }, { orderId: b, collectedAmount: 89.9 }] }).expect(201);
    expect(Number(batch.body.totalExpected)).toBe(350);
    expect(Number(batch.body.totalCollected)).toBe(340);
    expect(Number(batch.body.netSettled)).toBe(335);
    expect(batch.body.actorId).toBe(hub.id);
    const [ca, cb] = await Promise.all([a, b].map(orderId => prisma.paymentCollection.findUniqueOrThrow({ where: { orderId } })));
    expect(ca.status).toBe('settled');
    expect(cb.status).toBe('short');

    const replay = await settle(admin, { totalCollected: 1, collections: [{ orderId: a, collectedAmount: 1 }] }).expect(409);
    expect(replay.body.message).toMatch(/already settled/);
    const after = await prisma.paymentCollection.findUniqueOrThrow({ where: { orderId: a } });
    expect(Number(after.collectedAmount)).toBe(250.1);
    expect(after.settlementBatchId).toBe(ca.settlementBatchId);
    await init(admin, a, 1).expect(409);
  });
});
