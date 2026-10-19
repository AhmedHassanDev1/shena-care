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
 * GLO-237 red team + GLO-243: impossible packs/MOQs and late price increases are explicit supplier
 * exceptions (never silently accepted, customer price never changes, the order is re-planned), and
 * confirmed units that never reach the Hub are attributed shortfalls — no phantom receipt, the PO
 * completes on what arrived, and the payable pays only received units.
 */
describe('GLO-237/243 supplier exceptions and receiving shortfalls (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: DomainEventsService;
  let admin: Actor; let hub: Actor; let driver: Actor;
  let locationId: string;
  const http = () => request(app.getHttpServer());

  const settleEvents = async (aggregateId: string) => {
    for (let i = 0; i < 100; i++) {
      await events.dispatchPending({ aggregateId });
      if (!await prisma.domainEvent.count({ where: { aggregateId, status: { not: 'delivered' } } })) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  };
  const procure = async (quantity: number, fallbackCost?: number) => {
    const sku = await createSellableSku(prisma); // supplier offer at 50 EGP
    if (fallbackCost) {
      const fallback = await prisma.supplier.create({ data: { name: 'Fallback ' + randomUUID(), slug: 'fallback-' + randomUUID() } });
      await prisma.supplierOffer.create({ data: { supplierId: fallback.id, skuId: sku.id, costPrice: fallbackCost, currency: 'EGP', lastObservedAt: new Date(), lastConfirmedAt: new Date() } });
    }
    const supplier = await createActor(prisma, 'SUPPLIER', sku.supplierId);
    const order = await placeGuestOrder(app, [{ skuId: sku.id, quantity }]);
    await settleEvents(order.id);
    const [po] = (await http().post('/purchase-orders/batches').set(admin.auth).send({ supplierId: sku.supplierId }).expect(201)).body.purchaseOrders;
    return { sku, supplier, order, po, lineId: po.lines[0].id as string, link: po.lines[0].allocations[0] };
  };
  const allocations = (orderId: string) => prisma.sourceAllocation.findMany({
    where: { requirement: { supplyRequest: { orderId } } }, include: { supplierOffer: true }, orderBy: { selectedAt: 'asc' },
  });

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
    driver = await createActor(prisma, 'DRIVER');
    locationId = (await prisma.fulfillmentLocation.create({ data: { name: 'Shortfall Hub ' + randomUUID(), address: 'Cairo' } })).id;
    await prisma.fulfillmentLocationOperator.create({ data: { locationId, operatorId: hub.id } });
  });
  afterAll(async () => { if (app) await app.close(); });

  it('a carton/MOQ the order cannot use is an explicit exception and the order falls back', async () => {
    const { supplier, order, po, lineId } = await procure(2, 60);
    const answer = (line: Record<string, unknown>) => http().post(`/purchase-orders/${po.id}/confirm`).set(supplier.auth).send({ lines: [{ id: lineId, ...line }] });
    await answer({ status: 'unavailable', exceptionCode: 'MIN_ORDER_QUANTITY', proposedQuantity: 1 }).expect(400);
    await answer({ status: 'confirmed_full', exceptionCode: 'PACK_SIZE', proposedQuantity: 6 }).expect(400);
    await answer({ status: 'unavailable', proposedQuantity: 6 }).expect(400); // proposal without a reason
    await answer({ status: 'unavailable', exceptionCode: 'PACK_SIZE', proposedQuantity: 6, exceptionNote: 'Sold in cartons of 6' }).expect(201);
    await settleEvents(po.id);

    expect(await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: lineId } }))
      .toMatchObject({ status: 'unavailable', confirmedQuantity: 0, exceptionCode: 'PACK_SIZE', proposedQuantity: 6, exceptionNote: 'Sold in cartons of 6' });
    const [first, fallback] = await allocations(order.id);
    expect(first).toMatchObject({ result: 'unavailable', confirmedQuantity: 0 });
    expect(fallback).toMatchObject({ result: 'pending', allocatedQuantity: 2 });
    expect(Number(fallback.selectedCost)).toBe(60);
    expect(await prisma.supportCase.count({ where: { title: { contains: 'PACK_SIZE' }, category: 'sourcing' } })).toBeGreaterThanOrEqual(1);
    expect(Number((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).totalAmount)).toBe(Number(order.totalAmount));
  });

  it('a late supplier price increase never changes the PO cost or the customer total', async () => {
    const { supplier, order, po, lineId } = await procure(1);
    const answer = (line: Record<string, unknown>) => http().post(`/purchase-orders/${po.id}/confirm`).set(supplier.auth).send({ lines: [{ id: lineId, ...line }] });
    await answer({ status: 'unavailable', exceptionCode: 'PRICE_CHANGED', proposedUnitCost: 75 }).expect(400);
    await answer({ status: 'price_changed', proposedUnitCost: 75.555 }).expect(400);
    await answer({ status: 'price_changed', proposedUnitCost: 75 }).expect(201);
    await settleEvents(po.id);
    const line = await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: lineId } });
    expect(line).toMatchObject({ exceptionCode: 'PRICE_CHANGED', confirmedQuantity: 0 });
    expect(Number(line.unitCost)).toBe(50);
    expect(Number(line.proposedUnitCost)).toBe(75);
    expect((await allocations(order.id))[0]).toMatchObject({ result: 'price_changed', confirmedQuantity: 0 });
    const plan = await http().get(`/sourcing/supply-plans/orders/${order.id}`).set(admin.auth).expect(200);
    expect(plan.body.status).toBe('UNAVAILABLE'); // customer decision, not a silent re-price
    expect(Number((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).totalAmount)).toBe(Number(order.totalAmount));
    const payable = await http().post(`/sourcing/purchase-orders/${po.id}/payable`).set(admin.auth).expect(201);
    expect(payable.body.amount).toBe('0');
  });

  it('8 ready → 7 handed over → 6 received: two attributed shortfalls, no phantom stock, paid for 6', async () => {
    const { sku, supplier, order, po, lineId, link } = await procure(8);
    await http().post(`/purchase-orders/${po.id}/confirm`).set(supplier.auth).send({ lines: [{ id: lineId, status: 'confirmed_full' }] }).expect(201);
    await settleEvents(po.id);
    await http().post(`/purchase-orders/${po.id}/ready`).set(supplier.auth).expect(201);
    await http().post('/fulfillment/receipts').set(hub.auth).send({
      locationId, allocationId: link.sourceAllocationId, orderId: order.id, orderItemId: link.orderItemId, skuId: sku.id,
      variantName: sku.variantName, barcodeScanned: sku.barcode, quantity: 6, condition: 'ACCEPTABLE', idempotencyKey: randomUUID(),
    }).expect(201);
    expect((await prisma.supplierPurchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe('ready');
    // Payable waits for the outstanding two units to be explained.
    expect((await http().post(`/sourcing/purchase-orders/${po.id}/payable`).set(admin.auth).expect(409)).body.code).toBe('GOODS_NOT_RECEIVED');

    const shortfall = (actor: Actor, body: Record<string, unknown>) => http().post(`/purchase-orders/${po.id}/shortfalls`).set(actor.auth)
      .send({ sourceAllocationId: link.sourceAllocationId, ...body });
    await shortfall(supplier, { quantity: 1, reasonCode: 'NOT_HANDED_OVER' }).expect(403);
    await shortfall(driver, { quantity: 1, reasonCode: 'NOT_HANDED_OVER' }).expect(403);
    await shortfall(hub, { quantity: 3, reasonCode: 'LOST_IN_TRANSIT' }).expect(400); // only 2 outstanding
    await shortfall(hub, { quantity: 1, reasonCode: 'EATEN_BY_CAT' }).expect(400);
    await shortfall(hub, { quantity: 1, reasonCode: 'NOT_HANDED_OVER', notes: 'Collector counted 7 at the supplier' }).expect(201);
    expect((await prisma.supplierPurchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe('ready');
    const second = await shortfall(hub, { quantity: 1, reasonCode: 'LOST_IN_TRANSIT', notes: 'Hub counted 6' }).expect(201);
    await settleEvents(second.body.id);

    const updatedLink = await prisma.purchaseOrderLineAllocation.findUniqueOrThrow({ where: { sourceAllocationId: link.sourceAllocationId }, include: { shortfalls: true } });
    expect(updatedLink).toMatchObject({ confirmedQuantity: 8, receivedQuantity: 6, shortQuantity: 2 });
    expect(updatedLink.shortfalls.map(s => [s.reasonCode, s.quantity, s.actorId]).sort()).toEqual([['LOST_IN_TRANSIT', 1, hub.id], ['NOT_HANDED_OVER', 1, hub.id]]);
    expect((await prisma.supplierPurchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe('received_at_hub');
    const [allocation] = await allocations(order.id);
    expect(allocation).toMatchObject({ result: 'confirmed_partial', confirmedQuantity: 6 });
    // Exactly 6 units exist at the Hub for the order; the missing 2 are re-planned, never phantom-received.
    expect((await prisma.fulfillmentReceipt.aggregate({ where: { orderId: order.id }, _sum: { quantity: true } }))._sum.quantity).toBe(6);
    const plan = await http().get(`/sourcing/supply-plans/orders/${order.id}`).set(admin.auth).expect(200);
    expect(plan.body.lines[0]).toMatchObject({ coveredQuantity: 6, unresolvedQuantity: 2 });
    await http().post('/fulfillment/receipts').set(hub.auth).send({
      locationId, allocationId: link.sourceAllocationId, orderId: order.id, orderItemId: link.orderItemId, skuId: sku.id,
      variantName: sku.variantName, barcodeScanned: sku.barcode, quantity: 1, condition: 'ACCEPTABLE', idempotencyKey: randomUUID(),
    }).expect(400);
    expect(await prisma.supportCase.count({ where: { orderId: order.id, title: { contains: 'Receiving shortfall' } } })).toBe(2);
    const receivables = await http().get(`/fulfillment/locations/${locationId}/receivables`).set(hub.auth).expect(200);
    expect(receivables.body.some((r: { allocationId: string }) => r.allocationId === link.sourceAllocationId)).toBe(false);

    const payable = await http().post(`/sourcing/purchase-orders/${po.id}/payable`).set(admin.auth).expect(201);
    expect(payable.body).toMatchObject({ amount: '300', currency: 'EGP' });
  });
});
