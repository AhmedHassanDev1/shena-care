// A flat fee keeps the expected COD arithmetic readable; the tiered policy has its own suite.
process.env.DELIVERY_FEE_POLICY = JSON.stringify({ bands: [{ maxKm: null, fee: 50 }], discountTiers: [], freeFrom: 100000 });
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { Role } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { DomainEventsService } from '../../src/platform/events/domain-events.service';
import { createActor, Actor } from '../fixtures/actors';
import { signInCustomer } from '../fixtures/checkout';
import { createSellableSku } from '../fixtures/sellable-sku';

/**
 * GLO-295 / GLO-296 release-proof journey on persisted data, no mocks of the operational steps:
 * two real customer checkouts of one product → internal Buy List (summed) → acquired → Hub receiving by barcode →
 * scan-verified preparation → label/pack → delivery run → driver delivery with COD declaration → cash counted by the Hub.
 */
describe('Customer order across Admin / Hub / Driver workspaces via the Buy List (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: DomainEventsService;
  let admin: Actor; let hub: Actor; let driver: Actor; let otherDriver: Actor;
  let locationId: string;
  let sku: Awaited<ReturnType<typeof createSellableSku>>;
  const previousMode = process.env.SOURCING_MODE;
  const http = () => request(app.getHttpServer());

  const checkout = async (quantity: number) => {
    const customer = await signInCustomer(app);
    const address = { governorate: 'Cairo', area: 'Maadi' };
    await http().post('/ordering/cart/add').set(customer.auth).send({ skuId: sku.id, quantity }).expect(201);
    const quote = (await http().post('/ordering/checkout/quote').set(customer.auth).send(address).expect(201)).body;
    const placed = await http().post('/ordering/checkout').set(customer.auth).send({
      ...address, customerName: 'Journey Customer', customerPhone: '01012345678', shippingAddress: '12 Road 9, Maadi',
      latitude: 29.9602, longitude: 31.2569, locationSource: 'map_pin', locationConfirmed: true,
      quoteVersion: quote.quoteVersion, cartRevision: quote.revision, idempotencyKey: randomUUID(),
    }).expect(201);
    return { customer, order: placed.body as { id: string; orderNumber: string; codAmount: number; items: Array<{ id: string }> } };
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
    admin = await createActor(prisma, Role.ADMIN);
    hub = await createActor(prisma, Role.HUB_OPERATOR);
    driver = await createActor(prisma, Role.DRIVER);
    otherDriver = await createActor(prisma, Role.DRIVER);
    locationId = (await prisma.fulfillmentLocation.create({ data: { name: 'Journey Hub ' + randomUUID(), address: '1 Hub Street' } })).id;
    await prisma.fulfillmentLocationOperator.create({ data: { locationId, operatorId: hub.id } });
    sku = await createSellableSku(prisma);
  });

  afterAll(async () => {
    if (previousMode === undefined) delete process.env.SOURCING_MODE; else process.env.SOURCING_MODE = previousMode;
    await app.close();
  });

  const buyRow = async (auth = hub.auth) => ((await http().get('/buy-list').set(auth).expect(200)).body.items as Array<{
    skuId: string; toBuy: number; acquired: number; awaitingHub: number; orderCount: number }>).find(i => i.skuId === sku.id);

  it('moves two real orders from checkout to settled cash with no manual data fixes', async () => {
    const first = await checkout(2);
    const second = await checkout(3);
    // Order placement is an outbox event; its durable consumer creates the supply requirement the Buy List reads.
    await events.dispatchPending();

    // Immediate dispatch may already have claimed one event. Await the actual
    // durable deliveries rather than treating SKIP LOCKED as a completed drain.
    const orderIds = [first.order.id, second.order.id];
    for (let attempt = 0; attempt < 100; attempt++) {
      const pending = await prisma.domainEvent.count({
        where: { aggregateId: { in: orderIds }, status: { not: 'delivered' } },
      });
      if (!pending) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    expect(await prisma.domainEvent.count({
      where: { aggregateId: { in: orderIds }, status: { not: 'delivered' } },
    })).toBe(0);

    expect(await buyRow()).toMatchObject({ toBuy: 5, orderCount: 2, acquired: 0 });
    // The Buy List is internal: the driver and the customers cannot read it.
    await http().get('/buy-list').set(driver.auth).expect(403);
    await http().get('/buy-list').set(first.customer.auth).expect(403);

    // Offline purchase done: staff count it once (a retry changes nothing), then the Hub receives it by barcode.
    const key = randomUUID();
    await http().post('/buy-list/acquire').set(hub.auth).send({ skuId: sku.id, quantity: 5, idempotencyKey: key }).expect(200);
    await http().post('/buy-list/acquire').set(hub.auth).send({ skuId: sku.id, quantity: 5, idempotencyKey: key }).expect(200);
    expect(await buyRow(admin.auth)).toMatchObject({ toBuy: 0, acquired: 5, awaitingHub: 5 });

    const receivables = (await http().get(`/fulfillment/locations/${locationId}/receivables`).set(hub.auth).expect(200)).body as Array<{
      allocationId: string; orderId: string; orderItemId: string; remainingQuantity: number }>;
    for (const order of [first.order, second.order]) {
      const row = receivables.find(r => r.orderId === order.id)!;
      await http().post('/fulfillment/receipts').set(hub.auth).send({
        locationId, allocationId: row.allocationId, orderId: order.id, orderItemId: row.orderItemId, skuId: sku.id,
        variantName: sku.variantName, quantity: row.remainingQuantity, condition: 'ACCEPTABLE', expiryDate: '2031-12-31',
        idempotencyKey: randomUUID(), barcodeScanned: sku.barcode!,
      }).expect(201);
    }
    expect(await buyRow()).toBeUndefined();

    // Scan-verified preparation, label, pack.
    const shipmentIds: string[] = [];
    for (const [order, units] of [[first.order, 2], [second.order, 3]] as const) {
      const shipment = await prisma.shipment.findUniqueOrThrow({ where: { orderId: order.id } });
      expect(shipment.status).toBe('ready_to_prepare');
      const session = (await http().post(`/fulfillment/shipments/${shipment.id}/preparation`).set(hub.auth).send({}).expect(201)).body;
      for (let unit = 0; unit < units; unit++) {
        await http().post(`/fulfillment/preparation-sessions/${session.id}/scan`).set(hub.auth)
          .send({ barcodeScanned: sku.barcode, clientScanId: randomUUID() }).expect(201);
      }
      await http().post(`/fulfillment/preparation-sessions/${session.id}/complete`).set(hub.auth).expect(201);
      await http().post(`/fulfillment/shipments/${shipment.id}/label`).set(hub.auth).expect(201);
      await http().post(`/fulfillment/shipments/${shipment.id}/events`).set(hub.auth).send({ type: 'PACKED' }).expect(201);
      shipmentIds.push(shipment.id);
    }

    // Hand-off to the driver on one run.
    const batch = (await http().post('/fulfillment/delivery-batches').set(hub.auth)
      .send({ hubId: locationId, name: 'Journey run', driverId: driver.id }).expect(201)).body;
    await http().post(`/fulfillment/delivery-batches/${batch.id}/stops`).set(hub.auth)
      .send({ stops: shipmentIds.map((shipmentId, index) => ({ shipmentId, sequence: index + 1 })) }).expect(201);
    await http().post(`/fulfillment/delivery-batches/${batch.id}/dispatch`).set(hub.auth).expect(201);

    // The driver sees only the assigned stops; another driver sees none of them.
    const manifest = (await http().get('/fulfillment/driver/runs').set(driver.auth).expect(200)).body as Array<{ stops: Array<{ shipmentId: string; codDue: number }> }>;
    const stops = manifest.flatMap(run => run.stops).filter(stop => shipmentIds.includes(stop.shipmentId));
    expect(stops).toHaveLength(2);
    const other = (await http().get('/fulfillment/driver/runs').set(otherDriver.auth).expect(200)).body as Array<{ stops: Array<{ shipmentId: string }> }>;
    expect(other.flatMap(run => run.stops).some(stop => shipmentIds.includes(stop.shipmentId))).toBe(false);

    // Delivery outcomes: the driver declares the exact cash due at the door; staff cannot.
    for (const [order, shipmentId] of [[first.order, shipmentIds[0]], [second.order, shipmentIds[1]]] as const) {
      await http().post(`/fulfillment/shipments/${shipmentId}/events`).set(admin.auth).send({ type: 'DELIVERED', collectedAmount: order.codAmount }).expect(409);
      await http().post(`/fulfillment/shipments/${shipmentId}/events`).set(driver.auth).send({ type: 'DELIVERED', collectedAmount: order.codAmount }).expect(201);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('delivered');
    }

    // The Hub counts the round once; expected, declared and counted cash agree.
    const total = Number(first.order.codAmount) + Number(second.order.codAmount);
    const round = (await http().get('/ordering/settlements/rounds/open').set(hub.auth).expect(200)).body as Array<{ courierId: string; orders: number; expectedTotal: string; declaredTotal: string }>;
    expect(round.find(r => r.courierId === driver.id)).toMatchObject({ orders: 2, expectedTotal: total.toFixed(2), declaredTotal: total.toFixed(2) });
    const reference = 'JOURNEY-' + randomUUID();
    await http().post('/ordering/settlements/batch').set(admin.auth).send({
      courierId: driver.id, locationId, reference, currency: 'EGP', totalCollected: total,
      collections: [{ orderId: first.order.id, collectedAmount: Number(first.order.codAmount) }, { orderId: second.order.id, collectedAmount: Number(second.order.codAmount) }],
    }).expect(201);
    for (const order of [first.order, second.order]) {
      const collection = await prisma.paymentCollection.findUniqueOrThrow({ where: { orderId: order.id } });
      expect(collection.status).toBe('settled');
      expect(Number(collection.collectedAmount)).toBe(Number(order.codAmount));
    }
  });
});
