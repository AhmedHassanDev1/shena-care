/* eslint-disable @typescript-eslint/no-explicit-any -- HTTP response bodies are asserted structurally */
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
import { RfqService } from '../../src/modules/sourcing/public';

/**
 * MVP procurement closure: frozen supplier files, Admin enrollment and Hub actual acquisition cost, over real HTTP and PostgreSQL.
 * The RFQ allocation, stale-answer and SSE invariants are covered by rfq-broadcast.e2e-spec.ts.
 */
describe('Procurement closure: enrollment and acquisition cost (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: DomainEventsService;
  let rfqService: RfqService;
  let admin: Actor;
  let hub: Actor;
  let customer: Actor;
  let locationId: string;
  const suppliers: Record<'A' | 'B', { id: string; actor: Actor }> = {} as never;

  const api = () => request(app.getHttpServer());

  const settle = async (aggregateId: string) => {
    for (let i = 0; i < 100; i++) {
      await events.dispatchPending({ aggregateId });
      if (await prisma.domainEvent.count({ where: { aggregateId, status: { not: 'delivered' } } }) === 0) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  };

  const freshState = async () => {
    await prisma.procurementRfq.updateMany({ where: { status: 'open' }, data: { status: 'closed', closedAt: new Date(), closeReason: 'TEST_RESET' } });
    await prisma.supplyRequirement.updateMany({ where: { releasedAt: null }, data: { releasedAt: new Date() } });
    const ids = Object.values(suppliers).map(x => x.id);
    await prisma.supplier.updateMany({ where: { id: { notIn: ids } }, data: { rfqEnrolledAt: null } });
    await prisma.supplier.updateMany({ where: { id: { in: ids } }, data: { rfqEnrolledAt: new Date(), isActive: true, closedWeekdays: [], closedDates: [], opensAt: '00:00', closesAt: '23:59', rfqScopeSkuIds: [] } });
  };

  const makeSku = async () => {
    const sku = await createSellableSku(prisma);
    await prisma.supplierOffer.deleteMany({ where: { skuId: sku.id } });
    return sku;
  };

  const place = async (lines: Array<{ skuId: string; quantity: number }>) => {
    const order = await placeGuestOrder(app, lines);
    await settle(order.id);
    return order;
  };

  const flush = async () => (await api().post('/rfq/batches').set(admin.auth).send({ reason: 'closure test' }).expect(201)).body as { rfqId: string | null; recipients: number };
  const snapshot = async (actor: Actor, rfqId: string) => (await api().get(`/rfq/${rfqId}`).set(actor.auth).expect(200)).body;
  const lineOf = (snap: { lines: any[] }, skuId: string) => snap.lines.find(l => l.skuId === skuId);

  /** A binding PO for the whole demand of one order line, supplier-ready, with goods still to receive. */
  const awardedPo = async (quantity: number) => {
    const sku = await makeSku();
    const order = await place([{ skuId: sku.id, quantity }]);
    const { rfqId } = await flush();
    const line = lineOf(await snapshot(suppliers.A.actor, rfqId!), sku.id);
    const res = await api().post(`/rfq/${rfqId}/responses`).set(suppliers.A.actor.auth)
      .send({ idempotencyKey: randomUUID(), lines: [{ demandLineId: line.demandLineId, answer: 'FULL', basedOnVersion: line.version, seenQuantity: line.requestedQuantity }] }).expect(201);
    const purchaseOrderId = res.body.purchaseOrderId as string;
    await settle(purchaseOrderId);
    await api().post(`/purchase-orders/${purchaseOrderId}/ready`).set(suppliers.A.actor.auth).expect(201);
    const link = await prisma.purchaseOrderLineAllocation.findFirstOrThrow({ where: { orderId: order.id } });
    const poLine = await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: link.purchaseOrderLineId } });
    const receive = (qty: number) => api().post('/fulfillment/receipts').set(hub.auth).send({
      locationId, allocationId: link.sourceAllocationId, orderId: order.id, orderItemId: link.orderItemId, skuId: sku.id, variantName: sku.variantName,
      barcodeScanned: sku.barcode!, quantity: qty, condition: 'ACCEPTABLE', expiryDate: '2031-12-31', idempotencyKey: randomUUID(),
    });
    return { sku, order, purchaseOrderId, poLine, link, receive };
  };

  const captureCost = (poId: string, lineId: string, body: Record<string, unknown>, actor: Actor = hub) =>
    api().post(`/procurement/acquisition-costs/purchase-orders/${poId}/lines/${lineId}`).set(actor.auth).send({ idempotencyKey: randomUUID(), ...body });
  const createPayable = (poId: string) => api().post(`/sourcing/purchase-orders/${poId}/payable`).set(admin.auth);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useClass(DeterministicAiClient).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    events = app.get(DomainEventsService);
    rfqService = app.get(RfqService);
    admin = await createActor(prisma, 'ADMIN');
    hub = await createActor(prisma, 'HUB_OPERATOR');
    customer = await createActor(prisma, 'CUSTOMER');
    for (const key of ['A', 'B'] as const) {
      const supplier = await prisma.supplier.create({ data: { name: `Closure ${key} ${randomUUID()}`, slug: `closure-${key.toLowerCase()}-${randomUUID()}`, rfqEnrolledAt: new Date() } });
      suppliers[key] = { id: supplier.id, actor: await createActor(prisma, 'SUPPLIER', supplier.id) };
    }
    locationId = (await api().post('/fulfillment/locations').set(admin.auth)
      .send({ name: `Closure Hub ${randomUUID()}`, address: '1 Hub Street', capabilities: ['RECEIVE_SUPPLIER_GOODS', 'PREPARE_ORDERS'] }).expect(201)).body.id;
    await api().post(`/fulfillment/locations/${locationId}/operators`).set(admin.auth).send({ operatorId: hub.id }).expect(201);
  }, 120000);

  beforeEach(freshState);

  afterAll(async () => {
    await app.close();
  });

  it('freeze: supplier file ingestion no longer exists (module removed), so no supplier file can feed stock or offers', async () => {
    // The backend ingestion module was removed (0244296); the former SUPPLIER_INGESTION_FROZEN guard is now absence of the routes.
    const upload = await api().post('/ingestion/jobs/upload').set(admin.auth).attach('file', Buffer.from('a,b\n1,2\n'), 'stock.csv').field('supplierId', suppliers.A.id);
    expect(upload.status).toBe(404);
    const supplierUpload = await api().post('/ingestion/jobs/upload').set(suppliers.A.actor.auth).attach('file', Buffer.from('a,b\n1,2\n'), 'stock.csv');
    expect(supplierUpload.status).toBe(404);
    expect((await api().post(`/ingestion/jobs/${randomUUID()}/commit-offers`).set(admin.auth).send({})).status).toBe(404);
    expect((await api().get('/rfq/mode').set(suppliers.A.actor.auth).expect(200)).body.mode).toBe('BROADCAST_ON_DEMAND');
  });

  it('scheduler: a due checkpoint issues the RFQ with no staff action and no SupplierOffer', async () => {
    const sku = await makeSku();
    const order = await place([{ skuId: sku.id, quantity: 2 }]);
    const checkpoint = Date.parse('2026-11-08T10:00:00Z'); // Sunday 12:00 Cairo
    await prisma.supplyRequirement.updateMany({ where: { supplyRequest: { orderId: order.id } }, data: { createdAt: new Date(checkpoint - 300000) } });
    const outcome = await rfqService.flushRfqBatch('system:rfq-schedule', { now: new Date(checkpoint + 1800000) });
    expect(outcome).toMatchObject({ lines: 1, recipients: 2 });
    expect(await prisma.supplierOffer.count({ where: { skuId: sku.id } })).toBe(0);
  });

  it('enrollment: Admin-only, readiness is truthful, product scope controls distribution, every change is audited and the audit cannot be rewritten', async () => {
    const body = { name: `Enrolled ${randomUUID()}`, slug: `enrolled-${randomUUID()}`, reason: 'New pharmacy distributor', closedWeekdays: [5], opensAt: '10:00', closesAt: '20:00' };
    await api().get('/procurement/enrollment').expect(401);
    for (const actor of [hub, customer, suppliers.A.actor]) {
      await api().get('/procurement/enrollment').set(actor.auth).expect(403);
      await api().post('/procurement/enrollment').set(actor.auth).send(body).expect(403);
    }
    await api().post('/procurement/enrollment').set(admin.auth).send({ ...body, reason: 'x' }).expect(400);
    const created = (await api().post('/procurement/enrollment').set(admin.auth).send(body).expect(201)).body;

    const readinessOf = async (id: string) => (await api().get('/procurement/enrollment').set(admin.auth).expect(200)).body.find((row: any) => row.id === id);
    expect((await readinessOf(created.id)).readiness).toEqual({ ready: false, blockers: ['NOT_ENROLLED', 'NO_SUPPLIER_ACCOUNT'] });

    await api().patch(`/procurement/enrollment/${created.id}`).set(admin.auth).send({ rfqEnrolled: true, scopeSkuCodes: ['NOPE-CODE'], reason: 'Approve with scope' }).expect(400);
    const inScope = await makeSku();
    const outOfScope = await makeSku();
    await api().patch(`/procurement/enrollment/${created.id}`).set(admin.auth)
      .send({ rfqEnrolled: true, scopeSkuCodes: [inScope.code], closedDates: ['2026-12-25'], opensAt: '00:00', closesAt: '23:59', closedWeekdays: [], reason: 'Approve with scope' }).expect(200);
    const account = await createActor(prisma, 'SUPPLIER', created.id);
    const ready = await readinessOf(created.id);
    expect(ready.readiness).toEqual({ ready: true, blockers: [] });
    expect(ready.scope.map((row: any) => row.skuId)).toEqual([inScope.id]);

    await place([{ skuId: inScope.id, quantity: 1 }, { skuId: outOfScope.id, quantity: 1 }]);
    const { rfqId } = await flush();
    const seen = (await snapshot(account, rfqId!)).lines.map((line: any) => line.skuId);
    expect(seen).toEqual([inScope.id]);
    await api().get(`/rfq/${rfqId}`).set(suppliers.A.actor.auth).expect(200);

    // Hub keeps calendars but cannot change who participates.
    await api().patch(`/sourcing/suppliers/${created.id}`).set(hub.auth).send({ rfqEnrolled: false }).expect(403);
    await api().patch(`/sourcing/suppliers/${created.id}`).set(hub.auth).send({ isActive: false }).expect(403);
    await api().patch(`/sourcing/suppliers/${created.id}`).set(hub.auth).send({ pickupLeadMinutes: 90 }).expect(200);

    const audit = (await api().get(`/procurement/enrollment/${created.id}/audit`).set(admin.auth).expect(200)).body;
    const actions = audit.map((row: any) => row.action);
    expect(actions).toEqual(expect.arrayContaining(['REGISTERED', 'ENROLLED', 'SCOPE_CHANGED', 'CALENDAR_CHANGED']));
    expect(audit.find((row: any) => row.action === 'ENROLLED')).toMatchObject({ actorId: admin.id, reason: 'Approve with scope' });
    expect(audit.find((row: any) => row.action === 'CALENDAR_CHANGED' && row.actorId === hub.id)).toBeTruthy();
    await expect(prisma.supplierEnrollmentEvent.deleteMany({ where: { supplierId: created.id } })).rejects.toThrow(/append-only/);
    await expect(prisma.supplierEnrollmentEvent.updateMany({ where: { supplierId: created.id }, data: { reason: 'rewritten' } })).rejects.toThrow(/append-only/);
  }, 120000);

  it('withdrawal: awarded POs stay binding, pending requests time out, the other supplier still sees the demand, and re-enrolment affects only future requests', async () => {
    const sku = await makeSku();
    await place([{ skuId: sku.id, quantity: 10 }]);
    const { rfqId } = await flush();
    const a = lineOf(await snapshot(suppliers.A.actor, rfqId!), sku.id);
    const res = await api().post(`/rfq/${rfqId}/responses`).set(suppliers.A.actor.auth)
      .send({ idempotencyKey: randomUUID(), lines: [{ demandLineId: a.demandLineId, answer: 'PARTIAL', quantity: 6, basedOnVersion: a.version, seenQuantity: 10 }] }).expect(201);
    const poBefore = await prisma.supplierPurchaseOrder.findUniqueOrThrow({ where: { id: res.body.purchaseOrderId }, include: { lines: true } });

    const b = lineOf(await snapshot(suppliers.B.actor, rfqId!), sku.id);
    expect(b.requestedQuantity).toBe(4);
    await api().patch(`/procurement/enrollment/${suppliers.B.id}`).set(admin.auth).send({ rfqEnrolled: false, reason: 'Stopped participating' }).expect(200);
    const refused = await api().post(`/rfq/${rfqId}/responses`).set(suppliers.B.actor.auth)
      .send({ idempotencyKey: randomUUID(), lines: [{ demandLineId: b.demandLineId, answer: 'FULL', basedOnVersion: b.version, seenQuantity: 4 }] });
    expect(refused.status).toBeGreaterThanOrEqual(403);
    expect((await prisma.rfqRecipient.findUniqueOrThrow({ where: { rfqId_supplierId: { rfqId: rfqId!, supplierId: suppliers.B.id } } })).status).toBe('timed_out');

    await api().patch(`/procurement/enrollment/${suppliers.A.id}`).set(admin.auth).send({ isActive: false, reason: 'Temporarily closed' }).expect(200);
    expect(await prisma.supplierPurchaseOrder.findUniqueOrThrow({ where: { id: res.body.purchaseOrderId }, include: { lines: true } })).toEqual(poBefore);
    expect((await prisma.supplierEnrollmentEvent.findFirstOrThrow({ where: { supplierId: suppliers.A.id, action: 'DEACTIVATED' } })).reason).toBe('Temporarily closed');
  }, 120000);

  it('cost: receipt can precede cost, payable stays blocked until every received unit has invoice evidence, lots may differ, and nothing is invented', async () => {
    const { purchaseOrderId, poLine, receive, sku, order } = await awardedPo(5);
    const itemBefore = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });

    const notYet = await captureCost(purchaseOrderId, poLine.id, { quantity: 1, unitCost: 100, invoiceRef: 'INV-1' });
    expect([notYet.status, notYet.body.code]).toEqual([409, 'GOODS_NOT_RECEIVED']);

    await receive(3).expect(201);
    const list = (await api().get('/procurement/acquisition-costs').query({ purchaseOrderId, status: 'COST_PENDING' }).set(hub.auth).expect(200)).body;
    expect(list.items[0]).toMatchObject({ lineId: poLine.id, receivedQuantity: 3, costedQuantity: 0, pendingQuantity: 3, status: 'COST_PENDING', supplierId: suppliers.A.id });

    const barcode = await captureCost(purchaseOrderId, poLine.id, { quantity: 1, unitCost: 100, invoiceRef: 'INV-1', barcodeScanned: 'WRONG-CODE' });
    expect([barcode.status, barcode.body.code]).toEqual([409, 'BARCODE_MISMATCH']);
    const supplierCheck = await captureCost(purchaseOrderId, poLine.id, { quantity: 1, unitCost: 100, invoiceRef: 'INV-1', expectedSupplierId: suppliers.B.id });
    expect([supplierCheck.status, supplierCheck.body.code]).toEqual([409, 'SUPPLIER_MISMATCH']);
    await captureCost(purchaseOrderId, poLine.id, { quantity: 1, unitCost: -5, invoiceRef: 'INV-1' }).expect(400);
    await captureCost(purchaseOrderId, poLine.id, { quantity: 1, unitCost: 10.123, invoiceRef: 'INV-1' }).expect(400);
    await captureCost(purchaseOrderId, poLine.id, { quantity: 1, unitCost: 10, invoiceRef: 'INV-1', currency: 'USD' }).expect(400);

    const key = randomUUID();
    const first = await captureCost(purchaseOrderId, poLine.id, { idempotencyKey: key, quantity: 2, unitCost: 100.5, invoiceRef: ' inv-1 ', barcodeScanned: sku.barcode, expectedSupplierId: suppliers.A.id }).expect(201);
    expect(first.body.lot).toMatchObject({ invoiceRef: 'INV-1', quantity: 2 });
    expect(first.body.line).toMatchObject({ status: 'COST_PENDING', costedQuantity: 2, pendingQuantity: 1 });
    const replay = await captureCost(purchaseOrderId, poLine.id, { idempotencyKey: key, quantity: 2, unitCost: 100.5, invoiceRef: 'INV-1' }).expect(201);
    expect(replay.body).toMatchObject({ replayed: true, lot: { id: first.body.lot.id } });
    const reused = await captureCost(purchaseOrderId, poLine.id, { idempotencyKey: key, quantity: 1, unitCost: 100.5, invoiceRef: 'INV-1' });
    expect([reused.status, reused.body.code]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
    const duplicate = await captureCost(purchaseOrderId, poLine.id, { quantity: 1, unitCost: 100.5, invoiceRef: 'inv-1' });
    expect([duplicate.status, duplicate.body.code]).toEqual([409, 'DUPLICATE_INVOICE_LINE']);
    const over = await captureCost(purchaseOrderId, poLine.id, { quantity: 2, unitCost: 90, invoiceRef: 'INV-2' });
    expect([over.status, over.body.code]).toEqual([409, 'COST_QUANTITY_EXCEEDS_RECEIVED']);

    // Partial receiving: goods outstanding block the payable, then pending cost blocks it, and the error says which.
    expect((await createPayable(purchaseOrderId)).body.code).toBe('GOODS_NOT_RECEIVED');
    await receive(2).expect(201);
    expect((await prisma.supplierPurchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrderId } })).status).toBe('received_at_hub');
    const pending = await createPayable(purchaseOrderId);
    expect([pending.status, pending.body.code]).toEqual([409, 'COST_PENDING']);
    expect(await prisma.supplierPayable.count({ where: { purchaseOrderId } })).toBe(0);

    const second = await captureCost(purchaseOrderId, poLine.id, { quantity: 3, unitCost: 90, invoiceRef: 'INV-2' }).expect(201);
    expect(second.body.line).toMatchObject({ status: 'COST_CAPTURED', costedQuantity: 5, pendingQuantity: 0, capturedValue: '471.00' });
    const payable = (await createPayable(purchaseOrderId).expect(201)).body;
    expect(Number(payable.amount)).toBe(471);
    expect(payable.basis[0]).toMatchObject({ costSource: 'hub_invoice', quantity: 5, lineAmount: '471.00', unitCost: '94.20' });
    expect(payable.basis[0].costLots.map((lot: any) => lot.invoiceRef)).toEqual(['INV-1', 'INV-2']);

    // Customer's price is only ever read.
    expect(await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } })).toEqual(itemBefore);
    // Binding PO line snapshot untouched: no silent modification.
    expect((await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: poLine.id } })).unitCost).toBeNull();
  }, 120000);

  it('cost: concurrent captures can never cover more than was received, and concurrent corrections let exactly one win', async () => {
    const { purchaseOrderId, poLine, receive } = await awardedPo(4);
    await receive(4).expect(201);
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => captureCost(purchaseOrderId, poLine.id, { quantity: 2, unitCost: 50 + i, invoiceRef: `RACE-${i}` })));
    expect(results.filter(r => r.status === 201)).toHaveLength(2);
    expect(results.filter(r => r.status === 409 && r.body.code === 'COST_QUANTITY_EXCEEDS_RECEIVED')).toHaveLength(4);
    const lots = await prisma.acquisitionCostLot.findMany({ where: { purchaseOrderLineId: poLine.id } });
    expect(lots.reduce((sum, lot) => sum + lot.quantity, 0)).toBe(4);

    const sameInvoice = await awardedPo(4);
    await sameInvoice.receive(4).expect(201);
    const raced = await Promise.all([1, 2, 3].map(() => captureCost(sameInvoice.purchaseOrderId, sameInvoice.poLine.id, { quantity: 1, unitCost: 70, invoiceRef: 'SAME-INV' })));
    expect(raced.filter(r => r.status === 201)).toHaveLength(1);
    expect(raced.filter(r => r.body.code === 'DUPLICATE_INVOICE_LINE')).toHaveLength(2);

    const lot = lots[0];
    const corrections = await Promise.all([60, 61, 62].map(unitCost => api().post(`/procurement/acquisition-costs/lots/${lot.id}/corrections`).set(admin.auth)
      .send({ expectedVersion: 1, unitCost, reason: 'Supplier reissued invoice' })));
    expect(corrections.filter(r => r.status === 200)).toHaveLength(1);
    expect(corrections.filter(r => r.body.code === 'COST_LOT_STALE')).toHaveLength(2);
  }, 120000);

  it('reconciliation: corrections are Admin-only, keep immutable history, move an open payable by the exact difference, keep credits apart, and stop at payment', async () => {
    const { purchaseOrderId, poLine, receive, order, sku } = await awardedPo(2);
    await receive(2).expect(201);
    const lot = (await captureCost(purchaseOrderId, poLine.id, { quantity: 2, unitCost: 100, invoiceRef: 'REC-1' }).expect(201)).body.lot;
    const payable = (await createPayable(purchaseOrderId).expect(201)).body;
    expect(Number(payable.amount)).toBe(200);

    const correct = (body: Record<string, unknown>, actor = admin) => api().post(`/procurement/acquisition-costs/lots/${lot.id}/corrections`).set(actor.auth).send(body);
    await correct({ expectedVersion: 1, unitCost: 80, reason: 'Hub cannot correct' }, hub).expect(403);
    await correct({ expectedVersion: 1, unitCost: 80, reason: 'x' }).expect(400);
    await correct({ expectedVersion: 9, unitCost: 80, reason: 'Stale version test' }).expect(409);
    await correct({ expectedVersion: 1, quantity: 3, reason: 'More than received' }).expect(409);

    const lowered = (await correct({ expectedVersion: 1, unitCost: 80, reason: 'Supplier reissued invoice at 80' }).expect(200)).body;
    expect(lowered).toMatchObject({ payableDelta: '-40.00', lot: { version: 2 } });
    const history = (await api().get(`/procurement/acquisition-costs/lots/${lot.id}/history`).set(hub.auth).expect(200)).body;
    expect(history.events.map((event: any) => event.action)).toEqual(['CAPTURED', 'CORRECTED']);
    expect(history.events[1]).toMatchObject({ actorId: admin.id, reason: 'Supplier reissued invoice at 80', previous: { unitCost: '100.00' }, current: { unitCost: '80.00', version: 2 } });
    await expect(prisma.acquisitionCostEvent.deleteMany({ where: { lotId: lot.id } })).rejects.toThrow(/append-only/);

    // A supplier credit is cash-side only; gross goods cost stays in the basis and COGS does not change.
    const credit = await api().post(`/sourcing/payables/${payable.id}/apply-credit`).set(admin.auth).send({ creditAmount: 30, supplierReturnRef: 'RET-77' }).expect(201);
    expect(credit.body).toMatchObject({ creditApplied: 30, netAmount: 130 });
    const row = (await api().get('/sourcing/payables').set(admin.auth).expect(200)).body.items.find((p: any) => p.id === payable.id);
    expect(row).toMatchObject({ grossAmount: 160, creditApplied: 30, netAmount: 130 });
    const contribution = (await api().get(`/procurement/acquisition-costs/orders/${order.id}/contribution`).set(admin.auth).expect(200)).body;
    expect(contribution).toMatchObject({ complete: true, actualCogs: '160.00' });

    // An evidence gap reopened by a correction blocks closure.
    await correct({ expectedVersion: 2, quantity: 1, reason: 'One unit moved to another invoice' }).expect(200);
    const blocked = await api().patch(`/sourcing/payables/${payable.id}/mark-paid`).set(admin.auth).send({ paymentRef: 'PAY-1' });
    expect([blocked.status, blocked.body.code]).toEqual([409, 'COST_PENDING']);
    await captureCost(purchaseOrderId, poLine.id, { quantity: 1, unitCost: 80, invoiceRef: 'REC-2', barcodeScanned: sku.barcode }).expect(201);
    await api().patch(`/sourcing/payables/${payable.id}/mark-paid`).set(admin.auth).send({ paymentRef: 'PAY-1' }).expect(200);

    const afterPaid = await correct({ expectedVersion: 3, unitCost: 70, reason: 'Too late to change' });
    expect([afterPaid.status, afterPaid.body.code]).toEqual([409, 'PAYABLE_CLOSED']);
  }, 120000);

  it('margin: actual contribution is computed from invoice cost, a loss raises an immediate case, and pending cost is reported as unknown', async () => {
    const { purchaseOrderId, poLine, receive, order } = await awardedPo(2);
    await receive(2).expect(201);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    const unitPrice = item.lineTotal ? item.lineTotal.div(item.quantity) : item.price;

    const unknown = (await api().get(`/procurement/acquisition-costs/orders/${order.id}/contribution`).set(admin.auth).expect(200)).body;
    expect(unknown).toMatchObject({ complete: false, actualCogs: null, contribution: null });
    expect(unknown.items[0].costStatus).toBe('COST_PENDING');

    const lossCost = unitPrice.plus(25).toDecimalPlaces(2).toNumber();
    const captured = (await captureCost(purchaseOrderId, poLine.id, { quantity: 2, unitCost: lossCost, invoiceRef: 'LOSS-1' }).expect(201)).body;
    expect(captured.marginWarnings).toHaveLength(1);
    expect(captured.marginWarnings[0]).toMatchObject({ orderId: order.id, orderItemId: item.id, unitCost: lossCost.toFixed(2) });
    expect(Number(captured.marginWarnings[0].unitContribution)).toBeLessThan(0);
    const supportCase = await prisma.supportCase.findUniqueOrThrow({ where: { id: captured.marginWarnings[0].supportCaseId } });
    expect(supportCase).toMatchObject({ orderId: order.id, priority: 'high', category: 'sourcing' });

    const margin = (await api().get(`/procurement/acquisition-costs/orders/${order.id}/contribution`).set(admin.auth).expect(200)).body;
    expect(margin.complete).toBe(true);
    expect(Number(margin.contribution)).toBeLessThan(0);
    expect(margin.items[0].negative).toBe(true);
    expect(await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } })).toEqual(item);
  }, 120000);

  it('RBAC: suppliers and customers have no cost access, a supplier PO view carries no cost, and duplicate invoice numbers of two suppliers do not collide', async () => {
    const { purchaseOrderId, poLine, receive } = await awardedPo(1);
    await receive(1).expect(201);
    for (const actor of [suppliers.A.actor, suppliers.B.actor, customer]) {
      await captureCost(purchaseOrderId, poLine.id, { quantity: 1, unitCost: 10, invoiceRef: 'X-1' }, actor).expect(403);
      await api().get('/procurement/acquisition-costs').set(actor.auth).expect(403);
    }
    await api().get('/procurement/acquisition-costs').expect(401);
    await captureCost(purchaseOrderId, poLine.id, { quantity: 1, unitCost: 10, invoiceRef: 'SHARED-1' }).expect(201);
    const view = (await api().get(`/purchase-orders/${purchaseOrderId}`).set(suppliers.A.actor.auth).expect(200)).body;
    expect(JSON.stringify(view)).not.toMatch(/costLots|invoiceRef|unitCost":10/);

    // Supplier B's own invoice may carry the same number.
    const other = await prisma.supplierPurchaseOrder.create({ data: { supplierId: suppliers.B.id, status: 'confirmed',
      lines: { create: [{ skuId: poLine.skuId, requestedQuantity: 1, confirmedQuantity: 1 }] } }, include: { lines: true } });
    await captureCost(other.id, other.lines[0].id, { quantity: 1, unitCost: 12, invoiceRef: 'SHARED-1' }).expect(201);
  }, 120000);
});
