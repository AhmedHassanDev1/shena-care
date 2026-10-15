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

const MANUAL = { manualReason: 'New outer carton; brand, variant, size and pack checked against the catalog', manualChecks: ['brand', 'variant', 'size', 'pack'] };

/**
 * GLO-242: a manufacturer barcode is evidence, not identity. Reviewed aliases let legacy and new
 * packaging resolve to the same canonical SKU; unknown/retired codes need review; a code naming two
 * SKUs is ambiguous and blocks; manual verification is explicit, audited and still bound by order and
 * quantity guards; damaged goods are held as a receiving exception.
 */
describe('GLO-242 canonical product identity at Hub receiving and preparation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: DomainEventsService;
  let admin: Actor; let hub: Actor;
  let locationId: string;
  const http = () => request(app.getHttpServer());

  const settleEvents = async (aggregateId: string) => {
    for (let i = 0; i < 100; i++) {
      await events.dispatchPending({ aggregateId });
      if (!await prisma.domainEvent.count({ where: { aggregateId, status: { not: 'delivered' } } })) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  };
  const approve = (actor: Actor, body: Record<string, unknown>) => http().post('/catalog/barcode-aliases').set(actor.auth)
    .send({ source: 'packaging_revision', evidenceRef: 'photo:carton-2026-10', reason: 'Manufacturer repackaged; same formula and size', ...body });
  /** A ready-to-prepare shipment of `quantity` units of `skuId` with a started preparation session. */
  const session = async (skuId: string, quantity: number) => {
    const order = await prisma.order.create({ data: {
      orderNumber: 'ORD-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(), customerName: 'Scan', customerPhone: '01012345678',
      shippingAddress: '2 Scan St', totalAmount: 100, currency: 'EGP', status: 'packing',
    } });
    const shipment = await prisma.shipment.create({ data: { orderId: order.id, locationId, status: 'ready_to_prepare', items: { create: [{ skuId, quantity }] } } });
    const started = await http().post(`/fulfillment/shipments/${shipment.id}/preparation`).set(hub.auth).send({}).expect(201);
    return started.body.id as string;
  };
  const scan = (sessionId: string, body: Record<string, unknown>) =>
    http().post(`/fulfillment/preparation-sessions/${sessionId}/scan`).set(hub.auth).send(body);

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useValue(new DeterministicAiClient()).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useLogger(false);
    await app.init();
    prisma = app.get(PrismaService);
    events = app.get(DomainEventsService);
    admin = await createActor(prisma, 'ADMIN');
    hub = await createActor(prisma, 'HUB_OPERATOR');
    locationId = (await prisma.fulfillmentLocation.create({ data: { name: 'Identity Hub ' + randomUUID(), address: 'Cairo' } })).id;
    await prisma.fulfillmentLocationOperator.create({ data: { locationId, operatorId: hub.id } });
  });
  afterAll(async () => { if (app) await app.close(); });

  it('legacy and reviewed new packaging resolve to the same SKU without double counting', async () => {
    const sku = await createSellableSku(prisma);
    const newCode = 'NEWPKG-' + randomUUID().slice(0, 12);
    const sessionId = await session(sku.id, 2);

    const unknown = await scan(sessionId, { barcodeScanned: newCode }).expect(201);
    expect(unknown.body).toMatchObject({ isSuccessful: false, errorReason: 'PRODUCT_IDENTITY_REVIEW_REQUIRED', barcodeScanned: newCode, operatorId: hub.id });
    await http().post(`/fulfillment/preparation-sessions/${sessionId}/complete`).set(hub.auth).expect(400);

    // Only a catalog reviewer approves a global alias; hub, supplier and invalid input are refused.
    const supplier = await createActor(prisma, 'SUPPLIER', sku.supplierId);
    await approve(hub, { barcode: newCode, skuId: sku.id }).expect(403);
    await approve(supplier, { barcode: newCode, skuId: sku.id }).expect(403);
    await approve(admin, { barcode: newCode, skuId: sku.id, source: 'looks_similar' }).expect(400);
    await approve(admin, { barcode: newCode, skuId: sku.id, reason: '' }).expect(400);
    await approve(admin, { barcode: sku.barcode, skuId: sku.id }).expect(400); // already its primary code
    const alias = await approve(admin, { barcode: newCode, skuId: sku.id }).expect(201);
    expect(alias.body).toMatchObject({ status: 'approved', approvedBy: admin.id, evidenceRef: 'photo:carton-2026-10' });
    expect((await approve(admin, { barcode: newCode, skuId: sku.id }).expect(201)).body.id).toBe(alias.body.id);

    expect((await scan(sessionId, { barcodeScanned: sku.barcode }).expect(201)).body).toMatchObject({ isSuccessful: true, verificationMethod: 'primary_barcode' });
    expect((await scan(sessionId, { barcodeScanned: newCode }).expect(201)).body).toMatchObject({ isSuccessful: true, verificationMethod: 'barcode_alias', skuId: sku.id });
    expect((await scan(sessionId, { barcodeScanned: newCode }).expect(201)).body).toMatchObject({ isSuccessful: false, errorReason: 'EXCESS_QUANTITY' });
    await http().post(`/fulfillment/preparation-sessions/${sessionId}/complete`).set(hub.auth).expect(201);

    // Retired codes stop resolving.
    await http().patch(`/catalog/barcode-aliases/${alias.body.id}/retire`).set(admin.auth).expect(200);
    const after = await session(sku.id, 1);
    expect((await scan(after, { barcodeScanned: newCode }).expect(201)).body.errorReason).toBe('PRODUCT_IDENTITY_REVIEW_REQUIRED');
  });

  it('blocks ambiguous codes and keeps a different size a different SKU', async () => {
    const sku = await createSellableSku(prisma);
    const bigger = await createSellableSku(prisma); // e.g. the 100 ml sibling with its own barcode
    // A code that already identifies another SKU can never become an alias.
    expect((await approve(admin, { barcode: bigger.barcode, skuId: sku.id }).expect(409)).body.code).toBe('BARCODE_AMBIGUOUS');
    const shared = 'SHARED-' + randomUUID().slice(0, 12);
    await approve(admin, { barcode: shared, skuId: sku.id }).expect(201);
    expect((await approve(admin, { barcode: shared, skuId: bigger.id }).expect(409)).body.code).toBe('BARCODE_AMBIGUOUS');
    // Inconsistent historical data (same code approved for two SKUs) is detected at scan time: no "first match".
    const legacyDup = 'DUP-' + randomUUID().slice(0, 12);
    await prisma.skuBarcodeAlias.createMany({ data: [sku.id, bigger.id].map(skuId => ({
      barcode: legacyDup, skuId, source: 'other', reason: 'imported', approvedBy: admin.id,
    })) });

    const sessionId = await session(sku.id, 1);
    expect((await scan(sessionId, { barcodeScanned: legacyDup }).expect(201)).body).toMatchObject({ isSuccessful: false, errorReason: 'PRODUCT_IDENTITY_AMBIGUOUS' });
    expect((await scan(sessionId, { barcodeScanned: bigger.barcode }).expect(201)).body).toMatchObject({ isSuccessful: false, errorReason: 'WRONG_ITEM', skuId: bigger.id });
    expect(await prisma.preparationScanEvent.count({ where: { sessionId, isSuccessful: true } })).toBe(0);
  });

  it('manual verification is explicit, audited and still bound by item and quantity guards', async () => {
    const sku = await createSellableSku(prisma);
    const other = await createSellableSku(prisma);
    const sessionId = await session(sku.id, 1);
    await scan(sessionId, { skuId: sku.id }).expect(400);
    await scan(sessionId, { skuId: sku.id, manualReason: 'trust me' }).expect(400);
    await scan(sessionId, { skuId: sku.id, ...MANUAL, manualChecks: ['brand', 'variant'] }).expect(400);
    await scan(sessionId, { skuId: sku.id, ...MANUAL, manualChecks: ['brand', 'variant', 'size', 'pack', 'vibes'] }).expect(400);
    await scan(sessionId, { barcodeScanned: sku.barcode, ...MANUAL }).expect(400);
    expect((await scan(sessionId, { skuId: other.id, ...MANUAL }).expect(201)).body).toMatchObject({ isSuccessful: false, errorReason: 'WRONG_ITEM' });
    // Concurrent manual and barcode scans for the last unit: exactly one counts.
    const raced = await Promise.all([scan(sessionId, { skuId: sku.id, ...MANUAL }), scan(sessionId, { barcodeScanned: sku.barcode })]);
    expect(raced.map(r => r.body.isSuccessful).sort()).toEqual([false, true]);
    const counted = await prisma.preparationScanEvent.findFirstOrThrow({ where: { sessionId, isSuccessful: true } });
    expect(counted.operatorId).toBe(hub.id);
    if (counted.verificationMethod === 'manual') expect(counted.manualReason).toBe(MANUAL.manualReason);
  });

  it('receiving needs identity evidence; unknown, mismatched and damaged goods are not received', async () => {
    const sku = await createSellableSku(prisma);
    const other = await createSellableSku(prisma);
    const supplier = await createActor(prisma, 'SUPPLIER', sku.supplierId);
    const order = await placeGuestOrder(app.getHttpServer(), [{ skuId: sku.id, quantity: 3 }]);
    await settleEvents(order.id);
    const [po] = (await http().post('/purchase-orders/batches').set(admin.auth).send({ supplierId: sku.supplierId }).expect(201)).body.purchaseOrders;
    await http().post(`/purchase-orders/${po.id}/confirm`).set(supplier.auth).send({ lines: [{ id: po.lines[0].id, status: 'confirmed_full' }] }).expect(201);
    await settleEvents(po.id);
    const link = po.lines[0].allocations[0];
    const receive = (extra: Record<string, unknown>, idempotencyKey = randomUUID()) => http().post('/fulfillment/receipts').set(hub.auth).send({
      locationId, allocationId: link.sourceAllocationId, orderId: order.id, orderItemId: link.orderItemId, skuId: sku.id,
      variantName: sku.variantName, quantity: 1, condition: 'ACCEPTABLE', idempotencyKey, ...extra,
    });

    await receive({}).expect(400); // no identity evidence
    expect((await receive({ barcodeScanned: 'NOPE-' + randomUUID() }).expect(409)).body.code).toBe('PRODUCT_IDENTITY_REVIEW_REQUIRED');
    expect((await receive({ barcodeScanned: other.barcode }).expect(409)).body.code).toBe('PRODUCT_IDENTITY_MISMATCH');
    await receive({ ...MANUAL, manualChecks: ['brand'] }).expect(400);
    expect(await prisma.fulfillmentReceipt.count({ where: { orderId: order.id } })).toBe(0);

    const damagedKey = randomUUID();
    const damaged = await receive({ barcodeScanned: sku.barcode, condition: 'DAMAGED' }, damagedKey).expect(400);
    expect(damaged.body.code).toBe('RECEIVING_EXCEPTION');
    await receive({ barcodeScanned: sku.barcode, condition: 'DAMAGED' }, damagedKey).expect(400); // retry → same case
    expect(await prisma.supportCase.count({ where: { orderId: order.id, title: { contains: 'Receiving exception' } } })).toBe(1);
    expect(await prisma.fulfillmentReceipt.count({ where: { orderId: order.id } })).toBe(0);

    const alias = 'RCVPKG-' + randomUUID().slice(0, 12);
    await approve(admin, { barcode: alias, skuId: sku.id }).expect(201);
    await receive({ barcodeScanned: alias }).expect(201);
    await receive({ ...MANUAL }).expect(201);
    const receipts = await prisma.fulfillmentReceipt.findMany({ where: { orderId: order.id }, orderBy: { receivedAt: 'asc' } });
    expect(receipts.map(r => [r.identityMethod, r.barcodeScanned])).toEqual([['barcode_alias', alias], ['manual', null]]);
    expect(receipts[1].identityNote).toBe(MANUAL.manualReason);
  });
});
