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

type OrderableSku = { id: string; barcode: string | null; variantName: string };

const gtin = (body: number[]) => body.join('') + String((10 - (body.reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 3), 0) % 10)) % 10);
const ean13 = () => gtin(Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)));
/** The same code with one wrong check digit: a typical mistyped or half-read barcode. */
const withBadCheckDigit = (code: string) => code.slice(0, 12) + String((Number(code[12]) + 1) % 10);

async function createOrderableSku(prisma: PrismaService, price = 100): Promise<OrderableSku> {
  const suffix = randomUUID();
  const reviewer = await ensureFixtureReviewer(prisma);
  const brand = await prisma.brand.create({ data: { name: 'Prep ' + suffix, slug: 'prep-' + suffix } });
  const product = await prisma.product.create({ data: { brandId: brand.id, name: 'Prep Product', slug: 'prep-product-' + suffix, isPublished: true } });
  const barcode = ean13();
  const sku = await prisma.sku.create({ data: { productId: product.id, code: 'PREP-' + suffix, variantName: '50 ml', size: 50, sizeUnit: 'ml', barcode } });
  await prisma.productMedia.create({ data: {
    productId: product.id, type: MediaType.image, url: `https://cdn.fixtures.test/${suffix}.png`, isPrimary: true, originType: MediaOriginType.verified,
    generationMetadata: { isTest: false, reviewedBy: reviewer.id, reviewedAt: new Date().toISOString(), skuId: sku.id, barcode, size: 50, sizeUnit: 'ml',
      variantName: '50 ml', sourceType: 'OFFICIAL_MANUFACTURER', sourceUrl: FIXTURE_SOURCE_URL, identityVerification: 'BARCODE_VERIFIED' },
  } });
  await prisma.listing.create({ data: { skuId: sku.id, isListed: true } });
  await prisma.sellingPrice.create({ data: { skuId: sku.id, amount: price, currency: 'EGP', validFrom: new Date(Date.now() - 60000) } });
  return { id: sku.id, barcode, variantName: '50 ml' };
}

/**
 * Hub Orders & Preparation, the parts that make a parcel hand-off-ready: registering a missing barcode after exact verification (with
 * conflicts refused and every outcome audited), the print/packaging gate in front of "packed", per-document print failures that reopen a
 * printed paper, packaging cost snapshots, and loss-making orders flagged for an authorized review without ever touching the customer's price.
 */
