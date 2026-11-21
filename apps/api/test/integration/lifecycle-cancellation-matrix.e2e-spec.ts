import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { DomainEventsService } from '../../src/platform/events/domain-events.service';
import { OrderingService } from '../../src/modules/ordering/services/ordering.service';
import { signShipmentBarcode } from '../../src/modules/fulfillment/services/shipment-label';
import { AiClient } from '../../src/platform/ai';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { createActor, Actor } from '../fixtures/actors';
import { createSellableSku } from '../fixtures/sellable-sku';
import { placeGuestOrder } from '../fixtures/checkout';
import { takeCustody } from '../fixtures/custody';

/**
 * QA lifecycle matrix — cancellation at every stage a parcel or order can be in, with the isolation guarantees the owner asked for:
 * cancelling one order never touches another order sharing its purchase order or its delivery run, a refused cancellation changes
 * nothing, and racing cancel/dispatch commands leave one consistent outcome. Disposable fixtures only (run on a *_test database).
 */
describe('QA lifecycle matrix: cancellation stages and isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: DomainEventsService;
  let admin: Actor; let hub: Actor; let driverA: Actor; let customer: Actor;
  let locationId: string;
  const http = () => request(app.getHttpServer());

  const settleEvents = async (aggregateId: string) => {
    for (let i = 0; i < 100; i++) {
      await events.dispatchPending({ aggregateId });
      if (!await prisma.domainEvent.count({ where: { aggregateId, status: { not: 'delivered' } } })) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  };
  const makeOrder = (status: 'packing' | 'placed', cod: number, extra: Record<string, unknown> = {}) => prisma.order.create({ data: {
    orderNumber: 'ORD-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(),
    customerName: 'Matrix Customer', customerPhone: '01011112222', shippingAddress: '4 Matrix St',
    latitude: 29.9602, longitude: 31.2569, locationSource: 'map_pin',
    subtotal: cod, shippingFee: 0, totalAmount: cod, codAmount: cod, currency: 'EGP', status, ...extra,
  } });
  /** A packed parcel with a printed label, ready for a run. */
  const packed = async (cod = 300, extra: Record<string, unknown> = {}) => {
    const order = await makeOrder('packing', cod, extra);
    const shipment = await prisma.shipment.create({ data: { orderId: order.id, locationId, status: 'packed' } });
    await http().post(`/fulfillment/shipments/${shipment.id}/label`).set(hub.auth).expect(201);
    return { orderId: order.id, orderNumber: order.orderNumber, shipmentId: shipment.id, barcode: signShipmentBarcode(shipment.id) };
  };
  const run = async (driver: Actor | null) =>
    (await http().post('/fulfillment/delivery-batches').set(hub.auth).send({ hubId: locationId, name: 'Matrix run', ...(driver ? { driverId: driver.id } : {}) }).expect(201)).body.id as string;
  const addStop = (runId: string, shipmentId: string) => http().post(`/fulfillment/delivery-batches/${runId}/stops`).set(hub.auth).send({ stops: [{ shipmentId }] });
  const courierScan = (runId: string, barcode: string) => http().post(`/fulfillment/delivery-batches/${runId}/handoff-scan`).set(driverA.auth).send({ barcode });
  const cancel = (orderId: string, actor: Actor = admin) => http().post(`/ordering/orders/${orderId}/cancel`).set(actor.auth).send({ reasonCode: 'CUSTOMER_REQUEST' });
  const orderStatus = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id } })).status;
  const shipmentStatus = async (id: string) => (await prisma.shipment.findUniqueOrThrow({ where: { id } })).status;
  const batchStatus = async (id: string) => (await prisma.deliveryBatch.findUniqueOrThrow({ where: { id } })).status;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useValue(new DeterministicAiClient()).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useLogger(false);
    await app.init();
    prisma = app.get(PrismaService);
    events = app.get(DomainEventsService);
    admin = await createActor(prisma, 'ADMIN');
    hub = await createActor(prisma, 'HUB_OPERATOR');
    driverA = await createActor(prisma, 'DRIVER');
    customer = await createActor(prisma, 'CUSTOMER');
    locationId = (await prisma.fulfillmentLocation.create({ data: { name: 'Matrix Hub ' + randomUUID(), address: 'Cairo' } })).id;
    await prisma.fulfillmentLocationOperator.create({ data: { locationId, operatorId: hub.id } });
  });
  afterAll(async () => { if (app) await app.close(); });

  describe('shared purchase order', () => {
    it('cancelling one order leaves the other order, its allocation and the purchase order intact', async () => {
      const sku = await createSellableSku(prisma);
      const supplier = await createActor(prisma, 'SUPPLIER', sku.supplierId);
      const a = await placeGuestOrder(app, [{ skuId: sku.id, quantity: 2 }]);
      const b = await placeGuestOrder(app, [{ skuId: sku.id, quantity: 1 }]);
      await settleEvents(a.id); await settleEvents(b.id);
      const [po] = (await http().post('/purchase-orders/batches').set(admin.auth).send({ supplierId: sku.supplierId }).expect(201)).body.purchaseOrders;
      expect(po.lines[0].requestedQuantity).toBe(3);
      await http().post(`/purchase-orders/${po.id}/confirm`).set(supplier.auth).send({ lines: [{ id: po.lines[0].id, status: 'confirmed_full' }] }).expect(201);
      await settleEvents(po.id);

      const done = await cancel(a.id).expect(201);
      // The cancelled order's supplier commitment becomes a human exception; nothing else is cancelled.
      expect(done.body.supplierCommitments).toEqual([expect.objectContaining({ purchaseOrderId: po.id })]);
      expect(await orderStatus(a.id)).toBe('cancelled');
      expect(await orderStatus(b.id)).toBe('placed');
      expect(await prisma.supplyRequirement.count({ where: { supplyRequest: { orderId: b.id }, releasedAt: null } })).toBeGreaterThan(0);
      expect(await prisma.supplyRequirement.count({ where: { supplyRequest: { orderId: a.id }, releasedAt: null } })).toBe(0);
      expect((await prisma.supplierPurchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).not.toBe('cancelled');
      expect(await prisma.notificationOutbox.count({ where: { aggregateId: b.id, eventType: 'order.cancelled' } })).toBe(0);

      // The surviving order can still be received; the cancelled one cannot.
      const link = (orderId: string) => po.lines[0].allocations.find((x: { orderId: string }) => x.orderId === orderId);
      const receive = (order: { id: string }, quantity: number) => http().post('/fulfillment/receipts').set(hub.auth).send({
        locationId, allocationId: link(order.id).sourceAllocationId, orderId: order.id, orderItemId: link(order.id).orderItemId,
        skuId: sku.id, variantName: sku.variantName, barcodeScanned: sku.barcode, quantity, condition: 'ACCEPTABLE', expiryDate: '2031-12-31', idempotencyKey: randomUUID(),
      });
      await receive(a, 2).expect(409);
      await receive(b, 1).expect(201);
      expect(await prisma.fulfillmentReceipt.count({ where: { orderId: a.id } })).toBe(0);
    });
  });

  describe('shared delivery run', () => {
    it('cancelling one stop leaves the other stops, their custody and the run intact; the run still leaves once every remaining parcel is scanned', async () => {
      const [p1, p2, p3] = [await packed(100), await packed(200), await packed(300)];
      const runId = await run(driverA);
      for (const p of [p1, p2, p3]) await addStop(runId, p.shipmentId).expect(201);
      await courierScan(runId, p1.barcode).expect(201);

      await cancel(p2.orderId).expect(201);
      expect(await orderStatus(p2.orderId)).toBe('cancelled');
      expect(await shipmentStatus(p2.shipmentId)).toBe('cancelled');
      expect(await prisma.deliveryStop.count({ where: { shipmentId: p2.shipmentId } })).toBe(0);
      for (const p of [p1, p3]) {
        expect(await orderStatus(p.orderId)).toBe('packing');
        expect(await shipmentStatus(p.shipmentId)).toBe('packed');
        expect(await prisma.deliveryStop.count({ where: { shipmentId: p.shipmentId, status: 'active' } })).toBe(1);
      }
      expect(await batchStatus(runId)).toBe('planning');
      expect(await prisma.shipmentEvent.count({ where: { shipmentId: p1.shipmentId, type: 'HANDOFF_SCANNED' } })).toBe(1);

      await courierScan(runId, p3.barcode).expect(201);
      expect(await batchStatus(runId)).toBe('dispatched');
      for (const p of [p1, p3]) {
        expect(await orderStatus(p.orderId)).toBe('shipped');
        expect((await prisma.paymentCollection.findUniqueOrThrow({ where: { orderId: p.orderId } })).status).toBe('expected');
      }
      expect(await orderStatus(p2.orderId)).toBe('cancelled');
      expect(await prisma.paymentCollection.count({ where: { orderId: p2.orderId, status: 'expected' } })).toBe(0);
    });

    it('cancelling the last unscanned stop releases a run whose remaining parcels are already all in the courier’s hands', async () => {
      const [p1, p2, p3] = [await packed(100), await packed(200), await packed(300)];
      const runId = await run(driverA);
      for (const p of [p1, p2, p3]) await addStop(runId, p.shipmentId).expect(201);
      await courierScan(runId, p1.barcode).expect(201);
      await courierScan(runId, p3.barcode).expect(201);
      expect(await batchStatus(runId)).toBe('planning'); // p2 still missing

      await cancel(p2.orderId).expect(201);
      expect(await batchStatus(runId)).toBe('dispatched');
      expect(await orderStatus(p1.orderId)).toBe('shipped');
      expect(await orderStatus(p3.orderId)).toBe('shipped');
    });
  });

  describe('cancellation by stage', () => {
    it('during Hub preparation: the open session is failed, the parcel is cancelled with its order', async () => {
      const sku = await createSellableSku(prisma);
      const order = await makeOrder('packing', 100);
      await prisma.orderItem.create({ data: { orderId: order.id, skuId: sku.id, productName: 'Matrix item', price: 100, quantity: 1, currency: 'EGP' } });
      const shipment = await prisma.shipment.create({ data: { orderId: order.id, locationId, status: 'ready_to_prepare', items: { create: [{ skuId: sku.id, quantity: 1 }] } } });
      const session = (await http().post(`/fulfillment/shipments/${shipment.id}/preparation`).set(hub.auth).send({}).expect(201)).body;

      const done = await cancel(order.id).expect(201);
      expect(await orderStatus(order.id)).toBe('cancelled');
      expect(await shipmentStatus(shipment.id)).toBe('cancelled');
      expect((await prisma.shipmentPreparationSession.findUniqueOrThrow({ where: { id: session.id } })).status).toBe('failed');
      // A cancelled parcel can no longer be scanned or completed.
      await http().post(`/fulfillment/preparation-sessions/${session.id}/complete`).set(hub.auth).expect(res => expect([400, 409]).toContain(res.status));
      expect(done.body.alreadyCancelled).toBe(false);
    });

    it('after preparation, before any run: a packed parcel is cancelled and can never be planned into a run', async () => {
      const p = await packed(150);
      await cancel(p.orderId).expect(201);
      expect(await shipmentStatus(p.shipmentId)).toBe('cancelled');
      const runId = await run(driverA);
      await addStop(runId, p.shipmentId).expect(400);
      expect(await prisma.deliveryStop.count({ where: { shipmentId: p.shipmentId } })).toBe(0);
    });

    it('out for delivery: refused with CANCELLATION_TOO_LATE and absolutely nothing is written', async () => {
      const p = await packed(250);
      const runId = await run(driverA);
      await addStop(runId, p.shipmentId).expect(201);
      await courierScan(runId, p.barcode).expect(201);
      expect(await batchStatus(runId)).toBe('dispatched');
      const before = { resolutions: await prisma.orderResolution.count({ where: { orderId: p.orderId } }), events: await prisma.orderStatusEvent.count({ where: { orderId: p.orderId } }) };

      expect((await cancel(p.orderId).expect(409)).body.code).toBe('CANCELLATION_TOO_LATE');
      expect(await orderStatus(p.orderId)).toBe('shipped');
      expect(await shipmentStatus(p.shipmentId)).toBe('out_for_delivery');
      expect((await prisma.paymentCollection.findUniqueOrThrow({ where: { orderId: p.orderId } })).status).toBe('expected');
      expect(await prisma.orderResolution.count({ where: { orderId: p.orderId } })).toBe(before.resolutions);
      expect(await prisma.orderStatusEvent.count({ where: { orderId: p.orderId } })).toBe(before.events);
    });

    it('after delivery: ordinary cancellation is refused and the order stays delivered with its cash intact', async () => {
      const p = await packed(180);
      const runId = await run(driverA);
      await addStop(runId, p.shipmentId).expect(201);
      await courierScan(runId, p.barcode).expect(201);
      await http().post(`/fulfillment/shipments/${p.shipmentId}/events`).set(driverA.auth).send({ type: 'DELIVERED', collectedAmount: 180 }).expect(201);
      expect((await cancel(p.orderId).expect(409)).body.code).toBe('CANCELLATION_TOO_LATE');
      expect(await orderStatus(p.orderId)).toBe('delivered');
      expect((await prisma.paymentCollection.findUniqueOrThrow({ where: { orderId: p.orderId } })).status).toBe('collected');
    });

    it('a cancelled order refuses every later forward move (status, packing, run, delivery events)', async () => {
      const p = await packed(120);
      await cancel(p.orderId).expect(201);
      for (const status of ['confirmed', 'packing', 'shipped', 'delivered']) {
        await expect(app.get(OrderingService).updateOrderStatus(p.orderId, status as never)).rejects.toBeDefined();
      }
      expect(await orderStatus(p.orderId)).toBe('cancelled');
      const runId = await run(driverA);
      await addStop(runId, p.shipmentId).expect(400);
      await http().post(`/fulfillment/shipments/${p.shipmentId}/events`).set(driverA.auth).send({ type: 'DELIVERED', collectedAmount: 120 }).expect(res => expect([400, 403, 404, 409]).toContain(res.status));
      expect(await orderStatus(p.orderId)).toBe('cancelled');
      expect(await prisma.paymentCollection.count({ where: { orderId: p.orderId, status: 'collected' } })).toBe(0);
    });

    it('is customer-visible as cancelled, with the cash expectation voided and no operational fields exposed', async () => {
      const p = await packed(140, { customerId: customer.id });
      await prisma.paymentCollection.create({ data: { orderId: p.orderId, expectedAmount: 140, currency: 'EGP', status: 'expected', locationId } });
      await cancel(p.orderId).expect(201);
      const tracking = (await http().get(`/ordering/orders/${p.orderNumber}/tracking`).set(customer.auth).expect(200)).body;
      expect(tracking.status).toBe('CANCELLED');
      expect(JSON.stringify(tracking)).not.toMatch(/supplier|costPrice|courierId|driverId/i);
      expect(await prisma.paymentCollection.count({ where: { orderId: p.orderId, status: 'expected' } })).toBe(0);
    });
  });

  describe('idempotency and races', () => {
    it('two concurrent cancellations produce one cancellation, one resolution and one notification', async () => {
      const order = await makeOrder('placed', 90);
      const results = await Promise.all([cancel(order.id), cancel(order.id), cancel(order.id)]);
      expect(results.every(res => res.status === 201)).toBe(true);
      expect(results.filter(res => res.body.alreadyCancelled === false)).toHaveLength(1);
      expect(await prisma.orderResolution.count({ where: { orderId: order.id, type: 'cancellation' } })).toBe(1);
      expect(await prisma.orderStatusEvent.count({ where: { orderId: order.id, status: 'cancelled' } })).toBe(1);
      expect(await prisma.notificationOutbox.count({ where: { aggregateId: order.id, eventType: 'order.cancelled' } })).toBe(1);
    });

    it('cancel racing the hub dispatch ends in exactly one consistent outcome', async () => {
      const p = await packed(210);
      const runId = await run(driverA);
      await addStop(runId, p.shipmentId).expect(201);
      await takeCustody(app, hub.auth, runId); // hub-side scans never release the run by themselves
      expect(await batchStatus(runId)).toBe('planning');

      const [c, d] = await Promise.all([cancel(p.orderId), http().post(`/fulfillment/delivery-batches/${runId}/dispatch`).set(hub.auth)]);
      const cancelled = c.status === 201; const dispatched = d.status === 201;
      expect(cancelled !== dispatched).toBe(true);
      if (cancelled) {
        expect(await orderStatus(p.orderId)).toBe('cancelled');
        expect(await shipmentStatus(p.shipmentId)).toBe('cancelled');
        expect(await prisma.paymentCollection.count({ where: { orderId: p.orderId, status: 'expected' } })).toBe(0);
      } else {
        expect(c.status).toBe(409);
        expect(await orderStatus(p.orderId)).toBe('shipped');
        expect((await prisma.paymentCollection.findUniqueOrThrow({ where: { orderId: p.orderId } })).status).toBe('expected');
      }
    });
  });
});
