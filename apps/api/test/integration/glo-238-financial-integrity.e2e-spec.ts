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
 * GLO-238: expected COD (order) vs declared door cash (driver) vs counted cash (hub cashier) are
 * separate facts; only delivered, driver-declared cash of the same courier and hub settles, exactly
 * once, in exact Decimal with explicit variance. Supplier payables come from accepted/received
 * quantity at the PO's approved cost snapshot, one per PO, auditable and paid once.
 */
describe('GLO-238 COD settlement and supplier payable integrity (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: DomainEventsService;
  let admin: Actor; let hubA: Actor; let hubB: Actor; let driver: Actor; let otherDriver: Actor;
  let customer: Actor; let supplierActor: Actor;
  let hubAId: string; let hubBId: string;
  const http = () => request(app.getHttpServer());

  /** A COD order dispatched on `runDriver`'s run from hub A through the real API. */
  const dispatched = async (codAmount: number, runDriver: Actor = driver) => {
    const order = await prisma.order.create({ data: {
      orderNumber: 'ORD-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(),
      customerName: 'Cash Customer', customerPhone: '01011112222', shippingAddress: '7 Cash St',
      latitude: 29.9602, longitude: 31.2569, locationSource: 'map_pin',
      subtotal: codAmount, shippingFee: 0, totalAmount: codAmount, codAmount, currency: 'EGP', status: 'packing',
    } });
    const shipment = await prisma.shipment.create({ data: { orderId: order.id, locationId: hubAId, status: 'packed' } });
    const run = await http().post('/fulfillment/delivery-batches').set(hubA.auth).send({ hubId: hubAId, name: 'Cash run', driverId: runDriver.id }).expect(201);
    await http().post(`/fulfillment/delivery-batches/${run.body.id}/stops`).set(hubA.auth).send({ stops: [{ shipmentId: shipment.id }] }).expect(201);
    await http().post(`/fulfillment/delivery-batches/${run.body.id}/dispatch`).set(hubA.auth).expect(201);
    return { orderId: order.id, shipmentId: shipment.id };
  };
  const deliveredWithCash = async (codAmount: number, declared: number, runDriver: Actor = driver) => {
    const stop = await dispatched(codAmount, runDriver);
    await http().post(`/fulfillment/shipments/${stop.shipmentId}/events`).set(runDriver.auth)
      .send({ type: 'DELIVERED', collectedAmount: declared }).expect(201);
    return stop;
  };
  const settle = (actor: Actor, body: Record<string, unknown>) => http().post('/ordering/settlements/batch').set(actor.auth)
    .send({ courierId: driver.id, locationId: hubAId, reference: 'CNT-' + randomUUID(), currency: 'EGP', ...body });
  const collection = (orderId: string) => prisma.paymentCollection.findUniqueOrThrow({ where: { orderId } });

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
    hubA = await createActor(prisma, 'HUB_OPERATOR');
    hubB = await createActor(prisma, 'HUB_OPERATOR');
    driver = await createActor(prisma, 'DRIVER');
    otherDriver = await createActor(prisma, 'DRIVER');
    customer = await createActor(prisma, 'CUSTOMER');
    supplierActor = await createActor(prisma, 'SUPPLIER');
    hubAId = (await prisma.fulfillmentLocation.create({ data: { name: 'Cash Hub A ' + randomUUID(), address: 'Cairo' } })).id;
    hubBId = (await prisma.fulfillmentLocation.create({ data: { name: 'Cash Hub B ' + randomUUID(), address: 'Giza' } })).id;
    await prisma.fulfillmentLocationOperator.create({ data: { locationId: hubAId, operatorId: hubA.id } });
    await prisma.fulfillmentLocationOperator.create({ data: { locationId: hubBId, operatorId: hubB.id } });
  });
  afterAll(async () => { if (app) await app.close(); });

  describe('COD: expected vs declared vs counted vs settled', () => {
    it('settles 450/450/450 exactly once; a reused reference must repeat the same count', async () => {
      const { orderId } = await deliveredWithCash(450, 450);
      const declared = await collection(orderId);
      expect(declared).toMatchObject({ status: 'collected', courierId: driver.id, locationId: hubAId, collectedAmount: null });
      const reference = 'CNT-' + randomUUID();
      const body = { reference, totalCollected: 450, collections: [{ orderId, collectedAmount: 450 }] };
      const first = await settle(hubA, body).expect(201);
      expect(first.body).toMatchObject({ courierId: driver.id, locationId: hubAId, totalExpected: '450', totalCollected: '450', netSettled: '450' });
      expect(first.body.lines).toEqual([expect.objectContaining({
        orderId, status: 'settled', expectedAmount: '450.00', declaredAmount: '450.00', countedAmount: '450.00', variance: '0.00', countVersusDeclared: '0.00',
      })]);
      const replay = await settle(hubA, body).expect(201);
      expect(replay.body.id).toBe(first.body.id);
      expect((await settle(hubA, { ...body, totalCollected: 449, collections: [{ orderId, collectedAmount: 449 }] }).expect(409)).body.code)
        .toBe('SETTLEMENT_REFERENCE_REUSED');
      await settle(hubA, { totalCollected: 450, collections: [{ orderId, collectedAmount: 450 }] }).expect(409);
      expect(await prisma.courierSettlementBatch.count({ where: { collections: { some: { orderId } } } })).toBe(1);
    });

    it('records shortage and overage explicitly instead of marking them paid', async () => {
      const short = await deliveredWithCash(450, 450);
      const over = await deliveredWithCash(300, 300);
      const res = await settle(hubA, { totalCollected: 770, collections: [
        { orderId: short.orderId, collectedAmount: 400 }, { orderId: over.orderId, collectedAmount: 370 },
      ] }).expect(201);
      expect(res.body).toMatchObject({ totalExpected: '750', totalCollected: '770' });
      const lines = Object.fromEntries(res.body.lines.map((l: { orderId: string }) => [l.orderId, l]));
      expect(lines[short.orderId]).toMatchObject({ status: 'short', variance: '-50.00', countVersusDeclared: '-50.00' });
      expect(lines[over.orderId]).toMatchObject({ status: 'over', variance: '70.00' });
      expect((await collection(short.orderId)).status).toBe('short');
    });

    it('keeps money exact in Decimal (100.10 + 200.20 = 300.30)', async () => {
      const a = await deliveredWithCash(100.1, 100.1);
      const b = await deliveredWithCash(200.2, 200.2);
      const res = await settle(hubA, { totalCollected: 300.3, fees: 0.3, collections: [
        { orderId: a.orderId, collectedAmount: 100.1 }, { orderId: b.orderId, collectedAmount: 200.2 },
      ] }).expect(201);
      expect(res.body).toMatchObject({ totalExpected: '300.3', totalCollected: '300.3', netSettled: '300' });
      expect(res.body.lines.every((l: { status: string }) => l.status === 'settled')).toBe(true);
      await settle(hubA, { totalCollected: 300.31, collections: [{ orderId: a.orderId, collectedAmount: 300.301 }] }).expect(400);
    });

    it('rejects wrong courier, undelivered, failed and never-declared cash', async () => {
      const { orderId } = await deliveredWithCash(450, 450);
      expect((await settle(hubA, { courierId: otherDriver.id, totalCollected: 450, collections: [{ orderId, collectedAmount: 450 }] }).expect(409)).body.code)
        .toBe('COURIER_MISMATCH');
      expect((await settle(hubA, { courierId: randomUUID(), totalCollected: 450, collections: [{ orderId, collectedAmount: 450 }] }).expect(409)).body.code)
        .toBe('COURIER_MISMATCH');

      const onRoad = await dispatched(200);
      expect((await settle(hubA, { totalCollected: 200, collections: [{ orderId: onRoad.orderId, collectedAmount: 200 }] }).expect(409)).body.code)
        .toBe('ORDER_NOT_DELIVERED');
      const failed = await dispatched(200);
      await http().post(`/fulfillment/shipments/${failed.shipmentId}/events`).set(driver.auth).send({ type: 'FAILED' }).expect(201);
      expect((await settle(hubA, { totalCollected: 200, collections: [{ orderId: failed.orderId, collectedAmount: 200 }] }).expect(409)).body.code)
        .toBe('ORDER_NOT_DELIVERED');
      // Staff cannot turn a COD stop into "delivered" without the driver's declaration.
      expect((await http().patch(`/fulfillment/shipments/${onRoad.shipmentId}/status`).set(admin.auth).send({ status: 'delivered' }).expect(409)).body.code)
        .toBe('COD_DELIVERY_REQUIRES_DRIVER');
      for (const id of [onRoad.orderId, failed.orderId]) expect((await collection(id)).status).toBe('expected');
      // Nothing in this test was settled.
      expect((await collection(orderId)).settlementBatchId).toBeNull();
    });

    it('scopes counting to the hub and its operators; other roles are denied', async () => {
      const { orderId } = await deliveredWithCash(450, 450);
      const line = { totalCollected: 450, collections: [{ orderId, collectedAmount: 450 }] };
      await settle(hubB, line).expect(403); // hub B operator counting at hub A
      expect((await settle(hubB, { ...line, locationId: hubBId }).expect(409)).body.code).toBe('COLLECTION_FROM_ANOTHER_HUB');
      for (const actor of [driver, customer, supplierActor]) await settle(actor, line).expect(403);
      const res = await settle(admin, line).expect(201);
      await http().get(`/ordering/settlements/batches/${res.body.id}`).set(hubA.auth).expect(200);
      await http().get(`/ordering/settlements/batches/${res.body.id}`).set(hubB.auth).expect(404);
      await http().get(`/ordering/settlements/batches/${res.body.id}`).set(driver.auth).expect(403);
    });

    it('settles a collection once under concurrent counts, and one batch per concurrent duplicate reference', async () => {
      const { orderId } = await deliveredWithCash(450, 450);
      const line = { totalCollected: 450, collections: [{ orderId, collectedAmount: 450 }] };
      const racing = await Promise.all([settle(hubA, line), settle(admin, line)]);
      expect(racing.map(r => r.status).sort()).toEqual([201, 409]);
      expect(await prisma.courierSettlementBatch.count({ where: { collections: { some: { orderId } } } })).toBe(1);

      const again = await deliveredWithCash(120, 120);
      const sameRef = { reference: 'CNT-' + randomUUID(), totalCollected: 120, collections: [{ orderId: again.orderId, collectedAmount: 120 }] };
      const twins = await Promise.all([settle(hubA, sameRef), settle(hubA, sameRef)]);
      expect(twins.map(r => r.status)).toEqual([201, 201]);
      expect(twins[0].body.id).toBe(twins[1].body.id);
      expect(await prisma.courierSettlementBatch.count({ where: { reference: sameRef.reference } })).toBe(1);
    });
  });

  describe('supplier payables', () => {
    const settleEvents = async (aggregateId: string) => {
      for (let i = 0; i < 100; i++) {
        await events.dispatchPending({ aggregateId });
        if (!await prisma.domainEvent.count({ where: { aggregateId, status: { not: 'delivered' } } })) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    };
    const procured = async (quantities: number[]) => {
      const sku = await createSellableSku(prisma); // supplier offer cost 50 EGP
      const supplier = await createActor(prisma, 'SUPPLIER', sku.supplierId);
      const orders = [];
      for (const quantity of quantities) {
        const order = await placeGuestOrder(app.getHttpServer(), [{ skuId: sku.id, quantity }]);
        await settleEvents(order.id);
        orders.push(order);
      }
      const flushed = await http().post('/purchase-orders/batches').set(admin.auth).send({ supplierId: sku.supplierId }).expect(201);
      return { sku, supplier, orders, po: flushed.body.purchaseOrders[0] };
    };
    const receiveAll = async (sku: { id: string; variantName: string }, po: { lines: Array<{ allocations: Array<{ sourceAllocationId: string; orderId: string; orderItemId: string; quantity: number }> }> }, received?: number[]) => {
      let i = 0;
      for (const link of po.lines[0].allocations) {
        await http().post('/fulfillment/receipts').set(hubA.auth).send({
          locationId: hubAId, allocationId: link.sourceAllocationId, orderId: link.orderId, orderItemId: link.orderItemId,
          skuId: sku.id, variantName: sku.variantName, quantity: received?.[i++] ?? link.quantity, condition: 'ACCEPTABLE', idempotencyKey: randomUUID(),
        }).expect(201);
      }
    };

    it('pays received quantity at the PO cost snapshot, once, even after the live offer changes', async () => {
      const { sku, supplier, po } = await procured([2, 3]);
      await http().post(`/purchase-orders/${po.id}/confirm`).set(supplier.auth).send({ lines: [{ id: po.lines[0].id, status: 'confirmed_full' }] }).expect(201);
      await settleEvents(po.id);
      // Not payable before the goods are physically at the Hub.
      expect((await http().post(`/sourcing/purchase-orders/${po.id}/payable`).set(admin.auth).expect(409)).body.code).toBe('GOODS_NOT_RECEIVED');
      await receiveAll(sku, po);
      // The supplier's live price moves after the PO; the payable must not follow it.
      await prisma.supplierOffer.updateMany({ where: { supplierId: sku.supplierId, skuId: sku.id }, data: { costPrice: 99, currency: 'USD' } });

      await http().post(`/sourcing/purchase-orders/${po.id}/payable`).set(supplier.auth).expect(403);
      const results = await Promise.all([1, 2, 3].map(() => http().post(`/sourcing/purchase-orders/${po.id}/payable`).set(admin.auth)));
      expect(results.every(r => r.status === 201)).toBe(true);
      expect(new Set(results.map(r => r.body.id)).size).toBe(1);
      const payable = results[0].body;
      expect(payable).toMatchObject({ amount: '250', currency: 'EGP', status: 'open' });
      expect(payable.basis).toEqual([expect.objectContaining({ quantity: 5, quantitySource: 'received_at_hub', unitCost: '50.00', lineAmount: '250.00' })]);
      expect(await prisma.supplierPayable.count({ where: { purchaseOrderId: po.id } })).toBe(1);

      // Audited exact adjustments; never negative; paid once with proof.
      const adjusted = await http().patch(`/sourcing/payables/${payable.id}/adjust`).set(hubA.auth)
        .send({ amount: -10.05, reason: 'Damaged outer carton credit', actorId: 'spoofed' }).expect(200);
      expect(adjusted.body.payable).toMatchObject({ amount: '239.95', status: 'adjusted' });
      expect(adjusted.body.adjustment).toMatchObject({ actorId: hubA.id, amount: '-10.05' });
      await http().patch(`/sourcing/payables/${payable.id}/adjust`).set(admin.auth).send({ amount: -500, reason: 'too much' }).expect(400);
      await http().patch(`/sourcing/payables/${payable.id}/mark-paid`).set(hubA.auth).send({ paymentRef: 'TRX-1' }).expect(403);
      await http().patch(`/sourcing/payables/${payable.id}/mark-paid`).set(admin.auth).send({}).expect(400);
      const paid = await http().patch(`/sourcing/payables/${payable.id}/mark-paid`).set(admin.auth).send({ paymentRef: 'TRX-1' }).expect(200);
      expect(paid.body).toMatchObject({ status: 'paid', paymentRef: 'TRX-1' });
      await http().patch(`/sourcing/payables/${payable.id}/mark-paid`).set(admin.auth).send({ paymentRef: 'TRX-1' }).expect(200);
      await http().patch(`/sourcing/payables/${payable.id}/mark-paid`).set(admin.auth).send({ paymentRef: 'TRX-2' }).expect(409);
      await http().patch(`/sourcing/payables/${payable.id}/adjust`).set(admin.auth).send({ amount: 5, reason: 'late' }).expect(409);
    });

    it('pays only what was accepted: zero confirmed is a zero payable', async () => {
      const { supplier, po } = await procured([4]);
      await http().post(`/purchase-orders/${po.id}/confirm`).set(supplier.auth).send({ lines: [{ id: po.lines[0].id, status: 'unavailable' }] }).expect(201);
      await settleEvents(po.id);
      const payable = await http().post(`/sourcing/purchase-orders/${po.id}/payable`).set(admin.auth).expect(201);
      expect(payable.body).toMatchObject({ amount: '0', currency: 'EGP' });
      expect(payable.body.basis[0]).toMatchObject({ quantity: 0, lineAmount: '0.00' });
    });

    it('a still-unanswered PO has nothing payable', async () => {
      const { po } = await procured([1]);
      await http().post(`/sourcing/purchase-orders/${po.id}/payable`).set(admin.auth).expect(409);
      expect(await prisma.supplierPayable.count({ where: { purchaseOrderId: po.id } })).toBe(0);
    });
  });
});
