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
    // Margin = goods billed after every discount + the delivery fee (revenue) − purchase − packaging − delivery cost; the fee is never netted against the courier.
    // Until the actual courier cost is recorded the quote's base fee stands in as the delivery cost (an estimate), so the margin is already known.
    const pending = (await http().get(`/order-costs/${order.id}/profitability`).set(admin.auth).expect(200)).body;
    const fee = Number(pending.customerDeliveryFee);
    expect(pending).toMatchObject({ state: 'PROFIT', complete: true, missing: [], goodsNet: '100.00', costs: { purchase: '40.00', packaging: '5.00' } });
    expect(Number(pending.marginSoFar)).toBeCloseTo(100 + fee - 40 - 5 - Number(pending.costs.delivery), 2);
    // The actual cost, once recorded, replaces the estimate.
    await http().put(`/order-costs/${order.id}`).set(hub.auth).send({ courierCost: 80 }).expect(200);
    expect((await http().get(`/order-costs/${order.id}/profitability`).set(admin.auth).expect(200)).body)
      .toMatchObject({ complete: true, marginSoFar: (100 + fee - 40 - 5 - 80).toFixed(2), costs: { delivery: '80.00' } });
  });

  it('flags a loss-making order once for an authorized review, never blocks the parcel and never changes the customer price', async () => {
    // Sold for 100 (+ the delivery fee), bought for 250 (list 260, 10 discount): a loss before packaging and delivery are even counted.
    const { order, shipmentId } = await verifiedOrder(skuLoss, { listUnitPrice: 260, discountPerUnit: 10 });
    const line = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    const priceBefore = { price: line.price.toString(), lineTotal: line.lineTotal?.toString(), total: (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).totalAmount.toString() };

    const early = (await http().get(`/order-costs/${order.id}/profitability`).set(admin.auth).expect(200)).body;
    expect(early).toMatchObject({ state: 'LOSS', marginSoFar: (Number(early.goodsNet) + Number(early.customerDeliveryFee) - 250 - Number(early.costs.delivery ?? 0)).toFixed(2), costs: { purchase: '250.00' } });
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

  /* ── Order preparation cards: supplier discount %, manual confirmation, barcode correction, storefront price ── */

  const putDiscount = (orderId: string, orderItemId: string, body: Record<string, unknown>, auth = hub.auth) =>
    http().put(`/fulfillment/locations/${locationId}/desk/orders/${orderId}/lines/${orderItemId}/discount`).set(auth).send(body);

  it('receives without expiry or lot, and stores the card discount as a percentage of the list price with history, refusals and a loss re-check', async () => {
    const sku = await createOrderableSku(prisma);
    const order = await checkout([{ sku, quantity: 1 }]);
    const itemId = order.items[0].id;
    const priceBefore = (await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } })).price.toString();
    await putDiscount(order.id, itemId, { discountPercent: 10, listUnitPrice: 200 }).expect(409).expect(res => expect(res.body.code).toBe('NOT_PURCHASED_YET'));
    await buy(sku, 1);

    // No expiry date and no lot: the normal preparation flow does not ask for them.
    const received = await scan(order.id, { barcodeScanned: sku.barcode }).expect(201);
    expect(received.body).toMatchObject({ outcome: 'received', order: { stage: 'packing' } });
    const line = (id: string) => deskOrder(order.id).then(o => o.lines.find((l: any) => l.orderItemId === id));
    expect(await line(itemId)).toMatchObject({ cost: { recorded: false, listUnitPrice: null, discountPercent: null }, productSlug: expect.any(String) });

    // The base price may be sent once explicitly; without it the product's price on the order is the list price.
    await putDiscount(order.id, itemId, { discountPercent: 100, listUnitPrice: 200 }).expect(400);
    await putDiscount(order.id, itemId, { discountPercent: 10, listUnitPrice: 200 }, otherHub.auth).expect(403);
    await putDiscount(order.id, itemId, { discountPercent: 10, listUnitPrice: 200 }, driver.auth).expect(403);
    const first = await putDiscount(order.id, itemId, { discountPercent: 10, listUnitPrice: 200 }).expect(200);
    expect(first.body.order.lines[0].cost).toMatchObject({ recorded: true, listUnitPrice: '200.00', discountPerUnit: '20.00', discountPercent: '10.00', finalUnitCost: '180.00', version: 1 });

    // Editing again corrects the same purchase (history kept); the recorded list price is never changed from here.
    const second = await putDiscount(order.id, itemId, { discountPercent: 12.5 }).expect(200);
    expect(second.body.order.lines[0].cost).toMatchObject({ discountPerUnit: '25.00', discountPercent: '12.50', finalUnitCost: '175.00', version: 2 });
    await putDiscount(order.id, itemId, { discountPercent: 12.5, listUnitPrice: 300 }).expect(409).expect(res => expect(res.body.code).toBe('LIST_PRICE_RECORDED'));
    const key = second.body.order.lines[0].cost.acquireKey;
    const batch = await prisma.purchaseCostBatch.findUniqueOrThrow({ where: { acquireKey: key } });
    expect((batch.history as any[]).map(h => h.discountPerUnit)).toEqual(['20.00']);
    await putDiscount(order.id, itemId, { discountPercent: 12.5 }).expect(200); // unchanged value: a replay, no new version
    expect((await prisma.purchaseCostBatch.findUniqueOrThrow({ where: { acquireKey: key } })).version).toBe(2);

    // Sold at 100 and bought at 175+: already a loss, flagged once packaging is recorded; the customer's price never moves.
    await http().put(`/order-costs/${order.id}`).set(hub.auth).send({ packagingType: 'BAG' }).expect(200);
    expect(await reviewCases(order.id)).toHaveLength(1);
    await putDiscount(order.id, itemId, { discountPercent: 1 }).expect(200);
    expect(await reviewCases(order.id)).toHaveLength(1);
    const after = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(after.price.toString()).toBe(priceBefore);
  });

  it('confirms a unit by hand as a manual verification (never a barcode scan) and refuses an incomplete or wrong manual check', async () => {
    const sku = await createOrderableSku(prisma);
    const other = await createOrderableSku(prisma);
    const order = await checkout([{ sku, quantity: 2 }]);
    await buy(sku, 2);
    const manual = { skuId: sku.id, manualReason: 'Compared the pack with the photo and details', manualChecks: ['brand', 'variant', 'size', 'pack'] };
    await scan(order.id, { skuId: sku.id, manualReason: manual.manualReason, manualChecks: ['brand'] }).expect(400);
    await scan(order.id, { skuId: sku.id }).expect(400);
    expect((await scan(order.id, { ...manual, skuId: other.id }).expect(201)).body).toMatchObject({ outcome: 'rejected', code: 'WRONG_ITEM' });
    const done = await scan(order.id, manual).expect(201);
    expect(done.body).toMatchObject({ outcome: 'received' });
    const receipts = await prisma.fulfillmentReceipt.findMany({ where: { orderId: order.id } });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ identityMethod: 'manual', identityNote: manual.manualReason, expiryDate: null });
    // The quantity limit holds for manual units as well.
    await scan(order.id, manual).expect(201);
    expect((await scan(order.id, manual).expect(201)).body).toMatchObject({ outcome: 'rejected' });
    expect(await prisma.fulfillmentReceipt.count({ where: { orderId: order.id } })).toBe(2);
  });

  it('corrects a wrong barcode for catalog reviewers only, keeps the old code as a retired alias and refuses every conflict', async () => {
    const sku = await createOrderableSku(prisma);
    const taken = await createOrderableSku(prisma);
    const noCode = await createOrderableSku(prisma);
    const order = await checkout([{ sku, quantity: 1 }, { sku: noCode, quantity: 1 }]);
    await prisma.sku.update({ where: { id: noCode.id }, data: { barcode: null } });
    const oldCode = sku.barcode!;
    const fresh = ean13();
    const correct = (body: Record<string, unknown>, auth = admin.auth) =>
      http().post(`/fulfillment/locations/${locationId}/desk/orders/${order.id}/correct-barcode`).set(auth)
        .send({ clientScanId: randomUUID(), skuId: sku.id, barcode: fresh, checks: ['brand', 'variant', 'size', 'pack'], note: 'The printed code differs from the catalog', ...body });

    await correct({}, hub.auth).expect(403);
    await correct({ checks: ['brand'] }).expect(400);
    await correct({ barcode: withBadCheckDigit(fresh) }).expect(409).expect(res => expect(res.body.code).toBe('INVALID_BARCODE'));
    await correct({ barcode: taken.barcode }).expect(409).expect(res => expect(res.body.code).toBe('BARCODE_ALREADY_USED'));
    await correct({ skuId: taken.id }).expect(409).expect(res => expect(res.body.code).toBe('WRONG_ITEM'));
    await correct({ skuId: noCode.id }).expect(409).expect(res => expect(res.body.code).toBe('SKU_HAS_NO_BARCODE'));
    expect((await prisma.sku.findUniqueOrThrow({ where: { id: sku.id } })).barcode).toBe(oldCode);

    const id = randomUUID();
    const ok = await correct({ clientScanId: id }).expect(201);
    expect(ok.body).toMatchObject({ corrected: true, replayed: false, barcode: fresh });
    expect((await prisma.sku.findUniqueOrThrow({ where: { id: sku.id } })).barcode).toBe(fresh);
    const retired = await prisma.skuBarcodeAlias.findFirstOrThrow({ where: { skuId: sku.id, barcode: oldCode } });
    expect(retired).toMatchObject({ status: 'retired', retiredBy: admin.id, approvedBy: admin.id });
    expect(retired.reason).toContain('The printed code differs');
    await correct({ clientScanId: id }).expect(201).expect(res => expect(res.body.replayed).toBe(true));
    expect(await prisma.hubScanAttempt.findMany({ where: { orderId: order.id, outcomeCode: 'BARCODE_CORRECTED' } })).toHaveLength(1);

    // The new code identifies the product; the replaced one no longer does.
    await buy(sku, 1);
    expect((await scan(order.id, { barcodeScanned: oldCode }).expect(201)).body).toMatchObject({ outcome: 'rejected', code: 'PRODUCT_IDENTITY_REVIEW_REQUIRED' });
    expect((await scan(order.id, { barcodeScanned: fresh }).expect(201)).body).toMatchObject({ outcome: 'received', skuId: sku.id });
    // A hub operator can still add a code where the product has none.
    await register(order.id, { skuId: noCode.id, barcode: ean13() }).expect(201);
  });

  it('changes the storefront price for authorized users only: future checkouts and open carts follow it, confirmed orders keep theirs', async () => {
    const sku = await createOrderableSku(prisma, 100);
    const placed = await checkout([{ sku, quantity: 1 }]);
    const orderLine = () => prisma.orderItem.findFirstOrThrow({ where: { orderId: placed.id } });
    const customer = await signInCustomer(app);
    await http().post('/ordering/cart/add').set(customer.auth).send({ skuId: sku.id, quantity: 1 }).expect(201);

    await http().post(`/commerce/prices/skus/${sku.id}/change`).set(hub.auth).send({ amount: 130 }).expect(403);
    await http().post(`/commerce/prices/skus/${sku.id}/change`).set(admin.auth).send({ amount: 0 }).expect(400);
    const changed = await http().post(`/commerce/prices/skus/${sku.id}/change`).set(admin.auth).send({ amount: 130 }).expect(200);
    expect(changed.body).toMatchObject({ amount: 130, validUntil: null, isActive: true });
    await http().post(`/commerce/prices/skus/${sku.id}/change`).set(admin.auth).send({ amount: 130 }).expect(200).expect(res => expect(res.body.id).toBe(changed.body.id));

    // History is kept: the old price row is closed, one open price remains.
    const rows = await prisma.sellingPrice.findMany({ where: { skuId: sku.id }, orderBy: { validFrom: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0].validUntil).not.toBeNull();
    expect(rows.filter(r => r.validUntil === null)).toHaveLength(1);
    expect((await http().get(`/commerce/prices/skus/${sku.id}/current`).set(admin.auth).expect(200)).body.amount).toBe(130);

    // The confirmed order is untouched (even though it is being prepared); the unfinished cart now prices at 130.
    expect((await orderLine()).price.toString()).toBe('100');
    const cart = (await http().get('/ordering/cart').set(customer.auth).expect(200)).body;
    expect(cart.items.find((i: any) => i.skuId === sku.id)).toMatchObject({ price: 130 });
    const next = await checkout([{ sku, quantity: 1 }]);
    expect((await prisma.orderItem.findFirstOrThrow({ where: { orderId: next.id } })).price.toString()).toBe('130');
    expect((await orderLine()).price.toString()).toBe('100');
  });

  it('scopes a discount edit to the purchase behind that line: other products, other purchases and earlier costs are untouched', async () => {
    const a = await createOrderableSku(prisma);
    const b = await createOrderableSku(prisma);
    // One count of A covers two orders; B is bought separately. Order Y shares A's purchase with X.
    const x = await checkout([{ sku: a, quantity: 1 }, { sku: b, quantity: 1 }]);
    const y = await checkout([{ sku: a, quantity: 1 }]);
    await buy(a, 2); await buy(b, 1);
    for (const order of [x, y]) for (const item of order.items) {
      const sku = item.skuId === a.id ? a : b;
      await scan(order.id, { barcodeScanned: sku.barcode }).expect(201);
    }
    const lineOf = async (order: { id: string }, sku: OrderableSku) => (await deskOrder(order.id)).lines.find((l: any) => l.skuId === sku.id);
    const batchOf = (key: string) => prisma.purchaseCostBatch.findUniqueOrThrow({ where: { acquireKey: key } });
    const xa = await lineOf(x, a); const xb = await lineOf(x, b); const ya = await lineOf(y, a);
    expect(xa.cost.acquireKey).toBe(ya.cost.acquireKey); // the same physical purchase
    expect(xb.cost.acquireKey).not.toBe(xa.cost.acquireKey);

    await putDiscount(x.id, xa.orderItemId, { discountPercent: 10, listUnitPrice: 200 }).expect(200);
    // Only A's purchase got a cost (shared by the lines it covered, as recorded costs always are); B has none, and nothing else was created.
    expect((await lineOf(y, a)).cost).toMatchObject({ recorded: true, discountPercent: '10.00' });
    expect((await lineOf(x, b)).cost).toMatchObject({ recorded: false });
    expect(await prisma.purchaseCostBatch.count({ where: { skuId: b.id } })).toBe(0);
    expect(await prisma.purchaseCostBatch.count({ where: { skuId: a.id } })).toBe(1);

    // A later purchase of the same SKU is its own batch: editing the new one never rewrites the earlier one.
    const earlier = await batchOf(xa.cost.acquireKey);
    const z = await checkout([{ sku: a, quantity: 1 }]);
    await buy(a, 1);
    await scan(z.id, { barcodeScanned: a.barcode }).expect(201);
    const za = await lineOf(z, a);
    expect(za.cost.acquireKey).not.toBe(xa.cost.acquireKey);
    await putDiscount(z.id, za.orderItemId, { discountPercent: 30, listUnitPrice: 300 }).expect(200);
    const after = await batchOf(xa.cost.acquireKey);
    expect({ list: after.listUnitPrice.toString(), discount: after.discountPerUnit.toString(), version: after.version, history: after.history })
      .toEqual({ list: earlier.listUnitPrice.toString(), discount: earlier.discountPerUnit.toString(), version: earlier.version, history: earlier.history });
    expect((await batchOf(za.cost.acquireKey)).discountPerUnit.toString()).toBe('90');
    // Editing B's line leaves A's purchases alone.
    await putDiscount(x.id, xb.orderItemId, { discountPercent: 5, listUnitPrice: 100 }).expect(200);
    expect((await batchOf(xa.cost.acquireKey)).version).toBe(earlier.version);
  });

  it('edits only the purchase the next unit of a line belongs to when a line was bought in two purchases', async () => {
    const sku = await createOrderableSku(prisma);
    const order = await checkout([{ sku, quantity: 2 }]);
    const itemId = order.items[0].id;
    await buy(sku, 1); await buy(sku, 1);
    const first = (await deskOrder(order.id)).lines[0].cost.acquireKey;
    await putDiscount(order.id, itemId, { discountPercent: 10, listUnitPrice: 200 }).expect(200);
    await scan(order.id, { barcodeScanned: sku.barcode }).expect(201); // consumes the first purchase
    const second = (await deskOrder(order.id)).lines[0].cost.acquireKey;
    expect(second).not.toBe(first);
    await putDiscount(order.id, itemId, { discountPercent: 20, listUnitPrice: 300 }).expect(200);
    const rows = await prisma.purchaseCostBatch.findMany({ where: { acquireKey: { in: [first, second] } } });
    const byKey = new Map(rows.map(r => [r.acquireKey, r]));
    expect(byKey.get(first)).toMatchObject({ version: 1 });
    expect(byKey.get(first)!.discountPerUnit.toString()).toBe('20');
    expect(byKey.get(second)!.discountPerUnit.toString()).toBe('60');
  });

  it('keeps the audit trail when a shared purchase is corrected from another order, and never changes any confirmed customer price or total', async () => {
    const sku = await createOrderableSku(prisma);
    const x = await checkout([{ sku, quantity: 1 }]);
    const y = await checkout([{ sku, quantity: 1 }]);
    await buy(sku, 2);
    await scan(x.id, { barcodeScanned: sku.barcode }).expect(201);
    await scan(y.id, { barcodeScanned: sku.barcode }).expect(201);
    const money = async () => Promise.all([x, y].map(async order => {
      const line = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
      const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      return { price: line.price.toString(), lineTotal: line.lineTotal?.toString(), total: row.totalAmount.toString() };
    }));
    const before = await money();
    const xLine = (await deskOrder(x.id)).lines[0]; const yLine = (await deskOrder(y.id)).lines[0];
    expect(xLine.cost.acquireKey).toBe(yLine.cost.acquireKey);

    await putDiscount(x.id, xLine.orderItemId, { discountPercent: 10, listUnitPrice: 200 }, hub.auth).expect(200);
    await putDiscount(y.id, yLine.orderItemId, { discountPercent: 20 }, admin.auth).expect(200); // corrected from the other order, by another actor
    const batch = await prisma.purchaseCostBatch.findUniqueOrThrow({ where: { acquireKey: xLine.cost.acquireKey } });
    expect(batch).toMatchObject({ version: 2, recordedBy: hub.id });
    expect(batch.discountPerUnit.toString()).toBe('40');
    const history = batch.history as any[];
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ version: 1, discountPerUnit: '20.00', listUnitPrice: '200.00', finalUnitCost: '180.00', correctedBy: admin.id });
    expect(history[0].reason).toContain('20%');
    expect(history[0].correctedAt).toEqual(expect.any(String));
    // Both orders see the corrected cost; nothing the customers agreed to moved.
    expect((await deskOrder(x.id)).lines[0].cost).toMatchObject({ discountPercent: '20.00', finalUnitCost: '160.00', version: 2 });
    expect(await money()).toEqual(before);
  });

  it('integration: the Hub can read prices but never write them, and no desk route can change the quantity, price, total or COD of a confirmed order', async () => {
    const sku = await createOrderableSku(prisma, 100);
    const order = await checkout([{ sku, quantity: 1 }]);
    const itemId = order.items[0].id;
    const snapshot = async () => {
      const line = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
      const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      return { price: line.price.toString(), lineTotal: line.lineTotal?.toString(), total: row.totalAmount.toString(), cod: row.codAmount?.toString() };
    };
    const before = await snapshot();

    // Reads stay available to the Hub (reference/prefill); every write is Admin only.
    await http().get(`/commerce/prices/skus/${sku.id}/current`).set(hub.auth).expect(200);
    await http().post('/commerce/prices').set(hub.auth).send({ skuId: sku.id, amount: 90, autoClosePrevious: true }).expect(403);
    await http().post(`/commerce/prices/skus/${sku.id}/change`).set(hub.auth).send({ amount: 90 }).expect(403);
    const current = (await http().get(`/commerce/prices/skus/${sku.id}/current`).set(admin.auth).expect(200)).body;
    await http().patch(`/commerce/prices/${current.id}`).set(hub.auth).send({ amount: 90 }).expect(403);
    await http().patch(`/commerce/prices/${current.id}/deactivate`).set(hub.auth).send({}).expect(403);

    // Confirmed orders have no operational editor: quantity, price, total and COD can only change through the customer-agreed availability workflow.
    const patch = (body: Record<string, unknown>, auth = hub.auth) => http().patch(`/fulfillment/locations/${locationId}/desk/orders/${order.id}/lines/${itemId}`).set(auth).send(body);
    for (const body of [{ unitPrice: 80 }, { quantity: 5 }, { quantity: 1, unitPrice: 100 }]) {
      await patch(body).expect(404);
      await patch(body, admin.auth).expect(404);
    }
    expect(await snapshot()).toEqual(before);
  });
});
