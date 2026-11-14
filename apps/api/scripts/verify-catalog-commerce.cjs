/* eslint-disable @typescript-eslint/no-var-requires -- Explicit Node CommonJS verification entry point. */
'use strict';

// Explicit, opt-in proof against a retained 10-product pilot SKU. It never creates catalog
// identities, prices, listings or offers. Only test customers/carts/orders are added.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
require('./local-test-database.cjs').assertLocalTestDatabase(process.env);
if (process.env.NODE_ENV !== 'test' || process.env.SOURCING_MODE !== 'INTERNAL_BUY_LIST') {
  throw new Error('Requires explicit test environment and INTERNAL_BUY_LIST');
}
const [skuId, expectedPriceText, reportPath] = process.argv.slice(2);
if (!/^[\da-f-]{36}$/i.test(skuId ?? '') || !(Number(expectedPriceText) > 0) || !reportPath) {
  throw new Error('Usage: verify-catalog-commerce.cjs SKU_ID EXISTING_DEV_PRICE REPORT_PATH');
}
// Prevent inherited credentials from selecting an external storage provider.
Object.assign(process.env, { FILE_STORAGE_PROVIDER: 'local', MEDIA_STORAGE_PROVIDER: 'local',
  TEST_BYPASS_AUTH: 'false', INTAKE_WORKER: 'off', DOMAIN_EVENTS_POLL_MS: '0',
  PROCUREMENT_BATCH_INTERVAL_MINUTES: '0', DECISION_SWEEP_MS: '0', RFQ_TICK_MS: '0',
  EXA_API_KEY: '', FIRECRAWL_API_KEY: '' });
require('ts-node/register/transpile-only');
const { NestFactory } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const request = require('supertest');
const sharp = require('sharp');
const { AppModule } = require('../src/app.module');
const { PrismaService } = require('../src/platform/database/prisma.service');
const { DomainEventsService } = require('../src/platform/events/domain-events.service');
const { CatalogPublicationService } = require('../src/application/composition/services/catalog-publication.service');
const { createActor } = require('../test/fixtures/actors');

