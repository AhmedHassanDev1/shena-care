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
 * GLO-214 (W22): the cash a stop should bring back is fixed at dispatch; the driver declares what was
 * received at the door (custody); the hub count at settlement stays a separate figure.
 */
describe('GLO-214 driver COD declaration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor; let hub: Actor; let driver: Actor; let otherDriver: Actor;
  let locationId: string;
  const orderIds: string[] = []; const shipmentIds: string[] = []; const batchIds: string[] = [];
  const settlementRefs: string[] = [];
  const http = () => request(app.getHttpServer());

  /** A packed COD order on a planning run of `driver`, dispatched through the API. */
  const dispatchedStop = async (codAmount: number) => {
    const order = await prisma.order.create({ data: {
      orderNumber: 'ORD-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(),
      customerName: 'Cash Customer', customerPhone: '01011112222', shippingAddress: '3 Cash St', latitude: 29.9602, longitude: 31.2569, locationSource: 'map_pin',
      subtotal: codAmount, shippingFee: 0, totalAmount: codAmount, codAmount, currency: 'EGP', status: 'packing',
    } });
    orderIds.push(order.id);
    const shipment = await prisma.shipment.create({ data: { orderId: order.id, locationId, status: 'packed' } });
    shipmentIds.push(shipment.id);
    const batch = await prisma.deliveryBatch.create({ data: { locationId, driverId: driver.id, status: 'planning',
      stops: { create: [{ shipmentId: shipment.id, sequence: 1 }] } } });
    batchIds.push(batch.id);
    await http().post(`/fulfillment/delivery-batches/${batch.id}/dispatch`).set(hub.auth).expect(201);
    return { orderId: order.id, shipmentId: shipment.id };
  };
  const collection = (orderId: string) => prisma.paymentCollection.findUnique({ where: { orderId } });
  const deliver = (shipmentId: string, actor: Actor, body: Record<string, unknown>) =>
    http().post(`/fulfillment/shipments/${shipmentId}/events`).set(actor.auth).send({ type: 'DELIVERED', ...body });

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
    otherDriver = await createActor(prisma, 'DRIVER');
    locationId = (await prisma.fulfillmentLocation.create({ data: { name: 'W22 Hub ' + randomUUID(), address: 'C' } })).id;
    await prisma.fulfillmentLocationOperator.create({ data: { locationId, operatorId: hub.id } });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.paymentCollection.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.courierSettlementBatch.deleteMany({ where: { reference: { in: settlementRefs } } });
      await prisma.deliveryBatch.deleteMany({ where: { id: { in: batchIds } } });
      await prisma.shipmentEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
      await prisma.notificationOutbox.deleteMany({ where: { aggregateId: { in: shipmentIds } } });
      await prisma.orderStatusEvent.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
      await prisma.fulfillmentLocationOperator.deleteMany({ where: { locationId } });
      await prisma.fulfillmentLocation.deleteMany({ where: { id: locationId } });
    }
    if (app) await app.close();
  });

  it('fixes the expected cash when the run is dispatched', async () => {
    const { orderId } = await dispatchedStop(1050);
    const expected = await collection(orderId);
    expect(expected).toMatchObject({ status: 'expected', declaredAmount: null, collectedAmount: null });
    expect(Number(expected!.expectedAmount)).toBe(1050);
  });

  it('requires the driver to declare the cash received, once', async () => {
    const { orderId, shipmentId } = await dispatchedStop(1050);
    await deliver(shipmentId, driver, {}).expect(400);
    await deliver(shipmentId, driver, { collectedAmount: -5 }).expect(400);
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })).status).toBe('out_for_delivery');

    await deliver(shipmentId, driver, { collectedAmount: 1000 }).expect(201);
    const declared = await collection(orderId);
    expect(declared).toMatchObject({ status: 'collected', courierId: driver.id, collectedAmount: null });
    expect(Number(declared!.declaredAmount)).toBe(1000);
    expect(Number(declared!.expectedAmount)).toBe(1050);
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })).status).toBe('delivered');

    await deliver(shipmentId, driver, { collectedAmount: 1000 }).expect(201); // replay is harmless
    await deliver(shipmentId, driver, { collectedAmount: 1050 }).expect(409); // no silent rewrite
    expect(Number((await collection(orderId))!.declaredAmount)).toBe(1000);

    const manifest = await http().get('/fulfillment/driver/runs').set(driver.auth).expect(200);
    const stop = manifest.body.flatMap((r: { stops: Array<{ shipmentId: string }> }) => r.stops)
      .find((s: { shipmentId: string }) => s.shipmentId === shipmentId);
    expect(stop).toMatchObject({ codDue: 1050, cashDeclared: 1000 });
  });

  it('accepts the declaration through the status endpoint and keeps it to the delivering driver', async () => {
    const { orderId, shipmentId } = await dispatchedStop(480);
    await http().patch(`/fulfillment/shipments/${shipmentId}/status`).set(otherDriver.auth)
      .send({ status: 'delivered', collectedAmount: 480 }).expect(404);
    await http().patch(`/fulfillment/shipments/${shipmentId}/status`).set(driver.auth)
      .send({ status: 'failed', collectedAmount: 480 }).expect(400);
    await http().patch(`/fulfillment/shipments/${shipmentId}/status`).set(driver.auth)
      .send({ status: 'delivered', collectedAmount: 480 }).expect(200);
    expect(Number((await collection(orderId))!.declaredAmount)).toBe(480);
  });

  it('never lets hub or admin declare door cash, and settlement keeps both figures', async () => {
    const { orderId, shipmentId } = await dispatchedStop(300);
    await deliver(shipmentId, admin, { collectedAmount: 300 }).expect(400);
    await deliver(shipmentId, driver, { collectedAmount: 300 }).expect(201);

    const reference = 'W22-' + randomUUID();
    settlementRefs.push(reference);
    await http().post('/ordering/settlements/batch').set(admin.auth).send({
      courierId: driver.id, reference, currency: 'EGP', totalCollected: 290,
      collections: [{ orderId, collectedAmount: 290 }],
    }).expect(201);
    const settled = await collection(orderId);
    expect(settled!.status).toBe('short');
    expect(Number(settled!.declaredAmount)).toBe(300);
    expect(Number(settled!.collectedAmount)).toBe(290);
  });
});
