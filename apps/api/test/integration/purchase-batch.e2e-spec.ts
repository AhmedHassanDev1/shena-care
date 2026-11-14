// A flat fee keeps the expected COD arithmetic readable; the tiered policy has its own suite.
process.env.DELIVERY_FEE_POLICY = JSON.stringify({ bands: [{ maxKm: null, fee: 50 }], discountTiers: [], freeFrom: 100000 });
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { MediaOriginType, MediaType, Role } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { DomainEventsService } from '../../src/platform/events/domain-events.service';
import { PurchaseBatchService } from '../../src/modules/sourcing/public';
import { createActor, Actor } from '../fixtures/actors';
import { signInCustomer } from '../fixtures/checkout';
import { ensureFixtureReviewer, FIXTURE_SOURCE_URL } from '../fixtures/sellable-sku';

type OrderableSku = { id: string; barcode: string; variantName: string };

/** A valid EAN-13 (the media review rejects barcodes without a correct check digit). */
function ean13() {
  const body = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  const sum = body.reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 3), 0);
  return body.join('') + String((10 - (sum % 10)) % 10);
}

/**
 * A SKU the storefront will really sell: published product, identity-reviewed verified media, listing and price. Demand-only sourcing
 * needs no supplier offer. (The shared fixture predates the media review's identity-verification field, so this suite carries its own.)
 */
async function createOrderableSku(prisma: PrismaService): Promise<OrderableSku> {
  const suffix = randomUUID();
  const reviewer = await ensureFixtureReviewer(prisma);
  const brand = await prisma.brand.create({ data: { name: 'Batch ' + suffix, slug: 'batch-' + suffix } });
  const product = await prisma.product.create({ data: { brandId: brand.id, name: 'Batch Product', slug: 'batch-product-' + suffix, isPublished: true } });
  const barcode = ean13();
  const sku = await prisma.sku.create({ data: { productId: product.id, code: 'BATCH-' + suffix, variantName: '50 ml', size: 50, sizeUnit: 'ml', barcode } });
  await prisma.productMedia.create({ data: {
    productId: product.id, type: MediaType.image, url: `https://cdn.fixtures.test/${suffix}.png`, isPrimary: true, originType: MediaOriginType.verified,
    generationMetadata: { isTest: false, reviewedBy: reviewer.id, reviewedAt: new Date().toISOString(), skuId: sku.id, barcode, size: 50, sizeUnit: 'ml',
      variantName: '50 ml', sourceType: 'OFFICIAL_MANUFACTURER', sourceUrl: FIXTURE_SOURCE_URL, identityVerification: 'BARCODE_VERIFIED' },
  } });
  await prisma.listing.create({ data: { skuId: sku.id, isListed: true } });
  await prisma.sellingPrice.create({ data: { skuId: sku.id, amount: 100, currency: 'EGP', validFrom: new Date(Date.now() - 60000) } });
  return { id: sku.id, barcode, variantName: '50 ml' };
}

/**
 * Scheduled purchase batches on persisted data, no mocks of the operational steps: real customer checkouts → demand aggregated per exact
 * SKU → idempotent scheduled cutoff → numbered batch → staff mark it sent (who/when, ETA) → partial and full physical receipts →
 * existing Hub receiving by barcode → shipment ready to prepare; cost, cancellation, unavailable and concurrency are covered as well.
 */
