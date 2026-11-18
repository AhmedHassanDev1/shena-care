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
import { signInCustomer } from '../fixtures/checkout';
import { ensureFixtureReviewer, FIXTURE_SOURCE_URL } from '../fixtures/sellable-sku';

type OrderableSku = { id: string; barcode: string; variantName: string };

function ean13() {
  const body = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  const sum = body.reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 3), 0);
  return body.join('') + String((10 - (sum % 10)) % 10);
}

/** A SKU the storefront really sells (published, identity-reviewed media, listing and price). Same fixture as the purchase-batch suite. */
async function createOrderableSku(prisma: PrismaService): Promise<OrderableSku> {
  const suffix = randomUUID();
  const reviewer = await ensureFixtureReviewer(prisma);
  const brand = await prisma.brand.create({ data: { name: 'Desk ' + suffix, slug: 'desk-' + suffix } });
  const product = await prisma.product.create({ data: { brandId: brand.id, name: 'Desk Product', slug: 'desk-product-' + suffix, isPublished: true } });
  const barcode = ean13();
  const sku = await prisma.sku.create({ data: { productId: product.id, code: 'DESK-' + suffix, variantName: '50 ml', size: 50, sizeUnit: 'ml', barcode } });
  await prisma.productMedia.create({ data: {
    productId: product.id, type: MediaType.image, url: `https://cdn.fixtures.test/${suffix}.png`, isPrimary: true, originType: MediaOriginType.verified,
    generationMetadata: { isTest: false, reviewedBy: reviewer.id, reviewedAt: new Date().toISOString(), skuId: sku.id, barcode, size: 50, sizeUnit: 'ml',
      variantName: '50 ml', sourceType: 'OFFICIAL_MANUFACTURER', sourceUrl: FIXTURE_SOURCE_URL, identityVerification: 'BARCODE_VERIFIED' },
  } });
  await prisma.listing.create({ data: { skuId: sku.id, isListed: true } });
  await prisma.sellingPrice.create({ data: { skuId: sku.id, amount: 100, currency: 'EGP', validFrom: new Date(Date.now() - 60000) } });
  return { id: sku.id, barcode, variantName: '50 ml' };
}

type DeskLine = { skuId: string; required: number; purchased: number; received: number; verified: number };
type DeskOrder = { orderId: string; stage: string; shipment: { id: string; status: string } | null; lines: DeskLine[] };

/**
 * One-person Hub desk (GLO-315) on persisted data: real checkouts → Buy List purchases (partial) → ONE scan per unit that
 * receives it against the exact order line and verifies it for the order → prepared, ready to pack. Wrong, unknown,
 * duplicate, retried, not-yet-bought and expiry-less scans change nothing; access is Hub-scoped.
 */
