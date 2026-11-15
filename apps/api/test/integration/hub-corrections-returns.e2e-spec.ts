process.env.DELIVERY_FEE_POLICY = JSON.stringify({ bands: [{ maxKm: null, fee: 50 }], discountTiers: [], freeFrom: 100000 });
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { MediaOriginType, MediaType, Role } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { DomainEventsService } from '../../src/platform/events/domain-events.service';
import { ReconciliationService } from '../../src/modules/ordering/public';
import { createActor, Actor } from '../fixtures/actors';
import { signInCustomer } from '../fixtures/checkout';
import { ensureFixtureReviewer, FIXTURE_SOURCE_URL } from '../fixtures/sellable-sku';

type OrderableSku = { id: string; barcode: string; variantName: string };

function ean13() {
  const body = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  const sum = body.reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 3), 0);
  return body.join('') + String((10 - (sum % 10)) % 10);
}

async function createOrderableSku(prisma: PrismaService): Promise<OrderableSku> {
  const suffix = randomUUID();
  const reviewer = await ensureFixtureReviewer(prisma);
  const brand = await prisma.brand.create({ data: { name: 'Fix ' + suffix, slug: 'fix-' + suffix } });
  const product = await prisma.product.create({ data: { brandId: brand.id, name: 'Fix Product', slug: 'fix-product-' + suffix, isPublished: true } });
  const barcode = ean13();
  const sku = await prisma.sku.create({ data: { productId: product.id, code: 'FIX-' + suffix, variantName: '50 ml', size: 50, sizeUnit: 'ml', barcode } });
  await prisma.productMedia.create({ data: {
    productId: product.id, type: MediaType.image, url: `https://cdn.fixtures.test/${suffix}.png`, isPrimary: true, originType: MediaOriginType.verified,
    generationMetadata: { isTest: false, reviewedBy: reviewer.id, reviewedAt: new Date().toISOString(), skuId: sku.id, barcode, size: 50, sizeUnit: 'ml',
      variantName: '50 ml', sourceType: 'OFFICIAL_MANUFACTURER', sourceUrl: FIXTURE_SOURCE_URL, identityVerification: 'BARCODE_VERIFIED' },
  } });
  await prisma.listing.create({ data: { skuId: sku.id, isListed: true } });
  await prisma.sellingPrice.create({ data: { skuId: sku.id, amount: 100, currency: 'EGP', validFrom: new Date(Date.now() - 60000) } });
  return { id: sku.id, barcode, variantName: '50 ml' };
}

type DeskLine = { skuId: string; required: number; purchased: number; received: number; verified: number; cost: { recorded: boolean; finalUnitCost: string | null } | null };
type DeskOrder = {
  orderId: string; stage: string; shipment: { id: string; status: string } | null; lines: DeskLine[]
  units: Array<{ receiptId: string; skuId: string; correctable: boolean }>; corrections: Array<{ reversesReceiptId: string; reason: string | null }>; rejectedScans: number
}
type ReturnLine = { orderItemId: string; inspection: { id: string; result: string; disposition: string } | null; history: Array<{ id: string }> }
type ReturnCase = { resolutionId: string; status: string; allInspected: boolean; refund: unknown; lines: ReturnLine[] }

/**
 * GLO-315 closure on persisted data: committed receipt scans are corrected with compensating events (never edited), the actual purchase
 * cost is captured at receipt, and the Hub Returns workflow records physical inspection separately from any refund decision.
 */