async function main() {
  const report = { scope: 'ISOLATED_TEST_ONLY', skuId, expectedDevPrice: Number(expectedPriceText),
    startedAt: new Date().toISOString(), checks: [], stage: 'BOOT' };
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  const db = app.get(PrismaService);
  const http = request(app.getHttpServer());
  const record = (name, evidence) => report.checks.push({ name, passed: true, ...evidence });
  const commercialSnapshot = async () => ({
    prices: await db.sellingPrice.findMany({ where: { skuId }, orderBy: { id: 'asc' } }),
    listings: await db.listing.findMany({ where: { skuId }, orderBy: { id: 'asc' } }),
    offers: await db.supplierOffer.findMany({ where: { skuId }, orderBy: { id: 'asc' } }),
  });
  try {
    report.stage = 'REAL_PERSISTED_PRODUCT';
    const sku = await db.sku.findUniqueOrThrow({ where: { id: skuId }, include: { product: { include: { brand: true } } } });
    assert(['ADMIN_VERIFIED', 'EVIDENCE_VERIFIED', 'BARCODE_VERIFIED'].includes(sku.identityStatus));
    const commercialBefore = JSON.stringify(await commercialSnapshot());
    const listed = await http.get('/products').query({ limit: 100 }).expect(200);
    assert(listed.body.some(product => product.id === sku.productId));
    const detail = await http.get('/products/' + sku.product.slug).query({ skuId }).expect(200);
    const variant = detail.body.skus.find(item => item.id === skuId);
    assert.equal(variant.canOrder, true);
    assert.equal(Number(variant.price.amount), report.expectedDevPrice);
    assert.equal(variant.price.currency, 'EGP');
    record('public-listing-exact-variant-price', { status: 200, productId: sku.productId,
      brand: sku.product.brand.name, productName: sku.product.name, size: Number(sku.size), unit: sku.sizeUnit });
    const image = await http.get(new URL(detail.body.media[0].url).pathname).buffer(true)
      .parse((response, done) => { const chunks = []; response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => done(null, Buffer.concat(chunks))); }).expect(200);
    const hash = createHash('sha256').update(image.body).digest('hex');
    const asset = await db.mediaAsset.findFirstOrThrow({ where: { skuId, contentHash: hash,
      parentAssetId: null, role: 'PRIMARY_PACKSHOT', reviewStatus: 'APPROVED' } });
    const metadata = await sharp(image.body).metadata();
    assert.equal(metadata.width, asset.width); assert.equal(metadata.height, asset.height);
    record('authentic-original-delivery', { status: 200, sha256: hash, width: asset.width, height: asset.height,
      sourceUrl: asset.sourceUrl, rightsStatus: asset.rightsStatus });

    report.stage = 'AUTHENTICATION';
    const phone = '010' + String(Math.floor(10000000 + Math.random() * 90000000));
    // The development OTP adapter prints its code. Keep the proof output free
    // of credentials; the challenge is read only inside this guarded test DB.
    const previousLog = console.log;
    try {
      console.log = () => {};
      await http.post('/accounts/otp/send').send({ phoneNumber: phone }).expect(201);
    } finally { console.log = previousLog; }
    const challenge = await db.otpChallenge.findFirstOrThrow({ where: { phoneNumber: '+2' + phone }, orderBy: { createdAt: 'desc' } });
    await http.post('/accounts/otp/verify').send({ phoneNumber: phone, code: 'invalid' }).expect(400);
    const wrongCode = challenge.code === '000000' ? '000001' : '000000';
    const rejectedCode = await http.post('/accounts/otp/verify').send({ phoneNumber: phone, code: wrongCode }).expect(401);
    assert.equal(rejectedCode.body.code, 'OTP_INVALID');
    const signedIn = await http.post('/accounts/otp/verify').send({ phoneNumber: phone, code: challenge.code }).expect(201);
    const auth = { Authorization: 'Bearer ' + signedIn.body.token };
    await http.get('/accounts/me').set(auth).expect(200);
    const other = await createActor(db, 'CUSTOMER'); const admin = await createActor(db, 'ADMIN');
    record('real-otp-session', { send: 201, verify: 201, malformedCode: 400, wrongCode: 401 });
    await http.get('/catalog/workbench/skus/' + skuId).expect(401);
    await http.get('/buy-list').expect(401);
    await http.get('/buy-list').set(other.auth).expect(403);
    await http.get('/catalog/workbench/skus/' + skuId).set(auth).expect(403);
    record('workbench-and-procurement-access-control', { anonymous: 401, customer: 403 });

    report.stage = 'CART_AND_REJECTIONS';
    const added = await http.post('/ordering/cart/add').set(auth).send({ skuId, quantity: 2 }).expect(201);
    const cart = await http.get('/ordering/cart').set(auth).expect(200);
    assert.equal(cart.body.items.length, 1); assert.equal(cart.body.items[0].quantity, 2);
    assert.equal(Number(cart.body.items[0].price), report.expectedDevPrice);
    const persisted = await db.cartItem.findMany({ where: { cartId: cart.body.id } });
    assert.equal(persisted.length, 1); assert.equal(persisted[0].skuId, skuId); assert.equal(persisted[0].quantity, 2);
    const stableCart = JSON.stringify(cart.body);
    for (const [name, body, status] of [
      ['unknown-variant', { skuId: randomUUID(), quantity: 1 }, 400],
      ['zero-quantity', { skuId, quantity: 0 }, 400],
      ['client-price-injection', { skuId, quantity: 1, unitPrice: 0.01 }, 400],
    ]) {
      await http.post('/ordering/cart/add').set(auth).send(body).expect(status);
      assert.equal(JSON.stringify((await http.get('/ordering/cart').set(auth)).body), stableCart);
      record(name, { status, cartUnchanged: true });
    }
    const held = await db.sku.findUniqueOrThrow({ where: { id: '54f9dfb7-5cb5-4cea-b1a7-7d472dd074f8' } });
    const heldResult = await http.post('/ordering/cart/add').set(auth).send({ skuId: held.id, quantity: 1 });
    assert([400, 409].includes(heldResult.status));
    assert.equal(JSON.stringify((await http.get('/ordering/cart').set(auth)).body), stableCart);
    record('unpublished-contradictory-product-denied', { status: heldResult.status, cartUnchanged: true });
    assert.equal((await http.get('/ordering/cart').set(other.auth)).body.items.length, 0);
    record('cart-persistence-and-owner-isolation', { quantity: 2, revision: added.body.revision });

    report.stage = 'QUOTE_AND_CHECKOUT';
    const address = { governorate: 'Cairo', area: 'Maadi' };
    const quote = await http.post('/ordering/checkout/quote').set(auth).send(address).expect(201);
    assert.equal(quote.body.items.length, 1); assert.equal(quote.body.items[0].skuId, skuId);
    assert.equal(quote.body.subtotal, report.expectedDevPrice * 2);
    const body = { ...address, customerName: 'Isolated catalog closure test', customerPhone: phone,
      shippingAddress: 'Isolated development test, Maadi', latitude: 29.9602, longitude: 31.2569,
      locationSource: 'map_pin', locationConfirmed: true, quoteVersion: quote.body.quoteVersion,
      cartRevision: quote.body.revision, idempotencyKey: randomUUID() };
    const ordersBefore = await db.order.count();
    const allocationsBefore = await db.sourceAllocation.count();
    await http.post('/ordering/checkout').send(body).expect(401);
    await http.post('/ordering/checkout').set(other.auth).send(body).expect(409);
    await http.post('/ordering/checkout').set(auth).send({ ...body, totalAmount: 0.01 }).expect(400);
    await http.post('/ordering/checkout').set(auth).send({ ...body, cartRevision: body.cartRevision + 1 }).expect(409);
    assert.equal(await db.order.count(), ordersBefore);
    assert.equal(await db.sourceAllocation.count(), allocationsBefore);
    assert.equal(JSON.stringify((await http.get('/ordering/cart').set(auth)).body), stableCart);
    record('failed-checkouts-atomic-price-and-quote-owner-guards', { anonymous: 401,
      otherQuoteOwner: 409, injectedTotal: 400, staleRevision: 409, ordersUnchanged: true, allocationsUnchanged: true });
    const [first, concurrent] = await Promise.all([
      http.post('/ordering/checkout').set(auth).send(body).expect(201),
      http.post('/ordering/checkout').set(auth).send(body).expect(201),
    ]);
    assert.equal(concurrent.body.id, first.body.id);
    const replay = await http.post('/ordering/checkout').set(auth).send(body).expect(201);
    assert.equal(replay.body.id, first.body.id);
    assert.equal(await db.order.count({ where: { idempotencyKey: body.idempotencyKey } }), 1);
    assert.equal((await http.get('/ordering/cart').set(auth)).body.items.length, 0);
    const order = await db.order.findUniqueOrThrow({ where: { id: first.body.id }, include: { items: true } });
    assert.equal(order.items.length, 1); assert.equal(order.items[0].skuId, skuId);
    assert.equal(order.items[0].quantity, 2); assert.equal(Number(order.items[0].price), report.expectedDevPrice);
    assert.equal(Number(order.subtotal), quote.body.subtotal);
    await http.get('/ordering/orders/' + order.id).set(auth).expect(200);
    await http.get('/ordering/orders/' + order.id).set(other.auth).expect(404);
    await http.get('/ordering/orders/' + order.id).expect(401);
    record('checkout-persisted-replay-and-order-ownership', { orderId: order.id, quantity: 2, unitPrice: report.expectedDevPrice,
      duplicateOrders: 0, concurrentSubmissions: 2, ownOrder: 200, otherOwner: 404, anonymous: 401 });

    report.stage = 'INTERNAL_BUY_LIST';
    const events = app.get(DomainEventsService);
    await events.dispatchPending({ aggregateId: order.id });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (!await db.domainEvent.count({ where: { aggregateId: order.id, status: { not: 'delivered' } } })) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const delivery = await db.domainEvent.findMany({ where: { aggregateId: order.id }, select: { status: true } });
    assert(delivery.length && delivery.every(event => event.status === 'delivered'));
    const list = await http.get('/buy-list').set(admin.auth).expect(200);
    const row = list.body.items.find(item => item.skuId === skuId);
    assert(row); const demand = row.orders.find(item => item.orderId === order.id);
    assert(demand); assert.equal(demand.required, 2);
    record('internal-buy-list-exact-order-demand', { status: 200, orderId: order.id, skuId, quantity: demand.required,
      durableEventsDelivered: delivery.length });
    assert.equal(JSON.stringify(await commercialSnapshot()), commercialBefore);
    record('selling-prices-listings-and-offers-unchanged', {});
    const readiness = await app.get(CatalogPublicationService).readiness(skuId);
    assert.equal(readiness.ready, true);
    report.stage = 'PASSED'; report.durationMs = Date.now() - Date.parse(report.startedAt);
  } catch (error) {
    report.failure = { stage: report.stage, message: error.message };
    process.exitCode = 1;
  } finally {
    const destination = path.resolve(reportPath); fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, JSON.stringify(report, null, 2));
    await app.close();
    console.log(JSON.stringify({ stage: report.stage, passedChecks: report.checks.length, failure: report.failure,
      report: destination }));
  }
}
main().catch(() => { console.error('Catalog commerce proof could not initialize; inspect local environment'); process.exitCode = 1; });
