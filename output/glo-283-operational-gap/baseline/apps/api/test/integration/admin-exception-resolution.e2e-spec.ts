import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { OrderStatus, ShipmentStatus, SettlementStatus, OrderResolutionStatus, OrderResolutionType } from '@prisma/client';
import { createActor, Actor } from '../fixtures/actors';
import { randomUUID } from 'crypto';

describe('Admin Operational Exception Resolution Guard (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor;
  let customer: Actor;
  let customerId: string;
  let locationId: string;

  const orderIds: string[] = [];
  const caseIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
    prisma = app.get<PrismaService>(PrismaService);

    admin = await createActor(prisma, 'ADMIN');
    customer = await createActor(prisma, 'CUSTOMER');
    customerId = customer.id;

    // Ensure a fulfillment location exists for shipment fixtures
    const location = await prisma.fulfillmentLocation.upsert({
      where: { name: 'Test Exception Resolution Hub' },
      update: {},
      create: {
        name: 'Test Exception Resolution Hub',
        address: '100 Test St, Cairo',
      },
    });
    locationId = location.id;
  });

  afterAll(async () => {
    // Comprehensive cleanup of test-created entities
    await prisma.notificationOutbox.deleteMany({ where: { aggregateType: 'SupportCase' } });
    if (caseIds.length > 0) {
      await prisma.supportCase.deleteMany({ where: { id: { in: caseIds } } });
    }
    if (orderIds.length > 0) {
      await prisma.orderResolutionItem.deleteMany({ where: { resolution: { orderId: { in: orderIds } } } });
      await prisma.orderResolution.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.paymentCollection.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.shipmentItem.deleteMany({ where: { shipment: { orderId: { in: orderIds } } } });
      await prisma.shipment.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.supportCase.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    await app.close();
  });

  async function createTestOrder(status: OrderStatus = OrderStatus.confirmed) {
    const orderNumber = `ORD-EX-${randomUUID().slice(0, 8)}`;
    const order = await prisma.order.create({
      data: {
        orderNumber,
        customerId,
        customerName: 'Test Recipient',
        customerPhone: '+201000000000',
        status,
        currency: 'EGP',
        subtotal: 500.00,
        totalAmount: 500.00,
        shippingAddress: 'Nasr City, Cairo, Egypt',
      },
    });
    orderIds.push(order.id);
    return order;
  }

  // 1. Anti-cosmetic guard
  it('rejects closing a case without documented internal notes (anti-cosmetic guard)', async () => {
    const order = await createTestOrder();
    const supportCase = await prisma.supportCase.create({
      data: {
        title: 'Pending Investigation',
        description: 'Investigating order anomaly before fulfillment',
        category: 'other',
        priority: 'medium',
        orderId: order.id,
      },
    });
    caseIds.push(supportCase.id);

    // Attempt to close without internal notes
    const res = await request(app.getHttpServer())
      .patch(`/operations/support/cases/${supportCase.id}`)
      .set(admin.auth)
      .send({ status: 'closed' })
      .expect(400);

    expect(res.body.message).toContain('requires documented internal notes');

    // Attempt to close with trivial notes (< 10 chars)
    const res2 = await request(app.getHttpServer())
      .patch(`/operations/support/cases/${supportCase.id}`)
      .set(admin.auth)
      .send({ status: 'closed', internalNotes: 'done' })
      .expect(400);

    expect(res2.body.message).toContain('requires documented internal notes');
  });

  // 2. Linkage verification (unrelated or missing domain entity)
  it('rejects closing operational exceptions that lack verified domain entity linkage', async () => {
    const supportCase = await prisma.supportCase.create({
      data: {
        title: 'Unlinked Cancellation Exception',
        description: 'No order or outcome linked',
        category: 'cancellation',
        priority: 'high',
      },
    });
    caseIds.push(supportCase.id);

    const res = await request(app.getHttpServer())
      .patch(`/operations/support/cases/${supportCase.id}`)
      .set(admin.auth)
      .send({
        status: 'resolved',
        internalNotes: 'Trying to close an exception without linking any order',
      })
      .expect(400);

    expect(res.body.message).toContain('case must be linked to an order with verified domain outcome');
  });

  // 3. Cancellation Exception
  it('rejects closing cancellation exception when order is NOT cancelled in ordering domain', async () => {
    const order = await createTestOrder(OrderStatus.confirmed);
    const supportCase = await prisma.supportCase.create({
      data: {
        title: `Cancellation Exception — ${order.orderNumber}`,
        description: 'Customer requested order cancellation',
        category: 'cancellation',
        priority: 'high',
        orderId: order.id,
      },
    });
    caseIds.push(supportCase.id);

    const res = await request(app.getHttpServer())
      .patch(`/operations/support/cases/${supportCase.id}`)
      .set(admin.auth)
      .send({
        status: 'resolved',
        internalNotes: 'Order cancellation verbally agreed by phone',
      })
      .expect(400);

    expect(res.body.message).toContain('order is not cancelled in the ordering domain');
  });

  it('rejects closing cancellation exception when order is cancelled but shipment is still in physical transit', async () => {
    const order = await createTestOrder(OrderStatus.cancelled);
    const shipment = await prisma.shipment.create({
      data: {
        orderId: order.id,
        locationId,
        status: ShipmentStatus.dispatched,
      },
    });
    const supportCase = await prisma.supportCase.create({
      data: {
        title: `Cancellation with In-Transit Shipment — ${order.orderNumber}`,
        description: 'Order cancelled but driver has custody',
        category: 'cancellation',
        priority: 'high',
        orderId: order.id,
      },
    });
    caseIds.push(supportCase.id);

    const res = await request(app.getHttpServer())
      .patch(`/operations/support/cases/${supportCase.id}`)
      .set(admin.auth)
      .send({
        status: 'resolved',
        internalNotes: 'Closing cancellation exception while shipment is still on the road',
      })
      .expect(400);

    expect(res.body.message).toContain('still in active transit/preparation');

    // Clean up shipment status to cancelled
    await prisma.shipment.update({
      where: { id: shipment.id },
      data: { status: ShipmentStatus.cancelled },
    });
  });

  it('permits resolving cancellation exception after order is cancelled and custody settled', async () => {
    const order = await createTestOrder(OrderStatus.cancelled);
    const supportCase = await prisma.supportCase.create({
      data: {
        title: `Settled Cancellation — ${order.orderNumber}`,
        description: 'Order cancelled, no transit active',
        category: 'cancellation',
        priority: 'high',
        orderId: order.id,
      },
    });
    caseIds.push(supportCase.id);

    const res = await request(app.getHttpServer())
      .patch(`/operations/support/cases/${supportCase.id}`)
      .set(admin.auth)
      .send({
        status: 'resolved',
        internalNotes: 'Order cancelled in ordering domain; stock returned cleanly',
      })
      .expect(200);

    expect(res.body.status).toBe('resolved');

    const outbox = await prisma.notificationOutbox.findFirst({
      where: {
        aggregateId: supportCase.id,
        eventType: 'support.case_resolved',
      },
    });
    expect(outbox).toBeTruthy();
  });

  // 4. Delivery Exception
  it('rejects closing delivery exception when order is not terminal or shipment is in transit', async () => {
    const order = await createTestOrder(OrderStatus.confirmed);
    await prisma.shipment.create({
      data: {
        orderId: order.id,
        locationId,
        status: ShipmentStatus.out_for_delivery,
      },
    });
    const supportCase = await prisma.supportCase.create({
      data: {
        title: `Delivery Exception — ${order.orderNumber}`,
        description: 'Customer not answering at the door',
        category: 'delivery',
        priority: 'high',
        orderId: order.id,
      },
    });
    caseIds.push(supportCase.id);

    const res = await request(app.getHttpServer())
      .patch(`/operations/support/cases/${supportCase.id}`)
      .set(admin.auth)
      .send({
        status: 'resolved',
        internalNotes: 'Attempting to resolve delivery exception while courier is out',
      })
      .expect(400);

    expect(res.body.message).toContain('Order must be in a terminal disposition');
  });

  it('permits resolving delivery exception when order and shipment are in terminal delivered state', async () => {
    const order = await createTestOrder(OrderStatus.delivered);
    await prisma.shipment.create({
      data: {
        orderId: order.id,
        locationId,
        status: ShipmentStatus.delivered,
      },
    });
    const supportCase = await prisma.supportCase.create({
      data: {
        title: `Delivery Exception Resolved — ${order.orderNumber}`,
        description: 'Customer received package on second attempt',
        category: 'delivery',
        priority: 'high',
        orderId: order.id,
      },
    });
    caseIds.push(supportCase.id);

    const res = await request(app.getHttpServer())
      .patch(`/operations/support/cases/${supportCase.id}`)
      .set(admin.auth)
      .send({
        status: 'resolved',
        internalNotes: 'Delivered successfully on 2nd attempt with OTP confirmed',
      })
      .expect(200);

    expect(res.body.status).toBe('resolved');
  });

  // 5. Return / Refund Exception
  it('rejects closing return exception when return resolution is still pending in domain', async () => {
    const order = await createTestOrder(OrderStatus.delivered);
    const resolution = await prisma.orderResolution.create({
      data: {
        orderId: order.id,
        type: OrderResolutionType.return,
        status: OrderResolutionStatus.requested,
        actorId: customerId,
      },
    });
    const supportCase = await prisma.supportCase.create({
      data: {
        title: `Return Exception — ${order.orderNumber}`,
        description: 'Customer wants to return broken bottle',
        category: 'return',
        priority: 'medium',
        orderId: order.id,
      },
    });
    caseIds.push(supportCase.id);

    const res = await request(app.getHttpServer())
      .patch(`/operations/support/cases/${supportCase.id}`)
      .set(admin.auth)
      .send({
        status: 'resolved',
        internalNotes: 'Premature resolution while return request is still pending',
      })
      .expect(400);

    expect(res.body.message).toContain('return resolution');
    expect(res.body.message).toContain('is still pending');

    // Settle the return resolution
    await prisma.orderResolution.update({
      where: { id: resolution.id },
      data: { status: OrderResolutionStatus.resolved },
    });

    // Now resolving the support case succeeds
    const res2 = await request(app.getHttpServer())
      .patch(`/operations/support/cases/${supportCase.id}`)
      .set(admin.auth)
      .send({
        status: 'resolved',
        internalNotes: 'Return resolution completed and refunded cleanly',
      })
      .expect(200);

    expect(res2.body.status).toBe('resolved');
  });

  // 6. Payment / COD Discrepancy Exception
  it('rejects closing payment exception when PaymentCollection is disputed or uncollected', async () => {
    const order = await createTestOrder(OrderStatus.delivered);
    await prisma.paymentCollection.create({
      data: {
        orderId: order.id,
        expectedAmount: 500.00,
        currency: 'EGP',
        status: SettlementStatus.disputed,
        notes: 'Driver collected 400 instead of 500',
      },
    });
    const supportCase = await prisma.supportCase.create({
      data: {
        title: `COD Discrepancy — ${order.orderNumber}`,
        description: '100 EGP short on cash drop',
        category: 'payment',
        priority: 'high',
        orderId: order.id,
      },
    });
    caseIds.push(supportCase.id);

    const res = await request(app.getHttpServer())
      .patch(`/operations/support/cases/${supportCase.id}`)
      .set(admin.auth)
      .send({
        status: 'resolved',
        internalNotes: 'Driver verbally promised to bring the remaining cash tomorrow',
      })
      .expect(400);

    expect(res.body.message).toContain('cash collection is still disputed');

    // Reconcile and settle the collection in finance domain
    await prisma.paymentCollection.update({
      where: { orderId: order.id },
      data: { status: SettlementStatus.settled },
    });

    const res2 = await request(app.getHttpServer())
      .patch(`/operations/support/cases/${supportCase.id}`)
      .set(admin.auth)
      .send({
        status: 'resolved',
        internalNotes: 'Cash difference deposited and settlement batch finalized',
      })
      .expect(200);

    expect(res2.body.status).toBe('resolved');
  });

  // 7. Duplicate Request Idempotency
  it('handles duplicate resolve requests idempotently without error', async () => {
    const order = await createTestOrder(OrderStatus.cancelled);
    const supportCase = await prisma.supportCase.create({
      data: {
        title: `Idempotent Test Case — ${order.orderNumber}`,
        description: 'Duplicate resolution request handling',
        category: 'cancellation',
        priority: 'low',
        orderId: order.id,
      },
    });
    caseIds.push(supportCase.id);

    // First resolve
    const res1 = await request(app.getHttpServer())
      .patch(`/operations/support/cases/${supportCase.id}`)
      .set(admin.auth)
      .send({
        status: 'resolved',
        internalNotes: 'Initial resolution note with valid audit trail',
      })
      .expect(200);

    expect(res1.body.status).toBe('resolved');

    // Immediate duplicate resolve request
    const res2 = await request(app.getHttpServer())
      .patch(`/operations/support/cases/${supportCase.id}`)
      .set(admin.auth)
      .send({
        status: 'resolved',
        internalNotes: 'Repeated identical resolution request',
      })
      .expect(200);

    expect(res2.body.status).toBe('resolved');
    expect(res2.body.id).toBe(supportCase.id);
  });

  // 8. Concurrent Resolution Protection
  it('protects against race conditions during concurrent resolution via advisory transaction lock', async () => {
    const order = await createTestOrder(OrderStatus.cancelled);
    const supportCase = await prisma.supportCase.create({
      data: {
        title: `Concurrency Test Case — ${order.orderNumber}`,
        description: 'Testing parallel resolution requests',
        category: 'cancellation',
        priority: 'high',
        orderId: order.id,
      },
    });
    caseIds.push(supportCase.id);

    // Fire two resolve requests concurrently
    const [p1, p2] = await Promise.all([
      request(app.getHttpServer())
        .patch(`/operations/support/cases/${supportCase.id}`)
        .set(admin.auth)
        .send({
          status: 'resolved',
          internalNotes: 'Agent 1 resolving order cancellation',
        }),
      request(app.getHttpServer())
        .patch(`/operations/support/cases/${supportCase.id}`)
        .set(admin.auth)
        .send({
          status: 'resolved',
          internalNotes: 'Agent 2 resolving order cancellation',
        }),
    ]);

    expect(p1.status).toBe(200);
    expect(p2.status).toBe(200);
    expect(p1.body.status).toBe('resolved');
    expect(p2.body.status).toBe('resolved');

    // Exactly one resolution outbox event was recorded (idempotent / deduplicated)
    const outboxEvents = await prisma.notificationOutbox.findMany({
      where: {
        aggregateId: supportCase.id,
        eventType: 'support.case_resolved',
      },
    });
    expect(outboxEvents.length).toBe(1);
  });
});