describe('Hub corrections, receipt-time cost and returns (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: DomainEventsService;
  let reconciliation: ReconciliationService;
  let hub: Actor; let otherHub: Actor; let driver: Actor; let admin: Actor;
  let locationId: string;
  let skuA: OrderableSku; let skuB: OrderableSku;
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
  const desk = async (orderId: string) => {
    const body = (await http().get(`/fulfillment/locations/${locationId}/desk`).set(hub.auth).expect(200)).body as { orders: DeskOrder[] };
    return body.orders.find(o => o.orderId === orderId);
  };
  const reverse = (receiptId: string, body: Record<string, unknown>, auth = hub.auth) =>
    http().post(`/fulfillment/locations/${locationId}/desk/receipts/${receiptId}/reverse`).set(auth).send({ idempotencyKey: randomUUID(), reason: 'WRONG_UNIT_SCANNED', note: 'scanned the wrong box', ...body });
  const net = (orderId: string) => prisma.fulfillmentReceipt.aggregate({ where: { orderId }, _sum: { quantity: true } }).then(r => r._sum.quantity ?? 0);
  const returns = async (auth = hub.auth) => (await http().get(`/fulfillment/locations/${locationId}/returns`).set(auth).expect(200)).body.items as ReturnCase[];
  const inspect = (resolutionId: string, body: Record<string, unknown>, auth = hub.auth) =>
    http().post(`/fulfillment/locations/${locationId}/returns/${resolutionId}/inspections`).set(auth).send({ idempotencyKey: randomUUID(), quantity: 1, result: 'SEALED_INTACT', ...body });

  beforeAll(async () => {
    process.env.TEST_BYPASS_AUTH = 'false';
    process.env.SOURCING_MODE = 'INTERNAL_BUY_LIST';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    events = app.get(DomainEventsService);
    reconciliation = app.get(ReconciliationService, { strict: false });
    hub = await createActor(prisma, Role.HUB_OPERATOR);
    otherHub = await createActor(prisma, Role.HUB_OPERATOR);
    driver = await createActor(prisma, Role.DRIVER);
    admin = await createActor(prisma, Role.ADMIN);
    locationId = (await prisma.fulfillmentLocation.create({ data: { name: 'Corr Hub ' + randomUUID(), address: '1 Hub Street' } })).id;
    await prisma.fulfillmentLocationOperator.create({ data: { locationId, operatorId: hub.id } });
    const elsewhere = await prisma.fulfillmentLocation.create({ data: { name: 'Other Hub ' + randomUUID(), address: '2 Hub Street' } });
    await prisma.fulfillmentLocationOperator.create({ data: { locationId: elsewhere.id, operatorId: otherHub.id } });
    skuA = await createOrderableSku(prisma);
    skuB = await createOrderableSku(prisma);
  });

  afterAll(async () => {
    if (previousMode === undefined) delete process.env.SOURCING_MODE; else process.env.SOURCING_MODE = previousMode;
    await app.close();
  });

  let orderA: { id: string; items: Array<{ id: string; skuId: string }> };

  it('captures the purchase cost at receipt and refuses a silent change of an already recorded cost', async () => {
    orderA = await checkout([{ sku: skuA, quantity: 2 }]);
    await buy(skuA, 2);
    const before = await desk(orderA.id);
    expect(before!.lines[0].cost).toMatchObject({ recorded: false, finalUnitCost: null });
    // A bad price is refused before anything is received.
    await scan(orderA.id, { barcodeScanned: skuA.barcode, expiryDate: EXPIRY, cost: { listUnitPrice: 100, discountPerUnit: 100 } }).expect(400);
    expect(await net(orderA.id)).toBe(0);
    const first = await scan(orderA.id, { barcodeScanned: skuA.barcode, expiryDate: EXPIRY, lotNumber: 'L1', cost: { listUnitPrice: 100, discountPerUnit: 10 } }).expect(201);
    expect(first.body.outcome).toBe('received');
    // Recorded once, derived (list − discount), and visible on the desk.
    const batches = await prisma.purchaseCostBatch.findMany({ where: { skuId: skuA.id } });
    expect(batches).toHaveLength(1);
    expect(batches[0].finalUnitCost.toFixed(2)).toBe('90.00');
    expect(first.body.order.lines[0].cost).toMatchObject({ recorded: true, finalUnitCost: '90.00' });
    // A different price for the same purchase is a mismatch (a correction needs its own reason); nothing is received.
    await scan(orderA.id, { barcodeScanned: skuA.barcode, expiryDate: EXPIRY, cost: { listUnitPrice: 120 } })
      .expect(409).expect(res => expect(res.body.code).toBe('COST_MISMATCH'));
    expect(await net(orderA.id)).toBe(1);
    // The same value again replays harmlessly and completes the order.
    const second = await scan(orderA.id, { barcodeScanned: skuA.barcode, expiryDate: EXPIRY, lotNumber: 'L1', cost: { listUnitPrice: 100, discountPerUnit: 10 } }).expect(201);
    expect(second.body.order).toMatchObject({ stage: 'packing', shipment: { status: 'prepared' } });
    expect(await prisma.purchaseCostBatch.count({ where: { skuId: skuA.id } })).toBe(1);
  });

  it('corrects a committed scan with a compensating event, atomically and exactly once', async () => {
    const view = (await desk(orderA.id))!;
    expect(view.units).toHaveLength(2);
    const target = view.units[0];
    expect(target.correctable).toBe(true);
    const shipmentId = view.shipment!.id;
    const balanceBefore = await prisma.inventoryBalance.findFirstOrThrow({ where: { locationId, skuId: skuA.id } });

    // Access and input rules.
    await reverse(target.receiptId, {}, otherHub.auth).expect(403);
    await reverse(target.receiptId, {}, driver.auth).expect(403);
    await reverse(target.receiptId, { note: 'x' }).expect(400);
    await reverse(target.receiptId, { reason: 'BECAUSE' }).expect(400);

    const key = randomUUID();
    const done = await reverse(target.receiptId, { idempotencyKey: key }).expect(201);
    expect(done.body).toMatchObject({ replayed: false, receiptId: target.receiptId });
    expect(done.body.order).toMatchObject({ stage: 'receiving', shipment: { status: 'pending' } });
    expect(done.body.order.lines[0]).toMatchObject({ received: 1, purchased: 2, verified: 0 });
    expect(done.body.order.corrections).toEqual([expect.objectContaining({ reversesReceiptId: target.receiptId, reason: 'WRONG_UNIT_SCANNED' })]);
    // The original is untouched; a negative receipt points at it; net stock and quantities follow.
    const rows = await prisma.fulfillmentReceipt.findMany({ where: { orderId: orderA.id }, orderBy: { receivedAt: 'asc' } });
    expect(rows.map(r => r.quantity).sort()).toEqual([-1, 1, 1]);
    expect(rows.find(r => r.id === target.receiptId)).toBeTruthy();
    expect(await net(orderA.id)).toBe(1);
    const balanceAfter = await prisma.inventoryBalance.findFirstOrThrow({ where: { locationId, skuId: skuA.id } });
    expect(balanceAfter.orderAllocatedExternalGoods).toBe(balanceBefore.orderAllocatedExternalGoods - 1);
    expect(await prisma.inventoryTransaction.count({ where: { balanceId: balanceAfter.id, type: 'REVERSE_ORDER_ALLOCATED', quantity: -1 } })).toBe(1);
    // The verification built on the reversed scan is voided and audited.
    expect((await prisma.shipmentPreparationSession.findMany({ where: { shipmentId } })).map(s => s.status)).toEqual(['failed']);
    expect(await prisma.shipmentEvent.count({ where: { shipmentId, type: 'RECEIPT_CORRECTED', reasonCode: 'WRONG_UNIT_SCANNED' } })).toBe(1);
    expect(await prisma.shipmentEvent.count({ where: { shipmentId, type: 'PREPARATION_REOPENED' } })).toBe(1);

    // Exactly once: a retry replays, a second key is refused, and a correction cannot itself be corrected.
    await reverse(target.receiptId, { idempotencyKey: key }).expect(201).expect(res => expect(res.body.replayed).toBe(true));
    await reverse(target.receiptId, {}).expect(409).expect(res => expect(res.body.code).toBe('ALREADY_CORRECTED'));
    await reverse(rows.find(r => r.reversesReceiptId)!.id, {}).expect(409).expect(res => expect(res.body.code).toBe('RECEIPT_IS_CORRECTION'));
    expect(await net(orderA.id)).toBe(1);
    // A concurrent burst on the other unit lands once.
    const other = (await desk(orderA.id))!.units[0];
    const burst = await Promise.all([1, 2, 3].map(() => reverse(other.receiptId, {})));
    expect(burst.filter(r => r.status === 201)).toHaveLength(1);
    expect(burst.filter(r => r.status === 409)).toHaveLength(2);
    expect(await net(orderA.id)).toBe(0);

    // The unit is receivable again; a correct scan restores verification, and the trail keeps every row.
    expect((await desk(orderA.id))!.lines[0]).toMatchObject({ received: 0, purchased: 2 });
    await scan(orderA.id, { barcodeScanned: skuA.barcode, expiryDate: EXPIRY, lotNumber: 'L1' }).expect(201);
    const last = await scan(orderA.id, { barcodeScanned: skuA.barcode, expiryDate: EXPIRY, lotNumber: 'L1' }).expect(201);
    expect(last.body.order).toMatchObject({ stage: 'packing', shipment: { status: 'prepared' } });
    expect(last.body.order.lines[0]).toMatchObject({ received: 2, verified: 2 });
    expect(await net(orderA.id)).toBe(2);
    expect(await prisma.fulfillmentReceipt.count({ where: { orderId: orderA.id } })).toBe(6);
    const trail = (await http().get(`/fulfillment/orders/${orderA.id}/trail`).set(admin.auth)).body;
    if (trail?.receipts) expect(trail.receipts.filter((r: { reversesReceiptId: string | null }) => r.reversesReceiptId)).toHaveLength(2);

    // Once the parcel is printed, the receipt can no longer be reversed; that is the returns flow's job.
    const shipment = (await desk(orderA.id))!.shipment!;
    await http().post(`/fulfillment/shipments/${shipment.id}/label`).set(hub.auth).expect(201);
    await http().post(`/fulfillment/shipments/${shipment.id}/events`).set(hub.auth).send({ type: 'RECEIPT_PRINTED' }).expect(201);
    const printed = (await desk(orderA.id))!;
    expect(printed.units.every(u => !u.correctable)).toBe(true);
    await reverse(printed.units[0].receiptId, {}).expect(409).expect(res => expect(res.body.code).toBe('ALREADY_PACKED'));
    expect(await net(orderA.id)).toBe(2);
  });

  it('records the physical return inspection separately from any refund, with audited corrections', async () => {
    const itemA = orderA.items[0];
    const created = await reconciliation.createResolution({ orderId: orderA.id, type: 'return', actorId: admin.id, reasonCode: 'DAMAGED', items: [{ orderItemId: itemA.id, quantity: 1 }] });
    // Not approved yet: the Hub has nothing to receive.
    expect((await returns()).find(c => c.resolutionId === created.id)).toBeUndefined();
    await reconciliation.updateResolutionStatus(created.id, 'approved', admin.id, 'approved by admin');
    const listed = (await returns()).find(c => c.resolutionId === created.id)!;
    expect(listed).toMatchObject({ status: 'approved', allInspected: false, refund: null });
    await http().get(`/fulfillment/locations/${locationId}/returns`).set(otherHub.auth).expect(403);
    await http().get(`/fulfillment/locations/${locationId}/returns`).set(driver.auth).expect(403);

    // A different product is rejected and recorded; nothing is inspected.
    const wrong = await inspect(created.id, { orderItemId: itemA.id, barcodeScanned: skuB.barcode }).expect(201);
    expect(wrong.body).toMatchObject({ outcome: 'rejected', code: 'PRODUCT_IDENTITY_MISMATCH' });
    expect(await prisma.hubScanAttempt.count({ where: { orderId: orderA.id, context: 'return', outcomeCode: 'PRODUCT_IDENTITY_MISMATCH' } })).toBe(1);
    expect(await prisma.returnReceipt.count({ where: { resolutionId: created.id } })).toBe(0);
    // Owner policy: only sealed, intact goods go back to the supplier.
    await inspect(created.id, { orderItemId: itemA.id, barcodeScanned: skuA.barcode, result: 'USED', disposition: 'RETURN_TO_SUPPLIER' })
      .expect(400).expect(res => expect(res.body.code).toBe('ONLY_SEALED_GOES_BACK'));
    await inspect(created.id, { orderItemId: itemA.id, barcodeScanned: skuA.barcode, quantity: 5 }).expect(400);

    const key = randomUUID();
    const recorded = await inspect(created.id, { idempotencyKey: key, orderItemId: itemA.id, barcodeScanned: skuA.barcode, result: 'OPENED_UNUSED', lotNumber: 'R1', note: 'cap opened' }).expect(201);
    expect(recorded.body).toMatchObject({ outcome: 'recorded', replayed: false });
    const line = (recorded.body.case as ReturnCase).lines[0];
    expect(line.inspection).toMatchObject({ result: 'OPENED_UNUSED', disposition: 'WRITE_OFF' });
    // Physical receipt moved the return to `received`; it did NOT resolve it or create/decide a refund.
    expect(recorded.body.case).toMatchObject({ status: 'received', allInspected: true, refund: null });
    expect((await prisma.orderResolution.findUniqueOrThrow({ where: { id: created.id } })).status).toBe('received');
    expect(await prisma.refundTransaction.count({ where: { orderId: orderA.id } })).toBe(0);
    const trail = await prisma.orderResolutionEvent.findMany({ where: { resolutionId: created.id }, orderBy: { createdAt: 'asc' } });
    expect(trail.map(e => e.status)).toEqual(['requested', 'approved', 'approved', 'received']);
    expect(trail.some(e => e.notes?.includes('OPENED_UNUSED → WRITE_OFF'))).toBe(true);

    // Replay and double inspection.
    await inspect(created.id, { idempotencyKey: key, orderItemId: itemA.id, barcodeScanned: skuA.barcode, result: 'OPENED_UNUSED' }).expect(201).expect(res => expect(res.body.replayed).toBe(true));
    await inspect(created.id, { orderItemId: itemA.id, barcodeScanned: skuA.barcode }).expect(409);

    // A correction supersedes the inspection (history kept, reason required, exactly once per row).
    const current = line.inspection!;
    const correctUrl = (id: string) => `/fulfillment/locations/${locationId}/returns/${created.id}/inspections/${id}/correct`;
    await http().post(correctUrl(current.id)).set(hub.auth).send({ idempotencyKey: randomUUID(), orderItemId: itemA.id, quantity: 1, result: 'SEALED_INTACT', reason: 'x' }).expect(400);
    const fixed = await http().post(correctUrl(current.id)).set(hub.auth).send({ idempotencyKey: randomUUID(), orderItemId: itemA.id, quantity: 1, result: 'SEALED_INTACT', reason: 'seal was intact on re-check' }).expect(201);
    const corrected = (fixed.body.case as ReturnCase).lines[0];
    expect(corrected.inspection).toMatchObject({ result: 'SEALED_INTACT', disposition: 'RETURN_TO_SUPPLIER' });
    expect(corrected.history).toHaveLength(2);
    await http().post(correctUrl(current.id)).set(hub.auth).send({ idempotencyKey: randomUUID(), orderItemId: itemA.id, quantity: 1, result: 'DAMAGED', reason: 'second try on old row' })
      .expect(409).expect(res => expect(res.body.code).toBe('ALREADY_CORRECTED'));
    await http().post(correctUrl(current.id)).set(otherHub.auth).send({ idempotencyKey: randomUUID(), orderItemId: itemA.id, quantity: 1, result: 'DAMAGED', reason: 'not my hub' }).expect(403);
    expect(await prisma.refundTransaction.count({ where: { orderId: orderA.id } })).toBe(0);
  });

  it('holds goods from a safety report in quarantine, never returns or writes them off', async () => {
    const order = await checkout([{ sku: skuB, quantity: 1 }]);
    await buy(skuB, 1);
    await scan(order.id, { barcodeScanned: skuB.barcode, expiryDate: EXPIRY }).expect(201);
    const resolution = await reconciliation.createResolution({ orderId: order.id, type: 'return', actorId: admin.id, reasonCode: 'POSSIBLE_ADVERSE_EVENT', items: [{ orderItemId: order.items[0].id, quantity: 1 }] });
    await prisma.orderResolution.update({ where: { id: resolution.id }, data: { resolutionDetails: { escalateToSafety: true, requiresPhysicalReturn: true } } });
    await reconciliation.updateResolutionStatus(resolution.id, 'approved', admin.id);
    await inspect(resolution.id, { orderItemId: order.items[0].id, barcodeScanned: skuB.barcode, disposition: 'WRITE_OFF' })
      .expect(400).expect(res => expect(res.body.code).toBe('SAFETY_REPORT_QUARANTINE'));
    const held = await inspect(resolution.id, { orderItemId: order.items[0].id, barcodeScanned: skuB.barcode, result: 'OPENED_UNUSED' }).expect(201);
    expect((held.body.case as ReturnCase).lines[0].inspection).toMatchObject({ disposition: 'QUARANTINE' });
  });
});
