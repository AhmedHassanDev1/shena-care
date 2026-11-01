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
 * GLO-216 / GLO-215 F-03: a reported possible adverse reaction becomes an actionable, critical human
 * safety case in the same transaction as the report, with a staff notification — never a mere flag.
 */
describe('GLO-216 safety escalation of possible adverse events (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let customer: Actor; let admin: Actor;
  const orderIds: string[] = []; const caseIds: string[] = [];
  const http = () => request(app.getHttpServer());

  const deliveredOrder = async () => {
    const order = await prisma.order.create({ data: {
      orderNumber: 'ORD-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(),
      customerId: customer.id, customerName: 'Safety Customer', customerPhone: '01012345678',
      shippingAddress: '1 Safety St', totalAmount: 150, shippingFee: 50, subtotal: 100, codAmount: 150,
      currency: 'EGP', status: 'delivered',
      items: { create: [{ skuId: randomUUID(), quantity: 1, price: 100, productName: 'Retinol Serum', skuCode: 'RET-30',
        variantName: '30 ml', currency: 'EGP', lineTotal: 100 }] },
      statusEvents: { create: [{ status: 'placed', createdAt: new Date(Date.now() - 60000) }, { status: 'delivered' }] },
    }, include: { items: true } });
    orderIds.push(order.id);
    return order;
  };
  const report = (orderNumber: string, itemId: string, reasonCode: string) =>
    http().post(`/ordering/orders/${orderNumber}/items/${itemId}/returns`).set(customer.auth)
      .send({ reasonCode, quantity: 1, description: 'Redness and burning after first use', batchOrLot: 'L2309' });

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useValue(new DeterministicAiClient()).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useLogger(false);
    await app.init();
    prisma = app.get(PrismaService);
    customer = await createActor(prisma, 'CUSTOMER');
    admin = await createActor(prisma, 'ADMIN');
  });

  afterAll(async () => {
    if (prisma) {
      const resolutions = await prisma.orderResolution.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
      const resolutionIds = resolutions.map((r) => r.id);
      await prisma.notificationOutbox.deleteMany({ where: { aggregateId: { in: [...resolutionIds, ...caseIds] } } });
      await prisma.supportCase.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderResolutionEvent.deleteMany({ where: { resolutionId: { in: resolutionIds } } });
      await prisma.orderResolutionItem.deleteMany({ where: { resolutionId: { in: resolutionIds } } });
      await prisma.orderResolution.deleteMany({ where: { id: { in: resolutionIds } } });
      await prisma.orderStatusEvent.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (app) await app.close();
  });

  it('opens a critical safety case linked to the report and notifies staff', async () => {
    const order = await deliveredOrder();
    const res = await report(order.orderNumber, order.items[0].id, 'POSSIBLE_ADVERSE_EVENT').expect(201);

    const cases = await prisma.supportCase.findMany({ where: { orderId: order.id } });
    expect(cases).toHaveLength(1);
    const safetyCase = cases[0];
    caseIds.push(safetyCase.id);
    expect(safetyCase).toMatchObject({ category: 'safety_concern', priority: 'critical', status: 'open', customerId: customer.id });
    expect(safetyCase.description).toContain('Redness and burning after first use');
    expect(safetyCase.description).toContain('L2309');
    expect(safetyCase.description).toContain('Retinol Serum');

    const resolution = await prisma.orderResolution.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(resolution.resolutionDetails).toMatchObject({ escalateToSafety: true, supportCaseId: safetyCase.id });

    const notice = await prisma.notificationOutbox.findFirst({ where: { eventType: 'safety.escalated', aggregateId: safetyCase.id } });
    expect(notice).not.toBeNull();
    expect(notice!.customerId).toBeNull(); // staff notification, not a customer message

    // Critical safety cases lead the staff queue.
    const queue = await http().get('/operations/support/cases').set(admin.auth).expect(200);
    const firstNonCritical = queue.body.findIndex((c: { priority: string }) => c.priority !== 'critical');
    const position = queue.body.findIndex((c: { id: string }) => c.id === safetyCase.id);
    expect(firstNonCritical === -1 || position < firstNonCritical).toBe(true);
  });

  it('does not open a safety case for ordinary returns', async () => {
    const order = await deliveredOrder();
    await report(order.orderNumber, order.items[0].id, 'DEFECT_OR_QUALITY_CONCERN').expect(201);
    expect(await prisma.supportCase.count({ where: { orderId: order.id } })).toBe(0);
  });
});
