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
import { createActor, Actor } from '../fixtures/actors';
import { signInCustomer } from '../fixtures/checkout';
import { ensureFixtureReviewer, FIXTURE_SOURCE_URL } from '../fixtures/sellable-sku';

type OrderableSku = { id: string; barcode: string; price: number };

const gtin = (body: number[]) => body.join('') + String((10 - (body.reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 3), 0) % 10)) % 10);
const ean13 = () => gtin(Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)));

async function createOrderableSku(prisma: PrismaService, price: number): Promise<OrderableSku> {
  const suffix = randomUUID();
  const reviewer = await ensureFixtureReviewer(prisma);
  const brand = await prisma.brand.create({ data: { name: 'Qty ' + suffix, slug: 'qty-' + suffix } });
  const product = await prisma.product.create({ data: { brandId: brand.id, name: 'Qty Product', slug: 'qty-product-' + suffix, isPublished: true } });
  const barcode = ean13();
  const sku = await prisma.sku.create({ data: { productId: product.id, code: 'QTY-' + suffix, variantName: '50 ml', size: 50, sizeUnit: 'ml', barcode } });
  await prisma.productMedia.create({ data: {
    productId: product.id, type: MediaType.image, url: `https://cdn.fixtures.test/${suffix}.png`, isPrimary: true, originType: MediaOriginType.verified,
    generationMetadata: { isTest: false, reviewedBy: reviewer.id, reviewedAt: new Date().toISOString(), skuId: sku.id, barcode, size: 50, sizeUnit: 'ml',
      variantName: '50 ml', sourceType: 'OFFICIAL_MANUFACTURER', sourceUrl: FIXTURE_SOURCE_URL, identityVerification: 'BARCODE_VERIFIED' },
  } });
  await prisma.listing.create({ data: { skuId: sku.id, isListed: true } });
  await prisma.sellingPrice.create({ data: { skuId: sku.id, amount: price, currency: 'EGP', validFrom: new Date(Date.now() - 60000) } });
  return { id: sku.id, barcode, price };
}

/**
 * Hub quantity workflow: the product is identified with ONE scan and the quantity is confirmed in ONE request; a shortage is only a report
 * until an Admin applies the partial-fulfillment adjustment, which then moves the line, the order totals, the COD and the sourcing
 * requirement together while the original order stays auditable. Missing units are never counted as received.
 */
