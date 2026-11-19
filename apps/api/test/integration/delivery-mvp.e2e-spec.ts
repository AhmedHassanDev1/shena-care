process.env.DELIVERY_FEE_POLICY = JSON.stringify({ bands: [{ maxKm: null, fee: 50 }], discountTiers: [], freeFrom: 100000 });
/* eslint-disable @typescript-eslint/no-explicit-any -- HTTP response bodies are asserted structurally */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { MediaOriginType, MediaType, Role } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { DomainEventsService } from '../../src/platform/events/domain-events.service';
import { clearRuntimeSetting, setRuntimeSetting, SETTING_KEYS } from '../../src/platform/settings/runtime-settings';
import { createActor, Actor } from '../fixtures/actors';
import { signInCustomer } from '../fixtures/checkout';
import { ensureFixtureReviewer, FIXTURE_SOURCE_URL } from '../fixtures/sellable-sku';

type OrderableSku = { id: string; barcode: string };

const gtin = (body: number[]) => body.join('') + String((10 - (body.reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 3), 0) % 10)) % 10);
const ean13 = () => gtin(Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)));

// Delivery pins: two close together in Maadi, one far away in Mohandessin (separate geographic clusters).
const MAADI_A = { latitude: 29.9602, longitude: 31.2569 };
const MAADI_B = { latitude: 29.9655, longitude: 31.2610 };
const MOHANDESSIN = { latitude: 30.0561, longitude: 31.2000 };

async function createOrderableSku(prisma: PrismaService, price = 100): Promise<OrderableSku> {
  const suffix = randomUUID();
  const reviewer = await ensureFixtureReviewer(prisma);
  const brand = await prisma.brand.create({ data: { name: 'Dlv ' + suffix, slug: 'dlv-' + suffix } });
  const product = await prisma.product.create({ data: { brandId: brand.id, name: 'Delivery Product', slug: 'dlv-product-' + suffix, isPublished: true } });
  const barcode = ean13();
  const sku = await prisma.sku.create({ data: { productId: product.id, code: 'DLV-' + suffix, variantName: '50 ml', size: 50, sizeUnit: 'ml', barcode } });
  await prisma.productMedia.create({ data: {
    productId: product.id, type: MediaType.image, url: `https://cdn.fixtures.test/${suffix}.png`, isPrimary: true, originType: MediaOriginType.verified,
    generationMetadata: { isTest: false, reviewedBy: reviewer.id, reviewedAt: new Date().toISOString(), skuId: sku.id, barcode, size: 50, sizeUnit: 'ml',
      variantName: '50 ml', sourceType: 'OFFICIAL_MANUFACTURER', sourceUrl: FIXTURE_SOURCE_URL, identityVerification: 'BARCODE_VERIFIED' },
  } });
  await prisma.listing.create({ data: { skuId: sku.id, isListed: true } });
  await prisma.sellingPrice.create({ data: { skuId: sku.id, amount: price, currency: 'EGP', validFrom: new Date(Date.now() - 60000) } });
  return { id: sku.id, barcode };
}

/**
 * Delivery MVP, end to end over HTTP on real data: smart dispatch (cluster + capacity), manual adjustment and courier reassignment,
 * the handoff gate (typed scan outcomes, audited duplicates/wrong parcels, dispatch only with a courier and every parcel in custody),
 * courier-scoped access, delivery outcomes, COD declaration and the counted settlement of one run.
 */