describe('Purchase batches (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: DomainEventsService;
  let batches: PurchaseBatchService;
  let admin: Actor; let hub: Actor; let driver: Actor;
  let locationId: string;
  let skuA: OrderableSku;
  let skuB: OrderableSku;
  const previousMode = process.env.SOURCING_MODE;
  const http = () => request(app.getHttpServer());

  const checkout = async (sku: { id: string }, quantity: number) => {
    const customer = await signInCustomer(app);
    const address = { governorate: 'Cairo', area: 'Maadi' };
    await http().post('/ordering/cart/add').set(customer.auth).send({ skuId: sku.id, quantity }).expect(201);
    const quote = (await http().post('/ordering/checkout/quote').set(customer.auth).send(address).expect(201)).body;
    const placed = await http().post('/ordering/checkout').set(customer.auth).send({
      ...address, customerName: 'Batch Customer', customerPhone: '01012345678', shippingAddress: '12 Road 9, Maadi',
      latitude: 29.9602, longitude: 31.2569, locationSource: 'map_pin', locationConfirmed: true,
      quoteVersion: quote.quoteVersion, cartRevision: quote.revision, idempotencyKey: randomUUID(),
    }).expect(201);
    await events.dispatchPending({ aggregateId: placed.body.id }); // Await only this order's outbox work.
    // The app's own dispatcher may hold the event; the demand exists once its requirement does.
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await prisma.supplyRequirement.findUnique({ where: { orderItemId: placed.body.items[0].id } })) break;
      await pause(100);
      await events.dispatchPending({ aggregateId: placed.body.id });
    }
    return { customer, order: placed.body as { id: string; orderNumber: string; items: Array<{ id: string }> } };
  };
  const placedAt = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).createdAt;
  const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const detail = async (id: string, auth = hub.auth) => (await http().get(`/purchase-batches/${id}`).set(auth).expect(200)).body;
  type LineView = { id: string; required: number; received: number; remaining: number; closedOut: number; orders: Array<{ orderId: string; quantity: number; received: number; remaining: number; state: string }> };
  const lineOf = (batch: { lines: Array<{ skuId: string }> }, sku: { id: string }) => batch.lines.find(line => line.skuId === sku.id) as unknown as LineView;

  beforeAll(async () => {
    process.env.TEST_BYPASS_AUTH = 'false';
    process.env.SOURCING_MODE = 'INTERNAL_BUY_LIST';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    events = app.get(DomainEventsService);
    batches = app.get(PurchaseBatchService);
    admin = await createActor(prisma, Role.ADMIN);
    hub = await createActor(prisma, Role.HUB_OPERATOR);
    driver = await createActor(prisma, Role.DRIVER);
    locationId = (await prisma.fulfillmentLocation.create({ data: { name: 'Batch Hub ' + randomUUID(), address: '1 Hub Street' } })).id;
    await prisma.fulfillmentLocationOperator.create({ data: { locationId, operatorId: hub.id } });
    skuA = await createOrderableSku(prisma);
    skuB = await createOrderableSku(prisma);
    // Earlier suites can leave a due outbox row without a supply requirement.
    // Materialize that existing demand before parking it, so a later checkout's
    // dispatcher cannot introduce unrelated lines inside this suite's cutoff.
    await events.dispatchPending({ limit: 1000 });
    // Demand left on this database by earlier suites is parked in a batch of its own, so every count below is about this suite's orders only.
    await batches.cutNow(randomUUID(), admin.id);
  });

  afterAll(async () => {
    if (previousMode === undefined) delete process.env.SOURCING_MODE; else process.env.SOURCING_MODE = previousMode;
    await app.close();
  });

  it('runs the whole workflow: demand → scheduled batch → sent + ETA → partial/full receipt → Hub allocation, with no double counting', async () => {
    // Customers: two orders for A; the first cutoff falls between them.
    const o1 = await checkout(skuA, 2);
    await pause(30);
    const cutoff1 = await placedAt(o1.order.id);
    await pause(30);
    const o2 = await checkout(skuA, 3);
    // The Buy List is internal: no driver, no customer.
    await http().get('/purchase-batches').set(driver.auth).expect(403);
    await http().get('/purchase-batches').set(o1.customer.auth).expect(403);

    // Cutoff 1 takes only what was placed at or before it; the later order waits for the next batch.
    const slot1 = `slot:test-${randomUUID()}`;
    const first = await batches.cut({ slotKey: slot1, cutoffAt: cutoff1, kind: 'scheduled', actorId: null });
    expect(first).toMatchObject({ replayed: false });
    const batch1 = await detail(first!.batchId);
    expect(batch1).toMatchObject({ status: 'ready', kind: 'scheduled', skus: 1, units: 2, received: 0, remaining: 2, nextAction: 'send' });
    expect(lineOf(batch1, skuA).orders.map(o => [o.orderId, o.quantity])).toEqual([[o1.order.id, 2]]);

    // The scheduled cut is idempotent: retries and a concurrent burst (several instances) end with one batch.
    expect(await batches.cut({ slotKey: slot1, cutoffAt: cutoff1, kind: 'scheduled', actorId: null })).toMatchObject({ replayed: true, batchId: first!.batchId });
    const slot2 = `slot:test-${randomUUID()}`;
    const cutoff2 = new Date();
    const burst = await Promise.all(Array.from({ length: 5 }, () => batches.cut({ slotKey: slot2, cutoffAt: cutoff2, kind: 'scheduled', actorId: null })));
    const batch2Id = burst.find(result => result && !result.replayed)!.batchId;
    expect(new Set(burst.map(result => result!.batchId))).toEqual(new Set([batch2Id]));
    expect(await prisma.purchaseBatch.count({ where: { slotKey: slot2 } })).toBe(1);

    // Batch 2 holds only the demand batch 1 does not: A×3 (not A×2 again), and numbers are consecutive.
    const batch2 = await detail(batch2Id);
    expect(batch2.number).toBe(batch1.number + 1);
    expect(lineOf(batch2, skuA)).toMatchObject({ required: 3 });
    expect(lineOf(batch2, skuA).orders.map(o => [o.orderId, o.quantity])).toEqual([[o2.order.id, 3]]);
    // Nothing is left unclaimed for A, so another cut produces nothing rather than an empty or duplicate batch.
    expect(await batches.cut({ slotKey: `slot:test-${randomUUID()}`, cutoffAt: new Date(), kind: 'scheduled', actorId: null })).toBeNull();
    const overview = (await http().get('/purchase-batches').set(hub.auth).expect(200)).body;
    expect(overview.pending).toEqual({ skus: 0, units: 0, orders: 0 });
    expect(overview.items.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining([batch1.id, batch2Id]));

    // Goods cannot be "received" before staff confirmed the order was placed.
    await http().post(`/purchase-batches/${batch1.id}/lines/${lineOf(batch1, skuA).id}/receive`).set(hub.auth).send({ quantity: 1, idempotencyKey: randomUUID() })
      .expect(409).expect(res => expect(res.body.code).toBe('BATCH_NOT_SENT'));

    // Mark sent with an ETA of tomorrow: who and when are recorded; a retry replays and the audit trail has one "sent".
    const tomorrow = new Date(Date.now() + 24 * 3_600_000).toISOString();
    const sent = await http().post(`/purchase-batches/${batch1.id}/send`).set(hub.auth).send({ expectedAt: tomorrow, note: 'ordered by phone' }).expect(200);
    expect(sent.body).toMatchObject({ replayed: false, batch: { status: 'sent', sentBy: hub.id, note: 'ordered by phone', nextAction: 'receive' } });
    expect(sent.body.batch.sentAt).toBeTruthy();
    expect(new Date(sent.body.batch.expectedAt).toISOString()).toBe(tomorrow);
    const resent = await http().post(`/purchase-batches/${batch1.id}/send`).set(admin.auth).send({ expectedAt: new Date(Date.now() + 48 * 3_600_000).toISOString() }).expect(200);
    expect(resent.body.replayed).toBe(true);
    expect(resent.body.batch.sentBy).toBe(hub.id); // the first confirmation stands
    expect(resent.body.batch.events.filter((e: { type: string }) => e.type === 'sent')).toHaveLength(1);
    const eta = await http().patch(`/purchase-batches/${batch1.id}`).set(hub.auth).send({ expectedAt: new Date(Date.now() + 36 * 3_600_000).toISOString() }).expect(200);
    expect(eta.body.events.map((e: { type: string }) => e.type)).toEqual(['created', 'sent', 'details']);

    // Partial delivery: 1 of 2 arrives. A retry with the same key counts once; the next count is capped at what is left.
    const lineId = lineOf(batch1, skuA).id;
    const keyPartial = randomUUID();
    const partial = await http().post(`/purchase-batches/${batch1.id}/lines/${lineId}/receive`).set(hub.auth).send({ quantity: 1, idempotencyKey: keyPartial }).expect(200);
    expect(partial.body.replayed).toBe(false);
    const replay = await http().post(`/purchase-batches/${batch1.id}/lines/${lineId}/receive`).set(hub.auth).send({ quantity: 1, idempotencyKey: keyPartial }).expect(200);
    expect(replay.body.replayed).toBe(true);
    expect(lineOf(await detail(batch1.id), skuA)).toMatchObject({ required: 2, received: 1, remaining: 1 });
    await http().post(`/purchase-batches/${batch1.id}/lines/${lineId}/receive`).set(hub.auth).send({ quantity: 2, idempotencyKey: randomUUID() })
      .expect(409).expect(res => expect(res.body.code).toBe('EXCEEDS_OUTSTANDING'));
    // The same key on a different count is refused, not silently replayed.
    await http().post(`/purchase-batches/${batch1.id}/lines/${lineId}/receive`).set(hub.auth).send({ quantity: 2, idempotencyKey: keyPartial }).expect(409);
    // Cannot close with units still expected.
    await http().post(`/purchase-batches/${batch1.id}/close`).set(hub.auth).expect(409).expect(res => expect(res.body.code).toBe('BATCH_HAS_REMAINING'));

    // Final unit arrives with its actual cost (list price − discount) → batch closes by itself.
    const costKey = randomUUID();
    const done = await http().post(`/purchase-batches/${batch1.id}/lines/${lineId}/receive`).set(hub.auth)
      .send({ quantity: 1, idempotencyKey: costKey, cost: { listUnitPrice: 100, discountPerUnit: 10 } }).expect(200);
    expect(done.body.batch).toMatchObject({ status: 'closed', closeReason: 'completed', received: 2, remaining: 0, nextAction: null });
    const cost = await prisma.purchaseCostBatch.findUniqueOrThrow({ where: { acquireKey: costKey } });
    expect(cost.finalUnitCost.toFixed(2)).toBe('90.00');
    expect(await prisma.purchaseBatchReceipt.count({ where: { lineId } })).toBe(2);
    await http().post(`/purchase-batches/${batch1.id}/lines/${lineId}/receive`).set(hub.auth).send({ quantity: 1, idempotencyKey: randomUUID() })
      .expect(409).expect(res => expect(res.body.code).toBe('BATCH_CLOSED'));

    // Hub receiving (existing flow): the batch's purchase shows as a receivable, and the barcode receipt makes the order ready to prepare.
    const receivables = (await http().get(`/fulfillment/locations/${locationId}/receivables`).set(hub.auth).expect(200)).body as Array<{
      allocationId: string; orderId: string; orderItemId: string; remainingQuantity: number }>;
    const forO1 = receivables.filter(r => r.orderId === o1.order.id);
    expect(forO1.reduce((sum, r) => sum + r.remainingQuantity, 0)).toBe(2);
    for (const row of forO1) {
      await http().post('/fulfillment/receipts').set(hub.auth).send({
        locationId, allocationId: row.allocationId, orderId: o1.order.id, orderItemId: row.orderItemId, skuId: skuA.id,
        variantName: skuA.variantName, quantity: row.remainingQuantity, condition: 'ACCEPTABLE', expiryDate: '2031-12-31',
        idempotencyKey: randomUUID(), barcodeScanned: skuA.barcode!,
      }).expect(201);
    }
    expect((await prisma.shipment.findUniqueOrThrow({ where: { orderId: o1.order.id } })).status).toBe('ready_to_prepare');

    // A new B order is cut into a manual (early) batch; resolving it unavailable parks the order in the customer decision flow.
    const o3 = await checkout(skuB, 1);
    const early = await batches.cutNow(randomUUID(), hub.id);
    const b3 = await detail(early!.batchId);
    expect(b3).toMatchObject({ kind: 'manual', skus: 1, units: 1 });
    expect(lineOf(b3, skuB).orders.map(o => o.orderId)).toEqual([o3.order.id]);
    await http().post(`/purchase-batches/${b3.id}/send`).set(hub.auth).send({}).expect(200);
    const resolved = await http().post(`/purchase-batches/${b3.id}/lines/${lineOf(b3, skuB).id}/unavailable`).set(hub.auth).send({ note: 'not in market' }).expect(200);
    expect(resolved.body).toMatchObject({ status: 'closed', closeReason: 'cancelled', received: 0, remaining: 0 });
    expect(lineOf(resolved.body, skuB)).toMatchObject({ closedOut: 1 });
    const requirement = await prisma.supplyRequirement.findUniqueOrThrow({ where: { orderItemId: o3.order.items[0].id }, include: { actionRequirement: true } });
    expect(requirement.actionRequirement).toMatchObject({ category: 'BUY_LIST_UNAVAILABLE', unresolvedQuantity: 1 });
    // Repeating the resolution is harmless, and the parked demand does not come back into a later batch.
    await http().post(`/purchase-batches/${b3.id}/lines/${lineOf(b3, skuB).id}/unavailable`).set(hub.auth).send({}).expect(200);
    expect(await batches.cutNow(randomUUID(), hub.id)).toBeNull();

    // Batch 2 (A×3): only 2 arrive; the shortage is resolved explicitly, the order keeps what arrived, and the batch closes.
    await http().post(`/purchase-batches/${batch2Id}/send`).set(hub.auth).send({}).expect(200);
    const l2 = lineOf(batch2, skuA).id;
    await http().post(`/purchase-batches/${batch2Id}/lines/${l2}/receive`).set(hub.auth).send({ quantity: 2, idempotencyKey: randomUUID() }).expect(200);
    const short = await http().post(`/purchase-batches/${batch2Id}/lines/${l2}/unavailable`).set(hub.auth).send({ note: 'supplier short' }).expect(200);
    expect(short.body).toMatchObject({ status: 'closed', closeReason: 'completed', received: 2, remaining: 0 });
    expect(lineOf(short.body, skuA)).toMatchObject({ received: 2, closedOut: 1 });
    const o2Requirement = await prisma.supplyRequirement.findUniqueOrThrow({ where: { orderItemId: o2.order.items[0].id }, include: { actionRequirement: true } });
    expect(o2Requirement.actionRequirement).toMatchObject({ unresolvedQuantity: 1 });
  });

  it('lets a cancelled order drop out of an open batch and closes the batch without a click', async () => {
    const order = await checkout(skuA, 1);
    const cut = await batches.cutNow(randomUUID(), hub.id);
    const batch = await detail(cut!.batchId);
    expect(batch).toMatchObject({ status: 'ready', remaining: 1 });
    await prisma.order.update({ where: { id: order.order.id }, data: { status: 'cancelled' } });
    // Restart recovery / scheduler sweep: nothing left to buy → closed as cancelled, never sent.
    expect(await batches.sweepFinished()).toBeGreaterThanOrEqual(1);
    expect(await detail(batch.id)).toMatchObject({ status: 'closed', closeReason: 'cancelled', remaining: 0 });
    await http().post(`/purchase-batches/${batch.id}/send`).set(hub.auth).send({}).expect(409);
  });

  it('keeps old batches and demand intact when the schedule changes, and only Admin can change it', async () => {
    const current = (await http().get('/purchase-batches/settings').set(hub.auth).expect(200)).body.settings.version as number;
    const before = await prisma.purchaseBatch.findMany({ select: { id: true, cutoffAt: true, slotKey: true, number: true } });
    await http().put('/purchase-batches/settings').set(hub.auth).send({ intervalMinutes: 60, startTime: '08:00', timeZone: 'Africa/Cairo' }).expect(403);
    await http().put('/purchase-batches/settings').set(admin.auth).send({ intervalMinutes: 5, startTime: '08:00', timeZone: 'Africa/Cairo' }).expect(400);
    await http().put('/purchase-batches/settings').set(admin.auth).send({ intervalMinutes: 60, startTime: '08:00', timeZone: 'Mars/Olympus' }).expect(400);
    const updated = await http().put('/purchase-batches/settings').set(admin.auth).send({ intervalMinutes: 60, startTime: '08:00', timeZone: 'Africa/Cairo', expectedVersion: current }).expect(200);
    expect(updated.body.settings).toMatchObject({ intervalMinutes: 60, startTime: '08:00', timeZone: 'Africa/Cairo', version: current + 1, updatedBy: admin.id });
    await http().put('/purchase-batches/settings').set(admin.auth).send({ intervalMinutes: 30, startTime: '08:00', timeZone: 'Africa/Cairo', expectedVersion: current })
      .expect(409).expect(res => expect(res.body.code).toBe('SETTINGS_STALE'));
    // The scheduled tick uses the new schedule; with nothing unclaimed it cuts nothing and changes no historical batch.
    await batches.runDue();
    const after = await prisma.purchaseBatch.findMany({ select: { id: true, cutoffAt: true, slotKey: true, number: true } });
    for (const row of before) expect(after).toContainEqual(row);
    expect((await http().get('/purchase-batches/settings').set(hub.auth).expect(200)).body.settings.intervalMinutes).toBe(60);
    await http().put('/purchase-batches/settings').set(admin.auth).send({ intervalMinutes: 180, startTime: '09:00', timeZone: 'Africa/Cairo', expectedVersion: current + 1 }).expect(200);
  });
});
