import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { OrderStatus, ShipmentStatus } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AiClient } from '../../src/platform/ai';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { createActor, Actor } from '../fixtures/actors';

/**
 * GLO-210 (W18): thermal documents come from the canonical order snapshot, reprints keep one
 * shipment identity, "printed" is never inferred from label generation, and shipments only move
 * forward — an unverified shipment cannot be packed.
 */
describe('GLO-210 shipment documents, print lifecycle and transitions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let hub: Actor; let otherHub: Actor; let driver: Actor;
  let locationId: string;
  const orderIds: string[] = []; const shipmentIds: string[] = []; const locationIds: string[] = [];
  const http = () => request(app.getHttpServer());

  const makeOrder = async (status: OrderStatus = 'packing') => {
    const order = await prisma.order.create({ data: {
      orderNumber: 'ORD-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(),
      customerName: 'Hiba T.', customerPhone: '01012345678', governorate: 'Cairo', area: 'Heliopolis',
      shippingAddress: '12 Ahram St, floor 4', notes: 'Call 10 minutes before',
      subtotal: 690, shippingFee: 50, totalAmount: 710, codAmount: 710, currency: 'EGP', status,
      items: { create: [
        { skuId: randomUUID(), quantity: 2, price: 210, currency: 'EGP', productName: 'Niacinamide Serum 10%', variantName: '30 ml',
          skuCode: 'SRM-030', discountAmount: 30, lineTotal: 390 },
        { skuId: randomUUID(), quantity: 1, price: 270, currency: 'EGP', productName: 'Hydra Cream', variantName: '250 ml',
          skuCode: 'CRM-250', lineTotal: 270 },
      ] },
    }, include: { items: true } });
    orderIds.push(order.id);
    return order;
  };
  const makeShipment = async (orderId: string, status: ShipmentStatus) => {
    const shipment = await prisma.shipment.create({ data: { orderId, locationId, status } });
    shipmentIds.push(shipment.id);
    return shipment.id;
  };
  const statusOf = async (id: string) => (await prisma.shipment.findUniqueOrThrow({ where: { id } })).status;
  const events = (shipmentId: string, type: string) => prisma.shipmentEvent.count({ where: { shipmentId, type } });

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useValue(new DeterministicAiClient()).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useLogger(false);
    await app.init();
    prisma = app.get(PrismaService);

    hub = await createActor(prisma, 'HUB_OPERATOR');
    otherHub = await createActor(prisma, 'HUB_OPERATOR');
    driver = await createActor(prisma, 'DRIVER');
    locationId = (await prisma.fulfillmentLocation.create({ data: { name: 'W18 Hub ' + randomUUID(), address: 'H' } })).id;
    locationIds.push(locationId);
    await prisma.fulfillmentLocationOperator.create({ data: { locationId, operatorId: hub.id } });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.shipmentEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.shipment.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
      await prisma.orderStatusEvent.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
      await prisma.fulfillmentLocationOperator.deleteMany({ where: { locationId: { in: locationIds } } });
      await prisma.fulfillmentLocation.deleteMany({ where: { id: { in: locationIds } } });
    }
    if (app) await app.close();
  });

  describe('documents', () => {
    it('builds the inside receipt from the order snapshot and keeps prices off the outside slip', async () => {
      const order = await makeOrder();
      const shipmentId = await makeShipment(order.id, 'prepared');
      const res = await http().get(`/fulfillment/shipments/${shipmentId}/documents`).set(hub.auth).expect(200);

      const { customerReceipt: receipt, shippingSlip: slip } = res.body;
      expect(receipt.orderNumber).toBe(order.orderNumber);
      expect(receipt.lines).toEqual(expect.arrayContaining([
        { name: 'Niacinamide Serum 10%', variant: '30 ml', skuCode: 'SRM-030', quantity: 2, unitPrice: 210, discount: 30, lineTotal: 390 },
        { name: 'Hydra Cream', variant: '250 ml', skuCode: 'CRM-250', quantity: 1, unitPrice: 270, discount: null, lineTotal: 270 },
      ]));
      expect(receipt).toMatchObject({ subtotal: 690, discountTotal: 30, shippingFee: 50, total: 710, codDue: 710 });

      expect(slip).toMatchObject({
        orderNumber: order.orderNumber, recipientName: 'Hiba T.', recipientPhone: '01012345678',
        area: 'Heliopolis', address: '12 Ahram St, floor 4', deliveryNotes: 'Call 10 minutes before',
        codDue: 710, packageCount: 1, itemCount: 3,
      });
      expect(slip.barcode).toMatch(/^SHP-/);
      expect(JSON.stringify(slip)).not.toMatch(/Niacinamide|Hydra|unitPrice|lineTotal|lines/);
      // Reading documents is not printing.
      expect(await prisma.shipmentEvent.count({ where: { shipmentId } })).toBe(0);
    });

    it('is limited to the assigned hub, printable statuses and live orders', async () => {
      const order = await makeOrder();
      const prepared = await makeShipment(order.id, 'prepared');
      await http().get(`/fulfillment/shipments/${prepared}/documents`).expect(401);
      await http().get(`/fulfillment/shipments/${prepared}/documents`).set(driver.auth).expect(403);
      await http().get(`/fulfillment/shipments/${prepared}/documents`).set(otherHub.auth).expect(403);

      const pending = await makeShipment((await makeOrder()).id, 'pending');
      await http().get(`/fulfillment/shipments/${pending}/documents`).set(hub.auth).expect(400);

      const cancelled = await makeShipment((await makeOrder('cancelled')).id, 'prepared');
      await http().get(`/fulfillment/shipments/${cancelled}/documents`).set(hub.auth).expect(409);
      await http().post(`/fulfillment/shipments/${cancelled}/label`).set(hub.auth).expect(409);
      await http().post(`/fulfillment/shipments/${cancelled}/events`).set(hub.auth).send({ type: 'PACKED' }).expect(409);
      expect(await statusOf(cancelled)).toBe('prepared');
    });
  });

  describe('print lifecycle', () => {
    it('reprints keep one shipment identity and never claim paper was printed', async () => {
      const order = await makeOrder();
      const shipmentId = await makeShipment(order.id, 'prepared');
      const first = await http().post(`/fulfillment/shipments/${shipmentId}/label`).set(hub.auth).expect(201);
      const second = await http().post(`/fulfillment/shipments/${shipmentId}/label`).set(hub.auth).expect(201);
      const docs = await http().get(`/fulfillment/shipments/${shipmentId}/documents`).set(hub.auth).expect(200);

      expect(second.body.barcode).toBe(first.body.barcode);
      expect(docs.body.shippingSlip.barcode).toBe(first.body.barcode);
      expect(await prisma.shipment.count({ where: { orderId: order.id } })).toBe(1);
      expect(await statusOf(shipmentId)).toBe('prepared');
      expect(await events(shipmentId, 'LABEL_GENERATED')).toBe(2);
      expect(await events(shipmentId, 'LABEL_PRINTED')).toBe(0);
    });

    it('records print outcomes only as explicit hub confirmations', async () => {
      const shipmentId = await makeShipment((await makeOrder()).id, 'prepared');
      await http().post(`/fulfillment/shipments/${shipmentId}/events`).set(hub.auth).send({ type: 'LABEL_PRINTED' }).expect(400);
      await http().post(`/fulfillment/shipments/${shipmentId}/label`).set(hub.auth).expect(201);
      await http().post(`/fulfillment/shipments/${shipmentId}/events`).set(hub.auth)
        .send({ type: 'PRINT_FAILED', notes: 'paper jam' }).expect(201);
      await http().post(`/fulfillment/shipments/${shipmentId}/events`).set(hub.auth).send({ type: 'LABEL_PRINTED' }).expect(201);
      await http().post(`/fulfillment/shipments/${shipmentId}/events`).set(hub.auth).send({ type: 'RECEIPT_PRINTED' }).expect(201);
      await http().post(`/fulfillment/shipments/${shipmentId}/events`).set(hub.auth).send({ type: 'LABEL_GENERATED' }).expect(400);
      expect(await statusOf(shipmentId)).toBe('prepared');
    });
  });

  describe('transitions', () => {
    it('cannot pack or skip ahead without scan-verified preparation', async () => {
      const shipmentId = await makeShipment((await makeOrder()).id, 'pending');
      await http().post(`/fulfillment/shipments/${shipmentId}/events`).set(hub.auth).send({ type: 'PACKED' }).expect(409);
      expect(await prisma.shipmentEvent.count({ where: { shipmentId } })).toBe(0);
      for (const status of ['packed', 'prepared', 'out_for_delivery', 'delivered']) {
        await http().patch(`/fulfillment/shipments/${shipmentId}/status`).set(hub.auth).send({ status }).expect(409);
      }
      expect(await statusOf(shipmentId)).toBe('pending');
      await http().post(`/fulfillment/shipments/${shipmentId}/events`).set(hub.auth).send({ type: 'SHIPPED_SOMEHOW' }).expect(400);
    });

    it('moves forward from verified preparation and rejects going back', async () => {
      const shipmentId = await makeShipment((await makeOrder()).id, 'prepared');
      await http().post(`/fulfillment/shipments/${shipmentId}/events`).set(hub.auth).send({ type: 'PACKED' }).expect(201);
      await http().post(`/fulfillment/shipments/${shipmentId}/events`).set(hub.auth).send({ type: 'PACKED' }).expect(201);
      expect(await statusOf(shipmentId)).toBe('packed');
      await http().patch(`/fulfillment/shipments/${shipmentId}/status`).set(hub.auth).send({ status: 'delivered' }).expect(409);
      await http().patch(`/fulfillment/shipments/${shipmentId}/status`).set(hub.auth).send({ status: 'prepared' }).expect(409);
      expect(await statusOf(shipmentId)).toBe('packed');
    });
  });

  it('allocates one shipment per order under concurrent requests', async () => {
    const order = await makeOrder('confirmed');
    const results = await Promise.all([0, 1].map(() =>
      http().post('/fulfillment/shipments/allocate').set(hub.auth).send({ orderId: order.id, locationId })));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses[0]).toBe(201);
    expect([400, 409]).toContain(statuses[1]);
    const created = results.find((r) => r.status === 201)!;
    shipmentIds.push(created.body.id);
    expect(await prisma.shipment.count({ where: { orderId: order.id } })).toBe(1);
  });
});
