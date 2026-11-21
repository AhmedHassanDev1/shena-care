// A flat fee keeps the expected COD arithmetic readable.
process.env.DELIVERY_FEE_POLICY = JSON.stringify({ bands: [{ maxKm: null, fee: 50 }], discountTiers: [], freeFrom: 100000 });
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { MediaOriginType, MediaType, Role } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { DomainEventsService } from '../../src/platform/events/domain-events.service';
import { createActor, Actor } from '../fixtures/actors';
import { recordPackaging } from '../fixtures/pack-ready';
import { signInCustomer } from '../fixtures/checkout';
import { ensureFixtureReviewer, FIXTURE_SOURCE_URL } from '../fixtures/sellable-sku';

type Sku = { id: string; barcode: string; variantName: string; slug: string };
type Placed = { id: string; orderNumber: string; codAmount: number; totalAmount: number; items: Array<{ id: string; skuId: string; quantity: number }> };
type DeskLine = { skuId: string; required: number; purchased: number; received: number; verified: number; cost: { recorded: boolean; finalUnitCost: string | null } | null };
type DeskOrder = { orderId: string; stage: string; shipment: { id: string; status: string } | null; lines: DeskLine[]; units: Array<{ receiptId: string; correctable: boolean }>; rejectedScans: number };

function ean13() {
  const body = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  const sum = body.reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 3), 0);
  return body.join('') + String((10 - (sum % 10)) % 10);
}

async function createSku(prisma: PrismaService, opts: { listed?: boolean; price?: number } = {}): Promise<Sku> {
  const suffix = randomUUID();
  const reviewer = await ensureFixtureReviewer(prisma);
  const brand = await prisma.brand.create({ data: { name: 'Gold ' + suffix, slug: 'gold-' + suffix } });
  const slug = 'gold-product-' + suffix;
  const product = await prisma.product.create({ data: { brandId: brand.id, name: 'Golden Product', slug, isPublished: true } });
  const barcode = ean13();
  const sku = await prisma.sku.create({ data: { productId: product.id, code: 'GOLD-' + suffix, variantName: '50 ml', size: 50, sizeUnit: 'ml', barcode } });
  await prisma.productMedia.create({ data: {
    productId: product.id, type: MediaType.image, url: `https://cdn.fixtures.test/${suffix}.png`, isPrimary: true, originType: MediaOriginType.verified,
    generationMetadata: { isTest: false, reviewedBy: reviewer.id, reviewedAt: new Date().toISOString(), skuId: sku.id, barcode, size: 50, sizeUnit: 'ml',
      variantName: '50 ml', sourceType: 'OFFICIAL_MANUFACTURER', sourceUrl: FIXTURE_SOURCE_URL, identityVerification: 'BARCODE_VERIFIED' },
  } });
  await prisma.listing.create({ data: { skuId: sku.id, isListed: opts.listed ?? true } });
  await prisma.sellingPrice.create({ data: { skuId: sku.id, amount: opts.price ?? 100, currency: 'EGP', validFrom: new Date(Date.now() - 60000) } });
  return { id: sku.id, barcode, variantName: '50 ml', slug };
}

/**
 * GLO-304: the two critical golden journeys on the merged HEAD, over HTTP and persisted data, with the one-person Hub desk:
 *  1. PDP → cart → COD checkout → Hub (purchase, scan-once receipt + verification, correction, print) → delivery → cash settlement → finance.
 *  5. Several orders → aggregated Buy List → partial purchase → Hub → delivery (one failed attempt + retry) → COD round.
 * Each carries the focused negative cases for its stage; nothing is mocked and no data is fixed up by hand.
 */
