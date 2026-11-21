import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { signShipmentBarcode } from '../../src/modules/fulfillment/services/shipment-label';
import { AiClient } from '../../src/platform/ai';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { createActor, Actor } from '../fixtures/actors';

/**
 * QA lifecycle matrix — delivery failure. Every reason the courier app offers must be accepted by the API (a rejected reason made the
 * courier's "تعذر التسليم" button fail), and a failed attempt must never look delivered or collected anywhere: the order stays open,
 * the cash stays expected, the parcel stays in the courier's hands until the hub scans it back, and the customer sees a delivery issue.
 */
describe('QA lifecycle matrix: failed delivery (e2e)', () => {
  // The codes of apps/business/lib/labels.ts FAILURE_REASONS, i.e. exactly what the courier can pick.
  const COURIER_REASONS = [
    'CUSTOMER_UNREACHABLE', 'CUSTOMER_NOT_FOUND', 'ITEM_MISMATCH', 'WRONG_ITEM', 'CUSTOMER_REFUSED', 'ADDRESS_NOT_FOUND',
    'RESCHEDULE_REQUESTED', 'PIN_MISMATCH', 'NOT_SERVICEABLE', 'PACKAGE_DAMAGED', 'OTHER',
  ];
  let app: INestApplication;
  let prisma: PrismaService;
  let hub: Actor; let driverA: Actor; let driverB: Actor; let customer: Actor;
  let locationId: string;
  const http = () => request(app.getHttpServer());

  const outForDelivery = async (cod = 260) => {
    const order = await prisma.order.create({ data: {
      orderNumber: 'ORD-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(), customerId: customer.id,
      customerName: 'Failure Customer', customerPhone: '01011112222', shippingAddress: '4 Failure St',
      latitude: 29.9602, longitude: 31.2569, locationSource: 'map_pin',
      subtotal: cod, shippingFee: 0, totalAmount: cod, codAmount: cod, currency: 'EGP', status: 'packing',
    } });
    const shipment = await prisma.shipment.create({ data: { orderId: order.id, locationId, status: 'packed' } });
    await http().post(`/fulfillment/shipments/${shipment.id}/label`).set(hub.auth).expect(201);
    const run = (await http().post('/fulfillment/delivery-batches').set(hub.auth).send({ hubId: locationId, name: 'Failure run', driverId: driverA.id }).expect(201)).body.id as string;
    await http().post(`/fulfillment/delivery-batches/${run}/stops`).set(hub.auth).send({ stops: [{ shipmentId: shipment.id }] }).expect(201);
    await http().post(`/fulfillment/delivery-batches/${run}/handoff-scan`).set(driverA.auth).send({ barcode: signShipmentBarcode(shipment.id) }).expect(201);
    expect((await prisma.deliveryBatch.findUniqueOrThrow({ where: { id: run } })).status).toBe('dispatched');
    return { orderId: order.id, orderNumber: order.orderNumber, shipmentId: shipment.id, runId: run, barcode: signShipmentBarcode(shipment.id) };
  };
  const event = (actor: Actor, shipmentId: string, body: Record<string, unknown>) => http().post(`/fulfillment/shipments/${shipmentId}/events`).set(actor.auth).send(body);

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useValue(new DeterministicAiClient()).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useLogger(false);
    await app.init();
    prisma = app.get(PrismaService);
    hub = await createActor(prisma, 'HUB_OPERATOR');
    driverA = await createActor(prisma, 'DRIVER');
    driverB = await createActor(prisma, 'DRIVER');
    customer = await createActor(prisma, 'CUSTOMER');
    locationId = (await prisma.fulfillmentLocation.create({ data: { name: 'Failure Hub ' + randomUUID(), address: 'Cairo' } })).id;
    await prisma.fulfillmentLocationOperator.create({ data: { locationId, operatorId: hub.id } });
  });
  afterAll(async () => { if (app) await app.close(); });

  it('accepts every reason the courier app offers, and a failed attempt never looks delivered or collected', async () => {
    for (const reasonCode of COURIER_REASONS) {
      const p = await outForDelivery();
      await event(driverA, p.shipmentId, { type: 'FAILED', reasonCode, notes: 'tested' }).expect(201);
      expect((await prisma.shipment.findUniqueOrThrow({ where: { id: p.shipmentId } })).status).toBe('failed');
      expect((await prisma.order.findUniqueOrThrow({ where: { id: p.orderId } })).status).toBe('shipped'); // a failed attempt never cancels or delivers
      expect((await prisma.paymentCollection.findUniqueOrThrow({ where: { orderId: p.orderId } }))).toMatchObject({ status: 'expected', collectedAmount: null });
      expect(await prisma.shipmentEvent.findFirst({ where: { shipmentId: p.shipmentId, type: 'FAILED' } })).toMatchObject({ reasonCode, actorId: driverA.id });
    }
  });

  it('refuses an unknown reason, a missing reason and a delivery after the failure, writing nothing', async () => {
    const p = await outForDelivery();
    await event(driverA, p.shipmentId, { type: 'FAILED', reasonCode: 'TELEPORTED' }).expect(400);
    await event(driverA, p.shipmentId, { type: 'FAILED' }).expect(400);
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: p.shipmentId } })).status).toBe('out_for_delivery');
    await event(driverA, p.shipmentId, { type: 'FAILED', reasonCode: 'CUSTOMER_UNREACHABLE' }).expect(201);
    // A failed parcel is still in the courier's hands: it cannot be delivered, collected or counted until the hub takes it back.
    await event(driverA, p.shipmentId, { type: 'DELIVERED', collectedAmount: 260 }).expect(res => expect([400, 409]).toContain(res.status));
    expect((await prisma.order.findUniqueOrThrow({ where: { id: p.orderId } })).status).toBe('shipped');
    expect(await prisma.paymentCollection.count({ where: { orderId: p.orderId, status: 'collected' } })).toBe(0);
  });

  it('keeps other couriers and customers out, and shows the customer a delivery issue, never a delivery', async () => {
    const p = await outForDelivery();
    await event(driverB, p.shipmentId, { type: 'FAILED', reasonCode: 'CUSTOMER_UNREACHABLE' }).expect(res => expect([403, 404]).toContain(res.status));
    await event(customer, p.shipmentId, { type: 'FAILED', reasonCode: 'CUSTOMER_UNREACHABLE' }).expect(403);
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: p.shipmentId } })).status).toBe('out_for_delivery');

    await event(driverA, p.shipmentId, { type: 'FAILED', reasonCode: 'CUSTOMER_UNREACHABLE' }).expect(201);
    const tracking = (await http().get(`/ordering/orders/${p.orderNumber}/tracking`).set(customer.auth).expect(200)).body;
    expect(tracking.status).toBe('DELIVERY_ISSUE');
    expect(tracking.delivery.deliveredAt).toBeNull();
  });

  it('after the hub scans the parcel back the same order can be sent out again and delivered once', async () => {
    const p = await outForDelivery(180);
    await event(driverA, p.shipmentId, { type: 'FAILED', reasonCode: 'RESCHEDULE_REQUESTED' }).expect(201);
    await event(hub, p.shipmentId, { type: 'RECEIVED_BACK', barcode: p.barcode }).expect(201);
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: p.shipmentId } })).status).toBe('packed');

    const retry = (await http().post('/fulfillment/delivery-batches').set(hub.auth).send({ hubId: locationId, name: 'Retry run', driverId: driverB.id }).expect(201)).body.id as string;
    await http().post(`/fulfillment/delivery-batches/${retry}/stops`).set(hub.auth).send({ stops: [{ shipmentId: p.shipmentId }] }).expect(201);
    await http().post(`/fulfillment/delivery-batches/${retry}/handoff-scan`).set(driverB.auth).send({ barcode: p.barcode }).expect(201);
    expect((await prisma.deliveryBatch.findUniqueOrThrow({ where: { id: retry } })).status).toBe('dispatched');

    await event(driverB, p.shipmentId, { type: 'DELIVERED', collectedAmount: 180 }).expect(201);
    await event(driverB, p.shipmentId, { type: 'DELIVERED', collectedAmount: 180 }).expect(201); // duplicate confirmation: same outcome
    expect(await prisma.shipmentEvent.count({ where: { shipmentId: p.shipmentId, type: 'DELIVERED' } })).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: p.orderId } })).status).toBe('delivered');
    expect(await prisma.paymentCollection.findUniqueOrThrow({ where: { orderId: p.orderId } })).toMatchObject({ status: 'collected', courierId: driverB.id });
    expect((await prisma.deliveryStop.findMany({ where: { shipmentId: p.shipmentId }, orderBy: { createdAt: 'asc' } })).map(s => s.status)).toEqual(['failed', 'delivered']);
  });
});
