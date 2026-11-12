/* eslint-disable @typescript-eslint/no-explicit-any -- HTTP responses are checked structurally */
process.env.SOURCING_MODE = 'BROADCAST_ON_DEMAND';

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

describe('staff records offline broadcast procurement (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let events: DomainEventsService;
  let hub: Actor;
  let customer: Actor;
  let supplierActor: Actor;
  let secondSupplierActor: Actor;
  const suppliers: string[] = [];
  const api = () => request(app.getHttpServer());

  async function settle(id: string) {
    for (let i = 0; i < 50; i++) {
      await events.dispatchPending({ aggregateId: id });
      if (await db.domainEvent.count({ where: { aggregateId: id, status: { not: 'delivered' } } }) === 0) return;
    }
  }

  async function demand() {
    const sku = await createSellableSku(db);
    const order = await placeGuestOrder(app, [{ skuId: sku.id, quantity: 10 }]);
    await settle(order.id);
    const batch = await api().post('/rfq/batches').set(hub.auth).send({ reason: 'Fixture phone procurement' }).expect(201);
    const rfqId = batch.body.rfqId as string;
    expect(rfqId).toBeTruthy();
    const line = await db.rfqDemandLine.findUniqueOrThrow({ where: { rfqId_skuId: { rfqId, skuId: sku.id } } });
    return { rfqId, line, order };
  }

  function answer(rfqId: string, lineId: string, supplierId: string, availableQuantity: number, key = randomUUID(), confirmedAt = new Date().toISOString()) {
    return api().post(`/rfq/staff/${rfqId}/responses`).set(hub.auth).send({
      supplierId, confirmationSource: 'PHONE', confirmedAt, idempotencyKey: key,
      lines: [{ demandLineId: lineId, answer: 'PARTIAL', availableQuantity }],
    });
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useValue(new DeterministicAiClient()).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useLogger(['error']);
    await app.init();
    db = app.get(PrismaService);
    events = app.get(DomainEventsService);
    for (let i = 0; i < 3; i++) {
      const supplier = await db.supplier.create({ data: {
        name: `Offline fixture ${i} ${randomUUID()}`, slug: `offline-${randomUUID()}`,
        isActive: true, rfqEnrolledAt: new Date(), closedWeekdays: [], opensAt: '00:00', closesAt: '23:59', rfqScopeSkuIds: [],
      } });
      suppliers.push(supplier.id);
    }
    hub = await createActor(db, 'HUB_OPERATOR');
    customer = await createActor(db, 'CUSTOMER');
    supplierActor = await createActor(db, 'SUPPLIER', suppliers[0]);
    secondSupplierActor = await createActor(db, 'SUPPLIER', suppliers[1]);
  }, 120000);

  afterAll(async () => { await app?.close(); });

  it('allocates 6 + 4 + 0 immediately, keeps immutable phone evidence and one PO per positive award', async () => {
    const { rfqId, line } = await demand();
    const results = [];
    for (const [index, quantity] of [6, 8, 10].entries()) {
      const response = await answer(rfqId, line.id, suppliers[index], quantity).expect(201);
      results.push(response.body);
    }
    expect(results.map(r => r.lines[0].awardedQuantity)).toEqual([6, 4, 0]);
    expect(results.map(r => Boolean(r.purchaseOrderId))).toEqual([true, true, false]);
    const records = await db.rfqResponse.findMany({ where: { rfqId }, orderBy: { createdAt: 'asc' } });
    expect(records.map(r => r.createdBy)).toEqual(suppliers.map(() => hub.id));
    const audit = await db.rfqEvent.findMany({ where: { rfqId, type: 'offline_response_recorded' } });
    expect(audit).toHaveLength(3);
    expect(audit.every(e => e.actorId === hub.id && (e.payload as any).confirmationSource === 'PHONE')).toBe(true);
    const pos = await db.supplierPurchaseOrder.findMany({ where: { id: { in: results.map(r => r.purchaseOrderId).filter(Boolean) } } });
    expect(pos).toHaveLength(2);
  });

  it('caps concurrent confirmations, replays duplicate intent, and rejects unauthorized callers', async () => {
    const { rfqId, line } = await demand();
    const key = randomUUID();
    const confirmedAt = new Date().toISOString();
    const [a, b] = await Promise.all([answer(rfqId, line.id, suppliers[0], 10, key, confirmedAt), answer(rfqId, line.id, suppliers[1], 10)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.lines[0].awardedQuantity + b.body.lines[0].awardedQuantity).toBe(10);
    const replay = await answer(rfqId, line.id, suppliers[0], 10, key, confirmedAt).expect(201);
    expect(replay.body.replayed).toBe(true);
    expect((await api().post(`/rfq/staff/${rfqId}/responses`).send({})).status).toBe(401);
    expect((await api().post(`/rfq/staff/${rfqId}/responses`).set(customer.auth).send({})).status).toBe(403);
    expect((await api().post(`/rfq/staff/${rfqId}/responses`).set(supplierActor.auth).send({})).status).toBe(403);
  });

  it('records rejection, preserves the supplier API, and keeps rivals private', async () => {
    const { rfqId, line, order } = await demand();
    const reject = await api().post(`/rfq/staff/${rfqId}/responses`).set(hub.auth).send({
      supplierId: suppliers[0], confirmationSource: 'WHATSAPP', confirmedAt: new Date().toISOString(), idempotencyKey: randomUUID(),
      lines: [{ demandLineId: line.id, answer: 'REJECT' }],
    }).expect(201);
    expect(reject.body.lines[0]).toMatchObject({ answer: 'REJECT', awardedQuantity: 0 });
    expect(reject.body.purchaseOrderId).toBeNull();
    const snapshot = (await api().get(`/rfq/${rfqId}`).set(secondSupplierActor.auth).expect(200)).body;
    expect(JSON.stringify(snapshot)).not.toContain(order.id);
    expect(JSON.stringify(snapshot)).not.toContain(suppliers[0]);
    const ownLine = snapshot.lines.find((item: any) => item.demandLineId === line.id);
    const supplier = await api().post(`/rfq/${rfqId}/responses`).set(secondSupplierActor.auth).send({
      idempotencyKey: randomUUID(), lines: [{ demandLineId: line.id, answer: 'FULL',
        basedOnVersion: ownLine.version, seenQuantity: ownLine.requestedQuantity }],
    }).expect(201);
    expect(supplier.body.lines[0].awardedQuantity).toBe(10);
    expect((await db.rfqResponse.findUniqueOrThrow({ where: { id: supplier.body.responseId } })).confirmationSource).toBeNull();
  });

  it('reissues uncovered demand after a confirmed PO shortfall without changing the final PO', async () => {
    const { rfqId, line } = await demand();
    const award = await answer(rfqId, line.id, suppliers[0], 10).expect(201);
    const po = await db.supplierPurchaseOrder.findUniqueOrThrow({ where: { id: award.body.purchaseOrderId },
      include: { lines: { include: { allocations: true } } } });
    const link = po.lines[0].allocations[0];
    const shortfall = await api().post(`/purchase-orders/${po.id}/shortfalls`).set(hub.auth).send({
      sourceAllocationId: link.sourceAllocationId, quantity: 4, reasonCode: 'SHORT_SHIPPED',
    }).expect(201);
    await settle(shortfall.body.id);
    const replacement = await db.procurementRfq.findFirst({ where: { id: { not: rfqId },
      lines: { some: { skuId: line.skuId } } }, orderBy: { createdAt: 'desc' }, include: { lines: true } });
    expect(replacement?.lines[0].requiredQuantity).toBe(4);
    const final = await db.supplierPurchaseOrder.findUniqueOrThrow({ where: { id: po.id }, include: { lines: true } });
    expect(final.version).toBe(1);
    expect(final.lines[0].confirmedQuantity).toBe(10);
    expect(await db.receivingShortfall.count({ where: { linkId: link.id } })).toBe(1);

    // A shortfall larger than what is still confirmed is refused and creates nothing.
    const over = await api().post(`/purchase-orders/${po.id}/shortfalls`).set(hub.auth).send({
      sourceAllocationId: link.sourceAllocationId, quantity: 7, reasonCode: 'SHORT_SHIPPED',
    });
    expect(over.status).toBeGreaterThanOrEqual(400);
    expect(await db.receivingShortfall.count({ where: { linkId: link.id } })).toBe(1);

    // The recovery request is awarded exactly the released quantity once, never more.
    const recoveryLine = await db.rfqDemandLine.findUniqueOrThrow({ where: { rfqId_skuId: { rfqId: replacement!.id, skuId: line.skuId } } });
    const first = await answer(replacement!.id, recoveryLine.id, suppliers[1], 10).expect(201);
    const second = await answer(replacement!.id, recoveryLine.id, suppliers[2], 10).expect(201);
    expect([first.body.lines[0].awardedQuantity, second.body.lines[0].awardedQuantity]).toEqual([4, 0]);
    expect(await db.supplierPurchaseOrder.count({ where: { id: po.id } })).toBe(1);
    expect((await db.supplierPurchaseOrder.findUniqueOrThrow({ where: { id: first.body.purchaseOrderId } })).version).toBe(1);
    expect((await db.purchaseOrderLine.findFirstOrThrow({ where: { purchaseOrderId: po.id } })).confirmedQuantity).toBe(10);
  });
});
