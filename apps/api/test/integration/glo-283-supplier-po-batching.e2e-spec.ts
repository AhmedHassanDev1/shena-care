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
import { cairoWallTime, supplierResponseDeadline } from '../../src/modules/sourcing/services/supplier-schedule';
import { PurchaseOrderService } from '../../src/modules/sourcing/public';
import { OrderCancellationService } from '../../src/application/composition/services/order-cancellation.service';

/**
 * GLO-283 — Audit, Complete & Verify Supplier PO Batching.
 * Verifies approved provisional batching policy:
 * - 3 customer orders consolidation (2 + 1 + 3 -> 6)
 * - Timing checkpoints (08:55, 09:00, 11:59, 12:00, 23:59, 00:01, 00:59, 01:01)
 * - Friday closures and Saturday reopening
 * - Authorized vs unauthorized early flush (RBAC & audit trail)
 * - Concurrent scheduled and manual flushes
 * - Supplier responses (full, partial, zero, price changed, late)
 * - Same-SKU fallback and new supplier batching
 * - Order cancellation before/after PO dispatch
 * - Hub receiving lineage and absence of phantom stock
 * - Queue visibility
 */
describe('GLO-283 Supplier PO Batching Production Verification (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: DomainEventsService;
  let poService: PurchaseOrderService;
  let cancelService: OrderCancellationService;
  let admin: Actor;
  let hub: Actor;
  let supplierActor: Actor;
  let customerActor: Actor;
  let skuId: string;
  let supplierAId: string;
  let supplierBId: string;
  let locationId: string;

  const http = () => request(app.getHttpServer());

  const settleEvents = async (aggregateId: string) => {
    for (let i = 0; i < 100; i++) {
      await events.dispatchPending({ aggregateId });
      const pending = await prisma.domainEvent.count({ where: { aggregateId, status: { not: 'delivered' } } });
      if (pending === 0) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  };

  const flush = async (options: { supplierId?: string; reason?: string; force?: boolean; now?: Date } = {}, actor = admin) => {
    return (await http().post('/purchase-orders/batches')
      .set(actor.auth)
      .send(options)
      .expect(201)).body;
  };

  const allocationsOf = (orderId: string) => prisma.sourceAllocation.findMany({
    where: { requirement: { supplyRequest: { orderId } } },
    include: { supplierOffer: true, poLink: true },
    orderBy: { selectedAt: 'asc' },
  });

  it('automatically distributes 4/6 by delivery priority and immediately consolidates only eligible recovery', async () => {
    const fixture = await createSellableSku(prisma);
    const candidates = [];
    for (const [suffix, cost, extraSupplier, extraOffer] of [
      ['closed', 55, { closedWeekdays: [0, 1, 2, 3, 4, 5, 6] }, {}],
      ['moq', 56, {}, { minimumOrderUnits: 3 }],
      ['pack', 57, {}, { orderMultipleUnits: 4 }],
      ['unknown-pickup', 58, { pickupLeadMinutes: null }, {}],
      ['eligible', 65, {}, {}],
      ['loss', 1001, {}, {}],
    ] as const) {
      const supplier = await prisma.supplier.create({ data: { name: suffix + randomUUID(), slug: suffix + randomUUID(),
        closedWeekdays: [], opensAt: '00:00', closesAt: '23:59', pickupLeadMinutes: 10, ...extraSupplier } });
      await prisma.supplierOffer.create({ data: { supplierId: supplier.id, skuId: fixture.id, costPrice: cost,
        currency: 'EGP', availableQuantity: 20, lastConfirmedAt: new Date(), ...extraOffer } });
      candidates.push({ suffix, id: supplier.id });
    }
    const orders = [];
    for (const quantity of [2, 1, 3]) {
      const order = await placeGuestOrder(app, [{ skuId: fixture.id, quantity }]);
      await settleEvents(order.id);
      orders.push(order);
    }
    await prisma.order.update({ where: { id: orders[2].id }, data: { promisedDate: new Date() } });
    const before = await prisma.orderItem.findMany({ where: { orderId: { in: orders.map(o => o.id) } }, orderBy: { id: 'asc' } });
    const po = (await flush({ supplierId: fixture.supplierId })).purchaseOrders[0];
    expect(po.lines[0].requestedQuantity).toBe(6);
    await http().post(`/purchase-orders/${po.id}/confirm`).set(admin.auth)
      .send({ lines: [{ id: po.lines[0].id, status: 'confirmed_partial', confirmedQuantity: 4 }] }).expect(201);
    await settleEvents(po.id);
    const links = await prisma.purchaseOrderLineAllocation.findMany({ where: { purchaseOrderLineId: po.lines[0].id } });
    expect(orders.map(order => links.find(link => link.orderId === order.id)?.confirmedQuantity)).toEqual([1, 0, 3]);
    expect((await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: po.lines[0].id } })).distributionRequired).toBe(false);
    const alternate = await prisma.supplierPurchaseOrder.findMany({ where: { supplierId: { in: candidates.map(s => s.id) } }, include: { lines: true } });
    expect(alternate).toHaveLength(1);
    expect(alternate[0]).toMatchObject({ supplierId: candidates.find(s => s.suffix === 'eligible')!.id, expedited: true });
    expect(alternate[0].lines[0].requestedQuantity).toBe(2);
    const competing = await Promise.all([
      http().post(`/purchase-orders/${po.id}/confirm`).set(admin.auth).send({ lines: [{ id: po.lines[0].id, status: 'confirmed_full' }] }),
      http().post(`/purchase-orders/${alternate[0].id}/confirm`).set(admin.auth).send({ lines: [{ id: alternate[0].lines[0].id, status: 'confirmed_full' }] }),
    ]);
    expect(competing.map(r => r.status)).toEqual([409, 201]);
    await settleEvents(alternate[0].id);
    expect((await prisma.sourceAllocation.aggregate({ where: { requirement: { supplyRequest: { orderId: { in: orders.map(o => o.id) } } } }, _sum: { confirmedQuantity: true } }))._sum.confirmedQuantity).toBe(6);
    expect(await prisma.orderItem.findMany({ where: { orderId: { in: orders.map(o => o.id) } }, orderBy: { id: 'asc' } })).toEqual(before);
  });

  it('automatically recovers repeated shared partials using estimated leads without revoking confirmed stock or changing delivery promises', async () => {
    const sku = await createSellableSku(prisma);
    const alternates = [];
    for (const cost of [65, 75]) {
      const supplier = await prisma.supplier.create({ data: { name: 'Estimated recovery ' + randomUUID(), slug: 'estimated-' + randomUUID(),
        closedWeekdays: [], opensAt: '00:00', closesAt: '23:59', pickupLeadMinutes: null } });
      const offer = await prisma.supplierOffer.create({ data: { supplierId: supplier.id, skuId: sku.id, costPrice: cost,
        currency: 'EGP', availableQuantity: 10, lastConfirmedAt: new Date() } });
      alternates.push({ supplierId: supplier.id, offerId: offer.id });
    }
    const orders = [];
    for (const quantity of [2, 1, 3]) { const order = await placeGuestOrder(app, [{ skuId: sku.id, quantity }]); await settleEvents(order.id); orders.push(order); }
    await prisma.order.update({ where: { id: orders[2].id }, data: { promisedDate: new Date() } });
    const snapshots = () => prisma.order.findMany({ where: { id: { in: orders.map(o => o.id) } }, orderBy: { id: 'asc' },
      select: { id: true, promisedDate: true, items: { orderBy: { id: 'asc' }, select: { id: true, price: true, lineTotal: true, quantity: true, currency: true } } } });
    const before = await snapshots();
    const original = (await flush({ supplierId: sku.supplierId })).purchaseOrders[0];
    const answer = { lines: [{ id: original.lines[0].id, status: 'confirmed_partial', confirmedQuantity: 4 }] };
    const simultaneous = await Promise.all([http().post(`/purchase-orders/${original.id}/confirm`).set(admin.auth).send(answer),
      http().post(`/purchase-orders/${original.id}/confirm`).set(admin.auth).send(answer)]);
    expect(simultaneous.some(r => r.status === 201)).toBe(true);
    expect(simultaneous.every(r => [201, 409].includes(r.status))).toBe(true);
    await settleEvents(original.id);
    const originalLinks = () => prisma.purchaseOrderLineAllocation.findMany({ where: { purchaseOrderLineId: original.lines[0].id }, orderBy: { id: 'asc' } });
    const preserved = await originalLinks();
    expect(orders.map(o => preserved.find(link => link.orderId === o.id)?.confirmedQuantity)).toEqual([1, 0, 3]);
    const second = await prisma.supplierPurchaseOrder.findFirstOrThrow({ where: { supplierId: alternates[0].supplierId }, include: { lines: true } });
    expect(second).toMatchObject({ expedited: true, status: 'sent' });
    expect(second.lines[0].requestedQuantity).toBe(2);
    await Promise.all([1, 2].map(() => poService.flushProcurementBatch('system:duplicate-recovery', {
      orderIds: orders.map(o => o.id), recoveryOnly: true, expedited: true, isEarlyFlush: true,
    })));
    expect(await prisma.supplierPurchaseOrder.count({ where: { supplierId: alternates[0].supplierId } })).toBe(1);
    await http().post(`/purchase-orders/${second.id}/confirm`).set(admin.auth)
      .send({ lines: [{ id: second.lines[0].id, status: 'confirmed_partial', confirmedQuantity: 1 }] }).expect(201);
    await settleEvents(second.id);
    expect(await originalLinks()).toEqual(preserved);
    const secondLinks = await prisma.purchaseOrderLineAllocation.findMany({ where: { purchaseOrderLineId: second.lines[0].id } });
    expect([orders[0], orders[1]].map(o => secondLinks.find(link => link.orderId === o.id)?.confirmedQuantity)).toEqual([1, 0]);
    const third = await prisma.supplierPurchaseOrder.findFirstOrThrow({ where: { supplierId: alternates[1].supplierId }, include: { lines: true } });
    expect(third.lines[0].requestedQuantity).toBe(1);
    const competing = await Promise.all([
      http().post(`/purchase-orders/${second.id}/confirm`).set(admin.auth).send({ lines: [{ id: second.lines[0].id, status: 'confirmed_full' }] }),
      http().post(`/purchase-orders/${third.id}/confirm`).set(admin.auth).send({ lines: [{ id: third.lines[0].id, status: 'confirmed_full' }] }),
    ]);
    expect(competing.map(r => r.status)).toEqual([409, 201]);
    await settleEvents(third.id);
    expect(await originalLinks()).toEqual(preserved);
    expect((await prisma.sourceAllocation.aggregate({ where: { requirement: { supplyRequest: { orderId: { in: orders.map(o => o.id) } } } }, _sum: { confirmedQuantity: true } }))._sum.confirmedQuantity).toBe(6);
    expect(await prisma.purchaseOrderLine.count({ where: { purchaseOrderId: { in: [original.id, second.id] }, distributionRequired: true } })).toBe(0);
    expect(await snapshots()).toEqual(before);
    expect(await prisma.sourcingDecision.findMany({ where: { skuId: sku.id } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ rankedOffers: expect.arrayContaining([expect.objectContaining({ offerId: alternates[0].offerId,
        pickupLead: { source: 'OPERATIONAL_ESTIMATE', minutes: 240, uncertaintyMinutes: 120, planningMinutes: 360, deliverySlaVerified: false } })]) }),
    ]));
  });

  it('does not issue an estimated-lead fallback that cannot meet the existing delivery constraint', async () => {
    const sku = await createSellableSku(prisma);
    const supplier = await prisma.supplier.create({ data: { name: 'Uncertain late ' + randomUUID(), slug: 'uncertain-late-' + randomUUID(),
      closedWeekdays: [], opensAt: '00:00', closesAt: '23:59' } });
    await prisma.supplierOffer.create({ data: { supplierId: supplier.id, skuId: sku.id, costPrice: 65, currency: 'EGP', lastConfirmedAt: new Date() } });
    const order = await placeGuestOrder(app, [{ skuId: sku.id, quantity: 1 }]); await settleEvents(order.id);
    const before = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { promisedDate: true, totalAmount: true } });
    const po = (await flush({ supplierId: sku.supplierId })).purchaseOrders[0];
    const saved = process.env.PROCUREMENT_ESTIMATED_PICKUP_LEAD_MINUTES;
    try {
      process.env.PROCUREMENT_ESTIMATED_PICKUP_LEAD_MINUTES = '10080';
      await http().post(`/purchase-orders/${po.id}/confirm`).set(admin.auth).send({ lines: [{ id: po.lines[0].id, status: 'unavailable' }] }).expect(201);
      await settleEvents(po.id);
      expect(await prisma.supplierPurchaseOrder.count({ where: { supplierId: supplier.id } })).toBe(0);
      expect(await prisma.availabilityActionRequirement.count({ where: { requirement: { supplyRequest: { orderId: order.id } } } })).toBe(1);
      expect(await prisma.sourcingDecision.findMany({ where: { skuId: sku.id } })).toEqual(expect.arrayContaining([
        expect.objectContaining({ excludedOffers: expect.arrayContaining([expect.objectContaining({ reasonCodes: expect.arrayContaining(['DELIVERY_PROMISE']) })]) }),
      ]));
      expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { promisedDate: true, totalAmount: true } })).toEqual(before);
    } finally { if (saved === undefined) delete process.env.PROCUREMENT_ESTIMATED_PICKUP_LEAD_MINUTES; else process.env.PROCUREMENT_ESTIMATED_PICKUP_LEAD_MINUTES = saved; }
  });

  it.each([6, 0])('consolidates 2 + 1 + 3 and confirms %i/6 without duplicate commitments', async quantity => {
    const sku = await createSellableSku(prisma);
    const alternate = await prisma.supplier.create({ data: { name: 'Recovery ' + randomUUID(), slug: 'recovery-' + randomUUID(),
      closedWeekdays: [], opensAt: '00:00', closesAt: '23:59', pickupLeadMinutes: 10 } });
    await prisma.supplierOffer.create({ data: { supplierId: alternate.id, skuId: sku.id, costPrice: 65, currency: 'EGP', lastConfirmedAt: new Date() } });
    const orders = [];
    for (const q of [2, 1, 3]) { const order = await placeGuestOrder(app, [{ skuId: sku.id, quantity: q }]); await settleEvents(order.id); orders.push(order); }
    const po = (await flush({ supplierId: sku.supplierId })).purchaseOrders[0];
    expect(po.lines[0].requestedQuantity).toBe(6);
    const answer = { lines: [{ id: po.lines[0].id, status: quantity ? 'confirmed_full' : 'unavailable' }] };
    const responses = await Promise.all([http().post(`/purchase-orders/${po.id}/confirm`).set(admin.auth).send(answer),
      http().post(`/purchase-orders/${po.id}/confirm`).set(admin.auth).send(answer)]);
    expect(responses.some(r => r.status === 201)).toBe(true);
    expect(responses.every(r => [201, 409].includes(r.status))).toBe(true);
    await settleEvents(po.id);
    const linked = await prisma.purchaseOrderLineAllocation.aggregate({ where: { purchaseOrderLineId: po.lines[0].id }, _sum: { confirmedQuantity: true } });
    expect(linked._sum.confirmedQuantity).toBe(quantity);
    const recovery = await prisma.supplierPurchaseOrder.findMany({ where: { supplierId: alternate.id }, include: { lines: true } });
    expect(recovery).toHaveLength(quantity ? 0 : 1);
    if (!quantity) expect(recovery[0].lines[0].requestedQuantity).toBe(6);
  });

  it('rolls back an interrupted partial answer and retries without losing or duplicating quantity', async () => {
    const sku = await createSellableSku(prisma);
    const order = await placeGuestOrder(app, [{ skuId: sku.id, quantity: 2 }]); await settleEvents(order.id);
    const po = (await flush({ supplierId: sku.supplierId })).purchaseOrders[0];
    const record = jest.spyOn(events, 'record').mockRejectedValueOnce(new Error('Injected outbox interruption'));
    const answer = { lines: [{ id: po.lines[0].id, status: 'confirmed_partial' as const, confirmedQuantity: 1 }] };
    await expect(poService.confirmPurchaseOrder(po.id, answer)).rejects.toThrow('Injected outbox interruption');
    record.mockRestore();
    expect((await prisma.supplierPurchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).confirmedAt).toBeNull();
    expect((await allocationsOf(order.id))[0]).toMatchObject({ result: 'pending', confirmedQuantity: 0 });
    expect((await prisma.supplierOffer.findUniqueOrThrow({ where: { supplierId_skuId: { supplierId: sku.supplierId, skuId: sku.id } } })).isAvailable).toBe(true);
    await http().post(`/purchase-orders/${po.id}/confirm`).set(admin.auth).send(answer).expect(201);
    await settleEvents(po.id);
    expect((await allocationsOf(order.id))[0]).toMatchObject({ result: 'confirmed_partial', confirmedQuantity: 1 });
  });

  it('expires an unanswered issued PO atomically and rejects a late supplier confirmation', async () => {
    const sku = await createSellableSku(prisma);
    const alternateSupplier = await prisma.supplier.create({ data: { name: 'Expiry fallback ' + randomUUID(), slug: 'expiry-' + randomUUID(), closedWeekdays: [], opensAt: '00:00', closesAt: '23:59', pickupLeadMinutes: 10 } });
    await prisma.supplierOffer.create({ data: { supplierId: alternateSupplier.id, skuId: sku.id, costPrice: 65, currency: 'EGP', lastConfirmedAt: new Date() } });
    const actor = await createActor(prisma, 'SUPPLIER', sku.supplierId);
    const order = await placeGuestOrder(app, [{ skuId: sku.id, quantity: 2 }]);
    await settleEvents(order.id);
    const result = await flush({ supplierId: sku.supplierId });
    const po = result.purchaseOrders[0];
    expect(po.responseDeadlineAt).toBeTruthy();
    const due = new Date();
    await prisma.supplierPurchaseOrder.update({ where: { id: po.id }, data: { responseDeadlineAt: new Date(due.getTime() - 1) } });
    await Promise.all([poService.expireDuePurchaseOrders(due), poService.expireDuePurchaseOrders(due),
      http().post(`/purchase-orders/${po.id}/confirm`).set(actor.auth).send({ lines: [{ id: po.lines[0].id, status: 'confirmed_full' }] }).expect(409)]);
    const expired = await prisma.supplierPurchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    expect(expired.status).toBe('expired');
    expect((await allocationsOf(order.id))[0].result).toBe('unavailable');
    await settleEvents(po.id);
    await settleEvents(po.id);
    const alternatives = await prisma.supplierPurchaseOrder.findMany({ where: { supplierId: alternateSupplier.id }, include: { lines: true } });
    expect(alternatives).toHaveLength(1);
    expect(alternatives[0].lines[0].requestedQuantity).toBe(2);
    expect(alternatives[0].expedited).toBe(true);
    const foreign = await createActor(prisma, 'SUPPLIER', alternateSupplier.id);
    await http().post(`/purchase-orders/${po.id}/expiry-dispute`).send({ note: 'Prepared before deadline' }).expect(401);
    await http().post(`/purchase-orders/${po.id}/expiry-dispute`).set(customerActor.auth).send({ note: 'Prepared before deadline' }).expect(403);
    await http().post(`/purchase-orders/${po.id}/expiry-dispute`).set(actor.auth).send({ note: 'x'.repeat(1001) }).expect(400);
    await http().post(`/purchase-orders/${po.id}/expiry-dispute`).set(foreign.auth).send({ note: 'Prepared before deadline' }).expect(403);
    await http().post(`/purchase-orders/${po.id}/expiry-dispute`).set(actor.auth).send({ note: 'Prepared before deadline' }).expect(201);
    await http().post(`/purchase-orders/${po.id}/expiry-dispute`).set(actor.auth).send({ note: 'Repeated report' }).expect(201);
    expect((await prisma.supplierPurchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe('expired');
    expect(await prisma.notificationOutbox.count({ where: { deduplicationKey: `operations.exception:po-expiry-dispute:${po.id}` } })).toBe(1);
    const schedule = await prisma.supplier.findUniqueOrThrow({ where: { id: alternateSupplier.id } });
    expect(alternatives[0].responseDeadlineAt).toEqual(supplierResponseDeadline(alternatives[0].issuedAt!, schedule, 30));
    await poService.expireDuePurchaseOrders(new Date(alternatives[0].responseDeadlineAt!.getTime() + 1));
    await settleEvents(alternatives[0].id);
    expect((await prisma.supplierPurchaseOrder.findUniqueOrThrow({ where: { id: alternatives[0].id } })).status).toBe('expired');
    await http().post(`/purchase-orders/${alternatives[0].id}/confirm`).set(foreign.auth)
      .send({ lines: [{ id: alternatives[0].lines[0].id, status: 'confirmed_full' }] }).expect(409);
    const normalSchedule = await prisma.supplier.findUniqueOrThrow({ where: { id: sku.supplierId } });
    expect(new Date(po.responseDeadlineAt)).toEqual(supplierResponseDeadline(new Date(po.issuedAt), normalSchedule, 60));
    await http().post(`/purchase-orders/${po.id}/confirm`).set(actor.auth)
      .send({ lines: [{ id: po.lines[0].id, status: 'confirmed_full' }] }).expect(409);
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useValue(new DeterministicAiClient()).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useLogger(['error']);
    await app.init();

    prisma = app.get(PrismaService);
    events = app.get(DomainEventsService);
    poService = app.get(PurchaseOrderService);
    cancelService = app.get(OrderCancellationService);

    const sku = await createSellableSku(prisma);
    skuId = sku.id;
    supplierAId = sku.supplierId;

    // Supplier B as fallback
    supplierBId = (await prisma.supplier.create({
      data: { name: 'Fallback Supplier B ' + randomUUID(), slug: 'fallback-b-' + randomUUID() },
    })).id;
    await prisma.supplierOffer.create({
      data: {
        supplierId: supplierBId,
        skuId,
        costPrice: 55,
        currency: 'EGP',
        lastObservedAt: new Date(),
        lastConfirmedAt: new Date(),
      },
    });

    admin = await createActor(prisma, 'ADMIN');
    hub = await createActor(prisma, 'HUB_OPERATOR');
    supplierActor = await createActor(prisma, 'SUPPLIER', supplierAId);
    customerActor = await createActor(prisma, 'CUSTOMER');

    locationId = (await prisma.fulfillmentLocation.create({
      data: { name: 'GLO-283 Test Hub ' + randomUUID(), address: 'Cairo Test' },
    })).id;
    await prisma.fulfillmentLocationOperator.create({ data: { locationId, operatorId: hub.id } });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('1. consolidates 3 customer orders requesting SKU A (2 + 1 + 3) into 1 PO line for 6 with correct individual allocations', async () => {
    const o1 = await placeGuestOrder(app, [{ skuId, quantity: 2 }]);
    const o2 = await placeGuestOrder(app, [{ skuId, quantity: 1 }]);
    const o3 = await placeGuestOrder(app, [{ skuId, quantity: 3 }]);

    await settleEvents(o1.id);
    await settleEvents(o2.id);
    await settleEvents(o3.id);

    // Flush batch for Supplier A
    const result = await flush({ supplierId: supplierAId, reason: 'Test 3-order consolidation' });
    expect(result.purchaseOrders).toHaveLength(1);

    const po = result.purchaseOrders[0];
    expect(po.supplierId).toBe(supplierAId);
    expect(po.lines).toHaveLength(1);

    const line = po.lines[0];
    expect(line.skuId).toBe(skuId);
    expect(line.requestedQuantity).toBe(6); // 2 + 1 + 3
    expect(line.unitCost).toBe('50');

    // Individual lineage links
    expect(line.allocations).toHaveLength(3);
    const links = line.allocations.map((a: { orderId: string; quantity: number }) => [a.orderId, a.quantity]);
    expect(links).toEqual(expect.arrayContaining([
      [o1.id, 2],
      [o2.id, 1],
      [o3.id, 3],
    ]));

    // Check notes and audit trail in DB
    expect(po.notes).toContain('Test 3-order consolidation');
    const auditEvent = await prisma.domainEvent.findFirst({
      where: { eventType: 'purchase_order.batch_flushed' },
      orderBy: { createdAt: 'desc' },
    });
    expect(auditEvent).toBeDefined();
    expect(auditEvent?.payload).toMatchObject({ count: 1, reason: 'Test 3-order consolidation' });
  });

  it('2. respects dispatch checkpoints and midnight-crossing operating window (08:55, 09:00, 11:59, 12:00, 23:59, 00:01, 00:59, 01:01)', async () => {
    // Supplier with default operating window 09:00 to 01:00 next day (open weekdays Sunday-Thursday, closed Friday)
    const testSku = await createSellableSku(prisma);
    const supId = testSku.supplierId;
    await prisma.supplierOffer.updateMany({ where: { supplierId: supId }, data: { lastObservedAt: new Date('2027-01-16T10:00:00Z') } });

    // Place an order at 08:55 on Wednesday 2027-01-13
    const t0855 = cairoWallTime('2027-01-13', 8 * 60 + 55);
    const o_0855 = await placeGuestOrder(app, [{ skuId: testSku.id, quantity: 1 }]);
    await settleEvents(o_0855.id);
    await prisma.sourceAllocation.updateMany({ where: { requirement: { supplyRequest: { orderId: o_0855.id } } }, data: { selectedAt: t0855 } });

    // At 08:55: supplier is closed (opens at 09:00).
    // Early flush without force should be rejected with 400 (outside operating window)
    await expect(poService.flushProcurementBatch(admin.id, { supplierId: supId, now: t0855 })).rejects.toThrow('currently closed');

    // Scheduled batch at 08:55 skips supplier
    const sched0855 = await poService.flushProcurementBatch('system:procurement-schedule', {
      supplierId: supId,
      isEarlyFlush: false,
      now: t0855,
    });
    expect(sched0855.purchaseOrders).toHaveLength(0);

    // At 09:00: supplier opens! Normal dispatch checkpoint 09:00 dispatches the 08:55 order
    const t0900 = cairoWallTime('2027-01-13', 9 * 60);
    const sched0900 = await poService.flushProcurementBatch('system:procurement-schedule', {
      supplierId: supId,
      isEarlyFlush: false,
      now: t0900,
    });
    expect(sched0900.purchaseOrders).toHaveLength(1);
    expect(sched0900.purchaseOrders[0].lines[0].requestedQuantity).toBe(1);

    // Order placed at 11:59 (before 12:00 cutoff)
    const t1159 = cairoWallTime('2027-01-13', 11 * 60 + 59);
    const o_1159 = await placeGuestOrder(app, [{ skuId: testSku.id, quantity: 2 }]);
    await settleEvents(o_1159.id);
    await prisma.sourceAllocation.updateMany({ where: { requirement: { supplyRequest: { orderId: o_1159.id } } }, data: { selectedAt: t1159 } });
    expect((await poService.flushProcurementBatch('system:procurement-schedule', { supplierId: supId, isEarlyFlush: false, now: t1159 })).purchaseOrders).toHaveLength(0);

    // At 11:59: supplier is open, so an authorized early flush works immediately
    const early1159 = await poService.flushProcurementBatch(admin.id, {
      supplierId: supId,
      isEarlyFlush: true,
      reason: 'Urgent early flush at 11:59',
      now: t1159,
    });
    expect(early1159.purchaseOrders).toHaveLength(1);
    expect(early1159.purchaseOrders[0].lines[0].requestedQuantity).toBe(2);

    // Order placed at 12:00 (exactly at checkpoint)
    const t1200 = cairoWallTime('2027-01-13', 12 * 60);
    const o_1200 = await placeGuestOrder(app, [{ skuId: testSku.id, quantity: 3 }]);
    await settleEvents(o_1200.id);
    await prisma.sourceAllocation.updateMany({ where: { requirement: { supplyRequest: { orderId: o_1200.id } } }, data: { selectedAt: t1200 } });
    const sched1200 = await poService.flushProcurementBatch('system:procurement-schedule', {
      supplierId: supId,
      isEarlyFlush: false,
      now: t1200,
    });
    expect(sched1200.purchaseOrders).toHaveLength(1);
    expect(sched1200.purchaseOrders[0].lines[0].requestedQuantity).toBe(3);

    // Order placed at 23:59
    const t2359 = cairoWallTime('2027-01-13', 23 * 60 + 59);
    const o_2359 = await placeGuestOrder(app, [{ skuId: testSku.id, quantity: 4 }]);
    await settleEvents(o_2359.id);
    await prisma.sourceAllocation.updateMany({ where: { requirement: { supplyRequest: { orderId: o_2359.id } } }, data: { selectedAt: t2359 } });
    // Dispatched at 00:00 midnight checkpoint
    const t0000 = cairoWallTime('2027-01-14', 0);
    const sched0000 = await poService.flushProcurementBatch('system:procurement-schedule', {
      supplierId: supId,
      isEarlyFlush: false,
      now: t0000,
    });
    expect(sched0000.purchaseOrders).toHaveLength(1);
    expect(sched0000.purchaseOrders[0].lines[0].requestedQuantity).toBe(4);

    // Orders arriving after 00:00 and before 01:00 (e.g. 00:01 and 00:59)
    const t0001 = cairoWallTime('2027-01-14', 1);
    const t0059 = cairoWallTime('2027-01-14', 59);
    const o_0001 = await placeGuestOrder(app, [{ skuId: testSku.id, quantity: 1 }]);
    const o_0059 = await placeGuestOrder(app, [{ skuId: testSku.id, quantity: 2 }]);
    await settleEvents(o_0001.id);
    await settleEvents(o_0059.id);
    await prisma.sourceAllocation.updateMany({
      where: { requirement: { supplyRequest: { orderId: o_0001.id } } },
      data: { selectedAt: t0001 },
    });
    await prisma.sourceAllocation.updateMany({
      where: { requirement: { supplyRequest: { orderId: o_0059.id } } },
      data: { selectedAt: t0059 },
    });

    // Scheduled batch at 00:30 holds them: "Orders arriving after 00:00 and before 01:00 wait for the next eligible batch"
    const t0030 = cairoWallTime('2027-01-14', 30);
    const sched0030 = await poService.flushProcurementBatch('system:procurement-schedule', {
      supplierId: supId,
      isEarlyFlush: false,
      now: t0030,
    });
    expect(sched0030.purchaseOrders).toHaveLength(0); // Kept waiting!

    // But authorized early flush at 00:30 dispatches them: "unless an authorized early flush occurs while the supplier can receive it"
    // Since supplier operating window is 09:00-01:00, supplier is OPEN at 00:30!
    const early0030 = await poService.flushProcurementBatch(admin.id, {
      supplierId: supId,
      isEarlyFlush: true,
      reason: 'Authorized midnight early flush',
      now: t0030,
    });
    expect(early0030.purchaseOrders).toHaveLength(1);
    expect(early0030.purchaseOrders[0].lines[0].requestedQuantity).toBe(3); // 1 + 2

    // Order placed at 01:01 (after 01:00 closing)
    const t0101 = cairoWallTime('2027-01-14', 61);
    const o_0101 = await placeGuestOrder(app, [{ skuId: testSku.id, quantity: 5 }]);
    await settleEvents(o_0101.id);
    await prisma.sourceAllocation.updateMany({
      where: { requirement: { supplyRequest: { orderId: o_0101.id } } },
      data: { selectedAt: t0101 },
    });

    // At 01:01: supplier is CLOSED! Early flush fails
    await expect(poService.flushProcurementBatch(admin.id, { supplierId: supId, now: t0101 })).rejects.toThrow('currently closed');

    // At Thursday 09:00: supplier reopens and scheduled batch flushes it
    const tThu0900 = cairoWallTime('2027-01-14', 9 * 60);
    const schedThu0900 = await poService.flushProcurementBatch('system:procurement-schedule', {
      supplierId: supId,
      isEarlyFlush: false,
      now: tThu0900,
    });
    expect(schedThu0900.purchaseOrders).toHaveLength(1);
    expect(schedThu0900.purchaseOrders[0].lines[0].requestedQuantity).toBe(5);
  });

  it('3. respects Friday closures and Saturday reopening', async () => {
    const testSku = await createSellableSku(prisma);
    const supId = testSku.supplierId;
    await prisma.supplierOffer.updateMany({ where: { supplierId: supId }, data: { lastObservedAt: new Date('2027-01-16T10:00:00Z') } });

    // Friday 2027-01-15 12:00 Cairo time
    const fridayNoon = cairoWallTime('2027-01-15', 12 * 60);
    const fridayOrder = await placeGuestOrder(app, [{ skuId: testSku.id, quantity: 2 }]);
    await settleEvents(fridayOrder.id);
    await prisma.sourceAllocation.updateMany({ where: { requirement: { supplyRequest: { orderId: fridayOrder.id } } }, data: { selectedAt: fridayNoon } });

    // On Friday: supplier is closed by default. Scheduled batch flushes nothing.
    const schedFri = await poService.flushProcurementBatch('system:procurement-schedule', {
      supplierId: supId,
      isEarlyFlush: false,
      now: fridayNoon,
    });
    expect(schedFri.purchaseOrders).toHaveLength(0);

    // Early flush on Friday is rejected because supplier cannot receive
    await expect(poService.flushProcurementBatch(admin.id, { supplierId: supId, now: fridayNoon })).rejects.toThrow('currently closed');

    // Saturday 2027-01-16 09:00 Cairo time: supplier reopens
    const satMorning = cairoWallTime('2027-01-16', 9 * 60);
    const schedSat = await poService.flushProcurementBatch('system:procurement-schedule', {
      supplierId: supId,
      isEarlyFlush: false,
      now: satMorning,
    });
    expect(schedSat.purchaseOrders).toHaveLength(1);
    expect(schedSat.purchaseOrders[0].lines[0].requestedQuantity).toBe(2);
  });

  it('4. enforces RBAC permissions for early batch flush', async () => {
    // Admin is authorized (201)
    await http().post('/purchase-orders/batches')
      .set(admin.auth)
      .send({ reason: 'Admin authorized' })
      .expect(201);

    // Hub operator is authorized (201)
    await http().post('/purchase-orders/batches')
      .set(hub.auth)
      .send({ reason: 'Hub operator authorized' })
      .expect(201);

    // Supplier is NOT authorized (403)
    await http().post('/purchase-orders/batches')
      .set(supplierActor.auth)
      .send({ reason: 'Supplier unauthorized' })
      .expect(403);

    // Customer is NOT authorized (403)
    await http().post('/purchase-orders/batches')
      .set(customerActor.auth)
      .send({ reason: 'Customer unauthorized' })
      .expect(403);

    // Unauthenticated is rejected (401)
    await http().post('/purchase-orders/batches')
      .send({ reason: 'Anon' })
      .expect(401);
  });

  it('5. prevents double batching under concurrent flushes', async () => {
    const testSku = await createSellableSku(prisma);
    const order = await placeGuestOrder(app, [{ skuId: testSku.id, quantity: 7 }]);
    await settleEvents(order.id);

    // Concurrent flushes
    const [res1, res2] = await Promise.all([
      flush({ supplierId: testSku.supplierId }),
      flush({ supplierId: testSku.supplierId }),
    ]);

    const allPos = [...res1.purchaseOrders, ...res2.purchaseOrders];
    expect(allPos).toHaveLength(1);
    expect(allPos[0].lines[0].requestedQuantity).toBe(7);

    // Double batching is strictly impossible
    expect(await prisma.purchaseOrderLineAllocation.count({
      where: { orderId: order.id },
    })).toBe(1);
  });

  it('6. handles supplier fallback and subsequent batching on shortages', async () => {
    const testSku = await createSellableSku(prisma);
    const supA = testSku.supplierId;
    const supB = (await prisma.supplier.create({
      data: { name: 'Fallback B ' + randomUUID(), slug: 'fb-b-' + randomUUID(), closedWeekdays: [], opensAt: '00:00', closesAt: '23:59', pickupLeadMinutes: 10 },
    })).id;
    await prisma.supplierOffer.create({
      data: { supplierId: supB, skuId: testSku.id, costPrice: 65, currency: 'EGP', lastObservedAt: new Date(), lastConfirmedAt: new Date() },
    });

    const supAActor = await createActor(prisma, 'SUPPLIER', supA);
    const order = await placeGuestOrder(app, [{ skuId: testSku.id, quantity: 4 }]);
    await settleEvents(order.id);

    // Batch 1 to Supplier A
    const b1 = await flush({ supplierId: supA });
    const poA = b1.purchaseOrders[0];

    // Supplier A partial: confirms only 1 of 4
    await http().post(`/purchase-orders/${poA.id}/confirm`)
      .set(supAActor.auth)
      .send({ lines: [{ id: poA.lines[0].id, status: 'confirmed_partial', confirmedQuantity: 1 }] })
      .expect(201);

    await settleEvents(poA.id);

    expect((await prisma.supplierOffer.findUniqueOrThrow({ where: { supplierId_skuId: { supplierId: supA, skuId: testSku.id } } })).isAvailable).toBe(false);

    // Allocation for Supplier A is confirmed_partial for 1; shortage of 3 re-plans to Supplier B!
    const allocs = await allocationsOf(order.id);
    expect(allocs.map(a => [a.supplierOffer.supplierId, a.result, a.confirmedQuantity, a.allocatedQuantity])).toEqual([
      [supA, 'confirmed_partial', 1, 4],
      [supB, 'pending', 0, 3],
    ]);

    // The durable response handler already dispatched fallback, without a manual batch.
    const alternate = await prisma.supplierPurchaseOrder.findMany({ where: { supplierId: supB }, include: { lines: { include: { allocations: true } } } });
    expect(alternate).toHaveLength(1);
    expect(alternate[0].expedited).toBe(true);
    expect(alternate[0].lines[0].requestedQuantity).toBe(3);
    expect(alternate[0].lines[0].allocations[0].orderId).toBe(order.id);
    expect((await flush({ supplierId: supB })).purchaseOrders).toHaveLength(0);
  });

  it('7. preserves lineage when order is cancelled before vs after batch dispatch', async () => {
    const testSku = await createSellableSku(prisma);

    // Case A: Cancelled BEFORE batch dispatch
    const oPre = await placeGuestOrder(app, [{ skuId: testSku.id, quantity: 2 }]);
    await settleEvents(oPre.id);
    await cancelService.cancel(oPre.id, admin.id, { reasonCode: 'CUSTOMER_REQUEST', notes: 'Pre-batch cancel' });

    // Flush batch: cancelled order must NOT be batched!
    const flushPre = await flush({ supplierId: testSku.supplierId });
    expect(flushPre.purchaseOrders).toHaveLength(0);

    // Case B: Cancelled AFTER batch dispatch
    const oPost = await placeGuestOrder(app, [{ skuId: testSku.id, quantity: 3 }]);
    await settleEvents(oPost.id);
    const flushPost = await flush({ supplierId: testSku.supplierId });
    expect(flushPost.purchaseOrders).toHaveLength(1);
    const dispatchedPo = flushPost.purchaseOrders[0];

    // Now cancel the order
    const cancelRes = await cancelService.cancel(oPost.id, admin.id, { reasonCode: 'CUSTOMER_REQUEST', notes: 'Post-batch cancel' });
    expect(cancelRes.supplierCommitments).toHaveLength(1);
    expect(cancelRes.supplierCommitments[0].purchaseOrderId).toBe(dispatchedPo.id);

    // The already-sent PO is intact (not mutated)
    const poAfter = await poService.getPurchaseOrder(dispatchedPo.id);
    expect(poAfter.lines[0].requestedQuantity).toBe(3);
  });

  it('8. provides operational visibility into the procurement queue and checkpoints', async () => {
    const res = await http().get('/purchase-orders/batches/queue')
      .set(admin.auth)
      .expect(200);

    expect(res.body).toMatchObject({
      timeZone: 'Africa/Cairo',
      nextCheckpoint: expect.any(String),
      totalPendingAllocations: expect.any(Number),
      suppliers: expect.any(Array),
      recentBatches: expect.any(Array),
    });
    expect(res.body.suppliers.length).toBeGreaterThan(0);
    expect(res.body.suppliers[0]).toHaveProperty('canReceive');
  });
});