describe('Delivery MVP: dispatch, verified handoff, courier delivery, COD settlement (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: DomainEventsService;
  let hub: Actor; let otherHub: Actor; let admin: Actor; let d1: Actor; let d2: Actor;
  let locationId: string;
  const previousMode = process.env.SOURCING_MODE;
  const http = () => request(app.getHttpServer());
  const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  type Packed = { orderId: string; orderNumber: string; shipmentId: string; barcode: string; cod: number };

  const checkout = async (sku: OrderableSku, pin: { latitude: number; longitude: number }) => {
    const customer = await signInCustomer(app);
    const address = { governorate: 'Cairo', area: 'Maadi' };
    await http().post('/ordering/cart/add').set(customer.auth).send({ skuId: sku.id, quantity: 1 }).expect(201);
    const quote = (await http().post('/ordering/checkout/quote').set(customer.auth).send(address).expect(201)).body;
    const placed = await http().post('/ordering/checkout').set(customer.auth).send({
      ...address, customerName: 'Delivery Customer', customerPhone: '01012345678', shippingAddress: '12 Road 9',
      ...pin, locationSource: 'map_pin', locationConfirmed: true, quoteVersion: quote.quoteVersion, cartRevision: quote.revision, idempotencyKey: randomUUID(),
    }).expect(201);
    const order = placed.body as { id: string; orderNumber: string; codAmount: number; items: Array<{ id: string }> };
    await events.dispatchPending({ aggregateId: order.id });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await prisma.supplyRequirement.count({ where: { orderItemId: { in: order.items.map(i => i.id) } } }) === order.items.length) break;
      await pause(100);
      await events.dispatchPending({ aggregateId: order.id });
    }
    return order;
  };
  /** A real order taken all the way to a packed parcel at the hub: bought, scanned in, verified, printed, packaged, packed. */
  const packedOrder = async (pin: { latitude: number; longitude: number }): Promise<Packed> => {
    const sku = await createOrderableSku(prisma);
    const order = await checkout(sku, pin);
    await http().post('/buy-list/acquire').set(hub.auth).send({ skuId: sku.id, quantity: 1, idempotencyKey: randomUUID() }).expect(200);
    const received = await http().post(`/fulfillment/locations/${locationId}/desk/orders/${order.id}/scan`).set(hub.auth)
      .send({ clientScanId: randomUUID(), barcodeScanned: sku.barcode, cost: { listUnitPrice: 40, discountPerUnit: 0 } }).expect(201);
    const shipmentId = received.body.order.shipment.id as string;
    const barcode = (await http().post(`/fulfillment/shipments/${shipmentId}/label`).set(hub.auth).expect(201)).body.barcode as string;
    for (const type of ['RECEIPT_PRINTED', 'LABEL_PRINTED']) await http().post(`/fulfillment/shipments/${shipmentId}/events`).set(hub.auth).send({ type }).expect(201);
    await http().put(`/order-costs/${order.id}`).set(hub.auth).send({ packagingType: 'BAG' }).expect(200);
    await http().post(`/fulfillment/shipments/${shipmentId}/events`).set(hub.auth).send({ type: 'PACKED' }).expect(201);
    return { orderId: order.id, orderNumber: order.orderNumber, shipmentId, barcode, cod: Number(order.codAmount) };
  };
  const preview = (body: Record<string, unknown>, auth = hub.auth) => http().post(`/fulfillment/locations/${locationId}/dispatch/plan-preview`).set(auth).send(body);
  const approve = (body: Record<string, unknown>, auth = hub.auth) => http().post(`/fulfillment/locations/${locationId}/dispatch/plan-approve`).set(auth).send(body);
  const handoff = (batchId: string, barcode: string, auth: { Authorization: string }) => http().post(`/fulfillment/delivery-batches/${batchId}/handoff-scan`).set(auth).send({ barcode });
  const shipmentEvent = (shipmentId: string, body: Record<string, unknown>, auth: { Authorization: string }) => http().post(`/fulfillment/shipments/${shipmentId}/events`).set(auth).send(body);
  const run = async (batchId: string, auth = hub.auth) => (await http().get(`/fulfillment/delivery-batches/${batchId}`).set(auth)).body;

  beforeAll(async () => {
    process.env.TEST_BYPASS_AUTH = 'false';
    process.env.SOURCING_MODE = 'INTERNAL_BUY_LIST';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    events = app.get(DomainEventsService);
    hub = await createActor(prisma, Role.HUB_OPERATOR);
    otherHub = await createActor(prisma, Role.HUB_OPERATOR);
    admin = await createActor(prisma, Role.ADMIN);
    d1 = await createActor(prisma, Role.DRIVER);
    d2 = await createActor(prisma, Role.DRIVER);
    locationId = (await prisma.fulfillmentLocation.create({ data: { name: 'Dlv Hub ' + randomUUID(), address: '1 Hub Street' } })).id;
    await prisma.fulfillmentLocationOperator.create({ data: { locationId, operatorId: hub.id } });
    const elsewhere = await prisma.fulfillmentLocation.create({ data: { name: 'Dlv Other ' + randomUUID(), address: '2 Hub Street' } });
    await prisma.fulfillmentLocationOperator.create({ data: { locationId: elsewhere.id, operatorId: otherHub.id } });
    setRuntimeSetting(SETTING_KEYS.bagCost, 5);
  });

  afterAll(async () => {
    clearRuntimeSetting(SETTING_KEYS.bagCost);
    if (previousMode === undefined) delete process.env.SOURCING_MODE; else process.env.SOURCING_MODE = previousMode;
    await app.close();
  });

  it('plans nearby parcels into runs within courier capacity, approves once, and lets staff adjust and reassign before dispatch', async () => {
    const a = await packedOrder(MAADI_A); const b = await packedOrder(MAADI_B); const c = await packedOrder(MOHANDESSIN);
    const ids = [a.shipmentId, b.shipmentId, c.shipmentId];

    // Smart dispatch: the two Maadi parcels share a run, the distant one gets its own; every run has a courier within its stop capacity.
    const plan = (await preview({ shipmentIds: ids, drivers: [{ id: d1.id, maxStops: 5 }, { id: d2.id, maxStops: 5 }], maxStopsPerTrip: 5 }).expect(201)).body;
    expect(plan.unassignedOrders).toEqual([]);
    expect(plan.trips).toHaveLength(2);
    const sizes = plan.trips.map((trip: any) => trip.stops.length).sort();
    expect(sizes).toEqual([1, 2]);
    const pair = plan.trips.find((trip: any) => trip.stops.length === 2);
    expect(pair.stops.map((s: any) => s.shipmentId).sort()).toEqual([a.shipmentId, b.shipmentId].sort());
    expect(new Set(plan.trips.map((trip: any) => trip.driverId)).size).toBe(2);

    // Capacity is respected: one courier who can take a single stop cannot be given everything.
    const tight = (await preview({ shipmentIds: ids, drivers: [{ id: d1.id, maxStops: 1 }], maxTripsPerDriver: 1, maxStopsPerTrip: 5 }).expect(201)).body;
    expect(tight.trips.reduce((sum: number, trip: any) => sum + trip.stops.length, 0)).toBeLessThanOrEqual(1);
    expect(tight.unassignedOrders.length).toBeGreaterThanOrEqual(2);

    // Only the hub's own staff plan its parcels; the approval is verified against the previewed plan and is idempotent.
    await preview({ shipmentIds: ids }, otherHub.auth).expect(403);
    const trips = plan.trips.map((trip: any) => ({ tripId: trip.tripId, clusterId: trip.clusterId, driverId: trip.driverId, tripSequenceForDriver: trip.tripSequenceForDriver,
      stops: trip.stops.map((s: any) => ({ shipmentId: s.shipmentId, sequence: s.sequence })) }));
    await approve({ planFingerprint: 'tampered', trips }).expect(res => expect(res.status).toBeGreaterThanOrEqual(400));
    await approve({ planFingerprint: plan.planFingerprint, trips }, otherHub.auth).expect(403);
    const key = randomUUID();
    const approved = (await approve({ planFingerprint: plan.planFingerprint, trips, idempotencyKey: key }).expect(201)).body;
    expect(approved).toMatchObject({ success: true, totalBatchesCreated: 2, totalStopsCreated: 3 });
    const again = (await approve({ planFingerprint: plan.planFingerprint, trips, idempotencyKey: key }).expect(201)).body;
    expect(again.idempotentRetry).toBe(true);
    expect(await prisma.deliveryBatch.count({ where: { id: { in: approved.batches.map((x: any) => x.batchId) } } })).toBe(2);
    expect(await prisma.deliveryStop.count({ where: { shipmentId: { in: ids }, status: 'active' } })).toBe(3);

    // Manual adjustment and reassignment (hub staff only, planning stage only).
    const abBatch = approved.batches.find((x: any) => x.stopCount === 2);
    const currentDriver = abBatch.driverId as string;
    const other = currentDriver === d1.id ? d2 : d1;
    await http().patch(`/fulfillment/delivery-batches/${abBatch.batchId}/driver`).set(other.auth).send({ driverId: other.id }).expect(403);
    await http().patch(`/fulfillment/delivery-batches/${abBatch.batchId}/driver`).set(otherHub.auth).send({ driverId: other.id }).expect(404);
    await http().patch(`/fulfillment/delivery-batches/${abBatch.batchId}/driver`).set(hub.auth).send({ driverId: randomUUID() }).expect(400);
    await http().patch(`/fulfillment/delivery-batches/${abBatch.batchId}/driver`).set(hub.auth).send({ driverId: hub.id }).expect(400); // not a courier account
    const moved = await http().patch(`/fulfillment/delivery-batches/${abBatch.batchId}/driver`).set(hub.auth).send({ driverId: other.id }).expect(200);
    expect(moved.body.driverId).toBe(other.id);
    expect((await run(abBatch.batchId)).driverId).toBe(other.id);
  });

  it('refuses dispatch until a courier is assigned and every parcel is scanned into custody; tracks wrong, unknown and duplicate scans', async () => {
    const a = await packedOrder(MAADI_A); const b = await packedOrder(MAADI_B); const stray = await packedOrder(MOHANDESSIN);
    const batch = (await http().post('/fulfillment/delivery-batches').set(hub.auth).send({ hubId: locationId, name: 'Gate run' }).expect(201)).body as { id: string };
    await http().post(`/fulfillment/delivery-batches/${batch.id}/stops`).set(hub.auth).send({ stops: [{ shipmentId: a.shipmentId, sequence: 1 }, { shipmentId: b.shipmentId, sequence: 2 }] }).expect(201);

    await http().post(`/fulfillment/delivery-batches/${batch.id}/dispatch`).set(hub.auth).expect(400).expect(res => expect(res.body.message?.code ?? res.body.code).toBe('COURIER_REQUIRED'));
    await http().patch(`/fulfillment/delivery-batches/${batch.id}/driver`).set(hub.auth).send({ driverId: d1.id }).expect(200);
    const blocked = await http().post(`/fulfillment/delivery-batches/${batch.id}/dispatch`).set(hub.auth).expect(409);
    expect((blocked.body.message?.code ?? blocked.body.code)).toBe('HANDOFF_INCOMPLETE');
    expect(((blocked.body.message?.missingShipmentIds ?? blocked.body.missingShipmentIds) as string[]).sort()).toEqual([a.shipmentId, b.shipmentId].sort());

    // Wrong parcels never count: a genuine label of another parcel is audited on that parcel, a made-up code is simply refused.
    const wrong = await handoff(batch.id, stray.barcode, hub.auth).expect(201);
    expect(wrong.body).toMatchObject({ success: false, outcome: 'NOT_IN_RUN', scannedStopsCount: 0, totalStops: 2 });
    expect(await prisma.shipmentEvent.count({ where: { shipmentId: stray.shipmentId, type: 'HANDOFF_REJECTED', actorId: hub.id } })).toBe(1);
    expect((await handoff(batch.id, 'SHP-00000000-0000000000000000', hub.auth).expect(201)).body).toMatchObject({ success: false, outcome: 'UNKNOWN_PARCEL' });
    expect((await handoff(batch.id, 'garbage', hub.auth).expect(201)).body).toMatchObject({ success: false, outcome: 'UNKNOWN_PARCEL' });
    await handoff(batch.id, a.barcode, otherHub.auth).expect(404);

    // The hub scans the first parcel (who handed over is recorded); a second scan is a counted duplicate that changes nothing.
    const first = await handoff(batch.id, a.barcode, hub.auth).expect(201);
    expect(first.body).toMatchObject({ success: true, outcome: 'SCANNED', scannedStopsCount: 1, isComplete: false, missingShipmentIds: [b.shipmentId] });
    const dup = await handoff(batch.id, a.barcode, hub.auth).expect(201);
    expect(dup.body).toMatchObject({ outcome: 'DUPLICATE', alreadyScanned: true, scannedStopsCount: 1 });
    expect(await prisma.shipmentEvent.count({ where: { shipmentId: a.shipmentId, type: 'HANDOFF_SCANNED' } })).toBe(1);
    expect(await prisma.shipmentEvent.count({ where: { shipmentId: a.shipmentId, type: 'HANDOFF_DUPLICATE' } })).toBe(1);
    await http().post(`/fulfillment/delivery-batches/${batch.id}/dispatch`).set(hub.auth).expect(409);
    // Custody has started: the run can no longer change courier.
    await http().patch(`/fulfillment/delivery-batches/${batch.id}/driver`).set(hub.auth).send({ driverId: d2.id }).expect(409);

    // The courier receives the last parcel; the run shows who scanned each parcel and who received it.
    const second = await handoff(batch.id, b.barcode, d1.auth).expect(201);
    expect(second.body).toMatchObject({ outcome: 'SCANNED', isComplete: true, missingShipmentIds: [] });
    await handoff(batch.id, b.barcode, d2.auth).expect(404); // another courier cannot touch this run
    const view = await run(batch.id);
    expect(view.stops.find((s: any) => s.shipmentId === a.shipmentId)).toMatchObject({ handedOver: true, duplicateScans: 1, handoff: { scannedById: hub.id, receivedById: d1.id } });
    expect(view.stops.find((s: any) => s.shipmentId === b.shipmentId)).toMatchObject({ handedOver: true, handoff: { scannedById: d1.id, receivedById: d1.id } });

    // Only now does the run leave: parcels and orders move together, once.
    await http().post(`/fulfillment/delivery-batches/${batch.id}/dispatch`).set(d1.auth).expect(403);
    await http().post(`/fulfillment/delivery-batches/${batch.id}/dispatch`).set(hub.auth).expect(201);
    await http().post(`/fulfillment/delivery-batches/${batch.id}/dispatch`).set(hub.auth).expect(400);
    for (const p of [a, b]) {
      expect((await prisma.shipment.findUniqueOrThrow({ where: { id: p.shipmentId } })).status).toBe('out_for_delivery');
      expect((await prisma.order.findUniqueOrThrow({ where: { id: p.orderId } })).status).toBe('shipped');
    }
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: stray.shipmentId } })).status).toBe('packed');
    await http().patch(`/fulfillment/delivery-batches/${batch.id}/driver`).set(hub.auth).send({ driverId: d2.id }).expect(409); // dispatched
  });

  it('keeps each courier to their own run: delivery, failed attempt, retry, COD declaration and one counted settlement for the run', async () => {
    const a = await packedOrder(MAADI_A); const b = await packedOrder(MAADI_B);
    const dispatchRun = async (parcels: Packed[], driver: Actor, name: string) => {
      const batch = (await http().post('/fulfillment/delivery-batches').set(hub.auth).send({ hubId: locationId, name, driverId: driver.id }).expect(201)).body as { id: string };
      await http().post(`/fulfillment/delivery-batches/${batch.id}/stops`).set(hub.auth).send({ stops: parcels.map((p, i) => ({ shipmentId: p.shipmentId, sequence: i + 1 })) }).expect(201);
      for (const p of parcels) await handoff(batch.id, p.barcode, driver.auth).expect(201);
      await http().post(`/fulfillment/delivery-batches/${batch.id}/dispatch`).set(hub.auth).expect(201);
      return batch.id;
    };
    const first = await dispatchRun([a, b], d1, 'Morning');

    // Courier scope: the other courier sees nothing of this run and cannot act on its parcels.
    expect((await http().get('/fulfillment/driver/runs').set(d2.auth).expect(200)).body).toEqual([]);
    const manifest = (await http().get('/fulfillment/driver/runs').set(d1.auth).expect(200)).body as any[];
    expect(manifest.find(r => r.batchId === first || r.id === first)).toBeDefined();
    await http().get(`/fulfillment/shipments/${a.shipmentId}`).set(d2.auth).expect(res => expect([403, 404]).toContain(res.status));
    await shipmentEvent(a.shipmentId, { type: 'DELIVERED', collectedAmount: a.cod }, d2.auth).expect(res => expect([403, 404]).toContain(res.status));
    await http().get(`/fulfillment/delivery-batches/${first}`).set(d2.auth).expect(404);

    // Delivered with cash declared once (a replay is idempotent, a conflicting amount is refused); failed with a typed reason.
    await shipmentEvent(a.shipmentId, { type: 'DELIVERED' }, d1.auth).expect(400);
    await shipmentEvent(a.shipmentId, { type: 'DELIVERED', collectedAmount: a.cod }, d1.auth).expect(201);
    await shipmentEvent(a.shipmentId, { type: 'DELIVERED', collectedAmount: a.cod }, d1.auth).expect(201);
    await shipmentEvent(a.shipmentId, { type: 'DELIVERED', collectedAmount: a.cod - 1 }, d1.auth).expect(409);
    await shipmentEvent(b.shipmentId, { type: 'FAILED' }, d1.auth).expect(400);
    await shipmentEvent(b.shipmentId, { type: 'FAILED', reasonCode: 'CUSTOMER_UNREACHABLE' }, d1.auth).expect(201);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: b.orderId } })).status).toBe('shipped');
    // The hub's run list: the failed parcel is still an open attempt until it is taken back, but nothing is left for the courier to attempt.
    const listed = (await http().get(`/fulfillment/locations/${locationId}/runs`).set(hub.auth).expect(200)).body.items.find((r: any) => r.id === first);
    expect(listed).toMatchObject({ toAttempt: 0, attempts: { delivered: 1, active: 1 } });
    // The run is not settled: declared cash is uncounted and the failed parcel is still in the courier's hands, so it cannot be closed.
    expect(listed.settlement).toMatchObject({ state: 'reconciliation_required', canComplete: false, stops: { delivered: 1, pendingReturns: 1 } });
    const refused = await http().post(`/fulfillment/delivery-batches/${first}/complete`).set(hub.auth).expect(409);
    expect(refused.body).toMatchObject({ code: 'RUN_NOT_SETTLED', state: 'reconciliation_required' });
    expect(refused.body.blockers.map((blocker: { code: string }) => blocker.code)).toEqual(expect.arrayContaining(['PENDING_RETURNS', 'CASH_AWAITING_COUNT']));
    expect((await prisma.deliveryBatch.findUniqueOrThrow({ where: { id: first } })).status).toBe('dispatched');

    // Back at the hub (scanned), retried on a second run with the other courier, and delivered.
    await shipmentEvent(b.shipmentId, { type: 'RECEIVED_BACK', barcode: b.barcode }, d1.auth).expect(403);
    await shipmentEvent(b.shipmentId, { type: 'RECEIVED_BACK', barcode: b.barcode }, hub.auth).expect(201);
    const second = await dispatchRun([b], d2, 'Retry');
    await shipmentEvent(b.shipmentId, { type: 'DELIVERED', collectedAmount: b.cod }, d1.auth).expect(res => expect([403, 404]).toContain(res.status));
    await shipmentEvent(b.shipmentId, { type: 'DELIVERED', collectedAmount: b.cod }, d2.auth).expect(201);
    expect((await prisma.deliveryStop.findMany({ where: { shipmentId: b.shipmentId }, orderBy: { createdAt: 'asc' } })).map(s => s.status)).toEqual(['failed', 'delivered']);
    await http().post(`/fulfillment/delivery-batches/${second}/complete`).set(hub.auth).expect(409); // its cash is still uncounted
    expect(await prisma.orderStatusEvent.count({ where: { orderId: b.orderId, status: 'shipped' } })).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: b.orderId } })).status).toBe('delivered');

    // Cash: expected vs declared per courier is visible before the count; one counted round settles it once, with the variance kept.
    const open = (await http().get('/ordering/settlements/rounds/open').set(hub.auth).expect(200)).body as any[];
    expect(open.find(r => r.courierId === d1.id)).toMatchObject({ orders: 1, expectedTotal: a.cod.toFixed(2), declaredTotal: a.cod.toFixed(2) });
    expect(open.find(r => r.courierId === d2.id)).toMatchObject({ orders: 1, expectedTotal: b.cod.toFixed(2), declaredTotal: b.cod.toFixed(2) });
    await http().post('/ordering/settlements/rounds').set(otherHub.auth).send({ courierId: d1.id, locationId, reference: 'R-' + randomUUID(), countedTotal: a.cod }).expect(403);
    const reference = 'R-' + randomUUID();
    const settled = await http().post('/ordering/settlements/rounds').set(hub.auth).send({ courierId: d1.id, locationId, reference, countedTotal: a.cod - 5 }).expect(201);
    expect(settled.body).toMatchObject({ expectedTotal: a.cod.toFixed(2), declaredTotal: a.cod.toFixed(2), variance: '-5.00' });
    const replay = await http().post('/ordering/settlements/rounds').set(hub.auth).send({ courierId: d1.id, locationId, reference, countedTotal: a.cod - 5 }).expect(201);
    expect(replay.body.id).toBe(settled.body.id);
    await http().post('/ordering/settlements/rounds').set(hub.auth).send({ courierId: d1.id, locationId, reference, countedTotal: a.cod }).expect(409);
    await http().post('/ordering/settlements/rounds').set(hub.auth).send({ courierId: d1.id, locationId, reference: 'R-' + randomUUID(), countedTotal: a.cod }).expect(409); // nothing left to count
    expect(await prisma.paymentCollection.findUniqueOrThrow({ where: { orderId: a.orderId } })).toMatchObject({ status: 'settled' });
    expect(await prisma.paymentCollection.findUniqueOrThrow({ where: { orderId: b.orderId } })).toMatchObject({ status: expect.not.stringMatching(/^settled$/) });
    const rest = await http().post('/ordering/settlements/rounds').set(hub.auth).send({ courierId: d2.id, locationId, reference: 'R-' + randomUUID(), countedTotal: b.cod }).expect(201);
    expect(rest.body).toMatchObject({ variance: '0.00' });
    expect((await http().get('/ordering/settlements/rounds/open').set(hub.auth).expect(200)).body.filter((r: any) => [d1.id, d2.id].includes(r.courierId))).toEqual([]);
    // Customer prices and COD amounts are exactly what was confirmed at checkout.
    for (const p of [a, b]) expect(Number((await prisma.order.findUniqueOrThrow({ where: { id: p.orderId } })).codAmount)).toBe(p.cod);

    // Both runs are settled now (cash counted, the failed parcel was taken back), so each can be closed - once.
    for (const id of [first, second]) {
      expect((await http().get(`/fulfillment/delivery-batches/${id}/settlement`).set(hub.auth).expect(200)).body).toMatchObject({ state: 'settled', canComplete: true, blockers: [] });
      await http().post(`/fulfillment/delivery-batches/${id}/complete`).set(hub.auth).expect(201);
      expect((await http().get(`/fulfillment/delivery-batches/${id}/settlement`).set(hub.auth).expect(200)).body).toMatchObject({ state: 'completed', canComplete: false });
      await http().post(`/fulfillment/delivery-batches/${id}/complete`).set(hub.auth).expect(400); // already closed
    }
  });

  it('settlement states: an empty trip, outstanding cash, pending returns, a counted COD delivery and a valid zero-COD delivery', async () => {
    const dispatchRun = async (parcels: Packed[], driver: Actor, name: string) => {
      const batch = (await http().post('/fulfillment/delivery-batches').set(hub.auth).send({ hubId: locationId, name, driverId: driver.id }).expect(201)).body as { id: string };
      await http().post(`/fulfillment/delivery-batches/${batch.id}/stops`).set(hub.auth).send({ stops: parcels.map((p, i) => ({ shipmentId: p.shipmentId, sequence: i + 1 })) }).expect(201);
      for (const p of parcels) await handoff(batch.id, p.barcode, driver.auth).expect(201);
      await http().post(`/fulfillment/delivery-batches/${batch.id}/dispatch`).set(hub.auth).expect(201);
      return batch.id;
    };
    const settlement = async (id: string) => (await http().get(`/fulfillment/delivery-batches/${id}/settlement`).set(hub.auth).expect(200)).body;
    const complete = (id: string) => http().post(`/fulfillment/delivery-batches/${id}/complete`).set(hub.auth);

    // 1. An empty trip (no parcels at all) is never settled or completable, and no round can be "settled" for it.
    const empty = await prisma.deliveryBatch.create({ data: { status: 'dispatched', driverId: d1.id, locationId, dispatchedAt: new Date() } });
    expect(await settlement(empty.id)).toMatchObject({ state: 'pending', canComplete: false, canSettleCash: false, blockers: [{ code: 'NO_STOPS' }] });
    expect((await complete(empty.id).expect(409)).body).toMatchObject({ code: 'RUN_NOT_SETTLED' });
    expect((await http().post('/ordering/settlements/rounds').set(hub.auth).send({ courierId: d1.id, locationId, runId: empty.id, reference: 'R-' + randomUUID(), countedTotal: 0 }).expect(409)).body.code).toBe('NO_OPEN_ROUND');
    await http().post('/ordering/settlements/rounds').set(hub.auth).send({ courierId: d1.id, locationId, runId: randomUUID(), reference: 'R-' + randomUUID(), countedTotal: 0 }).expect(404);

    // 2. Parcels still on the road: pending, nothing to settle yet.
    const cod = await packedOrder(MAADI_A); const failed = await packedOrder(MAADI_B);
    const mixed = await dispatchRun([cod, failed], d1, 'Mixed');
    expect(await settlement(mixed)).toMatchObject({ state: 'pending', canComplete: false, stops: { inTransit: 2, delivered: 0 } });
    await complete(mixed).expect(400); // the courier still has parcels to attempt

    // 3. COD delivered + one failed parcel still in the courier's hands: reconciliation required, cash outstanding.
    await shipmentEvent(cod.shipmentId, { type: 'DELIVERED', collectedAmount: cod.cod }, d1.auth).expect(201);
    await shipmentEvent(failed.shipmentId, { type: 'FAILED', reasonCode: 'CUSTOMER_UNREACHABLE' }, d1.auth).expect(201);
    const reconciling = await settlement(mixed);
    expect(reconciling).toMatchObject({ state: 'reconciliation_required', canComplete: false, canSettleCash: true, stops: { delivered: 1, pendingReturns: 1 } });
    expect(reconciling.cash).toMatchObject({ codOrders: 1, awaitingCount: 1, expectedTotal: cod.cod, declaredTotal: cod.cod });
    expect(reconciling.pendingReturns).toEqual([expect.objectContaining({ shipmentId: failed.shipmentId, orderNumber: failed.orderNumber })]);
    await complete(mixed).expect(409);

    // 4. Count the cash: still blocked by the pending return. The counted round is scoped to this run's delivered cash.
    const counted = await http().post('/ordering/settlements/rounds').set(hub.auth).send({ courierId: d1.id, locationId, runId: mixed, reference: 'R-' + randomUUID(), countedTotal: cod.cod }).expect(201);
    expect(counted.body).toMatchObject({ variance: '0.00' });
    expect(await settlement(mixed)).toMatchObject({ state: 'reconciliation_required', canSettleCash: false, canComplete: false, blockers: [{ code: 'PENDING_RETURNS', count: 1 }] });
    expect((await settlement(mixed)).settlements).toEqual([expect.objectContaining({ countedTotal: cod.cod, variance: 0 })]);
    await complete(mixed).expect(409);

    // 5. Take the failed parcel back: the run is settled and closes.
    await shipmentEvent(failed.shipmentId, { type: 'RECEIVED_BACK', barcode: failed.barcode }, hub.auth).expect(201);
    expect(await settlement(mixed)).toMatchObject({ state: 'settled', canComplete: true, blockers: [], cash: { counted: 1, variance: 0 } });
    await complete(mixed).expect(201);
    expect(await settlement(mixed)).toMatchObject({ state: 'completed' });

    // 6. A valid zero-COD trip: a prepaid parcel really delivered. Nothing to count, yet it is settled and closes honestly.
    const prepaid = await packedOrder(MAADI_A);
    // Planned as a normal order, then settled online before the run leaves: no driver cash is ever due for it (GLO-241).
    const zeroBatch = (await http().post('/fulfillment/delivery-batches').set(hub.auth).send({ hubId: locationId, name: 'Prepaid', driverId: d2.id }).expect(201)).body as { id: string };
    await http().post(`/fulfillment/delivery-batches/${zeroBatch.id}/stops`).set(hub.auth).send({ stops: [{ shipmentId: prepaid.shipmentId, sequence: 1 }] }).expect(201);
    await handoff(zeroBatch.id, prepaid.barcode, d2.auth).expect(201);
    const paidOrder = await prisma.order.update({ where: { id: prepaid.orderId }, data: { paymentMethod: 'CARD', codAmount: 0 } });
    await prisma.paymentAttempt.create({ data: { orderId: paidOrder.id, method: 'CARD', provider: 'test-card-psp', reference: 'PAID-' + randomUUID().slice(0, 12), amount: paidOrder.totalAmount, currency: paidOrder.currency, status: 'confirmed', confirmedAt: new Date() } });
    await http().post(`/fulfillment/delivery-batches/${zeroBatch.id}/dispatch`).set(hub.auth).expect(201);
    const zero = zeroBatch.id;
    expect(await settlement(zero)).toMatchObject({ state: 'pending', canComplete: false });
    await shipmentEvent(prepaid.shipmentId, { type: 'DELIVERED' }, d2.auth).expect(201);
    const zeroCod = await settlement(zero);
    expect(zeroCod).toMatchObject({ state: 'settled', canComplete: true, canSettleCash: false, stops: { delivered: 1 }, cash: { codOrders: 0, zeroCodDeliveries: 1 } });
    expect(await prisma.paymentCollection.count({ where: { orderId: prepaid.orderId } })).toBe(0);
    await http().post('/ordering/settlements/rounds').set(hub.auth).send({ courierId: d2.id, locationId, runId: zero, reference: 'R-' + randomUUID(), countedTotal: 0 }).expect(409); // no cash to "settle"
    await complete(zero).expect(201);

    // 7. A trip whose only parcel failed and was taken back has nothing to settle and closes (no cash was ever due).
    const returned = await packedOrder(MAADI_B);
    const back = await dispatchRun([returned], d2, 'Returned');
    await shipmentEvent(returned.shipmentId, { type: 'FAILED', reasonCode: 'CUSTOMER_UNREACHABLE' }, d2.auth).expect(201);
    expect(await settlement(back)).toMatchObject({ state: 'reconciliation_required', stops: { pendingReturns: 1, delivered: 0 } });
    await shipmentEvent(returned.shipmentId, { type: 'RECEIVED_BACK', barcode: returned.barcode }, hub.auth).expect(201);
    expect(await settlement(back)).toMatchObject({ state: 'settled', canComplete: true, cash: { codOrders: 0, zeroCodDeliveries: 0 } });
    await complete(back).expect(201);

    // Scope: another hub sees neither the run's settlement nor can close it.
    await http().get(`/fulfillment/delivery-batches/${mixed}/settlement`).set(otherHub.auth).expect(404);
  });
});