describe('Hub desk: scan once = receipt + verification (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: DomainEventsService;
  let hub: Actor; let otherHub: Actor; let driver: Actor;
  let locationId: string;
  let skuA: OrderableSku; let skuB: OrderableSku; let skuC: OrderableSku;
  const previousMode = process.env.SOURCING_MODE;
  const http = () => request(app.getHttpServer());
  const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const EXPIRY = '2031-12-31';

  const checkout = async (lines: Array<{ sku: OrderableSku; quantity: number }>) => {
    const customer = await signInCustomer(app);
    const address = { governorate: 'Cairo', area: 'Maadi' };
    for (const line of lines) await http().post('/ordering/cart/add').set(customer.auth).send({ skuId: line.sku.id, quantity: line.quantity }).expect(201);
    const quote = (await http().post('/ordering/checkout/quote').set(customer.auth).send(address).expect(201)).body;
    const placed = await http().post('/ordering/checkout').set(customer.auth).send({
      ...address, customerName: 'Desk Customer', customerPhone: '01012345678', shippingAddress: '12 Road 9, Maadi',
      latitude: 29.9602, longitude: 31.2569, locationSource: 'map_pin', locationConfirmed: true,
      quoteVersion: quote.quoteVersion, cartRevision: quote.revision, idempotencyKey: randomUUID(),
    }).expect(201);
    const order = placed.body as { id: string; items: Array<{ id: string; skuId: string }> };
    await events.dispatchPending({ aggregateId: order.id });
    for (let attempt = 0; attempt < 100; attempt++) {
      const found = await prisma.supplyRequirement.count({ where: { orderItemId: { in: order.items.map(i => i.id) } } });
      if (found === order.items.length) break;
      await pause(100);
      await events.dispatchPending({ aggregateId: order.id });
    }
    return order;
  };
  const buy = (sku: OrderableSku, quantity: number) =>
    http().post('/buy-list/acquire').set(hub.auth).send({ skuId: sku.id, quantity, idempotencyKey: randomUUID() }).expect(200);
  const scan = (orderId: string, body: Record<string, unknown>, auth = hub.auth) =>
    http().post(`/fulfillment/locations/${locationId}/desk/orders/${orderId}/scan`).set(auth).send({ clientScanId: randomUUID(), ...body });
  const deskOrder = async (orderId: string) => {
    const desk = (await http().get(`/fulfillment/locations/${locationId}/desk`).set(hub.auth).expect(200)).body as { orders: DeskOrder[]; lastLots: Record<string, { lotNumber: string | null; expiryDate: string }> };
    return { order: desk.orders.find(o => o.orderId === orderId), lastLots: desk.lastLots };
  };
  const line = (order: DeskOrder | undefined, sku: OrderableSku) => order!.lines.find(l => l.skuId === sku.id)!;
  const receiptCount = (orderId: string) => prisma.fulfillmentReceipt.aggregate({ where: { orderId }, _sum: { quantity: true } }).then(r => r._sum.quantity ?? 0);

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
    driver = await createActor(prisma, Role.DRIVER);
    locationId = (await prisma.fulfillmentLocation.create({ data: { name: 'Desk Hub ' + randomUUID(), address: '1 Hub Street' } })).id;
    await prisma.fulfillmentLocationOperator.create({ data: { locationId, operatorId: hub.id } });
    const elsewhere = await prisma.fulfillmentLocation.create({ data: { name: 'Other Hub ' + randomUUID(), address: '2 Hub Street' } });
    await prisma.fulfillmentLocationOperator.create({ data: { locationId: elsewhere.id, operatorId: otherHub.id } });
    skuA = await createOrderableSku(prisma);
    skuB = await createOrderableSku(prisma);
    skuC = await createOrderableSku(prisma);
  });

  afterAll(async () => {
    if (previousMode === undefined) delete process.env.SOURCING_MODE; else process.env.SOURCING_MODE = previousMode;
    await app.close();
  });

  it('receives and verifies each unit with one scan, through partial purchases, rejections and retries', async () => {
    const order = await checkout([{ sku: skuA, quantity: 2 }, { sku: skuB, quantity: 1 }]);

    // Nothing bought yet: the order waits on the Purchases checklist; a scan cannot invent a receipt.
    expect((await deskOrder(order.id)).order).toBeUndefined();
    const early = await scan(order.id, { barcodeScanned: skuA.barcode, expiryDate: EXPIRY }).expect(201);
    expect(early.body).toMatchObject({ outcome: 'rejected', code: 'NOT_PURCHASED_YET' });

    // Partial purchase: A 1 of 2, B 1 of 1. Purchase is a record, never a receipt.
    await buy(skuA, 1);
    await buy(skuB, 1);
    let view = (await deskOrder(order.id)).order;
    expect(view).toMatchObject({ stage: 'receiving', shipment: null });
    expect(line(view, skuA)).toMatchObject({ required: 2, purchased: 1, received: 0, verified: 0 });
    expect(line(view, skuB)).toMatchObject({ required: 1, purchased: 1, received: 0 });
    expect(await receiptCount(order.id)).toBe(0);

    // Unknown code and a real product that is not in this order are rejected without any receipt.
    const unknown = await scan(order.id, { barcodeScanned: '0000000000000', expiryDate: EXPIRY }).expect(201);
    expect(unknown.body).toMatchObject({ outcome: 'rejected', code: 'PRODUCT_IDENTITY_REVIEW_REQUIRED' });
    const wrong = await scan(order.id, { barcodeScanned: skuC.barcode, expiryDate: EXPIRY }).expect(201);
    expect(wrong.body).toMatchObject({ outcome: 'rejected', code: 'WRONG_ITEM', skuId: skuC.id });
    // Expiry is not asked in the preparation flow, but a date that is supplied still has to meet the minimum shelf life (short-dated = receiving exception).
    const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    await scan(order.id, { barcodeScanned: skuA.barcode, expiryDate: soon }).expect(400).expect(res => expect(res.body.code).toBe('RECEIVING_EXCEPTION'));
    expect(await receiptCount(order.id)).toBe(0);
    // Refused scans are recorded at order level even though no shipment exists yet, and changed no quantity.
    expect(await prisma.shipment.count({ where: { orderId: order.id } })).toBe(0);
    expect((await prisma.hubScanAttempt.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } })).map(a => a.outcomeCode))
      .toEqual(['NOT_PURCHASED_YET', 'PRODUCT_IDENTITY_REVIEW_REQUIRED', 'WRONG_ITEM']);

    // First A unit: received against the exact line. A retry of the same physical scan replays, never double-counts.
    const scanId = randomUUID();
    const first = await scan(order.id, { clientScanId: scanId, barcodeScanned: skuA.barcode, expiryDate: EXPIRY, lotNumber: 'LOT-A1' }).expect(201);
    expect(first.body).toMatchObject({ outcome: 'received', skuId: skuA.id });
    expect(line(first.body.order, skuA)).toMatchObject({ purchased: 1, received: 1 });
    const retry = await scan(order.id, { clientScanId: scanId, barcodeScanned: skuA.barcode, expiryDate: EXPIRY, lotNumber: 'LOT-A1' }).expect(201);
    expect(retry.body.outcome).toBe('received');
    expect(await receiptCount(order.id)).toBe(1);
    // Another A scan before the second unit is bought: duplicate of what is physically here, nothing changes.
    const dup = await scan(order.id, { barcodeScanned: skuA.barcode, expiryDate: EXPIRY }).expect(201);
    expect(dup.body).toMatchObject({ outcome: 'rejected', code: 'NOT_PURCHASED_YET' });
    expect(await receiptCount(order.id)).toBe(1);
    const shipment = await prisma.shipment.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(shipment.status).toBe('pending');
    expect(await prisma.hubScanAttempt.count({ where: { orderId: order.id, outcomeCode: 'NOT_PURCHASED_YET' } })).toBe(2);
    // The lot/expiry just recorded is offered for the next unit of the same SKU.
    expect((await deskOrder(order.id)).lastLots[skuA.id]).toMatchObject({ lotNumber: 'LOT-A1', expiryDate: EXPIRY });

    // B arrives. The order still lacks one A, so it waits for that purchase.
    await scan(order.id, { barcodeScanned: skuB.barcode, expiryDate: EXPIRY }).expect(201).expect(res => expect(res.body.outcome).toBe('received'));
    view = (await deskOrder(order.id)).order;
    expect(view).toMatchObject({ stage: 'waiting_purchase' });

    // Second A bought and scanned: the order is complete, the receipt scans verify it, preparation completes by itself.
    await buy(skuA, 1);
    const last = await scan(order.id, { barcodeScanned: skuA.barcode, expiryDate: EXPIRY, lotNumber: 'LOT-A1' }).expect(201);
    expect(last.body.outcome).toBe('received');
    expect(last.body.order).toMatchObject({ stage: 'packing', shipment: { status: 'prepared' } });
    expect(line(last.body.order, skuA)).toMatchObject({ required: 2, received: 2, verified: 2 });
    expect(line(last.body.order, skuB)).toMatchObject({ required: 1, received: 1, verified: 1 });
    const session = await prisma.shipmentPreparationSession.findFirstOrThrow({ where: { shipmentId: shipment.id }, include: { scanEvents: true } });
    expect(session.status).toBe('completed');
    expect(session.scanEvents.filter(e => e.isSuccessful)).toHaveLength(3);
    expect(session.scanEvents.every(e => e.clientScanId?.startsWith('rcpt:') && e.verificationMethod === 'primary_barcode')).toBe(true);
    expect(await prisma.shipmentEvent.count({ where: { shipmentId: shipment.id, type: 'VERIFIED_BY_RECEIPT_SCAN' } })).toBe(1);
    expect(await receiptCount(order.id)).toBe(3);

    // Once verified, further scans are refused and stock is untouched; verify again is a harmless no-op.
    const after = await scan(order.id, { barcodeScanned: skuA.barcode, expiryDate: EXPIRY }).expect(201);
    expect(after.body).toMatchObject({ outcome: 'rejected', code: 'PACKING_STARTED' });
    await http().post(`/fulfillment/locations/${locationId}/desk/orders/${order.id}/verify`).set(hub.auth).expect(201);
    expect(await prisma.preparationScanEvent.count({ where: { sessionId: session.id } })).toBe(3);
    expect(await receiptCount(order.id)).toBe(3);

    // The existing print/pack flow continues from the same shipment.
    await http().post(`/fulfillment/shipments/${shipment.id}/label`).set(hub.auth).expect(201);
  });

  it('verifies an order received earlier on the old receiving desk without re-scanning, exactly once', async () => {
    const order = await checkout([{ sku: skuB, quantity: 2 }]);
    await buy(skuB, 2);
    const receivables = (await http().get(`/fulfillment/locations/${locationId}/receivables`).set(hub.auth).expect(200)).body as Array<{
      allocationId: string; orderId: string; orderItemId: string; remainingQuantity: number }>;
    for (const row of receivables.filter(r => r.orderId === order.id)) {
      await http().post('/fulfillment/receipts').set(hub.auth).send({
        locationId, allocationId: row.allocationId, orderId: order.id, orderItemId: row.orderItemId, skuId: skuB.id,
        variantName: skuB.variantName, quantity: row.remainingQuantity, condition: 'ACCEPTABLE', expiryDate: EXPIRY,
        idempotencyKey: randomUUID(), barcodeScanned: skuB.barcode,
      }).expect(201);
    }
    expect((await deskOrder(order.id)).order).toMatchObject({ stage: 'verifying', shipment: { status: 'ready_to_prepare' } });
    // Concurrent verify clicks end in one completed session with exactly two verification events.
    await Promise.all([1, 2, 3].map(() => http().post(`/fulfillment/locations/${locationId}/desk/orders/${order.id}/verify`).set(hub.auth)));
    const view = (await deskOrder(order.id)).order;
    expect(view).toMatchObject({ stage: 'packing', shipment: { status: 'prepared' } });
    expect(line(view, skuB)).toMatchObject({ required: 2, received: 2, verified: 2 });
    const sessions = await prisma.shipmentPreparationSession.findMany({ where: { shipmentId: view!.shipment!.id }, include: { scanEvents: true } });
    expect(sessions.filter(s => s.status === 'completed')).toHaveLength(1);
    expect(sessions.flatMap(s => s.scanEvents).filter(e => e.isSuccessful)).toHaveLength(2);
  });

  it('keeps the desk Hub-scoped and refuses cancelled orders', async () => {
    const order = await checkout([{ sku: skuC, quantity: 1 }]);
    await buy(skuC, 1);
    await http().get(`/fulfillment/locations/${locationId}/desk`).set(driver.auth).expect(403);
    await http().get(`/fulfillment/locations/${locationId}/desk`).set(otherHub.auth).expect(403);
    await scan(order.id, { barcodeScanned: skuC.barcode, expiryDate: EXPIRY }, otherHub.auth).expect(403);
    await scan(order.id, { barcodeScanned: skuC.barcode, expiryDate: EXPIRY }, driver.auth).expect(403);
    await http().post(`/fulfillment/locations/${locationId}/desk/orders/not-a-uuid/scan`).set(hub.auth).send({ clientScanId: randomUUID(), barcodeScanned: skuC.barcode }).expect(400);
    await scan(order.id, { barcodeScanned: skuC.barcode, expiryDate: EXPIRY, unexpected: true }).expect(400);

    await prisma.order.update({ where: { id: order.id }, data: { status: 'cancelled' } });
    const refused = await scan(order.id, { barcodeScanned: skuC.barcode, expiryDate: EXPIRY }).expect(201);
    expect(refused.body).toMatchObject({ outcome: 'rejected', code: 'ORDER_NOT_OPEN' });
    expect(await receiptCount(order.id)).toBe(0);
    expect((await deskOrder(order.id)).order).toBeUndefined();
  });
});
