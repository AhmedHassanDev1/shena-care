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
 * GLO-206 W23 F-01/F-02: return claims are bounded by what was bought (also under concurrency),
 * refunds by the order total and lifecycle, and resolution/refund statuses only move forward.
 */
describe('GLO-206 return and refund integrity (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor; let customer: Actor;
  const orderIds: string[] = [];
  const http = () => request(app.getHttpServer());

  /** Delivered yesterday; one line of `quantity` units at 100 EGP each plus 50 EGP shipping. */
  const deliveredOrder = async (quantity: number) => {
    const order = await prisma.order.create({ data: {
      orderNumber: 'ORD-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(), customerId: customer.id,
      customerName: 'Claim Customer', customerPhone: '01012345678', shippingAddress: '1 Claim Street',
      subtotal: 100 * quantity, shippingFee: 50, totalAmount: 100 * quantity + 50, codAmount: 100 * quantity + 50,
      currency: 'EGP', status: 'delivered',
      items: { create: [{ skuId: randomUUID(), productId: randomUUID(), quantity, price: 100, lineTotal: 100 * quantity,
        productName: 'Claim Serum', skuCode: 'CLM', variantName: '30 ml', currency: 'EGP' }] },
      statusEvents: { create: [{ status: 'placed', createdAt: new Date(Date.now() - 172800000) },
        { status: 'delivered', createdAt: new Date(Date.now() - 86400000) }] },
    }, include: { items: true } });
    orderIds.push(order.id);
    return { order, itemId: order.items[0].id };
  };
  const submit = (orderNumber: string, itemId: string, quantity: number) =>
    http().post(`/ordering/orders/${orderNumber}/items/${itemId}/returns`).set(customer.auth)
      .send({ reasonCode: 'DEFECT_OR_QUALITY_CONCERN', quantity });
  const setStatus = (resolutionId: string, status: string) =>
    http().patch(`/ordering/resolutions/${resolutionId}/status`).set(admin.auth).send({ status, actorId: 'ignored' });

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useValue(new DeterministicAiClient()).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useLogger(false);
    await app.init();
    prisma = app.get(PrismaService);
    admin = await createActor(prisma, 'ADMIN');
    customer = await createActor(prisma, 'CUSTOMER');
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.refundTransaction.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderResolution.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (app) await app.close();
  });

  it('never accepts more than was bought, and serializes concurrent claims', async () => {
    const { order, itemId } = await deliveredOrder(2);
    await submit(order.orderNumber, itemId, 3).expect(400);
    const race = await Promise.all([submit(order.orderNumber, itemId, 2), submit(order.orderNumber, itemId, 2)]);
    const statuses = race.map(r => r.status).sort();
    expect(statuses[0]).toBe(201);
    expect([400, 409]).toContain(statuses[1]); // eligibility pre-check or the locked re-check
    expect(await prisma.orderResolution.count({ where: { orderId: order.id } })).toBe(1);
  });

  it('counts completed claims against what remains', async () => {
    const { order, itemId } = await deliveredOrder(2);
    const first = await submit(order.orderNumber, itemId, 1).expect(201);
    await setStatus(first.body.id, 'approved').expect(200);
    await setStatus(first.body.id, 'resolved').expect(200);
    await submit(order.orderNumber, itemId, 2).expect(400);
    const second = await submit(order.orderNumber, itemId, 1).expect(201);
    await setStatus(second.body.id, 'rejected').expect(200);
    await submit(order.orderNumber, itemId, 1).expect(201); // a rejected claim frees its quantity
  });

  it('bounds staff-created resolutions the same way', async () => {
    const { order, itemId } = await deliveredOrder(1);
    const other = await deliveredOrder(1);
    const create = (items: object[]) => http().post('/ordering/resolutions').set(admin.auth)
      .send({ orderId: order.id, type: 'return', actorId: 'ignored', items });
    await create([{ orderItemId: other.itemId, quantity: 1 }]).expect(400);
    await create([{ orderItemId: itemId, quantity: 5 }]).expect(400);
    await create([{ orderItemId: itemId, quantity: 1 }]).expect(201);
  });

  it('keeps resolution statuses moving forward only', async () => {
    const { order, itemId } = await deliveredOrder(1);
    const claim = await submit(order.orderNumber, itemId, 1).expect(201);
    await setStatus(claim.body.id, 'resolved').expect(409);
    await setStatus(claim.body.id, 'rejected').expect(200);
    await setStatus(claim.body.id, 'approved').expect(409);
  });

  it('refunds only eligible resolutions, in currency, within the order total, once', async () => {
    const { order, itemId } = await deliveredOrder(2); // total 250 EGP
    const claim = await submit(order.orderNumber, itemId, 1).expect(201);
    const refund = (amount: number, currency = 'EGP') =>
      http().post(`/ordering/resolutions/${claim.body.id}/refund`).set(admin.auth).send({ amount, currency });
    await refund(100).expect(400); // still requested
    await setStatus(claim.body.id, 'approved').expect(200);
    await refund(100, 'USD').expect(400);
    await refund(-5).expect(400);
    await refund(251).expect(400);
    await refund(100).expect(201);
    await refund(100).expect(400); // one refund per resolution

    const status = (s: string) => http().patch(`/ordering/resolutions/${claim.body.id}/refund/status`).set(admin.auth).send({ status: s });
    await status('succeeded').expect(200);
    await status('pending').expect(409);
    await status('failed').expect(409);
    const stored = await prisma.refundTransaction.findUniqueOrThrow({ where: { resolutionId: claim.body.id } });
    expect(stored.status).toBe('succeeded');
  });
});
