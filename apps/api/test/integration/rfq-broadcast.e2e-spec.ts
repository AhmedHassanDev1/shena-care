/* eslint-disable @typescript-eslint/no-explicit-any -- HTTP response bodies are asserted structurally */
process.env.SOURCING_MODE = 'BROADCAST_ON_DEMAND';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import http from 'http';
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
import { PurchaseOrderService, RfqService, SupplyPlanService } from '../../src/modules/sourcing/public';
import { OrderCancellationService } from '../../src/application/composition/services/order-cancellation.service';

/**
 * GLO-283 BROADCAST_ON_DEMAND — real HTTP + PostgreSQL + SSE acceptance for non-binding RFQs, per-line atomic
 * allocation, real-time demand sync, stale-response protection, recovery and escalation.
 */
describe('BROADCAST_ON_DEMAND RFQ procurement (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: DomainEventsService;
  let rfqService: RfqService;
  let poService: PurchaseOrderService;
  let cancelService: OrderCancellationService;
  let admin: Actor;
  let hub: Actor;
  let customer: Actor;
  let port: number;
  const suppliers: Record<'A' | 'B' | 'C' | 'D', { id: string; actor: Actor }> = {} as never;
  let outsider: { id: string; actor: Actor };

  const api = () => request(app.getHttpServer());

  const settle = async (aggregateId: string) => {
    for (let i = 0; i < 100; i++) {
      await events.dispatchPending({ aggregateId });
      if (await prisma.domainEvent.count({ where: { aggregateId, status: { not: 'delivered' } } }) === 0) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  };

  /** A clean slate for demand: earlier tests' open RFQs and uncovered requirements must not leak into this one. */
  const freshState = async () => {
    await prisma.procurementRfq.updateMany({ where: { status: 'open' }, data: { status: 'closed', closedAt: new Date(), closeReason: 'TEST_RESET' } });
    await prisma.supplyRequirement.updateMany({ where: { releasedAt: null }, data: { releasedAt: new Date() } });
    // Only this suite's suppliers take part; suppliers enrolled by other runs in a shared local database must not.
    await prisma.supplier.updateMany({ where: { id: { notIn: [...Object.values(suppliers).map(x => x.id), outsider.id] } }, data: { rfqEnrolledAt: null } });
    for (const key of ['A', 'B', 'C'] as const) {
      await prisma.supplier.update({ where: { id: suppliers[key].id }, data: { rfqEnrolledAt: new Date(), isActive: true, closedWeekdays: [], opensAt: '00:00', closesAt: '23:59', rfqScopeSkuIds: [] } });
    }
    await prisma.supplier.update({ where: { id: suppliers.D.id }, data: { rfqEnrolledAt: null, closedWeekdays: [], opensAt: '00:00', closesAt: '23:59', rfqScopeSkuIds: [] } });
  };

  /** Sellable SKUs with NO SupplierOffer at all: the broadcast path must not need one. */
  const makeSkus = async (count: number) => {
    const skus = [];
    for (let i = 0; i < count; i++) {
      const sku = await createSellableSku(prisma);
      await prisma.supplierOffer.deleteMany({ where: { skuId: sku.id } });
      skus.push(sku);
    }
    return skus;
  };

  const place = async (lines: Array<{ skuId: string; quantity: number }>) => {
    const order = await placeGuestOrder(app, lines);
    await settle(order.id);
    return order;
  };

  const flush = async (reason = 'test checkpoint') => (await api().post('/rfq/batches').set(admin.auth).send({ reason }).expect(201)).body as
    { rfqId: string | null; batchRef: string | null; lines: number; recipients: number };

  const snapshot = async (actor: Actor, rfqId: string) => (await api().get(`/rfq/${rfqId}`).set(actor.auth).expect(200)).body;
  const lineOf = (snap: { lines: any[] }, skuId: string) => snap.lines.find(l => l.skuId === skuId);
  const full = (line: any) => ({ demandLineId: line.demandLineId, answer: 'FULL', basedOnVersion: line.version, seenQuantity: line.requestedQuantity });
  const partial = (line: any, quantity: number) => ({ demandLineId: line.demandLineId, answer: 'PARTIAL', quantity, basedOnVersion: line.version, seenQuantity: line.requestedQuantity });
  const unavailable = (line: any) => ({ demandLineId: line.demandLineId, answer: 'UNAVAILABLE', basedOnVersion: line.version });
  const respond = (actor: Actor, rfqId: string, lines: unknown[], key = randomUUID()) =>
    api().post(`/rfq/${rfqId}/responses`).set(actor.auth).send({ idempotencyKey: key, lines });

  /** Minimal SSE client over a real socket (the production stream, authenticated like the browser's fetch). */
  const openStream = (actor: Actor, after?: string) => {
    const received: Array<{ id?: string; event: string; data: any }> = [];
    let buffer = '';
    const req = http.get({ hostname: '127.0.0.1', port, path: `/rfq/stream${after ? `?after=${after}` : ''}`,
      headers: { Authorization: actor.auth.Authorization, Accept: 'text/event-stream' } }, res => {
      res.setEncoding('utf8');
      res.on('data', chunk => {
        buffer += chunk;
        let index;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const message: { id?: string; event: string; data: any } = { event: 'message', data: null };
          for (const line of block.split('\n')) {
            if (line.startsWith('id:')) message.id = line.slice(3).trim();
            else if (line.startsWith('event:')) message.event = line.slice(6).trim();
            else if (line.startsWith('data:')) message.data = JSON.parse(line.slice(5).trim());
          }
          received.push(message);
        }
      });
    });
    req.on('error', () => undefined);
    return {
      received,
      close: () => req.destroy(),
      waitFor: async (predicate: (m: { id?: string; event: string; data: any }) => boolean, ms = 5000) => {
        const started = Date.now();
        while (Date.now() - started < ms) {
          const hit = received.find(predicate);
          if (hit) return hit;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error(`SSE message not received within ${ms}ms; got ${JSON.stringify(received.map(r => r.event))}`);
      },
    };
  };

  const demandOf = async (skuId: string, rfqId: string) => {
    const line = await prisma.rfqDemandLine.findUniqueOrThrow({ where: { rfqId_skuId: { rfqId, skuId } }, include: { sources: true } });
    return { line, required: line.sources.reduce((s, x) => s + x.quantity, 0), awarded: line.sources.reduce((s, x) => s + x.awardedQuantity, 0) };
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useValue(new DeterministicAiClient()).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useLogger(['error']);
    await app.init();
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as { port: number }).port;

    prisma = app.get(PrismaService);
    events = app.get(DomainEventsService);
    rfqService = app.get(RfqService);
    poService = app.get(PurchaseOrderService);
    cancelService = app.get(OrderCancellationService);

    for (const key of ['A', 'B', 'C', 'D'] as const) {
      const supplier = await prisma.supplier.create({ data: { name: `RFQ ${key} ${randomUUID()}`, slug: `rfq-${key}-${randomUUID()}`,
        closedWeekdays: [], opensAt: '00:00', closesAt: '23:59', pickupLeadMinutes: 10 } });
      suppliers[key] = { id: supplier.id, actor: await createActor(prisma, 'SUPPLIER', supplier.id) };
    }
    const other = await prisma.supplier.create({ data: { name: `RFQ outsider ${randomUUID()}`, slug: `rfq-out-${randomUUID()}`, closedWeekdays: [] } });
    outsider = { id: other.id, actor: await createActor(prisma, 'SUPPLIER', other.id) };
    admin = await createActor(prisma, 'ADMIN');
    hub = await createActor(prisma, 'HUB_OPERATOR');
    customer = await createActor(prisma, 'CUSTOMER');
  }, 120000);

  afterAll(async () => { await app?.close(); });

  beforeEach(async () => { await freshState(); });

  it('A/B: a 20-SKU demand reaches three suppliers; A fulfils 9 lines, marks 11 unavailable; B sees only what is left; no offers or customer data needed', async () => {
    const skus = await makeSkus(20);
    const o1 = await place(skus.map(s => ({ skuId: s.id, quantity: 2 })));
    const o2 = await place(skus.slice(0, 10).map(s => ({ skuId: s.id, quantity: 3 })));
    expect(await prisma.supplierOffer.count({ where: { skuId: { in: skus.map(s => s.id) } } })).toBe(0);

    const issued = await flush();
    expect(issued).toMatchObject({ lines: 20, recipients: 3 });
    const rfqId = issued.rfqId!;

    // Aggregated by canonical SKU across customer orders: 5 for the first ten, 2 for the rest.
    for (const [i, sku] of skus.entries()) expect((await demandOf(sku.id, rfqId)).required).toBe(i < 10 ? 5 : 2);
    for (const key of ['A', 'B', 'C'] as const) {
      const list = (await api().get('/rfq/mine').set(suppliers[key].actor.auth).expect(200)).body;
      expect(list.find((r: any) => r.rfqId === rfqId)).toMatchObject({ lineCount: 20, actionableLineCount: 20, status: 'open' });
    }

    const a = await snapshot(suppliers.A.actor, rfqId);
    const leak = JSON.stringify(a);
    for (const secret of [o1.id, o2.id, o1.orderNumber, 'C2C Customer', '01012345678', 'Maadi', 'orderId', 'orderItemId', 'costPrice']) expect(leak).not.toContain(secret);

    const answered = await respond(suppliers.A.actor, rfqId, [
      ...skus.slice(0, 9).map(s => full(lineOf(a, s.id))),
      ...skus.slice(9).map(s => unavailable(lineOf(a, s.id))),
    ]);
    expect(answered.status).toBe(201);
    expect(answered.body.lines.filter((l: any) => l.awardedQuantity > 0)).toHaveLength(9);

    // Binding PO only now, with exact lineage and no invented cost.
    const po = await prisma.supplierPurchaseOrder.findUniqueOrThrow({ where: { id: answered.body.purchaseOrderId }, include: { lines: { include: { allocations: true } } } });
    expect(po).toMatchObject({ supplierId: suppliers.A.id, status: 'confirmed' });
    expect(po.lines).toHaveLength(9);
    expect(po.lines.every(l => l.unitCost === null && l.confirmedQuantity === l.requestedQuantity)).toBe(true);
    expect(po.lines.flatMap(l => l.allocations).reduce((s, l) => s + l.quantity, 0)).toBe(9 * 5 - 5 + 5); // 9 SKUs: 5 each for the first 9
    expect(po.lines.every(l => l.requestedQuantity === l.allocations.reduce((s, x) => s + x.quantity, 0))).toBe(true);

    // B immediately sees: 9 lines fulfilled elsewhere, 11 still actionable with unchanged quantities.
    const b = await snapshot(suppliers.B.actor, rfqId);
    expect(b.lines.filter((l: any) => l.state === 'fulfilled_elsewhere')).toHaveLength(9);
    expect(b.lines.filter((l: any) => l.state === 'actionable')).toHaveLength(11);
    expect(lineOf(b, skus[0].id)).toMatchObject({ requestedQuantity: 0, originalQuantity: 5 });
    expect(JSON.stringify(b)).not.toContain(suppliers.A.id);

    // Existing flow downstream: customer orders unchanged; Hub contracts see exact confirmed quantities.
    const links = await poService.listReceivableLinks();
    expect(links.filter(l => l.purchaseOrderId === po.id).reduce((s, l) => s + l.remainingQuantity, 0)).toBe(45);
    await settle(po.id);
    const firstLink = po.lines[0].allocations[0];
    expect(await app.get(SupplyPlanService).getReceivableAllocation(firstLink.sourceAllocationId)).toMatchObject({ confirmedQuantity: firstLink.quantity });
    expect(await prisma.orderItem.count({ where: { orderId: { in: [o1.id, o2.id] } } })).toBe(30);
    // A cost is not invented for a payable either.
    await api().post(`/sourcing/purchase-orders/${po.id}/payable`).set(admin.auth).expect(res => expect(res.status).toBeGreaterThanOrEqual(400));
  }, 180000);

  it('C/H: an open session receives the demand change immediately; a dropped session recovers missed events by cursor + snapshot', async () => {
    const [sku] = await makeSkus(1);
    await place([{ skuId: sku.id, quantity: 10 }]);
    const { rfqId } = await flush();
    const bBefore = await snapshot(suppliers.B.actor, rfqId!);
    const live = openStream(suppliers.B.actor);
    await live.waitFor(m => m.event === 'ready');

    const a = await snapshot(suppliers.A.actor, rfqId!);
    await respond(suppliers.A.actor, rfqId!, [partial(lineOf(a, sku.id), 6)]).expect(201);
    const pushed = await live.waitFor(m => m.event === 'demand_changed' && m.data.rfqId === rfqId);
    expect(pushed.data).toMatchObject({ previousQuantity: 10, remainingQuantity: 4, reason: 'DEMAND_AWARDED', skuId: sku.id });
    expect(pushed.data.version).toBeGreaterThan(lineOf(bBefore, sku.id).version);
    expect(JSON.stringify(pushed.data)).not.toContain(suppliers.A.id);
    // The recipient that was NOT involved gets no targeted notice about A's response.
    expect(live.received.some(m => m.event === 'allocation_accepted' || m.event === 'response_recorded')).toBe(false);
    live.close();

    // Disconnected B misses a second change; the cursor replays it and the snapshot reconciles.
    const cursor = pushed.id!;
    const c = await snapshot(suppliers.C.actor, rfqId!);
    await respond(suppliers.C.actor, rfqId!, [partial(lineOf(c, sku.id), 1)]).expect(201);
    const resumed = openStream(suppliers.B.actor, cursor);
    const missed = await resumed.waitFor(m => m.event === 'demand_changed' && m.data.remainingQuantity === 3);
    expect(missed.data.previousQuantity).toBe(4);
    resumed.close();
    const reconciled = lineOf(await snapshot(suppliers.B.actor, rfqId!), sku.id);
    expect(reconciled).toMatchObject({ requestedQuantity: 3, state: 'actionable' });
    expect(reconciled.version).toBe(lineOf(bBefore, sku.id).version + 2);

    // A supplier never receives another supplier's targeted events.
    const aStream = openStream(suppliers.A.actor, '0');
    await aStream.waitFor(m => m.event === 'allocation_accepted');
    expect(aStream.received.every(m => m.event !== 'allocation_accepted' || m.data.purchaseOrderId)).toBe(true);
    aStream.close();
    const cStream = openStream(suppliers.C.actor, '0');
    await cStream.waitFor(m => m.event === 'allocation_accepted');
    expect(cStream.received.filter(m => m.event === 'allocation_accepted')).toHaveLength(1);
    cStream.close();
  }, 120000);

  it('D/F/G: stale quantities are refused (never silently submitted); exact partial totals; full and zero availability', async () => {
    const [sku] = await makeSkus(1);
    const [o1, o2] = [await place([{ skuId: sku.id, quantity: 4 }]), await place([{ skuId: sku.id, quantity: 6 }])];
    const { rfqId } = await flush();
    const bSeen = lineOf(await snapshot(suppliers.B.actor, rfqId!), sku.id); // B is "editing" a response for 10
    expect(bSeen.requestedQuantity).toBe(10);

    const a = lineOf(await snapshot(suppliers.A.actor, rfqId!), sku.id);
    const first = await respond(suppliers.A.actor, rfqId!, [partial(a, 3)]).expect(201);
    expect(first.body.lines[0]).toMatchObject({ awardedQuantity: 3, remainingQuantity: 7 });

    // B submits what it saw (FULL of 10): refused, nothing awarded, fresh numbers in the error path.
    const stale = await respond(suppliers.B.actor, rfqId!, [full(bSeen)]);
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_DEMAND');
    expect(stale.body.staleLines[0]).toMatchObject({ demandLineId: bSeen.demandLineId, remainingQuantity: 7 });
    expect((await demandOf(sku.id, rfqId!)).awarded).toBe(3);
    // Even a stale PARTIAL that would fit is refused until reviewed.
    expect((await respond(suppliers.B.actor, rfqId!, [partial(bSeen, 2)])).status).toBe(409);

    // After review B can take the 7 remaining; C then sees the line as fulfilled elsewhere and cannot award more.
    const bFresh = lineOf(await snapshot(suppliers.B.actor, rfqId!), sku.id);
    expect(bFresh).toMatchObject({ requestedQuantity: 7, state: 'actionable' });
    const second = await respond(suppliers.B.actor, rfqId!, [full(bFresh)]).expect(201);
    expect(second.body.lines[0]).toMatchObject({ awardedQuantity: 7, remainingQuantity: 0 });
    const cView = lineOf(await snapshot(suppliers.C.actor, rfqId!), sku.id);
    expect(cView).toMatchObject({ requestedQuantity: 0, state: 'fulfilled_elsewhere' });
    expect((await respond(suppliers.C.actor, rfqId!, [full(cView)])).status).toBe(409);
    expect((await respond(suppliers.C.actor, rfqId!, [partial({ ...cView, requestedQuantity: 1 }, 1)])).status).toBe(409);

    // Exact quantities per customer order item, sum equals demand, nothing over-awarded.
    const allocations = await prisma.sourceAllocation.findMany({ where: { requirement: { supplyRequest: { orderId: { in: [o1.id, o2.id] } } } }, include: { requirement: { include: { supplyRequest: true } } } });
    const byOrder = (id: string) => allocations.filter(x => x.requirement.supplyRequest.orderId === id).reduce((s, x) => s + x.confirmedQuantity, 0);
    expect([byOrder(o1.id), byOrder(o2.id)]).toEqual([4, 6]);
    expect(allocations.every(x => x.supplierId !== null && x.supplierOfferId === null && x.selectedCost === null)).toBe(true);
    expect(await prisma.supplierPurchaseOrder.count({ where: { batchRef: (await prisma.procurementRfq.findUniqueOrThrow({ where: { id: rfqId! } })).batchRef } })).toBe(2);
    await rfqService.evaluateRfq(rfqId!);
    expect((await prisma.procurementRfq.findUniqueOrThrow({ where: { id: rfqId! } })).status).toBe('fulfilled');
    await settle(first.body.purchaseOrderId);
    await settle(second.body.purchaseOrderId);
    const plan = await app.get(SupplyPlanService).getPlan(o1.id);
    expect(plan.status).toBe('COVERED');
  }, 120000);

  it('E: simultaneous confirmations of the same SKUs never exceed demand (3 suppliers, many lines, whole-batch races)', async () => {
    const skus = await makeSkus(6);
    await place(skus.map(s => ({ skuId: s.id, quantity: 4 })));
    const { rfqId } = await flush();
    const snaps = await Promise.all((['A', 'B', 'C'] as const).map(k => snapshot(suppliers[k].actor, rfqId!)));
    const results = await Promise.all((['A', 'B', 'C'] as const).map((k, i) =>
      respond(suppliers[k].actor, rfqId!, skus.map(s => full(lineOf(snaps[i], s.id))))));
    expect(results.filter(r => r.status === 201)).toHaveLength(1);
    expect(results.filter(r => r.status === 409).every(r => r.body.code === 'STALE_DEMAND')).toBe(true);
    for (const sku of skus) expect((await demandOf(sku.id, rfqId!)).awarded).toBe(4);
    expect(await prisma.supplierPurchaseOrder.count({ where: { batchRef: (await prisma.procurementRfq.findUniqueOrThrow({ where: { id: rfqId! } })).batchRef } })).toBe(1);
  }, 120000);

  it('E/F: interleaved partial awards from competing suppliers converge to exactly the demand (property check)', async () => {
    const skus = await makeSkus(5);
    await place(skus.map(s => ({ skuId: s.id, quantity: 6 })));
    const { rfqId } = await flush();
    const awarded: Record<string, number> = {};
    const worker = async (key: 'A' | 'B' | 'C') => {
      for (let attempt = 0; attempt < 60; attempt++) {
        const snap = await snapshot(suppliers[key].actor, rfqId!);
        const open = snap.lines.filter((l: any) => l.state === 'actionable');
        if (!open.length) return;
        // Each supplier answers a line once, so slices of 2 until at most 3 remain, then take the rest.
        const answers = open.map((l: any) => l.requestedQuantity > 3 ? partial(l, 2) : full(l));
        const res = await respond(suppliers[key].actor, rfqId!, answers);
        if (res.status === 201) for (const l of res.body.lines) awarded[l.skuId] = (awarded[l.skuId] ?? 0) + l.awardedQuantity;
        else expect([409]).toContain(res.status);
      }
    };
    await Promise.all([worker('A'), worker('B'), worker('C')]);
    for (const sku of skus) {
      const demand = await demandOf(sku.id, rfqId!);
      expect(demand.awarded).toBe(6);
      expect(awarded[sku.id]).toBe(6);
      expect(demand.line.awardedQuantity).toBe(6);
      expect(demand.line.sources.every(s => s.awardedQuantity <= s.quantity)).toBe(true);
    }
    const allocated = await prisma.sourceAllocation.aggregate({ where: { evidenceRef: `RFQ:${rfqId}` }, _sum: { confirmedQuantity: true } });
    expect(allocated._sum.confirmedQuantity).toBe(30);
    expect(await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint n FROM sourcing.rfq_demand_lines WHERE awarded_quantity > required_quantity OR awarded_quantity < 0`).toEqual([{ n: BigInt(0) }]);
  }, 180000);

  it('I: duplicate confirmations replay, key reuse with other content conflicts, a second answer to an answered line is refused, restart keeps state', async () => {
    const [sku] = await makeSkus(1);
    await place([{ skuId: sku.id, quantity: 5 }]);
    const { rfqId } = await flush();
    const a = lineOf(await snapshot(suppliers.A.actor, rfqId!), sku.id);
    const key = randomUUID();
    const [one, two] = await Promise.all([respond(suppliers.A.actor, rfqId!, [partial(a, 2)], key), respond(suppliers.A.actor, rfqId!, [partial(a, 2)], key)]);
    expect([one.status, two.status]).toEqual([201, 201]);
    expect(one.body.purchaseOrderId).toBe(two.body.purchaseOrderId);
    const retry = await respond(suppliers.A.actor, rfqId!, [partial(a, 2)], key).expect(201);
    expect(retry.body).toMatchObject({ replayed: true, purchaseOrderId: one.body.purchaseOrderId });
    expect((await respond(suppliers.A.actor, rfqId!, [partial(a, 3)], key)).body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    const fresh = lineOf(await snapshot(suppliers.A.actor, rfqId!), sku.id);
    expect((await respond(suppliers.A.actor, rfqId!, [partial(fresh, 1)])).body.code).toBe('ALREADY_ANSWERED');
    expect(await prisma.supplierPurchaseOrder.count({ where: { supplierId: suppliers.A.id, batchRef: (await prisma.procurementRfq.findUniqueOrThrow({ where: { id: rfqId! } })).batchRef } })).toBe(1);
    expect((await demandOf(sku.id, rfqId!)).awarded).toBe(2);

    // Process restart: a brand new application instance sees identical authoritative state and the replay still holds.
    await settle(one.body.purchaseOrderId);
    await app.close();
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(AiClient).useValue(new DeterministicAiClient()).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useLogger(['error']);
    await app.init();
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as { port: number }).port;
    prisma = app.get(PrismaService); events = app.get(DomainEventsService); rfqService = app.get(RfqService);
    poService = app.get(PurchaseOrderService); cancelService = app.get(OrderCancellationService);
    const afterRestart = lineOf(await snapshot(suppliers.B.actor, rfqId!), sku.id);
    expect(afterRestart).toMatchObject({ requestedQuantity: 3, state: 'actionable' });
    expect((await respond(suppliers.A.actor, rfqId!, [partial(a, 2)], key).expect(201)).body.replayed).toBe(true);
  }, 180000);

  it('G/7: zero availability from every supplier escalates to Admin and the customer-decision path; recovery reaches a late supplier first', async () => {
    const [sku, sku2] = await makeSkus(2);
    const order = await place([{ skuId: sku.id, quantity: 3 }, { skuId: sku2.id, quantity: 1 }]);
    // D is enrolled but closed at issue time: it must not receive the first batch.
    await prisma.supplier.update({ where: { id: suppliers.D.id }, data: { rfqEnrolledAt: new Date(), closedWeekdays: [0, 1, 2, 3, 4, 5, 6] } });
    const issued = await flush();
    expect(issued.recipients).toBe(3);
    const rfqId = issued.rfqId!;

    await respond(suppliers.A.actor, rfqId, [unavailable(lineOf(await snapshot(suppliers.A.actor, rfqId), sku.id)), unavailable(lineOf(await snapshot(suppliers.A.actor, rfqId), sku2.id))]).expect(201);
    expect(await prisma.rfqRecipient.count({ where: { rfqId } })).toBe(3); // D is closed: no expedited recipient yet
    // Supplier D opens: the next evaluation extends the audience immediately (expedited), no 3-hour wait.
    await prisma.supplier.update({ where: { id: suppliers.D.id }, data: { closedWeekdays: [], opensAt: '00:00', closesAt: '23:59' } });
    expect(await rfqService.evaluateRfq(rfqId)).toBe('extended');
    const added = await prisma.rfqRecipient.findUniqueOrThrow({ where: { rfqId_supplierId: { rfqId, supplierId: suppliers.D.id } } });
    expect(added.addedReason).toBe('RECOVERY');
    expect((await prisma.procurementRfq.findUniqueOrThrow({ where: { id: rfqId } })).expedited).toBe(true);
    expect((await snapshot(suppliers.D.actor, rfqId)).lines.every((l: any) => l.state === 'actionable')).toBe(true);

    // B and C time out (no response); D says unavailable: nothing left to try -> Admin + customer decision.
    const late = new Date(Date.now() + 24 * 3600 * 1000);
    await prisma.rfqRecipient.updateMany({ where: { rfqId, supplierId: { in: [suppliers.B.id, suppliers.C.id] } }, data: { deadlineAt: new Date(Date.now() - 1000) } });
    await respond(suppliers.D.actor, rfqId, (await snapshot(suppliers.D.actor, rfqId)).lines.map(unavailable)).expect(201);
    expect(['escalated', 'noop']).toContain(await rfqService.evaluateRfq(rfqId, late));
    const rfq = await prisma.procurementRfq.findUniqueOrThrow({ where: { id: rfqId } });
    expect(rfq).toMatchObject({ status: 'exhausted', closeReason: 'NO_ELIGIBLE_SUPPLIER_LEFT' });
    await settle(rfqId);
    // B/C late answers are rejected: the window ended and the quantities were re-offered.
    const bLate = await respond(suppliers.B.actor, rfqId, [full({ demandLineId: (await prisma.rfqDemandLine.findFirstOrThrow({ where: { rfqId, skuId: sku.id } })).id, requestedQuantity: 3, version: 1 })]);
    expect(bLate.status).toBe(409);
    expect(await prisma.availabilityActionRequirement.count({ where: { requirement: { supplyRequest: { orderId: order.id } } } })).toBe(2);
    expect(await prisma.supportCase.count({ where: { title: { contains: 'Supply request unmet' } } })).toBeGreaterThanOrEqual(1);
    expect(await app.get(SupplyPlanService).getCustomerAvailability(order.id)).toMatchObject({ status: 'ACTION_REQUIRED' });
    expect(await prisma.supplierPurchaseOrder.count({ where: { batchRef: rfq.batchRef } })).toBe(0);
    // Escalated demand is not re-broadcast by the next checkpoint (waiting for a customer decision).
    expect((await flush()).rfqId).toBeNull();
  }, 120000);

  it('7: a timed-out recipient releases nothing it did not commit; partial commitment is kept and only the remainder is recovered', async () => {
    const [sku] = await makeSkus(1);
    await place([{ skuId: sku.id, quantity: 8 }]);
    await prisma.supplier.update({ where: { id: suppliers.D.id }, data: { rfqEnrolledAt: new Date(), closedWeekdays: [], opensAt: '00:00', closesAt: '23:59' } });
    const { rfqId } = await flush();
    expect((await prisma.rfqRecipient.count({ where: { rfqId: rfqId! } }))).toBe(4);
    await respond(suppliers.A.actor, rfqId!, [partial(lineOf(await snapshot(suppliers.A.actor, rfqId!), sku.id), 5)]).expect(201);
    await prisma.rfqRecipient.updateMany({ where: { rfqId: rfqId!, supplierId: { in: [suppliers.B.id, suppliers.C.id] } }, data: { deadlineAt: new Date(Date.now() - 60_000) } });
    await rfqService.evaluateRfq(rfqId!);
    const recipients = await prisma.rfqRecipient.findMany({ where: { rfqId: rfqId! } });
    expect(recipients.filter(r => r.status === 'timed_out').map(r => r.supplierId).sort()).toEqual([suppliers.B.id, suppliers.C.id].sort());
    expect(recipients.find(r => r.supplierId === suppliers.D.id)!.status).toBe('pending');
    // The 5 committed units stay; D still sees only the remaining 3 and finishes the job.
    const d = lineOf(await snapshot(suppliers.D.actor, rfqId!), sku.id);
    expect(d.requestedQuantity).toBe(3);
    await respond(suppliers.D.actor, rfqId!, [full(d)]).expect(201);
    await rfqService.evaluateRfq(rfqId!);
    expect((await prisma.procurementRfq.findUniqueOrThrow({ where: { id: rfqId! } })).status).toBe('fulfilled');
    expect((await demandOf(sku.id, rfqId!)).awarded).toBe(8);
    // Timed-out B cannot sneak a late confirmation in.
    expect((await respond(suppliers.B.actor, rfqId!, [full({ ...d, requestedQuantity: 3 })])).status).toBe(409);
  }, 120000);

  it('J: RBAC, tenant isolation, hidden customer data and an audit trail', async () => {
    const [sku] = await makeSkus(1);
    await place([{ skuId: sku.id, quantity: 2 }]);
    const { rfqId } = await flush();
    const line = lineOf(await snapshot(suppliers.A.actor, rfqId!), sku.id);
    // Not a recipient / wrong role / unauthenticated.
    await api().get(`/rfq/${rfqId}`).set(outsider.actor.auth).expect(403);
    await respond(outsider.actor, rfqId!, [full(line)]).expect(403);
    await api().get(`/rfq/${rfqId}`).set(customer.auth).expect(403);
    await api().get(`/rfq/${rfqId}`).set(hub.auth).expect(403);
    await respond(admin, rfqId!, [full(line)]).expect(403);
    await api().get(`/rfq/${rfqId}`).expect(401);
    await api().get('/rfq/staff').set(suppliers.A.actor.auth).expect(403);
    await api().post('/rfq/batches').set(suppliers.A.actor.auth).send({ reason: 'x y z' }).expect(403);
    await api().post('/rfq/batches').set(admin.auth).send({}).expect(400);
    await api().get('/rfq/stream').set(customer.auth).expect(403);
    // Supplier A answering another supplier's lines is impossible by construction (no per-supplier line ids); a foreign RFQ line id is rejected.
    const otherSku = (await makeSkus(1))[0];
    await place([{ skuId: otherSku.id, quantity: 1 }]);
    await prisma.supplier.update({ where: { id: suppliers.C.id }, data: { rfqScopeSkuIds: [sku.id] } }); // C is scoped to the first SKU only
    const second = await flush('second batch');
    await api().get(`/rfq/${second.rfqId}`).set(suppliers.C.actor.auth).expect(403); // out of C's product scope: never a recipient
    expect((await api().get('/rfq/mine').set(suppliers.C.actor.auth)).body.find((r: any) => r.rfqId === second.rfqId)).toBeUndefined();
    const foreignLine = await prisma.rfqDemandLine.findFirstOrThrow({ where: { rfqId: second.rfqId! } });
    expect((await respond(suppliers.C.actor, second.rfqId!, [{ demandLineId: foreignLine.id, answer: 'FULL', basedOnVersion: 1, seenQuantity: 1 }])).status).toBe(403);
    await prisma.supplier.update({ where: { id: suppliers.C.id }, data: { rfqScopeSkuIds: [] } });

    // Audit: staff see lineage and the append-only trail; suppliers do not.
    await respond(suppliers.A.actor, rfqId!, [full(line)]).expect(201);
    const detail = (await api().get(`/rfq/staff/${rfqId}`).set(admin.auth).expect(200)).body;
    expect(detail.lines[0].sources[0]).toMatchObject({ orderId: expect.any(String), orderItemId: expect.any(String) });
    const trail = detail.events.map((e: any) => `${e.type}:${e.actorId}`);
    expect(trail).toEqual(expect.arrayContaining([expect.stringMatching(/^rfq_issued:/), expect.stringContaining(`demand_changed:${suppliers.A.actor.id}`), expect.stringContaining(`allocation_accepted:${suppliers.A.actor.id}`)]));
    expect(detail.events.every((e: any) => e.actorId && e.createdAt)).toBe(true);
    expect(detail.responses[0].createdBy).toBe(suppliers.A.actor.id);
    expect((await api().get('/rfq/mode').set(admin.auth).expect(200)).body).toEqual({ mode: 'BROADCAST_ON_DEMAND' });
  }, 120000);

  it('4/5: cancelling a customer order shrinks open demand in real time and invalidates answers built on the old quantity', async () => {
    const [sku] = await makeSkus(1);
    const keep = await place([{ skuId: sku.id, quantity: 3 }]);
    const drop = await place([{ skuId: sku.id, quantity: 2 }]);
    const { rfqId } = await flush();
    const seen = lineOf(await snapshot(suppliers.B.actor, rfqId!), sku.id);
    expect(seen.requestedQuantity).toBe(5);
    const stream = openStream(suppliers.B.actor);
    await stream.waitFor(m => m.event === 'ready');
    await cancelService.cancel(drop.id, admin.id, { reasonCode: 'CUSTOMER_REQUEST', notes: 'cancel during RFQ' });
    const notice = await stream.waitFor(m => m.event === 'demand_changed' && m.data.reason === 'ORDER_CHANGED');
    expect(notice.data).toMatchObject({ remainingQuantity: 3, skuId: sku.id });
    stream.close();
    const stale = await respond(suppliers.B.actor, rfqId!, [full(seen)]);
    expect(stale.status).toBe(409);
    const fresh = lineOf(await snapshot(suppliers.B.actor, rfqId!), sku.id);
    expect(fresh.requestedQuantity).toBe(3);
    const ok = await respond(suppliers.B.actor, rfqId!, [full(fresh)]).expect(201);
    expect(ok.body.lines[0].awardedQuantity).toBe(3);
    await settle(ok.body.purchaseOrderId);
    expect(await prisma.sourceAllocation.count({ where: { requirement: { supplyRequest: { orderId: drop.id } }, supplierId: { not: null } } })).toBe(0);
    expect((await app.get(SupplyPlanService).getPlan(keep.id)).status).toBe('COVERED');
  }, 120000);

  it('K: an RFQ-awarded PO flows through supplier-ready, Hub barcode receiving and PO completion with exact quantities', async () => {
    const [sku] = await makeSkus(1);
    const order = await place([{ skuId: sku.id, quantity: 3 }]);
    const { rfqId } = await flush();
    const res = await respond(suppliers.A.actor, rfqId!, [full(lineOf(await snapshot(suppliers.A.actor, rfqId!), sku.id))]).expect(201);
    const poId = res.body.purchaseOrderId;
    await settle(poId);
    await api().post(`/purchase-orders/${poId}/ready`).set(suppliers.A.actor.auth).expect(201);
    const location = (await api().post('/fulfillment/locations').set(admin.auth)
      .send({ name: `RFQ Hub ${randomUUID()}`, address: '1 Hub Street', capabilities: ['RECEIVE_SUPPLIER_GOODS', 'PREPARE_ORDERS'] }).expect(201)).body.id;
    await api().post(`/fulfillment/locations/${location}/operators`).set(admin.auth).send({ operatorId: hub.id }).expect(201);
    const link = await prisma.purchaseOrderLineAllocation.findFirstOrThrow({ where: { orderId: order.id } });
    const receipt = (quantity: number, overrides: Record<string, unknown> = {}) => api().post('/fulfillment/receipts').set(hub.auth).send({
      locationId: location, allocationId: link.sourceAllocationId, orderId: order.id, orderItemId: link.orderItemId, skuId: sku.id,
      variantName: sku.variantName, barcodeScanned: sku.barcode!, quantity, condition: 'ACCEPTABLE', expiryDate: '2031-12-31',
      idempotencyKey: randomUUID(), ...overrides,
    });
    const wrong = await receipt(1, { barcodeScanned: 'WRONG-BARCODE' });
    expect([wrong.status, wrong.body.code]).toEqual([409, 'PRODUCT_IDENTITY_REVIEW_REQUIRED']); // barcode must identify the reviewed SKU
    expect((await receipt(4)).status).toBeGreaterThanOrEqual(400); // more than the 3 units the supplier committed
    const key = randomUUID();
    await receipt(2, { idempotencyKey: key }).expect(201);
    await receipt(2, { idempotencyKey: key }).expect(201); // duplicate scan replays
    expect((await prisma.purchaseOrderLineAllocation.findUniqueOrThrow({ where: { id: link.id } })).receivedQuantity).toBe(2);
    expect((await prisma.supplierPurchaseOrder.findUniqueOrThrow({ where: { id: poId } })).status).toBe('ready');
    await receipt(1).expect(201);
    expect((await prisma.supplierPurchaseOrder.findUniqueOrThrow({ where: { id: poId } })).status).toBe('received_at_hub');
    await receipt(1).expect(res2 => expect(res2.status).toBeGreaterThanOrEqual(400));
    expect((await prisma.purchaseOrderLineAllocation.findUniqueOrThrow({ where: { id: link.id } })).receivedQuantity).toBe(3);
    // Unknown cost stays unknown: no payable is invented from the requested quantity.
    expect((await api().post(`/sourcing/purchase-orders/${poId}/payable`).set(admin.auth)).status).toBeGreaterThanOrEqual(400);
  }, 120000);

  it('2/1: normal 3-hour checkpoint cutoff, modes, immutability of issued POs and no offer dependency', async () => {
    const [sku] = await makeSkus(1);
    // Scheduled run at 12:30 Cairo only takes demand placed before the 12:00 checkpoint.
    const order = await place([{ skuId: sku.id, quantity: 2 }]);
    // A Sunday 12:00 Cairo (UTC+2, winter time) at least two days ahead, so the recipients' real-time response window is
    // still open when the test answers. Rolls forward with the clock; skips the Apr-Oct daylight-saving months.
    const sunday = new Date(Date.UTC(2026, 10, 8, 10));
    while (sunday.getTime() < Date.now() + 2 * 86400000 || (sunday.getUTCMonth() >= 3 && sunday.getUTCMonth() <= 9)) sunday.setUTCDate(sunday.getUTCDate() + 7);
    const cairoNoon = (offsetMinutes: number) => new Date(sunday.getTime() + offsetMinutes * 60000);
    await prisma.supplyRequirement.updateMany({ where: { supplyRequest: { orderId: order.id } }, data: { createdAt: cairoNoon(-5) } });
    const early = await rfqService.flushRfqBatch('system:rfq-schedule', { now: cairoNoon(-10) });
    expect(early.rfqId).toBeNull(); // 11:50 — before the 12:00 checkpoint, the 09:00 cutoff precedes the order? (order after 09:00 cutoff)
    const due = await rfqService.flushRfqBatch('system:rfq-schedule', { now: cairoNoon(30) });
    expect(due).toMatchObject({ lines: 1, recipients: 3 });
    // Demand arriving after the checkpoint never alters the issued RFQ or its POs; it waits for the next checkpoint.
    const late = await place([{ skuId: sku.id, quantity: 4 }]);
    await prisma.supplyRequirement.updateMany({ where: { supplyRequest: { orderId: late.id } }, data: { createdAt: cairoNoon(20) } });
    expect((await rfqService.flushRfqBatch('system:rfq-schedule', { now: cairoNoon(40) })).rfqId).toBeNull();
    const a = lineOf(await snapshot(suppliers.A.actor, due.rfqId!), sku.id);
    expect(a.requestedQuantity).toBe(2);
    const po = (await respond(suppliers.A.actor, due.rfqId!, [full(a)]).expect(201)).body.purchaseOrderId;
    const before = await prisma.purchaseOrderLine.findMany({ where: { purchaseOrderId: po } });
    const next = await rfqService.flushRfqBatch('system:rfq-schedule', { now: cairoNoon(190) }); // 15:10 -> 15:00 checkpoint
    expect(next).toMatchObject({ lines: 1 });
    expect((await demandOf(sku.id, next.rfqId!)).required).toBe(4);
    expect(await prisma.purchaseOrderLine.findMany({ where: { purchaseOrderId: po } })).toEqual(before);

    // Inactive mode: the OFFER_BASED path stays intact and RFQ issuing is refused.
    process.env.SOURCING_MODE = 'OFFER_BASED';
    try {
      await api().post('/rfq/batches').set(admin.auth).send({ reason: 'mode check' }).expect(409);
    } finally { process.env.SOURCING_MODE = 'BROADCAST_ON_DEMAND'; }
  }, 120000);
});