describe('Hub desk: confirm quantity once, report shortages, authorized adjustment (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: DomainEventsService;
  let hub: Actor; let admin: Actor; let locationId: string;
  let skuA: OrderableSku; let skuB: OrderableSku;
  const previousMode = process.env.SOURCING_MODE;
  const http = () => request(app.getHttpServer());
  const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const checkout = async (lines: Array<{ sku: OrderableSku; quantity: number }>) => {
    const customer = await signInCustomer(app);
    const address = { governorate: 'Cairo', area: 'Maadi' };
    for (const line of lines) await http().post('/ordering/cart/add').set(customer.auth).send({ skuId: line.sku.id, quantity: line.quantity }).expect(201);
    const quote = (await http().post('/ordering/checkout/quote').set(customer.auth).send(address).expect(201)).body;
    const placed = await http().post('/ordering/checkout').set(customer.auth).send({
      ...address, customerName: 'Qty Customer', customerPhone: '01012345678', shippingAddress: '12 Road 9, Maadi',
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
  const buy = (sku: OrderableSku, quantity: number) => http().post('/buy-list/acquire').set(hub.auth).send({ skuId: sku.id, quantity, idempotencyKey: randomUUID() }).expect(200);
  const desk = `/fulfillment/locations`;
  const identify = (orderId: string, body: Record<string, unknown>) => http().post(`${desk}/${locationId}/desk/orders/${orderId}/identify`).set(hub.auth).send({ clientScanId: randomUUID(), ...body });
  const confirm = (orderId: string, body: Record<string, unknown>, auth = hub.auth) => http().post(`${desk}/${locationId}/desk/orders/${orderId}/scan`).set(auth).send({ clientScanId: randomUUID(), ...body });
  const report = (orderId: string, itemId: string, body: Record<string, unknown>, auth = hub.auth) =>
    http().post(`${desk}/${locationId}/desk/orders/${orderId}/lines/${itemId}/shortage`).set(auth).send({ clientRequestId: randomUUID(), ...body });
  const decide = (orderId: string, adjustmentId: string, what: 'approve' | 'reject', auth = admin.auth) =>
    http().post(`${desk}/${locationId}/desk/orders/${orderId}/shortages/${adjustmentId}/${what}`).set(auth).send({ note: 'checked at the hub' });
  const deskOrder = async (orderId: string) => {
    const body = (await http().get(`${desk}/${locationId}/desk`).set(hub.auth).expect(200)).body as { orders: any[] };
    return body.orders.find(o => o.orderId === orderId);
  };
  const receivedUnits = async (orderId: string) => (await prisma.fulfillmentReceipt.aggregate({ where: { orderId }, _sum: { quantity: true } }))._sum.quantity ?? 0;

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
    admin = await createActor(prisma, Role.ADMIN);
    locationId = (await prisma.fulfillmentLocation.create({ data: { name: 'Qty Hub ' + randomUUID(), address: '1 Hub Street' } })).id;
    await prisma.fulfillmentLocationOperator.create({ data: { locationId, operatorId: hub.id } });
    await prisma.fulfillmentLocationOperator.create({ data: { locationId, operatorId: admin.id } });
    skuA = await createOrderableSku(prisma, 100);
    skuB = await createOrderableSku(prisma, 250);
  });

  afterAll(async () => {
    if (previousMode === undefined) delete process.env.SOURCING_MODE; else process.env.SOURCING_MODE = previousMode;
    await app.close();
  });

  it('identifies a product with one scan (nothing received), then confirms the whole quantity in ONE request', async () => {
    const order = await checkout([{ sku: skuA, quantity: 3 }]);
    await buy(skuA, 3);

    const identified = await identify(order.id, { barcodeScanned: skuA.barcode }).expect(201);
    expect(identified.body).toMatchObject({ outcome: 'identified', skuId: skuA.id });
    expect(await receivedUnits(order.id)).toBe(0);
    const unknown = await identify(order.id, { barcodeScanned: ean13() }).expect(201);
    expect(unknown.body).toMatchObject({ outcome: 'rejected', code: 'PRODUCT_IDENTITY_REVIEW_REQUIRED' });

    // More than was bought (or ordered) changes nothing.
    const tooMany = await confirm(order.id, { barcodeScanned: skuA.barcode, quantity: 4 }).expect(201);
    expect(tooMany.body.outcome).toBe('rejected');
    expect(await receivedUnits(order.id)).toBe(0);

    const clientScanId = randomUUID();
    const done = await confirm(order.id, { clientScanId, barcodeScanned: skuA.barcode, quantity: 3 }).expect(201);
    expect(done.body.outcome).toBe('received');
    expect(await receivedUnits(order.id)).toBe(3);
    expect(await prisma.fulfillmentReceipt.count({ where: { orderId: order.id } })).toBe(1); // one operation, one receipt: not three scans
    expect(done.body.order.lines[0]).toMatchObject({ required: 3, ordered: 3, received: 3, shortage: null });
    expect(['verifying', 'packing']).toContain(done.body.order.stage);

    // A retry of the same confirmation never counts twice.
    await confirm(order.id, { clientScanId, barcodeScanned: skuA.barcode, quantity: 3 }).expect(201);
    expect(await receivedUnits(order.id)).toBe(3);
  });

  it('a shortage is only a report: nothing changes until an Admin applies it, then line, totals, COD and requirement move together', async () => {
    const order = await checkout([{ sku: skuA, quantity: 3 }, { sku: skuB, quantity: 2 }]);
    await buy(skuA, 3); await buy(skuB, 2);
    const itemA = order.items.find(i => i.skuId === skuA.id)!.id;
    const itemB = order.items.find(i => i.skuId === skuB.id)!.id;
    const before = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true, paymentCollection: true } });

    // Only 2 of the 3 A exist: confirm 2 (one operation), B is complete.
    await confirm(order.id, { barcodeScanned: skuA.barcode, quantity: 2 }).expect(201);
    await confirm(order.id, { barcodeScanned: skuB.barcode, quantity: 2 }).expect(201);
    expect(await receivedUnits(order.id)).toBe(4);

    // Reporting: validation first.
    await report(order.id, itemA, { missingQuantity: 3 }).expect(409); // 2 are already received: the available quantity cannot be 0
    await report(order.id, itemA, { missingQuantity: 0 }).expect(400);
    const reported = await report(order.id, itemA, { missingQuantity: 1, reason: 'one pack was damaged' }).expect(201);
    const line = reported.body.order.lines.find((l: any) => l.orderItemId === itemA);
    expect(line).toMatchObject({ ordered: 3, required: 3, received: 2, shortage: { missing: 1, newQuantity: 2 } });
    expect(line.shortage.amounts).toMatchObject({ delta: -100 });
    expect(reported.body.order.stage).toBe('shortage_review');
    expect(reported.body.order.lines.find((l: any) => l.orderItemId === itemB)).toMatchObject({ received: 2, shortage: null });

    // The report changed nothing about the order or the money, and missing units are not received.
    const same = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true, paymentCollection: true } });
    expect(Number(same.totalAmount)).toBe(Number(before.totalAmount));
    expect(same.items.find(i => i.id === itemA)!.quantity).toBe(3);
    expect(await receivedUnits(order.id)).toBe(4);

    // Authorization: the Hub operator cannot apply it.
    const adjustmentId = line.shortage.adjustmentId as string;
    await decide(order.id, adjustmentId, 'approve', hub.auth).expect(403);

    // Admin applies it.
    const applied = await decide(order.id, adjustmentId, 'approve').expect(201);
    const adjusted = applied.body.order.lines.find((l: any) => l.orderItemId === itemA);
    expect(adjusted).toMatchObject({ ordered: 3, required: 2, received: 2, shortage: null });
    expect(['verifying', 'packing']).toContain(applied.body.order.stage);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true, paymentCollection: true } });
    expect(after.items.find(i => i.id === itemA)).toMatchObject({ quantity: 2 });
    expect(Number(after.items.find(i => i.id === itemA)!.lineTotal)).toBe(200);
    expect(after.items.find(i => i.id === itemB)!.quantity).toBe(2); // the other product is untouched
    expect(Number(after.totalAmount)).toBe(Number(before.totalAmount) - 100);
    expect(Number(after.codAmount)).toBe(Number(before.codAmount) - 100);
    if (before.subtotal !== null) expect(Number(after.subtotal)).toBe(Number(before.subtotal) - 100);
    if (before.paymentCollection) expect(Number(after.paymentCollection!.expectedAmount)).toBe(Number(before.paymentCollection.expectedAmount) - 100);
    // Cart-total consistency: the lines, the fee and the amounts everyone reads agree.
    const lineSum = after.items.filter(i => i.lineState === 'active').reduce((sum, i) => sum + Number(i.lineTotal), 0);
    expect(lineSum + Number(after.shippingFee)).toBe(Number(after.totalAmount));
    expect(Number(after.codAmount)).toBe(Number(after.totalAmount));
    // The original order stays auditable on the adjustment.
    const record = await prisma.orderQuantityAdjustment.findUniqueOrThrow({ where: { id: adjustmentId } });
    expect(record).toMatchObject({ status: 'applied', orderedQuantity: 3, missingQuantity: 1, decidedBy: admin.id });
    expect(record.before).toMatchObject({ quantity: 3, lineTotal: 300 });
    expect(record.after).toMatchObject({ quantity: 2, lineTotal: 200 });
    expect(Number(record.codBefore)).toBe(Number(before.codAmount));
    expect(Number(record.codAfter)).toBe(Number(after.codAmount));
    // Sourcing and the shipment follow the new quantity, units are counted once.
    expect((await prisma.supplyRequirement.findFirstOrThrow({ where: { orderItemId: itemA } })).requiredQuantity).toBe(2);
    const shipment = await prisma.shipment.findUniqueOrThrow({ where: { orderId: order.id }, include: { items: true } });
    expect(shipment.items.find(i => i.skuId === skuA.id)!.quantity).toBe(2);
    expect(await receivedUnits(order.id)).toBe(4);

    // Replaying the approval changes nothing.
    await decide(order.id, adjustmentId, 'approve').expect(201);
    expect(Number((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).totalAmount)).toBe(Number(before.totalAmount) - 100);
  });

  it('a rejected report changes nothing; a newer report replaces an open one; invalid reports are refused', async () => {
    const order = await checkout([{ sku: skuA, quantity: 3 }]);
    await buy(skuA, 3);
    const itemA = order.items[0].id;
    await confirm(order.id, { barcodeScanned: skuA.barcode, quantity: 1 }).expect(201);

    // More received than the "available" quantity entered: refused.
    await report(order.id, itemA, { missingQuantity: 3 }).expect(409);
    // A shortage of the whole line is a cancellation of that item, not a quantity adjustment.
    const untouched = await checkout([{ sku: skuB, quantity: 2 }]);
    await buy(skuB, 2);
    await report(untouched.id, untouched.items[0].id, { missingQuantity: 2 }).expect(400);
    const first = await report(order.id, itemA, { missingQuantity: 1 }).expect(201);
    const second = await report(order.id, itemA, { missingQuantity: 2 }).expect(201);
    expect(await prisma.orderQuantityAdjustment.count({ where: { orderItemId: itemA, status: 'proposed' } })).toBe(1);
    expect(await prisma.orderQuantityAdjustment.count({ where: { orderItemId: itemA, status: 'superseded' } })).toBe(1);
    const open = second.body.order.lines[0].shortage;
    expect(open).toMatchObject({ missing: 2, newQuantity: 1 });
    expect(first.body.order.lines[0].shortage.adjustmentId).not.toBe(open.adjustmentId);

    const before = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    await decide(order.id, open.adjustmentId, 'reject', hub.auth).expect(403);
    const rejected = await decide(order.id, open.adjustmentId, 'reject').expect(201);
    expect(rejected.body.order.lines[0]).toMatchObject({ required: 3, ordered: 3, shortage: null });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    expect(Number(after.totalAmount)).toBe(Number(before.totalAmount));
    expect(after.items[0].quantity).toBe(3);
    await decide(order.id, open.adjustmentId, 'approve').expect(409); // a rejected report cannot be applied
  });

  it('refuses to edit the money of an online-paid order or one whose cash is already collected', async () => {
    const online = await checkout([{ sku: skuA, quantity: 2 }]);
    await buy(skuA, 2);
    await prisma.order.update({ where: { id: online.id }, data: { paymentMethod: 'ONLINE' as any } }).catch(async () => {
      await prisma.$executeRaw`UPDATE ordering.orders SET payment_method = (SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'PaymentMethod' AND enumlabel <> 'COD' LIMIT 1)::ordering."PaymentMethod" WHERE id = ${online.id}::uuid`;
    });
    const res = await report(online.id, online.items[0].id, { missingQuantity: 1 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('REFUND_FLOW_REQUIRED');

    const cash = await checkout([{ sku: skuB, quantity: 2 }]);
    await buy(skuB, 2);
    await prisma.paymentCollection.upsert({
      where: { orderId: cash.id }, create: { orderId: cash.id, expectedAmount: 500, currency: 'EGP', status: 'collected' as any }, update: { status: 'collected' as any },
    });
    const refused = await report(cash.id, cash.items[0].id, { missingQuantity: 1 });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('COLLECTION_ALREADY_STARTED');
  });
});
