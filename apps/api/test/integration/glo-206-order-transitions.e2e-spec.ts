import { ConflictException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { OrderStatus } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AiClient } from '../../src/platform/ai';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { createActor, Actor } from '../fixtures/actors';
import { scanIntoCustody } from '../fixtures/custody';
import { OrderingService } from '../../src/modules/ordering/services/ordering.service';

/**
 * GLO-206 GAP-08 / W20 / W21: orders only move forward, a failed delivery attempt does not cancel
 * the order, and dispatching a run moves its orders to shipped.
 */
describe('GLO-206 order transitions and delivery convergence (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ordering: OrderingService;
  let admin: Actor; let driver: Actor;
  let locationId: string;
  const orderIds: string[] = []; const shipmentIds: string[] = []; const batchIds: string[] = [];
  const http = () => request(app.getHttpServer());

  const makeOrder = async (status: OrderStatus) => {
    const order = await prisma.order.create({ data: {
      orderNumber: 'ORD-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(),
      customerName: 'Transition Customer', customerPhone: '01012345678', shippingAddress: '1 Route Street', latitude: 29.9602, longitude: 31.2569, locationSource: 'map_pin',
      totalAmount: 100, codAmount: 100, subtotal: 50, shippingFee: 50, currency: 'EGP', status,
    } });
    orderIds.push(order.id);
    return order.id;
  };
  const makeShipment = async (orderId: string, status: 'packed' | 'out_for_delivery') => {
    const shipment = await prisma.shipment.create({ data: { orderId, locationId, status } });
    shipmentIds.push(shipment.id);
    return shipment.id;
  };
  const statusOf = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useValue(new DeterministicAiClient()).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useLogger(false);
    await app.init();
    prisma = app.get(PrismaService);
    ordering = app.get(OrderingService);
    admin = await createActor(prisma, 'ADMIN');
    driver = await createActor(prisma, 'DRIVER');
    locationId = (await prisma.fulfillmentLocation.create({ data: { name: 'Transition Hub ' + randomUUID(), address: 'T' } })).id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.deliveryBatch.deleteMany({ where: { id: { in: batchIds } } });
      await prisma.shipmentEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
      await prisma.notificationOutbox.deleteMany({ where: { aggregateId: { in: shipmentIds } } });
      await prisma.orderStatusEvent.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.paymentCollection.deleteMany({ where: { orderId: { in: orderIds } } }); // created at dispatch (GLO-214)
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
      await prisma.fulfillmentLocation.deleteMany({ where: { id: locationId } });
    }
    if (app) await app.close();
  });

  it('rejects backward moves and leaving a terminal status', async () => {
    const cases: Array<[OrderStatus, OrderStatus]> = [
      ['delivered', 'packing'], ['delivered', 'cancelled'], ['cancelled', 'delivered'], ['cancelled', 'placed'],
      ['shipped', 'confirmed'], ['packing', 'placed'],
    ];
    for (const [from, to] of cases) {
      const orderId = await makeOrder(from);
      await expect(ordering.updateOrderStatus(orderId, to)).rejects.toBeInstanceOf(ConflictException);
      expect(await statusOf(orderId)).toBe(from);
    }
  });

  it('allows forward progression, pre-delivery cancellation and idempotent repeats', async () => {
    const orderId = await makeOrder('placed');
    await ordering.updateOrderStatus(orderId, 'packing');
    await ordering.updateOrderStatus(orderId, 'packing');
    await ordering.updateOrderStatus(orderId, 'shipped');
    expect(await prisma.orderStatusEvent.count({ where: { orderId } })).toBe(2);
    const cancellable = await makeOrder('shipped');
    await ordering.updateOrderStatus(cancellable, 'cancelled');
    expect(await statusOf(cancellable)).toBe('cancelled');
  });

  it('keeps the order open when a delivery attempt fails', async () => {
    const orderId = await makeOrder('shipped');
    const shipmentId = await makeShipment(orderId, 'out_for_delivery');
    await http().patch(`/fulfillment/shipments/${shipmentId}/status`).set(admin.auth).send({ status: 'failed' }).expect(400); // a failed attempt needs a typed reason (GLO-240)
    await http().patch(`/fulfillment/shipments/${shipmentId}/status`).set(admin.auth).send({ status: 'failed', reasonCode: 'CUSTOMER_UNREACHABLE' }).expect(200);
    expect(await statusOf(orderId)).toBe('shipped');
    const notice = await prisma.notificationOutbox.findFirst({ where: { aggregateId: shipmentId, eventType: 'shipment.failed' } });
    expect(notice).not.toBeNull();
  });

  it('moves orders to shipped when their run is dispatched, and refuses cancelled orders', async () => {
    const orderId = await makeOrder('packing');
    const shipmentId = await makeShipment(orderId, 'packed');
    const batch = await http().post('/fulfillment/delivery-batches').set(admin.auth).send({ hubId: locationId, name: 'Converge', driverId: driver.id }).expect(201);
    batchIds.push(batch.body.id);
    await http().post(`/fulfillment/delivery-batches/${batch.body.id}/stops`).set(admin.auth).send({ stops: [{ shipmentId }] }).expect(201);
    await scanIntoCustody(app, driver, shipmentId);
    await http().post(`/fulfillment/delivery-batches/${batch.body.id}/dispatch`).set(admin.auth).expect(201);
    expect(await statusOf(orderId)).toBe('shipped');
    await http().post(`/fulfillment/delivery-batches/${batch.body.id}/dispatch`).set(admin.auth).expect(400);

    const cancelledOrder = await makeOrder('cancelled');
    const cancelledShipment = await makeShipment(cancelledOrder, 'packed');
    const run = await http().post('/fulfillment/delivery-batches').set(admin.auth).send({ hubId: locationId, name: 'Stale', driverId: driver.id }).expect(201);
    batchIds.push(run.body.id);
    await http().post(`/fulfillment/delivery-batches/${run.body.id}/stops`).set(admin.auth).send({ stops: [{ shipmentId: cancelledShipment }] }).expect(201);
    const refused = await http().post(`/fulfillment/delivery-batches/${run.body.id}/dispatch`).set(admin.auth).expect(400);
    expect(refused.body.message).toMatch(/was cancelled/);
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: cancelledShipment } })).status).toBe('packed');
  });
});
