import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { DomainEventsService } from '../../src/platform/events/domain-events.service';
import { AiClient } from '../../src/platform/ai';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { createActor, Actor } from '../fixtures/actors';
import { createSellableSku } from '../fixtures/sellable-sku';
import { placeGuestOrder } from '../fixtures/checkout';

/**
 * GLO-240: a failed attempt is history, not a cancellation — the parcel is scanned back into the
 * hub and joins a later run (one active attempt at a time); a parcel given up on ends as a returned
 * order with no cash due and a human exception; staff cancel only before custody, releasing supply
 * and voiding the cash expectation without deleting facts.
 */
describe('GLO-240 failed delivery retry, return to sender and cancellation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: DomainEventsService;
  let admin: Actor; let hub: Actor; let driverA: Actor; let driverB: Actor; let customer: Actor;
  let locationId: string;
  const http = () => request(app.getHttpServer());

  const packed = async (codAmount = 300) => {
    const order = await prisma.order.create({ data: {
      orderNumber: 'ORD-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(),
      customerName: 'Retry Customer', customerPhone: '01011112222', shippingAddress: '4 Retry St',
      latitude: 29.9602, longitude: 31.2569, locationSource: 'map_pin',
      subtotal: codAmount, shippingFee: 0, totalAmount: codAmount, codAmount, currency: 'EGP', status: 'packing',
    } });
    const shipment = await prisma.shipment.create({ data: { orderId: order.id, locationId, status: 'packed' } });
    const label = await http().post(`/fulfillment/shipments/${shipment.id}/label`).set(hub.auth).expect(201);
    return { orderId: order.id, orderNumber: order.orderNumber, shipmentId: shipment.id, barcode: label.body.barcode as string };
  };
  const run = async (driver: Actor) =>
    (await http().post('/fulfillment/delivery-batches').set(hub.auth).send({ hubId: locationId, name: 'Retry run', driverId: driver.id }).expect(201)).body.id as string;
  const addStop = (runId: string, shipmentId: string) =>
    http().post(`/fulfillment/delivery-batches/${runId}/stops`).set(hub.auth).send({ stops: [{ shipmentId }] });
  const event = (actor: Actor, shipmentId: string, body: Record<string, unknown>) =>
    http().post(`/fulfillment/shipments/${shipmentId}/events`).set(actor.auth).send(body);
  const shipmentStatus = async (id: string) => (await prisma.shipment.findUniqueOrThrow({ where: { id } })).status;
  const orderStatus = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id } })).status;

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
    driverB = await createActor(prisma, 'DRIVER');
    customer = await createActor(prisma, 'CUSTOMER');
    locationId = (await prisma.fulfillmentLocation.create({ data: { name: 'Retry Hub ' + randomUUID(), address: 'Cairo' } })).id;
    await prisma.fulfillmentLocationOperator.create({ data: { locationId, operatorId: hub.id } });
  });
  afterAll(async () => { if (app) await app.close(); });

  it('failed → scanned back at the hub → new run with another driver → delivered, keeping every attempt', async () => {
    const parcel = await packed(300);
    const run1 = await run(driverA);
    await addStop(run1, parcel.shipmentId).expect(201);
    await event(driverA, parcel.shipmentId, { type: 'HANDOFF_SCANNED', barcode: parcel.barcode }).expect(201);
    await http().post(`/fulfillment/delivery-batches/${run1}/dispatch`).set(hub.auth).expect(201);

    await event(driverA, parcel.shipmentId, { type: 'FAILED' }).expect(400);
    await event(driverA, parcel.shipmentId, { type: 'FAILED', reasonCode: 'TELEPORTED' }).expect(400);
    await event(driverA, parcel.shipmentId, { type: 'FAILED', reasonCode: 'ADDRESS_NOT_FOUND', notes: 'Building number missing' }).expect(201);
    expect(await shipmentStatus(parcel.shipmentId)).toBe('failed');
    expect(await orderStatus(parcel.orderId)).toBe('shipped'); // a failed attempt never cancels
    expect(await prisma.shipmentEvent.findFirst({ where: { shipmentId: parcel.shipmentId, type: 'FAILED' } }))
      .toMatchObject({ reasonCode: 'ADDRESS_NOT_FOUND', actorId: driverA.id });

    // Not re-plannable until the parcel is physically back at the hub, and only the hub scans it in.
    const run2 = await run(driverB);
    await addStop(run2, parcel.shipmentId).expect(400);
    await http().patch(`/fulfillment/shipments/${parcel.shipmentId}/status`).set(hub.auth).send({ status: 'packed' }).expect(409);
    await event(driverA, parcel.shipmentId, { type: 'RECEIVED_BACK', barcode: parcel.barcode }).expect(403);
    await event(hub, parcel.shipmentId, { type: 'RECEIVED_BACK' }).expect(400);
    await event(hub, parcel.shipmentId, { type: 'RECEIVED_BACK', barcode: 'SHP-forged' }).expect(400);
    await event(hub, parcel.shipmentId, { type: 'RECEIVED_BACK', barcode: parcel.barcode }).expect(201);
    expect(await shipmentStatus(parcel.shipmentId)).toBe('packed');
    const tracking = await prisma.order.findUniqueOrThrow({ where: { id: parcel.orderId } });
    expect(tracking.status).toBe('shipped');
    // The ended attempt gives driver A nothing more to do with the parcel.
    await event(driverA, parcel.shipmentId, { type: 'OUT_FOR_DELIVERY' }).expect(409);

    // Exactly one active attempt: two runs racing for the same parcel → one wins.
    const run3 = await run(driverA);
    const raced = await Promise.all([addStop(run2, parcel.shipmentId), addStop(run3, parcel.shipmentId)]);
    expect(raced.map(r => r.status).sort()).toEqual([201, 400].sort());
    expect(await prisma.deliveryStop.count({ where: { shipmentId: parcel.shipmentId, status: 'active' } })).toBe(1);
    const winner = raced[0].status === 201 ? { runId: run2, driver: driverB, other: driverA } : { runId: run3, driver: driverA, other: driverB };

    const handoff = await event(winner.driver, parcel.shipmentId, { type: 'HANDOFF_SCANNED', barcode: parcel.barcode }).expect(201);
    const firstHandoff = await prisma.shipmentEvent.findFirstOrThrow({ where: { shipmentId: parcel.shipmentId, type: 'HANDOFF_SCANNED' }, orderBy: { createdAt: 'asc' } });
    expect(handoff.body.id).not.toBe(firstHandoff.id); // custody is taken again for the new attempt
    await http().post(`/fulfillment/delivery-batches/${winner.runId}/dispatch`).set(hub.auth).expect(201);
    expect(await prisma.orderStatusEvent.count({ where: { orderId: parcel.orderId, status: 'shipped' } })).toBe(1);
    if (winner.other.id !== winner.driver.id) await http().get(`/fulfillment/shipments/${parcel.shipmentId}`).set(winner.other.auth).expect(404);

    await event(winner.driver, parcel.shipmentId, { type: 'DELIVERED', collectedAmount: 300 }).expect(201);
    expect(await orderStatus(parcel.orderId)).toBe('delivered');
    const attempts = await prisma.deliveryStop.findMany({ where: { shipmentId: parcel.shipmentId }, orderBy: { createdAt: 'asc' } });
    expect(attempts.map(a => [a.batchId, a.status])).toEqual([[run1, 'failed'], [winner.runId, 'delivered']]);
    expect(attempts[0].closedAt).toBeInstanceOf(Date);
    const collection = await prisma.paymentCollection.findUniqueOrThrow({ where: { orderId: parcel.orderId } });
    expect(collection).toMatchObject({ status: 'collected', courierId: winner.driver.id, locationId });
    expect(Number(collection.expectedAmount)).toBe(300);
    await http().post(`/fulfillment/delivery-batches/${run1}/complete`).set(driverA.auth).expect(201);
  });

  it('a parcel given up on ends as a returned order with no cash due and one human exception', async () => {
    const parcel = await packed(450);
    const runId = await run(driverA);
    await addStop(runId, parcel.shipmentId).expect(201);
    await http().post(`/fulfillment/delivery-batches/${runId}/dispatch`).set(hub.auth).expect(201);
    await event(driverA, parcel.shipmentId, { type: 'FAILED', reasonCode: 'CUSTOMER_REFUSED' }).expect(201);
    await event(driverA, parcel.shipmentId, { type: 'RETURNED', barcode: parcel.barcode }).expect(403);
    await http().patch(`/fulfillment/shipments/${parcel.shipmentId}/status`).set(hub.auth).send({ status: 'returned' }).expect(400);
    const returned = await event(hub, parcel.shipmentId, { type: 'RETURNED', barcode: parcel.barcode }).expect(201);
    const replay = await event(hub, parcel.shipmentId, { type: 'RETURNED', barcode: parcel.barcode }).expect(201);
    expect(replay.body.id).toBe(returned.body.id);

    expect(await shipmentStatus(parcel.shipmentId)).toBe('returned');
    expect(await orderStatus(parcel.orderId)).toBe('returned');
    expect((await prisma.paymentCollection.findUniqueOrThrow({ where: { orderId: parcel.orderId } })).status).toBe('voided');
    expect((await prisma.deliveryStop.findFirstOrThrow({ where: { shipmentId: parcel.shipmentId } })).status).toBe('returned');
    const cases = await prisma.supportCase.findMany({ where: { orderId: parcel.orderId } });
    expect(cases).toEqual([expect.objectContaining({ category: 'delivery', priority: 'high', status: 'open' })]);
    // Returned money cannot be "settled" and the order cannot be cancelled or re-delivered.
    const settle = await http().post('/ordering/settlements/batch').set(hub.auth).send({
      courierId: driverA.id, locationId, reference: 'RET-' + randomUUID(), currency: 'EGP', totalCollected: 450,
      collections: [{ orderId: parcel.orderId, collectedAmount: 450 }],
    }).expect(409);
    expect(settle.body.code).toBe('ORDER_NOT_DELIVERED');
    await http().post(`/ordering/orders/${parcel.orderId}/cancel`).set(admin.auth).send({ reasonCode: 'OTHER' }).expect(409);
  });

  describe('staff cancellation', () => {
    const settleEvents = async (aggregateId: string) => {
      for (let i = 0; i < 100; i++) {
        await events.dispatchPending({ aggregateId });
        if (!await prisma.domainEvent.count({ where: { aggregateId, status: { not: 'delivered' } } })) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    };

    it('cancels a placed order once, releases its supply plan, and is admin-only', async () => {
      const sku = await createSellableSku(prisma);
      const order = await placeGuestOrder(app.getHttpServer(), [{ skuId: sku.id, quantity: 2 }]);
      await settleEvents(order.id);
      const cancel = (actor: Actor, body: Record<string, unknown> = { reasonCode: 'CUSTOMER_REQUEST', notes: 'Called support' }) =>
        http().post(`/ordering/orders/${order.id}/cancel`).set(actor.auth).send(body);
      for (const actor of [hub, driverA, customer]) await cancel(actor).expect(403);
      await cancel(admin, { reasonCode: 'BECAUSE' }).expect(400);
      const done = await cancel(admin).expect(201);
      expect(done.body).toMatchObject({ alreadyCancelled: false, goodsReceived: false, supplierCommitments: [], exceptionCaseId: null });
      expect(done.body.order.status).toBe('cancelled');
      expect((await cancel(admin).expect(201)).body.alreadyCancelled).toBe(true);

      const resolution = await prisma.orderResolution.findFirstOrThrow({ where: { orderId: order.id, type: 'cancellation' }, include: { items: true } });
      expect(resolution).toMatchObject({ status: 'resolved', actorId: admin.id, reasonCode: 'CUSTOMER_REQUEST' });
      expect(resolution.items).toEqual([expect.objectContaining({ quantity: 2 })]);
      expect(await prisma.supplyRequirement.count({ where: { supplyRequest: { orderId: order.id }, releasedAt: null } })).toBe(0);
      // Released demand is never batched to a supplier afterwards.
      const flushed = await http().post('/purchase-orders/batches').set(admin.auth).send({ supplierId: sku.supplierId }).expect(201);
      expect(flushed.body.purchaseOrders).toHaveLength(0);
      expect(await prisma.notificationOutbox.count({ where: { aggregateId: order.id, eventType: 'order.cancelled' } })).toBe(1);
    });

    it('cancels a packed parcel on a planning run with goods in flight and opens an exception', async () => {
      const sku = await createSellableSku(prisma);
      const supplier = await createActor(prisma, 'SUPPLIER', sku.supplierId);
      const order = await placeGuestOrder(app.getHttpServer(), [{ skuId: sku.id, quantity: 3 }]);
      await settleEvents(order.id);
      const [po] = (await http().post('/purchase-orders/batches').set(admin.auth).send({ supplierId: sku.supplierId }).expect(201)).body.purchaseOrders;
      await http().post(`/purchase-orders/${po.id}/confirm`).set(supplier.auth).send({ lines: [{ id: po.lines[0].id, status: 'confirmed_full' }] }).expect(201);
      await settleEvents(po.id);
      const link = po.lines[0].allocations[0];
      const receive = (quantity: number) => http().post('/fulfillment/receipts').set(hub.auth).send({
        locationId, allocationId: link.sourceAllocationId, orderId: order.id, orderItemId: link.orderItemId,
        skuId: sku.id, variantName: sku.variantName, barcodeScanned: sku.barcode, quantity, condition: 'ACCEPTABLE', idempotencyKey: randomUUID(),
      });
      await receive(2).expect(201); // 1 unit still with the supplier
      const shipment = await prisma.shipment.findUniqueOrThrow({ where: { orderId: order.id } });
      await prisma.shipment.update({ where: { id: shipment.id }, data: { status: 'packed' } });
      const runId = await run(driverA);
      await addStop(runId, shipment.id).expect(201);

      const done = await http().post(`/ordering/orders/${order.id}/cancel`).set(admin.auth).send({ reasonCode: 'CUSTOMER_REQUEST' }).expect(201);
      expect(done.body).toMatchObject({ goodsReceived: true, supplierCommitments: [expect.objectContaining({ purchaseOrderId: po.id, confirmed: 3 })] });
      expect(await shipmentStatus(shipment.id)).toBe('cancelled');
      expect(await prisma.deliveryStop.count({ where: { shipmentId: shipment.id } })).toBe(0);
      expect(await prisma.supportCase.findUniqueOrThrow({ where: { id: done.body.exceptionCaseId } }))
        .toMatchObject({ category: 'cancellation', priority: 'high', orderId: order.id });
      // The remaining unit cannot be received against the cancelled order; the parcel cannot be printed or dispatched.
      await receive(1).expect(409);
      await http().post(`/fulfillment/shipments/${shipment.id}/label`).set(hub.auth).expect(400);
    });

    it('refuses cancellation once the parcel is with a driver or delivered', async () => {
      const parcel = await packed(200);
      // A shipment is only cancelled with its order, never through a status patch.
      await http().patch(`/fulfillment/shipments/${parcel.shipmentId}/status`).set(hub.auth).send({ status: 'cancelled' }).expect(409);
      const runId = await run(driverA);
      await addStop(runId, parcel.shipmentId).expect(201);
      await http().post(`/fulfillment/delivery-batches/${runId}/dispatch`).set(hub.auth).expect(201);
      const late = await http().post(`/ordering/orders/${parcel.orderId}/cancel`).set(admin.auth).send({ reasonCode: 'CUSTOMER_REQUEST' }).expect(409);
      expect(late.body.code).toBe('CANCELLATION_TOO_LATE');
      expect(await orderStatus(parcel.orderId)).toBe('shipped');
      expect((await prisma.paymentCollection.findUniqueOrThrow({ where: { orderId: parcel.orderId } })).status).toBe('expected');
      await event(driverA, parcel.shipmentId, { type: 'DELIVERED', collectedAmount: 200 }).expect(201);
      await http().post(`/ordering/orders/${parcel.orderId}/cancel`).set(admin.auth).send({ reasonCode: 'CUSTOMER_REQUEST' }).expect(409);
    });
  });
});