describe('Golden journeys (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: DomainEventsService;
  let admin: Actor; let hub: Actor; let otherHub: Actor; let driver: Actor; let otherDriver: Actor;
  let locationId: string;
  const previousMode = process.env.SOURCING_MODE;
  const http = () => request(app.getHttpServer());
  const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const EXPIRY = '2031-12-31';
  const address = { governorate: 'Cairo', area: 'Maadi' };

  const quote = async (customer: Actor) => (await http().post('/ordering/checkout/quote').set(customer.auth).send(address).expect(201)).body as { quoteVersion: string; revision: number };
  const checkoutBody = (q: { quoteVersion: string; revision: number }, key = randomUUID(), overrides: Record<string, unknown> = {}) => ({
    ...address, customerName: 'Journey Customer', customerPhone: '01012345678', shippingAddress: '12 Road 9, Maadi',
    latitude: 29.9602, longitude: 31.2569, locationSource: 'map_pin', locationConfirmed: true,
    quoteVersion: q.quoteVersion, cartRevision: q.revision, idempotencyKey: key, ...overrides,
  });
  const awaitDemand = async (order: Placed) => {
    await events.dispatchPending({ aggregateId: order.id });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await prisma.supplyRequirement.count({ where: { orderItemId: { in: order.items.map(i => i.id) } } }) === order.items.length) return;
      await pause(100);
      await events.dispatchPending({ aggregateId: order.id });
    }
  };
  const place = async (lines: Array<{ sku: Sku; quantity: number }>) => {
    const customer = await signInCustomer(app);
    for (const line of lines) await http().post('/ordering/cart/add').set(customer.auth).send({ skuId: line.sku.id, quantity: line.quantity }).expect(201);
    const q = await quote(customer);
    const placed = (await http().post('/ordering/checkout').set(customer.auth).send(checkoutBody(q)).expect(201)).body as Placed;
    await awaitDemand(placed);
    return { customer, order: placed };
  };
  const buy = (sku: Sku, quantity: number, key = randomUUID()) => http().post('/buy-list/acquire').set(hub.auth).send({ skuId: sku.id, quantity, idempotencyKey: key });
  const buyRow = async (sku: Sku) => ((await http().get('/buy-list').set(hub.auth).expect(200)).body.items as Array<{ skuId: string; toBuy: number; acquired: number; awaitingHub: number; orderCount: number }>).find(i => i.skuId === sku.id);
  const scan = (orderId: string, body: Record<string, unknown>, auth = hub.auth) =>
    http().post(`/fulfillment/locations/${locationId}/desk/orders/${orderId}/scan`).set(auth).send({ clientScanId: randomUUID(), ...body });
  const desk = async (orderId: string) => ((await http().get(`/fulfillment/locations/${locationId}/desk`).set(hub.auth).expect(200)).body.orders as DeskOrder[]).find(o => o.orderId === orderId);
  const event = (shipmentId: string, actor: Actor, body: Record<string, unknown>) => http().post(`/fulfillment/shipments/${shipmentId}/events`).set(actor.auth).send(body);
  const printAndPack = async (shipmentId: string) => {
    const barcode = (await http().post(`/fulfillment/shipments/${shipmentId}/label`).set(hub.auth).expect(201)).body.barcode as string;
    await event(shipmentId, hub, { type: 'LABEL_PRINTED' }).expect(201);
    await event(shipmentId, hub, { type: 'RECEIPT_PRINTED' }).expect(201);
    await recordPackaging(app, hub.auth, shipmentId);
    await event(shipmentId, hub, { type: 'PACKED' }).expect(201);
    return barcode;
  };
  const run = async (name: string, shipments: Array<{ id: string; barcode: string }>) => {
    const batch = (await http().post('/fulfillment/delivery-batches').set(hub.auth).send({ hubId: locationId, name, driverId: driver.id }).expect(201)).body as { id: string };
    await http().post(`/fulfillment/delivery-batches/${batch.id}/stops`).set(hub.auth).send({ stops: shipments.map((s, i) => ({ shipmentId: s.id, sequence: i + 1 })) }).expect(201);
    for (const s of shipments) await event(s.id, driver, { type: 'HANDOFF_SCANNED', barcode: s.barcode }).expect(201);
    // The courier's last label scan releases the run by itself.
    expect((await prisma.deliveryBatch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe('dispatched');
    return batch.id;
  };
  const net = (orderId: string) => prisma.fulfillmentReceipt.aggregate({ where: { orderId }, _sum: { quantity: true } }).then(r => r._sum.quantity ?? 0);

  beforeAll(async () => {
    process.env.TEST_BYPASS_AUTH = 'false';
    process.env.SOURCING_MODE = 'INTERNAL_BUY_LIST';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    events = app.get(DomainEventsService);
    admin = await createActor(prisma, Role.ADMIN);
    hub = await createActor(prisma, Role.HUB_OPERATOR);
    otherHub = await createActor(prisma, Role.HUB_OPERATOR);
    driver = await createActor(prisma, Role.DRIVER);
    otherDriver = await createActor(prisma, Role.DRIVER);
    locationId = (await prisma.fulfillmentLocation.create({ data: { name: 'Golden Hub ' + randomUUID(), address: '1 Hub Street' } })).id;
    await prisma.fulfillmentLocationOperator.create({ data: { locationId, operatorId: hub.id } });
    const elsewhere = await prisma.fulfillmentLocation.create({ data: { name: 'Other Hub ' + randomUUID(), address: '2 Hub Street' } });
    await prisma.fulfillmentLocationOperator.create({ data: { locationId: elsewhere.id, operatorId: otherHub.id } });
  });

  afterAll(async () => {
    if (previousMode === undefined) delete process.env.SOURCING_MODE; else process.env.SOURCING_MODE = previousMode;
    await app.close();
  });

  it('Journey 1: PDP → cart → COD → Hub → delivery → cash settlement, with its negative cases', async () => {
    const sku = await createSku(prisma, { price: 100 });
    const hidden = await createSku(prisma, { listed: false });
    const otherSku = await createSku(prisma);

    // PDP: the public detail of an orderable SKU renders; an unlisted one does not exist for customers and cannot be carted.
    const pdp = await http().get(`/products/${sku.slug}/detail`).query({ skuId: sku.id }).expect(200);
    expect(JSON.stringify(pdp.body)).toContain(sku.id);
    const customer = await signInCustomer(app);
    await http().post('/ordering/cart/add').set(customer.auth).send({ skuId: hidden.id, quantity: 1 }).expect(res => expect(res.status).toBeGreaterThanOrEqual(400));
    await http().post('/ordering/cart/add').set(customer.auth).send({ skuId: sku.id, quantity: 2 }).expect(201);

    // Price and address changes after the quote never silently place the order at the old terms.
    const stale = await quote(customer);
    await prisma.sellingPrice.updateMany({ where: { skuId: sku.id }, data: { amount: 110 } });
    const priceChanged = await http().post('/ordering/checkout').set(customer.auth).send(checkoutBody(stale));
    expect(priceChanged.status).toBeGreaterThanOrEqual(400);
    const fresh = await quote(customer);
    const moved = await http().post('/ordering/checkout').set(customer.auth).send(checkoutBody(fresh, randomUUID(), { area: 'Nasr City' }));
    expect(moved.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.order.count({ where: { customerId: customer.id } })).toBe(0);

    // COD checkout at the new price; a duplicate submit with the same key returns the same order, never a second one.
    const key = randomUUID();
    const placed = await http().post('/ordering/checkout').set(customer.auth).send(checkoutBody(fresh, key)).expect(201);
    const again = await http().post('/ordering/checkout').set(customer.auth).send(checkoutBody(fresh, key));
    expect(again.status).toBeLessThan(300);
    expect(again.body.id).toBe(placed.body.id);
    expect(await prisma.order.count({ where: { customerId: customer.id } })).toBe(1);
    const order = placed.body as Placed;
    expect(Number(order.totalAmount)).toBe(270); // 2 × 110 + 50 delivery
    expect(Number(order.codAmount)).toBe(270);
    await awaitDemand(order);
    const stranger = await signInCustomer(app);
    await http().get(`/ordering/orders/${order.orderNumber}/tracking`).set(stranger.auth).expect(res => expect([403, 404]).toContain(res.status));

    // Hub: nothing is on the desk until something is bought; purchases are partial and are never receipt.
    expect(await desk(order.id)).toBeUndefined();
    expect(await buyRow(sku)).toMatchObject({ toBuy: 2, orderCount: 1 });
    await http().get('/buy-list').set(driver.auth).expect(403);
    await buy(sku, 3).expect(409); // more than is outstanding
    await buy(sku, 2).expect(200); // one purchase for both units: they share one actual cost
    expect(await net(order.id)).toBe(0);
    expect((await desk(order.id))!.lines[0]).toMatchObject({ required: 2, purchased: 2, received: 0 });

    // Wrong product and unknown code change nothing (both are recorded at order level). Expiry is not asked in the preparation flow.
    expect((await scan(order.id, { barcodeScanned: otherSku.barcode, expiryDate: EXPIRY }).expect(201)).body).toMatchObject({ outcome: 'rejected', code: 'WRONG_ITEM' });
    expect((await scan(order.id, { barcodeScanned: '0000000000000', expiryDate: EXPIRY }).expect(201)).body).toMatchObject({ outcome: 'rejected', code: 'PRODUCT_IDENTITY_REVIEW_REQUIRED' });
    expect(await net(order.id)).toBe(0);
    expect(await prisma.hubScanAttempt.count({ where: { orderId: order.id } })).toBe(2);

    // Scan 1 captures the actual cost at receipt; a different price for the same purchase is refused; the next unit is not bought yet.
    const one = await scan(order.id, { barcodeScanned: sku.barcode, expiryDate: EXPIRY, lotNumber: 'LOT-1', cost: { listUnitPrice: 100, discountPerUnit: 10 } }).expect(201);
    expect(one.body.outcome).toBe('received');
    // Another hub's operator can neither scan nor see this desk.
    await scan(order.id, { barcodeScanned: sku.barcode, expiryDate: EXPIRY }, otherHub.auth).expect(403);
    await scan(order.id, { barcodeScanned: sku.barcode, expiryDate: EXPIRY, cost: { listUnitPrice: 130 } }).expect(409).expect(res => expect(res.body.code).toBe('COST_MISMATCH'));
    expect(await net(order.id)).toBe(1);
    const two = await scan(order.id, { barcodeScanned: sku.barcode, expiryDate: EXPIRY, lotNumber: 'LOT-1' }).expect(201);
    expect(two.body.order).toMatchObject({ stage: 'packing', shipment: { status: 'prepared' } });
    expect(await net(order.id)).toBe(2);

    // The employee notices a slip: the committed scan is corrected with a compensating event, then scanned again.
    const unit = two.body.order.units[0] as { receiptId: string };
    await http().post(`/fulfillment/locations/${locationId}/desk/receipts/${unit.receiptId}/reverse`).set(hub.auth)
      .send({ idempotencyKey: randomUUID(), reason: 'DUPLICATE_SCAN', note: 'box scanned twice by mistake' }).expect(201);
    expect(await net(order.id)).toBe(1);
    expect((await desk(order.id))!.shipment!.status).toBe('pending');
    const rescanned = await scan(order.id, { barcodeScanned: sku.barcode, expiryDate: EXPIRY, lotNumber: 'LOT-1' }).expect(201);
    expect(rescanned.body.order).toMatchObject({ stage: 'packing', shipment: { status: 'prepared' } });
    expect(await net(order.id)).toBe(2);
    const costs = await prisma.purchaseCostBatch.findMany({ where: { skuId: sku.id } });
    expect(costs.map(c => c.finalUnitCost.toFixed(2))).toEqual(['90.00']); // recorded once per purchase, derived from list − discount

    // Print and pack, then hand to the driver; the parcel cannot be corrected any more.
    const shipmentId = rescanned.body.order.shipment.id as string;
    const barcode = await printAndPack(shipmentId);
    await http().post(`/fulfillment/locations/${locationId}/desk/receipts/${(await prisma.fulfillmentReceipt.findFirstOrThrow({ where: { orderId: order.id, reversesReceiptId: null, reversal: { is: null } } })).id}/reverse`)
      .set(hub.auth).send({ idempotencyKey: randomUUID(), reason: 'OTHER', note: 'too late to correct' }).expect(409);
    await http().get(`/fulfillment/shipments/${shipmentId}`).set(otherDriver.auth).expect(404);
    await run('Journey 1 run', [{ id: shipmentId, barcode }]);
    expect(JSON.stringify((await http().get('/fulfillment/driver/runs').set(otherDriver.auth).expect(200)).body)).not.toContain(shipmentId);

    // Delivery: staff cannot fake a COD delivery; the driver declares the exact cash; replays do not double count.
    expect((await http().patch(`/fulfillment/shipments/${shipmentId}/status`).set(admin.auth).send({ status: 'delivered' }).expect(409)).body.code).toBe('COD_DELIVERY_REQUIRES_DRIVER');
    await event(shipmentId, driver, { type: 'DELIVERED' }).expect(400);
    await event(shipmentId, driver, { type: 'DELIVERED', collectedAmount: 270 }).expect(201);
    await event(shipmentId, driver, { type: 'DELIVERED', collectedAmount: 270 }).expect(201);
    await event(shipmentId, driver, { type: 'DELIVERED', collectedAmount: 250 }).expect(409);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('delivered');
    expect(await prisma.paymentCollection.findUniqueOrThrow({ where: { orderId: order.id } })).toMatchObject({ status: 'collected', courierId: driver.id });

    // Cash: only the right hub and courier settle, exactly once, for the exact amount.
    const count = (actor: Actor, extra: Record<string, unknown> = {}) => http().post('/ordering/settlements/batch').set(actor.auth).send({
      courierId: driver.id, locationId, reference: 'J1-' + order.orderNumber, currency: 'EGP', totalCollected: 270, collections: [{ orderId: order.id, collectedAmount: 270 }], ...extra,
    });
    await count(otherHub).expect(403);
    await count(driver).expect(403);
    await count(hub, { totalCollected: 271, reference: 'J1-BAD-' + randomUUID() }).expect(res => expect(res.status).toBeGreaterThanOrEqual(400));
    const settled = await count(hub).expect(201);
    expect(settled.body.lines).toEqual([expect.objectContaining({ orderId: order.id, expectedAmount: '270.00', declaredAmount: '270.00', countedAmount: '270.00', variance: '0.00', status: 'settled' })]);
    expect((await count(hub).expect(201)).body.id).toBe(settled.body.id);
    await count(admin, { reference: 'J1-AGAIN-' + randomUUID() }).expect(409);
    expect(await prisma.courierSettlementBatch.count({ where: { collections: { some: { orderId: order.id } } } })).toBe(1);

    // Finance agrees with the order, the cash and the stock.
    const finance = (await http().get('/operations/finance/orders').query({ limit: 100 }).set(admin.auth).expect(200)).body.items as Array<{
      orderId: string; goods: number; deliveryFee: number; discounts: number; total: number; cod: { status: string; expected: number; collected: number | null } | null }>;
    const row = finance.find(r => r.orderId === order.id)!;
    expect(row).toBeTruthy();
    expect(row.goods + row.deliveryFee - row.discounts).toBeCloseTo(row.total, 2);
    expect(row.total).toBe(270);
    expect(row.cod).toMatchObject({ status: 'settled', expected: 270, collected: 270 });
    expect(await prisma.inventoryBalance.findFirstOrThrow({ where: { locationId, skuId: sku.id } })).toMatchObject({ orderAllocatedExternalGoods: 2 });
  });

  it('Journey 5: several orders → aggregated Buy List → partial purchase → Hub → delivery (failed attempt + retry) → COD round', async () => {
    const skuA = await createSku(prisma, { price: 100 });
    const skuB = await createSku(prisma, { price: 100 });
    // Oldest first: o1 and o2 are served before o3 when goods are short.
    const o1 = await place([{ sku: skuA, quantity: 2 }]);
    const o2 = await place([{ sku: skuA, quantity: 1 }, { sku: skuB, quantity: 1 }]);
    const o3 = await place([{ sku: skuB, quantity: 2 }]);

    // One aggregated list per exact SKU, across customers; staff-only.
    expect(await buyRow(skuA)).toMatchObject({ toBuy: 3, orderCount: 2, acquired: 0 });
    expect(await buyRow(skuB)).toMatchObject({ toBuy: 3, orderCount: 2, acquired: 0 });
    await http().get('/buy-list').set(o1.customer.auth).expect(403);

    // Partial purchase: all of A, only 2 of the 3 B. Retrying the same count changes nothing.
    const keyA = randomUUID();
    await buy(skuA, 3, keyA).expect(200);
    await buy(skuA, 3, keyA).expect(200);
    await buy(skuB, 2).expect(200);
    await buy(skuA, 1).expect(409);
    expect(await buyRow(skuA)).toMatchObject({ toBuy: 0, acquired: 3 });
    expect(await buyRow(skuB)).toMatchObject({ toBuy: 1, acquired: 2 });
    expect(await net(o1.order.id) + await net(o2.order.id) + await net(o3.order.id)).toBe(0); // bought is not received

    // Hub: o1 and o2 are completed by scanning, with the cost captured once per purchase.
    const costA = { listUnitPrice: 60, discountPerUnit: 0 };
    const costB = { listUnitPrice: 40, discountPerUnit: 5 };
    expect((await scan(o1.order.id, { barcodeScanned: skuA.barcode, expiryDate: EXPIRY, cost: costA }).expect(201)).body.outcome).toBe('received');
    const o1Done = await scan(o1.order.id, { barcodeScanned: skuA.barcode, expiryDate: EXPIRY }).expect(201);
    expect(o1Done.body.order).toMatchObject({ stage: 'packing', shipment: { status: 'prepared' } });
    await scan(o2.order.id, { barcodeScanned: skuA.barcode, expiryDate: EXPIRY }).expect(201);
    const o2Done = await scan(o2.order.id, { barcodeScanned: skuB.barcode, expiryDate: EXPIRY, cost: costB }).expect(201);
    expect(o2Done.body.order).toMatchObject({ stage: 'packing', shipment: { status: 'prepared' } });

    // o3 only got one of its two B units: it is held, cannot be verified or prepared, and the missing unit goes to the customer decision flow.
    const o3Part = await scan(o3.order.id, { barcodeScanned: skuB.barcode, expiryDate: EXPIRY }).expect(201);
    expect(o3Part.body.order).toMatchObject({ stage: 'waiting_purchase', shipment: { status: 'pending' } });
    await http().post(`/fulfillment/locations/${locationId}/desk/orders/${o3.order.id}/verify`).set(hub.auth).expect(409);
    await http().post(`/fulfillment/shipments/${o3Part.body.order.shipment.id}/preparation`).set(hub.auth).send({}).expect(400);
    await http().post('/buy-list/unavailable').set(hub.auth).send({ skuId: skuB.id, note: 'not in the market today' }).expect(200);
    const requirement = await prisma.supplyRequirement.findUniqueOrThrow({ where: { orderItemId: o3.order.items[0].id }, include: { actionRequirement: true } });
    expect(requirement.actionRequirement).toMatchObject({ category: 'BUY_LIST_UNAVAILABLE', unresolvedQuantity: 1 });
    expect(await buyRow(skuB)).toMatchObject({ toBuy: 0, unavailable: 1 });

    // Costs are recorded once per purchase, and none of these purchases is left pending.
    expect((await prisma.purchaseCostBatch.findMany({ where: { skuId: { in: [skuA.id, skuB.id] } }, orderBy: { skuId: 'asc' } })).map(c => c.finalUnitCost.toFixed(2)).sort()).toEqual(['35.00', '60.00']);

    // Delivery: both parcels on one run; o1 is delivered with its cash, o2's customer is unreachable, it returns to the hub and goes out again.
    const s1 = o1Done.body.order.shipment.id as string;
    const s2 = o2Done.body.order.shipment.id as string;
    const b1 = await printAndPack(s1);
    const b2 = await printAndPack(s2);
    await run('Journey 5 morning', [{ id: s1, barcode: b1 }, { id: s2, barcode: b2 }]);
    await event(s1, driver, { type: 'DELIVERED', collectedAmount: Number(o1.order.codAmount) }).expect(201);
    await event(s2, driver, { type: 'FAILED', reasonCode: 'CUSTOMER_UNREACHABLE' }).expect(201);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o2.order.id } })).status).toBe('shipped');
    await event(s2, driver, { type: 'RECEIVED_BACK', barcode: b2 }).expect(403); // only the hub takes a parcel back
    await event(s2, hub, { type: 'RECEIVED_BACK' }).expect(400);
    await event(s2, hub, { type: 'RECEIVED_BACK', barcode: b2 }).expect(201);
    await run('Journey 5 evening', [{ id: s2, barcode: b2 }]);
    await event(s2, driver, { type: 'DELIVERED', collectedAmount: Number(o2.order.codAmount) }).expect(201);
    expect((await prisma.deliveryStop.findMany({ where: { shipmentId: s2 }, orderBy: { createdAt: 'asc' } })).map(s => s.status)).toEqual(['failed', 'delivered']);
    expect(await prisma.orderStatusEvent.count({ where: { orderId: o2.order.id, status: 'shipped' } })).toBe(1);

    // The open round shows exactly what was declared; the hub counts it once.
    const total = Number(o1.order.codAmount) + Number(o2.order.codAmount);
    const round = (await http().get('/ordering/settlements/rounds/open').set(hub.auth).expect(200)).body as Array<{ courierId: string; orders: number; expectedTotal: string; declaredTotal: string }>;
    expect(round.find(r => r.courierId === driver.id)).toMatchObject({ orders: 2, expectedTotal: total.toFixed(2), declaredTotal: total.toFixed(2) });
    const reference = 'J5-' + randomUUID();
    const body = { courierId: driver.id, locationId, reference, currency: 'EGP', collections: [
      { orderId: o1.order.id, collectedAmount: Number(o1.order.codAmount) }, { orderId: o2.order.id, collectedAmount: Number(o2.order.codAmount) }] };
    await http().post('/ordering/settlements/batch').set(hub.auth).send({ ...body, totalCollected: total + 5 }).expect(res => expect(res.status).toBeGreaterThanOrEqual(400));
    await http().post('/ordering/settlements/batch').set(hub.auth).send({ ...body, totalCollected: total }).expect(201);
    for (const o of [o1.order, o2.order]) {
      expect(await prisma.paymentCollection.findUniqueOrThrow({ where: { orderId: o.id } })).toMatchObject({ status: 'settled' });
    }
    const finance = (await http().get('/operations/finance/orders').query({ limit: 100 }).set(admin.auth).expect(200)).body.items as Array<{ orderId: string; total: number; cod: { status: string; collected: number | null } | null }>;
    const rows = finance.filter(r => [o1.order.id, o2.order.id, o3.order.id].includes(r.orderId));
    expect(rows.map(r => r.orderId).sort()).toEqual([o1.order.id, o2.order.id].sort()); // the held order is not a sale
    expect(rows.reduce((sum, r) => sum + (r.cod?.collected ?? 0), 0)).toBeCloseTo(total, 2);

    // o3 is cancelled: its one received unit is acknowledged, the parcel never leaves, and nothing is billed.
    const cancelled = await http().post(`/ordering/orders/${o3.order.id}/cancel`).set(admin.auth).send({ reasonCode: 'CUSTOMER_REQUEST' }).expect(201);
    expect(cancelled.body).toMatchObject({ goodsReceived: true });
    expect(await prisma.shipment.findUniqueOrThrow({ where: { orderId: o3.order.id } })).toMatchObject({ status: 'cancelled' });
  });
});