describe('Hub orders & preparation: barcode registration, handoff gate, loss review (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: DomainEventsService;
  let hub: Actor; let otherHub: Actor; let driver: Actor; let admin: Actor;
  let locationId: string;
  let skuA: OrderableSku; let skuNoCode: OrderableSku; let skuC: OrderableSku; let skuLoss: OrderableSku; let skuFine: OrderableSku;
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
      ...address, customerName: 'Prep Customer', customerPhone: '01012345678', shippingAddress: '12 Road 9, Maadi',
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
  const register = (orderId: string, body: Record<string, unknown>, auth = hub.auth) =>
    http().post(`/fulfillment/locations/${locationId}/desk/orders/${orderId}/register-barcode`).set(auth)
      .send({ clientScanId: randomUUID(), checks: ['brand', 'variant', 'size', 'pack'], note: 'Compared the pack with the order line', ...body });
  const deskOrder = async (orderId: string) => {
    const desk = (await http().get(`/fulfillment/locations/${locationId}/desk`).set(hub.auth).expect(200)).body as { orders: any[] };
    return desk.orders.find(o => o.orderId === orderId);
  };
  const shipmentEvent = (shipmentId: string, body: Record<string, unknown>, auth = hub.auth) => http().post(`/fulfillment/shipments/${shipmentId}/events`).set(auth).send(body);
  const reviewCases = (orderId: string) => prisma.supportCase.findMany({ where: { orderId, title: { startsWith: 'Loss-making order' } } });
  /** A one-line order bought, costed and scanned in until the desk has verified it (shipment `prepared`). */
  const verifiedOrder = async (sku: OrderableSku, cost: { listUnitPrice: number; discountPerUnit?: number }) => {
    const order = await checkout([{ sku, quantity: 1 }]);
    await buy(sku, 1);
    const received = await scan(order.id, { barcodeScanned: sku.barcode, expiryDate: EXPIRY, cost }).expect(201);
    expect(received.body.order).toMatchObject({ stage: 'packing', shipment: { status: 'prepared' } });
    return { order, shipmentId: received.body.order.shipment.id as string };
  };

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
    admin = await createActor(prisma, Role.ADMIN);
    locationId = (await prisma.fulfillmentLocation.create({ data: { name: 'Prep Hub ' + randomUUID(), address: '1 Hub Street' } })).id;
    await prisma.fulfillmentLocationOperator.create({ data: { locationId, operatorId: hub.id } });
    const elsewhere = await prisma.fulfillmentLocation.create({ data: { name: 'Other Hub ' + randomUUID(), address: '2 Hub Street' } });
    await prisma.fulfillmentLocationOperator.create({ data: { locationId: elsewhere.id, operatorId: otherHub.id } });
    skuA = await createOrderableSku(prisma);
    skuNoCode = await createOrderableSku(prisma);
    skuC = await createOrderableSku(prisma);
    skuLoss = await createOrderableSku(prisma);
    skuFine = await createOrderableSku(prisma);
    setRuntimeSetting(SETTING_KEYS.bagCost, 5);
    setRuntimeSetting(SETTING_KEYS.boxCost, 12);
  });

  afterAll(async () => {
    clearRuntimeSetting(SETTING_KEYS.bagCost);
    clearRuntimeSetting(SETTING_KEYS.boxCost);
    if (previousMode === undefined) delete process.env.SOURCING_MODE; else process.env.SOURCING_MODE = previousMode;
    await app.close();
  });

  it('registers a missing barcode only after exact verification, refuses every conflict, audits each outcome, then scans normally', async () => {
    const order = await checkout([{ sku: skuNoCode, quantity: 1 }, { sku: skuA, quantity: 1 }]);
    // The storefront only sells products with a verified barcode, so the code goes missing afterwards (a catalog fix, a re-import): the desk must cope by hand.
    await prisma.sku.update({ where: { id: skuNoCode.id }, data: { barcode: null } });
    skuNoCode.barcode = null;
    await buy(skuNoCode, 1);
    await buy(skuA, 1);
    expect((await deskOrder(order.id)).lines.find((l: any) => l.skuId === skuNoCode.id).barcode).toBeNull();

    // The physical pack carries a code the catalog does not know: the scan is refused and nothing is received.
    const code = ean13();
    const unknown = await scan(order.id, { barcodeScanned: code, expiryDate: EXPIRY }).expect(201);
    expect(unknown.body).toMatchObject({ outcome: 'rejected', code: 'PRODUCT_IDENTITY_REVIEW_REQUIRED' });
    expect(await prisma.fulfillmentReceipt.count({ where: { orderId: order.id } })).toBe(0);

    // Verification must be complete and the actors must belong to this Hub.
    await register(order.id, { skuId: skuNoCode.id, barcode: code, checks: ['brand', 'variant', 'size'] }).expect(400).expect(res => expect(res.body.code).toBe('CHECKS_INCOMPLETE'));
    await register(order.id, { skuId: skuNoCode.id, barcode: code, note: 'x' }).expect(400);
    await register(order.id, { skuId: skuNoCode.id, barcode: code }, otherHub.auth).expect(403);
    await register(order.id, { skuId: skuNoCode.id, barcode: code }, driver.auth).expect(403);
    await http().post(`/fulfillment/locations/${locationId}/desk/orders/${order.id}/register-barcode`).send({}).expect(401);

    // Refusals: mistyped code, a product that is not in this order, a code that belongs to another product, a SKU that already has a code.
    await register(order.id, { skuId: skuNoCode.id, barcode: withBadCheckDigit(code) }).expect(409).expect(res => expect(res.body.code).toBe('INVALID_BARCODE'));
    await register(order.id, { skuId: skuC.id, barcode: code }).expect(409).expect(res => expect(res.body.code).toBe('WRONG_ITEM'));
    await register(order.id, { skuId: skuNoCode.id, barcode: skuA.barcode }).expect(409).expect(res => expect(res.body.code).toBe('BARCODE_ALREADY_USED'));
    await register(order.id, { skuId: skuA.id, barcode: code }).expect(409).expect(res => expect(res.body.code).toBe('SKU_ALREADY_HAS_BARCODE'));
    expect(await prisma.skuBarcodeAlias.count({ where: { OR: [{ skuId: skuNoCode.id }, { skuId: skuA.id }] } })).toBe(0);
    expect((await prisma.sku.findUniqueOrThrow({ where: { id: skuNoCode.id } })).barcode).toBeNull();

    // Registered: an approved alias of that one SKU with the actor and the evidence kept; the catalog's own identity is untouched.
    const clientScanId = randomUUID();
    const done = await register(order.id, { clientScanId, skuId: skuNoCode.id, barcode: code }).expect(201);
    expect(done.body).toMatchObject({ registered: true, replayed: false, skuId: skuNoCode.id, barcode: code });
    const alias = await prisma.skuBarcodeAlias.findFirstOrThrow({ where: { skuId: skuNoCode.id } });
    expect(alias).toMatchObject({ barcode: code, status: 'approved', source: 'hub_registration', approvedBy: hub.id, evidenceRef: `hub-desk:${order.id}` });
    expect(alias.reason).toContain('brand, variant, size, pack');
    expect((await prisma.sku.findUniqueOrThrow({ where: { id: skuNoCode.id } })).barcode).toBeNull();
    const again = await register(order.id, { clientScanId, skuId: skuNoCode.id, barcode: code }).expect(201);
    expect(again.body).toMatchObject({ registered: true, replayed: true });
    expect(await prisma.skuBarcodeAlias.count({ where: { skuId: skuNoCode.id } })).toBe(1);
    // The product now has its code: a second registration (same or different code) is refused, so a code can never be swapped from the desk.
    await register(order.id, { skuId: skuNoCode.id, barcode: code }).expect(409).expect(res => expect(res.body.code).toBe('SKU_ALREADY_HAS_BARCODE'));

    // Every outcome is on the order's audit trail, and the new code now scans like any other.
    const outcomes = (await prisma.hubScanAttempt.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } })).map(a => a.outcomeCode);
    expect(outcomes).toEqual(expect.arrayContaining(['PRODUCT_IDENTITY_REVIEW_REQUIRED', 'REGISTER_INVALID_BARCODE', 'REGISTER_WRONG_ITEM', 'REGISTER_BARCODE_ALREADY_USED', 'REGISTER_SKU_ALREADY_HAS_BARCODE', 'BARCODE_REGISTERED']));
    const received = await scan(order.id, { barcodeScanned: code, expiryDate: EXPIRY }).expect(201);
    expect(received.body).toMatchObject({ outcome: 'received', skuId: skuNoCode.id });
    const second = await scan(order.id, { barcodeScanned: code, expiryDate: EXPIRY }).expect(201);
    expect(second.body.outcome).toBe('rejected'); // excess / duplicate scan changes nothing
    expect(await prisma.fulfillmentReceipt.aggregate({ where: { orderId: order.id, skuId: skuNoCode.id }, _sum: { quantity: true } }).then(r => r._sum.quantity)).toBe(1);
  });

  it('refuses to mark a parcel packed until it is verified, printed and its packaging is recorded; a later print failure reopens the paper', async () => {
    const { order, shipmentId } = await verifiedOrder(skuFine, { listUnitPrice: 40 });
    const line = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    const priceBefore = { price: line.price.toString(), lineTotal: line.lineTotal?.toString() };

    // Nothing printed yet: the typed conflict tells the desk exactly what is missing.
    await shipmentEvent(shipmentId, { type: 'PACKED' }).expect(409).expect(res => expect(res.body.code).toBe('LABEL_NOT_GENERATED'));
    await http().post(`/fulfillment/shipments/${shipmentId}/label`).set(hub.auth).expect(201);
    await shipmentEvent(shipmentId, { type: 'PACKED' }).expect(409).expect(res => expect(res.body).toMatchObject({ code: 'PRINT_NOT_CONFIRMED', print: { receipt: 'pending', label: 'pending', ready: false } }));
    // A failure has to say what happened and which paper; PRINT_FAILED's document is meaningless on other events.
    await shipmentEvent(shipmentId, { type: 'PRINT_FAILED' }).expect(400);
    await shipmentEvent(shipmentId, { type: 'RECEIPT_PRINTED', document: 'LABEL' }).expect(400);
    await shipmentEvent(shipmentId, { type: 'RECEIPT_PRINTED' }).expect(201);
    await shipmentEvent(shipmentId, { type: 'PACKED' }).expect(409).expect(res => expect(res.body.code).toBe('PRINT_NOT_CONFIRMED'));
    await shipmentEvent(shipmentId, { type: 'LABEL_PRINTED' }).expect(201);
    // Printed, but no packaging recorded for the order.
    await shipmentEvent(shipmentId, { type: 'PACKED' }).expect(409).expect(res => expect(res.body.code).toBe('PACKAGING_NOT_RECORDED'));
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })).status).toBe('prepared');

    // The slip jams afterwards: the label is no longer counted as printed, the receipt still is, and the desk shows why.
    await shipmentEvent(shipmentId, { type: 'PRINT_FAILED', document: 'LABEL', notes: 'label printer jammed' }).expect(201);
    expect((await deskOrder(order.id)).print).toMatchObject({ receipt: 'printed', label: 'failed', ready: false, lastFailure: { document: 'LABEL', note: 'label printer jammed' } });
    await http().put(`/order-costs/${order.id}`).set(hub.auth).send({ packagingType: 'BAG' }).expect(200).expect(res => expect(res.body).toMatchObject({ packagingType: 'BAG', packagingCost: '5.00' }));
    await shipmentEvent(shipmentId, { type: 'PACKED' }).expect(409).expect(res => expect(res.body.code).toBe('PRINT_NOT_CONFIRMED'));
    await shipmentEvent(shipmentId, { type: 'LABEL_PRINTED' }).expect(201);
    expect((await deskOrder(order.id)).print).toMatchObject({ receipt: 'printed', label: 'printed', ready: true, lastFailure: null });

    // Packaging recorded by the hub cannot be swapped by the hub afterwards; the recorded cost is a snapshot.
    await http().put(`/order-costs/${order.id}`).set(hub.auth).send({ packagingType: 'BOX' }).expect(409).expect(res => expect(res.body.code).toBe('COST_ALREADY_RECORDED'));
    setRuntimeSetting(SETTING_KEYS.bagCost, 9);
    expect((await http().get(`/order-costs/${order.id}`).set(hub.auth).expect(200)).body).toMatchObject({ packagingType: 'BAG', packagingCost: '5.00' });
    setRuntimeSetting(SETTING_KEYS.bagCost, 5);

    // Ready: packed once, and a replay is a harmless no-op.
    await shipmentEvent(shipmentId, { type: 'PACKED' }).expect(201);
    await shipmentEvent(shipmentId, { type: 'PACKED' }).expect(201);
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })).status).toBe('packed');
    expect(await prisma.shipmentEvent.count({ where: { shipmentId, type: 'PACKED' } })).toBe(1);

    // A profitable order is never flagged, and the customer's confirmed price never moved.
    expect(await reviewCases(order.id)).toHaveLength(0);
    const lineAfter = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect({ price: lineAfter.price.toString(), lineTotal: lineAfter.lineTotal?.toString() }).toEqual(priceBefore);
    // Margin is Admin-only; the Hub records costs but does not see profit. 100 − 40 − 5 = 55 so far; the courier cost is still to come.
    await http().get(`/order-costs/${order.id}/profitability`).set(hub.auth).expect(403);
    expect((await http().get(`/order-costs/${order.id}/profitability`).set(admin.auth).expect(200)).body)
      .toMatchObject({ state: 'PENDING_COSTS', complete: false, missing: ['COURIER_COST'], goodsNet: '100.00', marginSoFar: '55.00', costs: { purchase: '40.00', packaging: '5.00', companyFundedDelivery: null } });
    await http().put(`/order-costs/${order.id}`).set(hub.auth).send({ courierCost: 50 }).expect(200);
    expect((await http().get(`/order-costs/${order.id}/profitability`).set(admin.auth).expect(200)).body)
      .toMatchObject({ state: 'PROFIT', complete: true, marginSoFar: '55.00', costs: { companyFundedDelivery: '0.00' } });
  });

  it('flags a loss-making order once for an authorized review, never blocks the parcel and never changes the customer price', async () => {
    // Sold for 100, bought for 150 (list 160, 10 discount): a loss before packaging and delivery are even counted.
    const { order, shipmentId } = await verifiedOrder(skuLoss, { listUnitPrice: 160, discountPerUnit: 10 });
    const line = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    const priceBefore = { price: line.price.toString(), lineTotal: line.lineTotal?.toString(), total: (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).totalAmount.toString() };

    expect((await http().get(`/order-costs/${order.id}/profitability`).set(admin.auth).expect(200)).body).toMatchObject({ state: 'LOSS', marginSoFar: '-50.00', costs: { purchase: '150.00' } });
    await http().post(`/fulfillment/shipments/${shipmentId}/label`).set(hub.auth).expect(201);
    await shipmentEvent(shipmentId, { type: 'RECEIPT_PRINTED' }).expect(201);
    await shipmentEvent(shipmentId, { type: 'LABEL_PRINTED' }).expect(201);
    expect(await reviewCases(order.id)).toHaveLength(0); // nothing recorded as a cost on the order yet: no flag from a bare read
    await http().put(`/order-costs/${order.id}`).set(hub.auth).send({ packagingType: 'BAG' }).expect(200);
    const opened = await reviewCases(order.id);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ status: 'open', priority: 'high', category: 'sourcing' });
    expect(opened[0].description).toContain('confirmed price is unchanged');

    // The parcel is not blocked (a human reviews, the operation continues); handing it off does not duplicate the case.
    await shipmentEvent(shipmentId, { type: 'PACKED' }).expect(201);
    expect(await reviewCases(order.id)).toHaveLength(1);
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })).status).toBe('packed');

    // Nothing the customer agreed to moved, and the Hub cannot open the margin view.
    const after = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect({ price: after.price.toString(), lineTotal: after.lineTotal?.toString(), total: (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).totalAmount.toString() }).toEqual(priceBefore);
    await http().get(`/order-costs/${order.id}/profitability`).set(hub.auth).expect(403);
  });

  it('keeps the desk response honest about printing for an order that is not packed yet', async () => {
    const order = await checkout([{ sku: skuC, quantity: 1 }]);
    await buy(skuC, 1);
    const received = await scan(order.id, { barcodeScanned: skuC.barcode, expiryDate: EXPIRY }).expect(201);
    expect(received.body).toMatchObject({ outcome: 'received' });
    const view = received.body.order;
    expect(view).toMatchObject({ stage: 'packing', print: { receipt: 'pending', label: 'pending', labelGenerated: false, ready: false, lastFailure: null } });
    // Cost entry stays optional at receipt; a purchase whose cost was deferred stays on the pending-costs list, never counted as zero.
    const pending = (await http().get('/buy-list/costs?pending=true&take=100').set(hub.auth).expect(200)).body;
    expect(pending.items.find((row: any) => row.skuId === skuC.id)).toMatchObject({ cost: null });
  });
});
