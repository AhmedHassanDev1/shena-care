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
import { placeGuestOrder, PlacedOrder } from '../fixtures/checkout';

/**
 * GLO-237: several orders for the same SKU/supplier become one PO line with quantity-aware links to
 * each order item; the supplier's answer flows to those allocations (full / zero / single partial),
 * a shared partial waits for an explicit admin distribution, shortages re-plan to a fallback supplier
 * or customer decision, suppliers are isolated, and Supplier Ready never counts as Hub receipt.
 */
describe('GLO-237 supplier PO ↔ allocation lineage (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: DomainEventsService;
  let admin: Actor; let hub: Actor; let supplierA: Actor; let supplierB: Actor;
  let skuId: string; let skuVariant: string; let supplierAId: string; let supplierBId: string;
  let locationId: string;
  const http = () => request(app.getHttpServer());

  const plan = async (order: PlacedOrder) => {
    await settleEvents(order.id);
    return (await http().get(`/sourcing/supply-plans/orders/${order.id}`).set(admin.auth).expect(200)).body;
  };
  const flush = async (supplierId: string) =>
    (await http().post('/purchase-orders/batches').set(admin.auth).send({ supplierId }).expect(201)).body;
  const allocationsOf = (orderId: string) => prisma.sourceAllocation.findMany({
    where: { requirement: { supplyRequest: { orderId } } }, include: { supplierOffer: true, poLink: true }, orderBy: { selectedAt: 'asc' },
  });
  /** Delivers due rows and waits for any in-flight immediate dispatch of the same aggregate. */
  const settleEvents = async (aggregateId: string) => {
    for (let i = 0; i < 100; i++) {
      await events.dispatchPending({ aggregateId });
      if (!await prisma.domainEvent.count({ where: { aggregateId, status: { not: 'delivered' } } })) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Events for ${aggregateId} were not delivered`);
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useValue(new DeterministicAiClient()).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useLogger(['error']);
    await app.init();
    prisma = app.get(PrismaService);
    events = app.get(DomainEventsService);
    const sku = await createSellableSku(prisma); // its own supplier offer at cost 50 = supplier A
    skuId = sku.id; skuVariant = sku.variantName; supplierAId = sku.supplierId;
    supplierBId = (await prisma.supplier.create({ data: { name: 'Fallback B ' + randomUUID(), slug: 'fallback-b-' + randomUUID() } })).id;
    await prisma.supplierOffer.create({ data: {
      supplierId: supplierBId, skuId, costPrice: 60, currency: 'EGP', lastObservedAt: new Date(), lastConfirmedAt: new Date(),
    } });
    admin = await createActor(prisma, 'ADMIN');
    hub = await createActor(prisma, 'HUB_OPERATOR');
    supplierA = await createActor(prisma, 'SUPPLIER', supplierAId);
    supplierB = await createActor(prisma, 'SUPPLIER', supplierBId);
    locationId = (await prisma.fulfillmentLocation.create({ data: { name: 'GLO-237 Hub ' + randomUUID(), address: 'Cairo' } })).id;
    await prisma.fulfillmentLocationOperator.create({ data: { locationId, operatorId: hub.id } });
  });
  afterAll(async () => { if (app) await app.close(); });

  it('consolidates two orders into one PO line with N:1 quantity-aware lineage, exactly once', async () => {
    const first = await placeGuestOrder(app.getHttpServer(), [{ skuId, quantity: 2 }]);
    const second = await placeGuestOrder(app.getHttpServer(), [{ skuId, quantity: 3 }]);
    for (const order of [first, second]) {
      const p = await plan(order);
      expect(p.lines[0].allocations[0]).toMatchObject({ result: 'pending', selectedCost: 50 });
    }
    // Concurrent flushes never batch the same allocation twice.
    const [a, b] = await Promise.all([flush(supplierAId), flush(supplierAId)]);
    const pos = [...a.purchaseOrders, ...b.purchaseOrders];
    expect(pos).toHaveLength(1);
    const po = pos[0];
    expect(po).toMatchObject({ supplierId: supplierAId, status: 'sent' });
    expect(po.lines).toHaveLength(1);
    expect(po.lines[0]).toMatchObject({ skuId, requestedQuantity: 5, unitCost: '50', currency: 'EGP' });
    expect(po.lines[0].allocations.map((l: { orderId: string; quantity: number }) => [l.orderId, l.quantity]))
      .toEqual([[first.id, 2], [second.id, 3]]);
    expect(await prisma.purchaseOrderLineAllocation.count({ where: { orderId: { in: [first.id, second.id] } } })).toBe(2);
    expect((await flush(supplierAId)).purchaseOrders).toHaveLength(0);

    // A linked allocation is answered only through its PO.
    const [allocation] = await allocationsOf(first.id);
    const direct = await http().post(`/sourcing/supply-plans/allocations/${allocation.id}/confirm`).set(admin.auth)
      .send({ result: 'confirmed_full', confirmedQuantity: 2 }).expect(409);
    expect(direct.body.code).toBe('ALLOCATION_ON_PURCHASE_ORDER');

    // Supplier isolation and minimal supplier view.
    await http().get(`/purchase-orders/${po.id}`).set(supplierB.auth).expect(403);
    await http().post(`/purchase-orders/${po.id}/confirm`).set(supplierB.auth)
      .send({ lines: [{ id: po.lines[0].id, status: 'confirmed_full' }] }).expect(403);
    const seen = await http().get(`/purchase-orders/${po.id}`).set(supplierA.auth).expect(200);
    expect(JSON.stringify(seen.body)).not.toMatch(new RegExp(`${first.id}|${second.id}|orderItemId|C2C Customer|01012345678`));
    const inboxA = await http().get('/purchase-orders').set(supplierA.auth).expect(200);
    expect(inboxA.body.items.every((p: { supplierId: string }) => p.supplierId === supplierAId)).toBe(true);
    const inboxB = await http().get('/purchase-orders').set(supplierB.auth).expect(200);
    expect(inboxB.body.items.map((p: { id: string }) => p.id)).not.toContain(po.id);

    // Shared partial: 3 of 5 for two orders needs an explicit distribution; nothing is guessed.
    const confirmed = await http().post(`/purchase-orders/${po.id}/confirm`).set(supplierA.auth)
      .send({ lines: [{ id: po.lines[0].id, status: 'confirmed_partial', confirmedQuantity: 3 }] }).expect(201);
    expect(confirmed.body.status).toBe('partial');
    // Late duplicate of the same answer is harmless; a different late answer conflicts.
    await http().post(`/purchase-orders/${po.id}/confirm`).set(supplierA.auth)
      .send({ lines: [{ id: po.lines[0].id, status: 'confirmed_partial', confirmedQuantity: 3 }] }).expect(201);
    await http().post(`/purchase-orders/${po.id}/confirm`).set(supplierA.auth)
      .send({ lines: [{ id: po.lines[0].id, status: 'confirmed_full' }] }).expect(409);
    const line = await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: po.lines[0].id } });
    expect(line).toMatchObject({ distributionRequired: true, confirmedQuantity: 3 });
    expect((await allocationsOf(first.id))[0].result).toBe('pending');
    expect((await allocationsOf(second.id))[0].result).toBe('pending');

    const distribute = (actor: Actor, body: unknown) =>
      http().post(`/purchase-orders/${po.id}/lines/${line.id}/distribute`).set(actor.auth).send(body);
    const a1 = (await allocationsOf(first.id))[0].id; const a2 = (await allocationsOf(second.id))[0].id;
    const valid = { allocations: [{ sourceAllocationId: a1, quantity: 2 }, { sourceAllocationId: a2, quantity: 1 }], reason: 'Oldest order first (owner decision)' };
    await distribute(supplierA, valid).expect(403);
    await distribute(hub, valid).expect(403);
    await distribute(admin, { ...valid, allocations: [{ sourceAllocationId: a1, quantity: 2 }, { sourceAllocationId: a2, quantity: 2 }] }).expect(400);
    await distribute(admin, { ...valid, allocations: [{ sourceAllocationId: a1, quantity: 3 }] }).expect(400);
    await distribute(admin, { ...valid, allocations: [{ sourceAllocationId: a1, quantity: 3 }, { sourceAllocationId: a2, quantity: 0 }] }).expect(400);
    await distribute(admin, valid).expect(201);
    await distribute(admin, valid).expect(409);
    await settleEvents(line.id);

    const firstAllocations = await allocationsOf(first.id);
    expect(firstAllocations).toHaveLength(1);
    expect(firstAllocations[0]).toMatchObject({ result: 'confirmed_full', confirmedQuantity: 2, evidenceRef: `PO:${po.id}` });
    expect(firstAllocations[0].poLink).toMatchObject({ confirmedQuantity: 2 });
    // Order 2: 1 confirmed from A; the missing 2 are re-planned to fallback supplier B at its own cost.
    const secondAllocations = await allocationsOf(second.id);
    expect(secondAllocations.map(a => [a.supplierOffer.supplierId, a.result, a.confirmedQuantity, a.allocatedQuantity])).toEqual([
      [supplierAId, 'confirmed_partial', 1, 3],
      [supplierBId, 'pending', 0, 2],
    ]);
    expect((await plan(first)).status).toBe('COVERED');

    // The fallback demand goes out on supplier B's next batch, linked to order 2 only.
    const fallback = (await flush(supplierBId)).purchaseOrders;
    expect(fallback).toHaveLength(1);
    expect(fallback[0].lines[0]).toMatchObject({ requestedQuantity: 2, unitCost: '60' });
    expect(fallback[0].lines[0].allocations).toEqual([expect.objectContaining({ orderId: second.id, quantity: 2 })]);

    // Supplier Ready is not a Hub receipt.
    await http().post(`/purchase-orders/${po.id}/ready`).set(supplierB.auth).expect(403);
    const ready = await http().post(`/purchase-orders/${po.id}/ready`).set(supplierA.auth).expect(201);
    expect(ready.body).toMatchObject({ status: 'ready' });
    expect(await prisma.purchaseOrderLineAllocation.aggregate({ where: { purchaseOrderLineId: line.id }, _sum: { receivedQuantity: true } }))
      .toMatchObject({ _sum: { receivedQuantity: 0 } });

    // Hub receives physical quantities against the confirmed lineage; over-receipt is blocked.
    const receive = (order: PlacedOrder, allocationId: string, quantity: number) => http().post('/fulfillment/receipts').set(hub.auth).send({
      locationId, allocationId, orderId: order.id, orderItemId: order.items[0].id, skuId, variantName: skuVariant,
      quantity, condition: 'ACCEPTABLE', idempotencyKey: randomUUID(),
    });
    await receive(second, a2, 2).expect(400);
    await receive(first, a1, 2).expect(201);
    expect((await prisma.supplierPurchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe('ready');
    await receive(second, a2, 1).expect(201);
    const received = await prisma.supplierPurchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    expect(received.status).toBe('received_at_hub');
    expect(received.receivedAt).toBeInstanceOf(Date);
  });

  it('maps a single-allocation partial directly and leaves the rest for a customer decision', async () => {
    const sku = await createSellableSku(prisma); // only one supplier for this SKU
    const supplier = await createActor(prisma, 'SUPPLIER', sku.supplierId);
    const order = await placeGuestOrder(app.getHttpServer(), [{ skuId: sku.id, quantity: 5 }]);
    await plan(order);
    const [po] = (await flush(sku.supplierId)).purchaseOrders;
    await http().post(`/purchase-orders/${po.id}/confirm`).set(supplier.auth)
      .send({ lines: [{ id: po.lines[0].id, status: 'confirmed_partial', confirmedQuantity: 3 }] }).expect(201);
    await settleEvents(po.id);
    const [allocation] = await allocationsOf(order.id);
    expect(allocation).toMatchObject({ result: 'confirmed_partial', confirmedQuantity: 3 });
    const after = await plan(order);
    expect(after.status).toBe('PARTIALLY_UNAVAILABLE');
    expect(after.lines[0]).toMatchObject({ coveredQuantity: 3, unresolvedQuantity: 2, status: 'ACTION_REQUIRED' });
    expect(await prisma.fulfillmentReceipt.count({ where: { orderId: order.id } })).toBe(0); // nothing phantom-received
  });

  it('maps a zero/price-changed answer to unavailable allocations with no payable quantity', async () => {
    const sku = await createSellableSku(prisma);
    const supplier = await createActor(prisma, 'SUPPLIER', sku.supplierId);
    const order = await placeGuestOrder(app.getHttpServer(), [{ skuId: sku.id, quantity: 4 }]);
    await plan(order);
    const [po] = (await flush(sku.supplierId)).purchaseOrders;
    await http().post(`/purchase-orders/${po.id}/confirm`).set(supplier.auth)
      .send({ lines: [{ id: po.lines[0].id, status: 'price_changed', confirmedQuantity: 1 }] }).expect(400);
    await http().post(`/purchase-orders/${po.id}/confirm`).set(supplier.auth)
      .send({ lines: [{ id: po.lines[0].id, status: 'price_changed' }] }).expect(201);
    await settleEvents(po.id);
    const [allocation] = await allocationsOf(order.id);
    expect(allocation).toMatchObject({ result: 'price_changed', confirmedQuantity: 0 });
    expect((await plan(order)).status).toBe('UNAVAILABLE');
    await http().post(`/purchase-orders/${po.id}/ready`).set(supplier.auth).expect(409);
  });
});
