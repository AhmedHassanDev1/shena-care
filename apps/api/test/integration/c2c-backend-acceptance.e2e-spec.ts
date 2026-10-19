import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { DomainEventsService } from '../../src/platform/events/domain-events.service';
import { OutboxService } from '../../src/modules/operations/services/outbox.service';
import { AiClient } from '../../src/platform/ai';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { createActor, Actor } from '../fixtures/actors';
import { createSellableSku } from '../fixtures/sellable-sku';
import { CAIRO_PIN, signInCustomer } from '../fixtures/checkout';
import { CartService } from '../../src/modules/ordering/services/cart.service';

/**
 * GLO-235 C1 GATE — one persisted, replayable Cart → Cash run through the real HTTP API and a
 * disposable PostgreSQL *_test database. The same identities (order, allocations, PO, shipment,
 * collection, settlement, payable, refund) are followed end to end; critical negative, authorization
 * and replay checks are asserted at the step where they matter. Steps are ordered and share state.
 */
describe('C1 backend Cart-to-Cash acceptance (GLO-235)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: DomainEventsService;
  const http = () => request(app.getHttpServer());

  // Actors with real sessions.
  let admin: Actor; let hub: Actor; let hubB: Actor; let driver: Actor; let otherDriver: Actor;
  let supplier: Actor; let otherSupplier: Actor; let customer: Actor;
  // Canonical identities followed through the run.
  let serum: Awaited<ReturnType<typeof createSellableSku>>;
  let cleanser: Awaited<ReturnType<typeof createSellableSku>>;
  let hubId: string; let hubBId: string;
  let cartToken: string;
  let order: { id: string; orderNumber: string; codAmount: number; totalAmount: number; items: Array<{ id: string; skuId: string; quantity: number }> };
  let secondOrder: { id: string; items: Array<{ id: string; skuId: string; quantity: number }> };
  let purchaseOrder: { id: string; lines: Array<{ id: string; skuId: string; requestedQuantity: number; allocations: Array<{ sourceAllocationId: string; orderId: string; orderItemId: string; quantity: number }> }> };
  let shipmentId: string; let barcode: string;
  let firstRun: string; let secondRun: string;

  const settleEvents = async (aggregateId: string) => {
    for (let i = 0; i < 100; i++) {
      await events.dispatchPending({ aggregateId });
      if (!await prisma.domainEvent.count({ where: { aggregateId, status: { not: 'delivered' } } })) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`events for ${aggregateId} not delivered`);
  };
  const itemOf = (o: { items: Array<{ id: string; skuId: string }> }, skuId: string) => o.items.find(i => i.skuId === skuId)!;
  const linkFor = (orderId: string, skuId: string) => purchaseOrder.lines.find(l => l.skuId === skuId)!.allocations.find(a => a.orderId === orderId)!;
  const checkoutBody = (quote: { quoteVersion: string; revision: number }, extra: Record<string, unknown> = {}) => ({
    governorate: 'Cairo', area: 'Maadi', customerName: 'Nour Customer', customerPhone: '01012345678',
    shippingAddress: '12 Road 9, Maadi', notes: 'Call on arrival', ...CAIRO_PIN,
    quoteVersion: quote.quoteVersion, cartRevision: quote.revision, idempotencyKey: randomUUID(), ...extra,
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useValue(new DeterministicAiClient()).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useLogger(false);
    await app.init();
    prisma = app.get(PrismaService);
    events = app.get(DomainEventsService);

    serum = await createSellableSku(prisma);    // 100 EGP, supplier offer 50 EGP
    cleanser = await createSellableSku(prisma); // 100 EGP, its own supplier
    // Both SKUs are sourced from ONE supplier so a single consolidated PO carries both lines.
    await prisma.supplierOffer.create({ data: { supplierId: serum.supplierId, skuId: cleanser.id, costPrice: 40, currency: 'EGP', lastObservedAt: new Date(), lastConfirmedAt: new Date() } });
    await prisma.supplierOffer.updateMany({ where: { supplierId: cleanser.supplierId, skuId: cleanser.id }, data: { isAvailable: false } });

    admin = await createActor(prisma, 'ADMIN');
    hub = await createActor(prisma, 'HUB_OPERATOR');
    hubB = await createActor(prisma, 'HUB_OPERATOR');
    driver = await createActor(prisma, 'DRIVER');
    otherDriver = await createActor(prisma, 'DRIVER');
    supplier = await createActor(prisma, 'SUPPLIER', serum.supplierId);
    otherSupplier = await createActor(prisma, 'SUPPLIER', cleanser.supplierId);
    customer = await createActor(prisma, 'CUSTOMER');
    hubId = (await prisma.fulfillmentLocation.create({ data: { name: 'C2C Hub ' + randomUUID(), address: 'Maadi, Cairo' } })).id;
    hubBId = (await prisma.fulfillmentLocation.create({ data: { name: 'C2C Hub B ' + randomUUID(), address: 'Dokki, Giza' } })).id;
    await prisma.fulfillmentLocationOperator.create({ data: { locationId: hubId, operatorId: hub.id } });
    await prisma.fulfillmentLocationOperator.create({ data: { locationId: hubBId, operatorId: hubB.id } });
  });
  afterAll(async () => { if (app) await app.close(); });

  it('1. cart, authoritative quote, price-change 409 and re-quote, idempotent COD order with a confirmed pin', async () => {
    const added = await http().post('/ordering/cart/add').send({ skuId: serum.id, quantity: 1 }).expect(201);
    cartToken = added.body.guestCartToken;
    const second = await http().post('/ordering/cart/add').set('x-cart-token', cartToken).send({ skuId: cleanser.id, quantity: 1 }).expect(201);
    // Quantities are server-side and revisioned: a stale revision is refused.
    await http().patch('/ordering/cart/quantity').set('x-cart-token', cartToken).send({ skuId: serum.id, quantity: 2, expectedRevision: second.body.revision - 1 }).expect(409);
    await http().patch('/ordering/cart/quantity').set('x-cart-token', cartToken).send({ skuId: serum.id, quantity: 2, expectedRevision: second.body.revision }).expect(200);
    // «إتمام الطلب» needs an account: phone sign-in adopts the guest cart (CUSTOMER_VERIFIED_EVENT), then the customer checks out.
    await app.get(CartService).adoptGuestCart(customer.id, cartToken);
    await http().post('/ordering/checkout').set('x-cart-token', cartToken).send({}).expect(401);

    const address = { governorate: 'Cairo', area: 'Maadi' };
    const quote = (await http().post('/ordering/checkout/quote').set(customer.auth).send(address).expect(201)).body;
    expect(quote).toMatchObject({ subtotal: 300, shippingFee: 50, totalAmount: 350, codAmount: 350, currency: 'EGP' });

    // The catalog price changes after the quote: the old quote is refused, nothing is consumed.
    const raise = await prisma.sellingPrice.create({ data: { skuId: serum.id, amount: 110, currency: 'EGP', validFrom: new Date(), isActive: true } });
    expect((await http().post('/ordering/checkout').set(customer.auth).send(checkoutBody(quote)).expect(409)).body.code).toBe('CHECKOUT_REVIEW_REQUIRED');
    await prisma.sellingPrice.delete({ where: { id: raise.id } });
    const requote = (await http().post('/ordering/checkout/quote').set(customer.auth).send(address).expect(201)).body;

    // Missing / out-of-area pins are refused by the owner backend.
    await http().post('/ordering/checkout').set(customer.auth).send(checkoutBody(requote, { latitude: undefined })).expect(400);
    expect((await http().post('/ordering/checkout').set(customer.auth)
      .send(checkoutBody(requote, { latitude: 31.2001, longitude: 29.9187 })).expect(422)).body.code).toBe('OUT_OF_SERVICE_AREA');

    const body = checkoutBody(requote);
    const placed = await http().post('/ordering/checkout').set(customer.auth).send(body).expect(201);
    const replay = await http().post('/ordering/checkout').set(customer.auth).send(body).expect(201);
    expect(replay.body.id).toBe(placed.body.id);
    expect(await prisma.order.count({ where: { idempotencyKey: body.idempotencyKey } })).toBe(1);
    order = placed.body;
    expect(placed.body).toMatchObject({ status: 'placed', totalAmount: 350, codAmount: 350, latitude: CAIRO_PIN.latitude, longitude: CAIRO_PIN.longitude, paymentMethod: 'COD' });
    expect(order.items.map(i => [i.skuId, i.quantity]).sort()).toEqual([[cleanser.id, 1], [serum.id, 2]].sort());
    expect((await http().get('/ordering/cart').set(customer.auth).expect(200)).body.items).toHaveLength(0);
  });

  it('2. durable order.placed creates exactly one supply plan; a second order shares the consolidated PO', async () => {
    expect(await prisma.domainEvent.count({ where: { aggregateId: order.id, eventType: 'order.placed' } })).toBe(1);
    await settleEvents(order.id);
    const plan = (await http().get(`/sourcing/supply-plans/orders/${order.id}`).set(admin.auth).expect(200)).body;
    expect(plan.status).toBe('CONFIRMING');
    expect(plan.lines.every((l: { allocations: Array<{ result: string }> }) => l.allocations.length === 1 && l.allocations[0].result === 'pending')).toBe(true);
    await http().get(`/sourcing/supply-plans/orders/${order.id}`).set(customer.auth).expect(403);

    // Another customer orders the same serum.
    const added = await http().post('/ordering/cart/add').send({ skuId: serum.id, quantity: 1 }).expect(201);
    const secondCustomer = await signInCustomer(app, added.body.guestCartToken);
    const quote = (await http().post('/ordering/checkout/quote').set(secondCustomer.auth).send({ governorate: 'Giza', area: 'Dokki' }).expect(201)).body;
    secondOrder = (await http().post('/ordering/checkout').set(secondCustomer.auth)
      .send(checkoutBody(quote, { governorate: 'Giza', area: 'Dokki', latitude: 30.0386, longitude: 31.2122, customerName: 'Second Customer' })).expect(201)).body;
    await settleEvents(secondOrder.id);

    const flushed = (await http().post('/purchase-orders/batches').set(admin.auth).send({ supplierId: serum.supplierId }).expect(201)).body;
    expect(flushed.purchaseOrders).toHaveLength(1);
    purchaseOrder = flushed.purchaseOrders[0];
    const serumLine = purchaseOrder.lines.find(l => l.skuId === serum.id)!;
    expect(serumLine).toMatchObject({ requestedQuantity: 3 });
    expect(serumLine.allocations.map(a => [a.orderId, a.quantity]).sort()).toEqual([[order.id, 2], [secondOrder.id, 1]].sort());
    expect(purchaseOrder.lines.find(l => l.skuId === cleanser.id)).toMatchObject({ requestedQuantity: 1, unitCost: '40' });
    expect((await http().post('/purchase-orders/batches').set(admin.auth).send({ supplierId: serum.supplierId }).expect(201)).body.purchaseOrders).toHaveLength(0);
  });

  it('3. supplier confirms its own PO only; Ready is not a Hub receipt', async () => {
    await http().get(`/purchase-orders/${purchaseOrder.id}`).set(otherSupplier.auth).expect(403);
    const confirmation = { lines: purchaseOrder.lines.map(l => ({ id: l.id, status: 'confirmed_full' })) };
    await http().post(`/purchase-orders/${purchaseOrder.id}/confirm`).set(otherSupplier.auth).send(confirmation).expect(403);
    const seen = await http().get(`/purchase-orders/${purchaseOrder.id}`).set(supplier.auth).expect(200);
    expect(JSON.stringify(seen.body)).not.toMatch(/Nour Customer|01012345678|Road 9/);
    await http().post(`/purchase-orders/${purchaseOrder.id}/confirm`).set(supplier.auth).send(confirmation).expect(201);
    await http().post(`/purchase-orders/${purchaseOrder.id}/confirm`).set(supplier.auth).send(confirmation).expect(201); // late duplicate
    await settleEvents(purchaseOrder.id);
    expect((await http().get(`/sourcing/supply-plans/orders/${order.id}`).set(admin.auth).expect(200)).body.status).toBe('COVERED');
    await http().post(`/purchase-orders/${purchaseOrder.id}/ready`).set(supplier.auth).expect(201);
    expect(await prisma.fulfillmentReceipt.count({ where: { orderId: order.id } })).toBe(0);
  });

  it('4. Hub receives real quantities against the lineage with identity evidence', async () => {
    const receive = (o: { id: string; items: Array<{ id: string; skuId: string }> }, sku: typeof serum, quantity: number, extra: Record<string, unknown> = {}) =>
      http().post('/fulfillment/receipts').set(hub.auth).send({
        locationId: hubId, allocationId: linkFor(o.id, sku.id).sourceAllocationId, orderId: o.id, orderItemId: itemOf(o, sku.id).id,
        skuId: sku.id, variantName: sku.variantName, barcodeScanned: sku.barcode, quantity, condition: 'ACCEPTABLE', idempotencyKey: randomUUID(), ...extra,
      });
    const receivables = await http().get(`/fulfillment/locations/${hubId}/receivables`).set(hub.auth).expect(200);
    expect(receivables.body.filter((r: { orderId: string }) => r.orderId === order.id)).toHaveLength(2);
    await http().get(`/fulfillment/locations/${hubId}/receivables`).set(hubB.auth).expect(403);

    expect((await receive(order, serum, 1, { barcodeScanned: cleanser.barcode }).expect(409)).body.code).toBe('PRODUCT_IDENTITY_MISMATCH');
    await receive(order, serum, 3).expect(400); // more than confirmed for this order
    await receive(order, serum, 2).expect(201);
    await receive(order, cleanser, 1).expect(201);
    const shipment = await prisma.shipment.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(shipment).toMatchObject({ locationId: hubId, status: 'ready_to_prepare' });
    shipmentId = shipment.id;
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('packing');
    expect((await prisma.supplierPurchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrder.id } })).status).toBe('ready'); // second order's unit outstanding
    await receive(secondOrder, serum, 1).expect(201);
    expect((await prisma.supplierPurchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrder.id } })).status).toBe('received_at_hub');
  });

  it('5. barcode-verified preparation, thermal documents, truthful print status, packed identity', async () => {
    const session = (await http().post(`/fulfillment/shipments/${shipmentId}/preparation`).set(hub.auth).send({}).expect(201)).body;
    const scan = (code: string) => http().post(`/fulfillment/preparation-sessions/${session.id}/scan`).set(hub.auth).send({ barcodeScanned: code }).expect(201);
    expect((await scan('UNKNOWN-' + randomUUID())).body.errorReason).toBe('PRODUCT_IDENTITY_REVIEW_REQUIRED');
    await scan(serum.barcode!); await scan(serum.barcode!);
    expect((await scan(serum.barcode!)).body.errorReason).toBe('EXCESS_QUANTITY');
    await http().post(`/fulfillment/preparation-sessions/${session.id}/complete`).set(hub.auth).expect(400); // cleanser missing
    await scan(cleanser.barcode!);
    await http().post(`/fulfillment/preparation-sessions/${session.id}/complete`).set(hub.auth).expect(201);

    const docs = (await http().get(`/fulfillment/shipments/${shipmentId}/documents`).set(hub.auth).expect(200)).body;
    expect(docs.customerReceipt).toMatchObject({ orderNumber: order.orderNumber, total: 350, codDue: 350 });
    expect(docs.customerReceipt.lines).toHaveLength(2);
    expect(docs.shippingSlip).toMatchObject({ orderNumber: order.orderNumber, codDue: 350, itemCount: 3 });
    expect(JSON.stringify(docs.shippingSlip)).not.toMatch(/unitPrice|lineTotal/);
    barcode = (await http().post(`/fulfillment/shipments/${shipmentId}/label`).set(hub.auth).expect(201)).body.barcode;
    expect(barcode).toBe(docs.shippingSlip.barcode);
    await http().post(`/fulfillment/shipments/${shipmentId}/events`).set(hub.auth).send({ type: 'LABEL_PRINTED' }).expect(201);
    await http().post(`/fulfillment/shipments/${shipmentId}/events`).set(hub.auth).send({ type: 'PACKED' }).expect(201);
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })).status).toBe('packed');
  });

  it('6. assigned driver manifest with secured pin, custody scan, atomic dispatch, failed attempt and retry', async () => {
    firstRun = (await http().post('/fulfillment/delivery-batches').set(hub.auth).send({ hubId, name: 'Morning run', driverId: driver.id }).expect(201)).body.id;
    await http().post(`/fulfillment/delivery-batches/${firstRun}/stops`).set(hub.auth).send({ stops: [{ shipmentId }] }).expect(201);
    const manifest = (await http().get('/fulfillment/driver/runs').set(driver.auth).expect(200)).body;
    const stop = manifest.flatMap((r: { stops: unknown[] }) => r.stops).find((s: { shipmentId: string }) => s.shipmentId === shipmentId);
    expect(stop).toMatchObject({ orderNumber: order.orderNumber, codDue: 350, location: { latitude: CAIRO_PIN.latitude, longitude: CAIRO_PIN.longitude } });
    expect(JSON.stringify((await http().get('/fulfillment/driver/runs').set(otherDriver.auth).expect(200)).body)).not.toContain(shipmentId);
    await http().get(`/fulfillment/shipments/${shipmentId}`).set(otherDriver.auth).expect(404);

    await http().post(`/fulfillment/shipments/${shipmentId}/events`).set(driver.auth).send({ type: 'HANDOFF_SCANNED', barcode: 'SHP-wrong' }).expect(400);
    const custody = await http().post(`/fulfillment/shipments/${shipmentId}/events`).set(driver.auth).send({ type: 'HANDOFF_SCANNED', barcode }).expect(201);
    expect((await http().post(`/fulfillment/shipments/${shipmentId}/events`).set(driver.auth).send({ type: 'HANDOFF_SCANNED', barcode }).expect(201)).body.id).toBe(custody.body.id);
    await http().post(`/fulfillment/delivery-batches/${firstRun}/dispatch`).set(driver.auth).expect(403);
    await http().post(`/fulfillment/delivery-batches/${firstRun}/dispatch`).set(hub.auth).expect(201);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('shipped');
    const expected = await prisma.paymentCollection.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(expected).toMatchObject({ status: 'expected', locationId: hubId });
    expect(Number(expected.expectedAmount)).toBe(350);

    // Nobody home: failed attempt → back at the hub → next run.
    await http().post(`/fulfillment/shipments/${shipmentId}/events`).set(driver.auth).send({ type: 'FAILED', reasonCode: 'CUSTOMER_UNREACHABLE' }).expect(201);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('shipped');
    await http().post(`/fulfillment/shipments/${shipmentId}/events`).set(hub.auth).send({ type: 'RECEIVED_BACK', barcode }).expect(201);
    secondRun = (await http().post('/fulfillment/delivery-batches').set(hub.auth).send({ hubId, name: 'Evening run', driverId: driver.id }).expect(201)).body.id;
    await http().post(`/fulfillment/delivery-batches/${secondRun}/stops`).set(hub.auth).send({ stops: [{ shipmentId }] }).expect(201);
    await http().post(`/fulfillment/shipments/${shipmentId}/events`).set(driver.auth).send({ type: 'HANDOFF_SCANNED', barcode }).expect(201);
    await http().post(`/fulfillment/delivery-batches/${secondRun}/dispatch`).set(hub.auth).expect(201);
    expect(await prisma.orderStatusEvent.count({ where: { orderId: order.id, status: 'shipped' } })).toBe(1);
  });

  it('7. delivery with door-cash declaration; staff cannot fake a COD delivery', async () => {
    expect((await http().patch(`/fulfillment/shipments/${shipmentId}/status`).set(admin.auth).send({ status: 'delivered' }).expect(409)).body.code)
      .toBe('COD_DELIVERY_REQUIRES_DRIVER');
    await http().post(`/fulfillment/shipments/${shipmentId}/events`).set(driver.auth).send({ type: 'DELIVERED' }).expect(400);
    await http().post(`/fulfillment/shipments/${shipmentId}/events`).set(driver.auth).send({ type: 'DELIVERED', collectedAmount: 350 }).expect(201);
    await http().post(`/fulfillment/shipments/${shipmentId}/events`).set(driver.auth).send({ type: 'DELIVERED', collectedAmount: 350 }).expect(201); // replay
    await http().post(`/fulfillment/shipments/${shipmentId}/events`).set(driver.auth).send({ type: 'DELIVERED', collectedAmount: 300 }).expect(409);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('delivered');
    expect(await prisma.paymentCollection.findUniqueOrThrow({ where: { orderId: order.id } })).toMatchObject({ status: 'collected', courierId: driver.id });
    expect((await prisma.deliveryStop.findMany({ where: { shipmentId }, orderBy: { createdAt: 'asc' } })).map(s => s.status)).toEqual(['failed', 'delivered']);
    const tracking = await http().get(`/ordering/orders/${order.orderNumber}/tracking`).set(customer.auth).expect(200);
    expect(tracking.body.status).toBe('DELIVERED');
  });

  it('8. physical cash count settles exactly once at the right hub for the right courier', async () => {
    const count = (actor: Actor, extra: Record<string, unknown> = {}) => http().post('/ordering/settlements/batch').set(actor.auth).send({
      courierId: driver.id, locationId: hubId, reference: 'CNT-' + order.orderNumber, currency: 'EGP', totalCollected: 350,
      collections: [{ orderId: order.id, collectedAmount: 350 }], ...extra,
    });
    await count(hubB).expect(403);
    await count(driver).expect(403);
    expect((await count(hub, { courierId: otherDriver.id, reference: 'CNT-X-' + randomUUID() }).expect(409)).body.code).toBe('COURIER_MISMATCH');
    const settled = await count(hub).expect(201);
    expect(settled.body.lines).toEqual([expect.objectContaining({ orderId: order.id, expectedAmount: '350.00', declaredAmount: '350.00', countedAmount: '350.00', variance: '0.00', status: 'settled' })]);
    expect((await count(hub).expect(201)).body.id).toBe(settled.body.id); // replayed count
    await count(admin, { reference: 'CNT-AGAIN-' + randomUUID() }).expect(409); // never twice
    expect(await prisma.courierSettlementBatch.count({ where: { collections: { some: { orderId: order.id } } } })).toBe(1);
  });

  it('9. supplier payable from received quantity at the PO cost snapshot, paid once', async () => {
    await prisma.supplierOffer.updateMany({ where: { supplierId: serum.supplierId }, data: { costPrice: 999 } }); // live price moves later
    const payable = (await http().post(`/sourcing/purchase-orders/${purchaseOrder.id}/payable`).set(admin.auth).expect(201)).body;
    expect(payable).toMatchObject({ amount: '190', currency: 'EGP' }); // 3 × 50 + 1 × 40
    expect((await http().post(`/sourcing/purchase-orders/${purchaseOrder.id}/payable`).set(admin.auth).expect(201)).body.id).toBe(payable.id);
    await http().patch(`/sourcing/payables/${payable.id}/mark-paid`).set(admin.auth).send({ paymentRef: 'BANK-TRX-0042' }).expect(200);
  });

  it('10. item return and manual COD refund: bounded by cash received, paid only with proof, once', async () => {
    const claim = await http().post('/ordering/resolutions').set(admin.auth).send({
      orderId: order.id, type: 'return', actorId: 'ignored', reasonCode: 'DAMAGED_IN_USE', items: [{ orderItemId: itemOf(order, cleanser.id).id, quantity: 1 }],
    }).expect(201);
    await http().patch(`/ordering/resolutions/${claim.body.id}/status`).set(admin.auth).send({ status: 'approved', actorId: 'ignored' }).expect(200);
    await http().post(`/ordering/resolutions/${claim.body.id}/refund`).set(admin.auth).send({ amount: 351, currency: 'EGP' }).expect(400);
    await http().post(`/ordering/resolutions/${claim.body.id}/refund`).set(admin.auth).send({ amount: 100, currency: 'EGP', paymentProvider: 'cash' }).expect(201);
    await http().post(`/ordering/resolutions/${claim.body.id}/refund`).set(admin.auth).send({ amount: 100, currency: 'EGP' }).expect(400);
    await http().patch(`/ordering/resolutions/${claim.body.id}/refund/status`).set(admin.auth).send({ status: 'succeeded' }).expect(400);
    await http().patch(`/ordering/resolutions/${claim.body.id}/refund/status`).set(hub.auth).send({ status: 'succeeded', providerRef: 'VOUCHER-7' }).expect(403);
    await http().patch(`/ordering/resolutions/${claim.body.id}/refund/status`).set(admin.auth).send({ status: 'succeeded', providerRef: 'VOUCHER-7' }).expect(200);
    expect(await prisma.refundTransaction.count({ where: { orderId: order.id } })).toBe(1);
  });

  it('11. the second order is cancelled with its goods at the hub: audited, released, exception opened', async () => {
    const cancelled = await http().post(`/ordering/orders/${secondOrder.id}/cancel`).set(admin.auth).send({ reasonCode: 'CUSTOMER_REQUEST' }).expect(201);
    expect(cancelled.body).toMatchObject({ goodsReceived: true });
    expect(cancelled.body.exceptionCaseId).toEqual(expect.any(String));
    expect(await prisma.shipment.findUniqueOrThrow({ where: { orderId: secondOrder.id } })).toMatchObject({ status: 'cancelled' });
  });

  it('12. cross-domain state is consistent and nothing reports success that did not happen', async () => {
    const [finalOrder, finalShipment, collection, po, payable, refund] = await Promise.all([
      prisma.order.findUniqueOrThrow({ where: { id: order.id } }),
      prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } }),
      prisma.paymentCollection.findUniqueOrThrow({ where: { orderId: order.id }, include: { settlementBatch: true } }),
      prisma.supplierPurchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrder.id } }),
      prisma.supplierPayable.findUniqueOrThrow({ where: { purchaseOrderId: purchaseOrder.id } }),
      prisma.refundTransaction.findFirstOrThrow({ where: { orderId: order.id } }),
    ]);
    expect(finalOrder.status).toBe('delivered');
    expect(finalShipment.status).toBe('delivered');
    expect(collection).toMatchObject({ status: 'settled', courierId: driver.id, locationId: hubId });
    expect(collection.settlementBatch).toMatchObject({ courierId: driver.id, locationId: hubId, actorId: hub.id });
    expect(po.status).toBe('received_at_hub');
    expect(payable).toMatchObject({ status: 'paid', paymentRef: 'BANK-TRX-0042' });
    expect(refund).toMatchObject({ status: 'succeeded', providerRef: 'VOUCHER-7' });
    expect(Number(refund.amount)).toBe(100);
    // Every domain event for these aggregates was delivered; nothing failed or dead.
    expect(await prisma.domainEvent.count({ where: { aggregateId: { in: [order.id, secondOrder.id, purchaseOrder.id] }, status: { not: 'delivered' } } })).toBe(0);
    // No provider is connected: customer notifications are held, never "sent".
    await app.get(OutboxService).processOutbox();
    expect(await prisma.notificationOutbox.count({ where: { aggregateId: { in: [order.id, shipmentId] }, status: 'sent' } })).toBe(0);
    // The admin attention queue lists the cancelled order's exception, readable by admin only.
    const queue = await http().get('/operations/queues/attention').set(admin.auth).expect(200);
    expect(queue.body.openCases.total).toBeGreaterThanOrEqual(1);
    await http().get('/operations/queues/attention').set(hub.auth).expect(403);
  });
});
