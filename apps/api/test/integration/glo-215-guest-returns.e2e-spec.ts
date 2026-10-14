import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createHash, randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AiClient } from '../../src/platform/ai';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';

/** GLO-215: guests report item problems with the same x-order-access-token as every other guest order route. */
describe('GLO-215 guest item problem reports (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const orderIds: string[] = [];
  const http = () => request(app.getHttpServer());
  const token = 'guest-' + randomUUID();

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useValue(new DeterministicAiClient()).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useLogger(false);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (prisma) {
      const resolutions = await prisma.orderResolution.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
      const ids = resolutions.map((r) => r.id);
      await prisma.notificationOutbox.deleteMany({ where: { aggregateId: { in: ids } } });
      await prisma.orderResolutionEvent.deleteMany({ where: { resolutionId: { in: ids } } });
      await prisma.orderResolutionItem.deleteMany({ where: { resolutionId: { in: ids } } });
      await prisma.orderResolution.deleteMany({ where: { id: { in: ids } } });
      await prisma.orderStatusEvent.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (app) await app.close();
  });

  it('accepts the order access token header and refuses other tokens', async () => {
    const order = await prisma.order.create({ data: {
      orderNumber: 'ORD-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(),
      customerName: 'Guest', customerPhone: '01012345678', shippingAddress: '1 Guest St',
      totalAmount: 150, shippingFee: 50, subtotal: 100, codAmount: 150, currency: 'EGP', status: 'delivered',
      guestAccessTokenHash: createHash('sha256').update(token).digest('hex'),
      guestAccessExpiresAt: new Date(Date.now() + 86400000),
      items: { create: [{ skuId: randomUUID(), quantity: 2, price: 50, currency: 'EGP', productName: 'Guest Cream', lineTotal: 100 }] },
      statusEvents: { create: [{ status: 'placed', createdAt: new Date(Date.now() - 60000) }, { status: 'delivered' }] },
    }, include: { items: true } });
    orderIds.push(order.id);
    const base = `/ordering/guest/orders/${order.orderNumber}/items/${order.items[0].id}`;

    const eligibility = await http().get(`${base}/eligibility`).set('x-order-access-token', token).expect(200);
    expect(eligibility.body.isEligible).toBe(true);
    await http().get(`${base}/eligibility`).set('x-order-access-token', 'wrong').expect(404);
    await http().get(`${base}/eligibility`).expect(401);

    await http().post(`${base}/returns`).set('x-order-access-token', token)
      .send({ reasonCode: 'DAMAGED_OR_LEAKING', quantity: 1 }).expect(201);
    // Legacy Bearer form still works for existing clients; a second open claim on the line is refused.
    await http().post(`${base}/returns`).set('Authorization', `Bearer ${token}`)
      .send({ reasonCode: 'DAMAGED_OR_LEAKING', quantity: 1 }).expect((res) => expect([400, 409]).toContain(res.status));
  });
});
