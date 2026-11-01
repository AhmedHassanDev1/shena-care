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

/**
 * Red-team register (GLO-235): RT14 a scan retried after a client timeout counts once; RT08 an
 * operator instruction/corrected meeting point never overwrites the customer's confirmed pin; RT04
 * lot/expiry evidence is kept and an already-expired pack is held, never received.
 */
describe('Red-team operational hardening RT04 / RT08 / RT14 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: DomainEventsService;
  let admin: Actor; let hub: Actor; let driver: Actor; let customer: Actor;
  let locationId: string;
  const http = () => request(app.getHttpServer());

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
    driver = await createActor(prisma, 'DRIVER');
    customer = await createActor(prisma, 'CUSTOMER');
    locationId = (await prisma.fulfillmentLocation.create({ data: { name: 'RT Hub ' + randomUUID(), address: 'Cairo' } })).id;
    await prisma.fulfillmentLocationOperator.create({ data: { locationId, operatorId: hub.id } });
  });
  afterAll(async () => { if (app) await app.close(); });

  it('RT14: a retried scan with the same client scan id counts once, even concurrently', async () => {
    const sku = await createSellableSku(prisma);
    const order = await prisma.order.create({ data: {
      orderNumber: 'ORD-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(), customerName: 'Scan', customerPhone: '01012345678',
      shippingAddress: '2 Scan St', totalAmount: 100, currency: 'EGP', status: 'packing',
    } });
    const shipment = await prisma.shipment.create({ data: { orderId: order.id, locationId, status: 'ready_to_prepare', items: { create: [{ skuId: sku.id, quantity: 2 }] } } });
    const session = (await http().post(`/fulfillment/shipments/${shipment.id}/preparation`).set(hub.auth).send({}).expect(201)).body;
    const scan = (clientScanId: string) => http().post(`/fulfillment/preparation-sessions/${session.id}/scan`).set(hub.auth)
      .send({ barcodeScanned: sku.barcode, clientScanId }).expect(201);

    const first = await scan('scan-1');
    expect((await scan('scan-1')).body.id).toBe(first.body.id); // timeout retry
    const raced = await Promise.all([scan('scan-2'), scan('scan-2'), scan('scan-2')]);
    expect(new Set(raced.map(r => r.body.id)).size).toBe(1);
    expect(await prisma.preparationScanEvent.count({ where: { sessionId: session.id, isSuccessful: true } })).toBe(2);
    expect((await scan('scan-3')).body.errorReason).toBe('EXCESS_QUANTITY');
    await http().post(`/fulfillment/preparation-sessions/${session.id}/complete`).set(hub.auth).expect(201);
  });

  it('RT08: operator instructions sit beside the customer pin and never replace it', async () => {
    const sku = await createSellableSku(prisma);
    const placed = await placeGuestOrder(app, [{ skuId: sku.id, quantity: 1 }]);
    const shipment = await prisma.shipment.create({ data: { orderId: placed.id, locationId, status: 'packed' } });
    const run = await http().post('/fulfillment/delivery-batches').set(hub.auth).send({ hubId: locationId, name: 'RT run', driverId: driver.id }).expect(201);
    await http().post(`/fulfillment/delivery-batches/${run.body.id}/stops`).set(hub.auth).send({ stops: [{ shipmentId: shipment.id }] }).expect(201);
    const instruct = (actor: Actor, body: Record<string, unknown>) =>
      http().post(`/ordering/orders/${placed.id}/delivery-instructions`).set(actor.auth).send(body);
    const body = { note: 'Entrance is on the side street behind the pharmacy', reason: 'PIN_CORRECTION', latitude: 29.9611, longitude: 31.2580 };
    await instruct(driver, body).expect(403);
    await instruct(customer, body).expect(403);
    await instruct(hub, { ...body, longitude: undefined }).expect(400);
    await instruct(hub, { ...body, reason: 'BECAUSE' }).expect(400);
    expect((await instruct(hub, { ...body, latitude: 31.2001, longitude: 29.9187 }).expect(422)).body.code).toBe('OUT_OF_SERVICE_AREA');
    await instruct(hub, { note: 'Call before arriving', reason: 'ACCESS_INSTRUCTIONS' }).expect(201);
    await instruct(hub, body).expect(201);

    const stored = await prisma.order.findUniqueOrThrow({ where: { id: placed.id } });
    expect(stored).toMatchObject({ latitude: 29.9602, longitude: 31.2569, locationConfirmedBy: 'customer' });
    const manifest = (await http().get('/fulfillment/driver/runs').set(driver.auth).expect(200)).body;
    const stop = manifest.flatMap((r: { stops: unknown[] }) => r.stops).find((s: { shipmentId: string }) => s.shipmentId === shipment.id);
    expect(stop.location).toMatchObject({ latitude: 29.9602, longitude: 31.2569 });
    expect(stop.operatorInstruction).toMatchObject({
      note: body.note, reason: 'PIN_CORRECTION',
      location: { latitude: 29.9611, longitude: 31.258, navigationUrl: 'https://www.google.com/maps/dir/?api=1&destination=29.9611,31.258' },
    });
    expect(await prisma.deliveryInstruction.count({ where: { orderId: placed.id } })).toBe(2);
  });

  it('RT04: lot/expiry evidence is kept; an already-expired pack is held as a receiving exception', async () => {
    const sku = await createSellableSku(prisma);
    const supplier = await createActor(prisma, 'SUPPLIER', sku.supplierId);
    const order = await placeGuestOrder(app, [{ skuId: sku.id, quantity: 2 }]);
    for (let i = 0; i < 50 && await prisma.domainEvent.count({ where: { aggregateId: order.id, status: { not: 'delivered' } } }); i++) {
      await events.dispatchPending({ aggregateId: order.id });
    }
    const [po] = (await http().post('/purchase-orders/batches').set(admin.auth).send({ supplierId: sku.supplierId }).expect(201)).body.purchaseOrders;
    await http().post(`/purchase-orders/${po.id}/confirm`).set(supplier.auth).send({ lines: [{ id: po.lines[0].id, status: 'confirmed_full' }] }).expect(201);
    for (let i = 0; i < 50 && await prisma.domainEvent.count({ where: { aggregateId: po.id, status: { not: 'delivered' } } }); i++) {
      await events.dispatchPending({ aggregateId: po.id });
    }
    const link = po.lines[0].allocations[0];
    const receive = (extra: Record<string, unknown>) => http().post('/fulfillment/receipts').set(hub.auth).send({
      locationId, allocationId: link.sourceAllocationId, orderId: order.id, orderItemId: link.orderItemId, skuId: sku.id,
      variantName: sku.variantName, barcodeScanned: sku.barcode, quantity: 1, condition: 'ACCEPTABLE', expiryDate: '2031-12-31', idempotencyKey: randomUUID(), ...extra,
    });
    await receive({ expiryDate: '31/12/2030' }).expect(400);
    const expired = await receive({ expiryDate: '2026-01-31', lotNumber: 'L-OLD-7' }).expect(400);
    expect(expired.body.code).toBe('RECEIVING_EXCEPTION');
    expect((await prisma.supportCase.findUniqueOrThrow({ where: { id: expired.body.caseId } })).description).toContain('lot L-OLD-7');
    expect(await prisma.fulfillmentReceipt.count({ where: { orderId: order.id } })).toBe(0);

    // Less than the owner's minimum shelf life (6 months) is held for the supplier, like an expired pack.
    const soon = new Date(); soon.setUTCMonth(soon.getUTCMonth() + 3);
    const shortDated = await receive({ expiryDate: soon.toISOString().slice(0, 10), lotNumber: 'L-SHORT-1' }).expect(400);
    expect(shortDated.body.code).toBe('RECEIVING_EXCEPTION');
    expect(shortDated.body.message).toContain('SHORT_DATED');
    await receive({ expiryDate: undefined }).expect(400);
    expect(await prisma.fulfillmentReceipt.count({ where: { orderId: order.id } })).toBe(0);

    await receive({ expiryDate: '2028-06-30', lotNumber: 'L-2026-44' }).expect(201);
    const receipt = await prisma.fulfillmentReceipt.findFirstOrThrow({ where: { orderId: order.id } });
    expect(receipt).toMatchObject({ lotNumber: 'L-2026-44' });
    expect(receipt.expiryDate?.toISOString().slice(0, 10)).toBe('2028-06-30');
  });
});
