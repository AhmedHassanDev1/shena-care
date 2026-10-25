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
 * GLO-239: role-scoped read APIs for future workspaces. Each actor sees only its own work (hub B,
 * driver B, supplier B and customers are denied), lists are bounded and filter-validated, and
 * operational rows carry order numbers and statuses — never customer phone/address.
 */
describe('GLO-239 role-scoped operational queues (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: DomainEventsService;
  let admin: Actor; let hubA: Actor; let hubB: Actor; let driverA: Actor; let driverB: Actor; let customer: Actor;
  let hubAId: string; let hubBId: string;
  const http = () => request(app.getHttpServer());
  const PII = /C2C Customer|Queue Customer|01012345678|01011112222|12 Road 9|8 Queue St/;

  const settleEvents = async (aggregateId: string) => {
    for (let i = 0; i < 100; i++) {
      await events.dispatchPending({ aggregateId });
      if (!await prisma.domainEvent.count({ where: { aggregateId, status: { not: 'delivered' } } })) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  };
  const deliveredAtHubA = async (codAmount: number, declared: number) => {
    const order = await prisma.order.create({ data: {
      orderNumber: 'ORD-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(),
      customerName: 'Queue Customer', customerPhone: '01011112222', shippingAddress: '8 Queue St',
      latitude: 29.9602, longitude: 31.2569, locationSource: 'map_pin',
      totalAmount: codAmount, codAmount, currency: 'EGP', status: 'packing',
    } });
    const shipment = await prisma.shipment.create({ data: { orderId: order.id, locationId: hubAId, status: 'packed' } });
    const run = await http().post('/fulfillment/delivery-batches').set(hubA.auth).send({ hubId: hubAId, name: 'Q run', driverId: driverA.id }).expect(201);
    await http().post(`/fulfillment/delivery-batches/${run.body.id}/stops`).set(hubA.auth).send({ stops: [{ shipmentId: shipment.id }] }).expect(201);
    await http().post(`/fulfillment/delivery-batches/${run.body.id}/dispatch`).set(hubA.auth).expect(201);
    if (declared >= 0) {
      await http().post(`/fulfillment/shipments/${shipment.id}/events`).set(driverA.auth).send({ type: 'DELIVERED', collectedAmount: declared }).expect(201);
    }
    return { orderId: order.id, orderNumber: order.orderNumber, shipmentId: shipment.id, runId: run.body.id as string };
  };

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
    hubA = await createActor(prisma, 'HUB_OPERATOR');
    hubB = await createActor(prisma, 'HUB_OPERATOR');
    driverA = await createActor(prisma, 'DRIVER');
    driverB = await createActor(prisma, 'DRIVER');
    customer = await createActor(prisma, 'CUSTOMER');
    hubAId = (await prisma.fulfillmentLocation.create({ data: { name: 'Queue Hub A ' + randomUUID(), address: 'Cairo' } })).id;
    hubBId = (await prisma.fulfillmentLocation.create({ data: { name: 'Queue Hub B ' + randomUUID(), address: 'Giza' } })).id;
    await prisma.fulfillmentLocationOperator.create({ data: { locationId: hubAId, operatorId: hubA.id } });
    await prisma.fulfillmentLocationOperator.create({ data: { locationId: hubBId, operatorId: hubB.id } });
  });
  afterAll(async () => { if (app) await app.close(); });

  it('hub receivables: confirmed lineage still to arrive, scoped to the receiving hub, no PII', async () => {
    const sku = await createSellableSku(prisma);
    const supplierA = await createActor(prisma, 'SUPPLIER', sku.supplierId);
    const order = await placeGuestOrder(app, [{ skuId: sku.id, quantity: 3 }]);
    await settleEvents(order.id);
    const [po] = (await http().post('/purchase-orders/batches').set(admin.auth).send({ supplierId: sku.supplierId }).expect(201)).body.purchaseOrders;
    const listFor = async (actor: Actor, hubId: string) =>
      (await http().get(`/fulfillment/locations/${hubId}/receivables`).set(actor.auth).expect(200)).body as Array<Record<string, unknown>>;
    expect((await listFor(hubA, hubAId)).some(r => r.orderId === order.id)).toBe(false); // not confirmed yet
    await http().post(`/purchase-orders/${po.id}/confirm`).set(supplierA.auth).send({ lines: [{ id: po.lines[0].id, status: 'confirmed_full' }] }).expect(201);
    await settleEvents(po.id);

    const receivable = (await listFor(hubA, hubAId)).find(r => r.orderId === order.id)!;
    expect(receivable).toMatchObject({ orderNumber: order.orderNumber, confirmedQuantity: 3, receivedQuantity: 0, remainingQuantity: 3,
      purchaseOrderId: po.id, skuId: sku.id, variantName: sku.variantName, barcode: sku.barcode });
    expect(JSON.stringify(receivable)).not.toMatch(PII);
    await http().get(`/fulfillment/locations/${hubAId}/receivables`).set(hubB.auth).expect(403);
    for (const actor of [driverA, customer, supplierA]) await http().get(`/fulfillment/locations/${hubAId}/receivables`).set(actor.auth).expect(403);

    // Once hub A receives the first unit, the order belongs to hub A and disappears from hub B.
    await http().post('/fulfillment/receipts').set(hubA.auth).send({
      locationId: hubAId, allocationId: receivable.allocationId, orderId: order.id, orderItemId: receivable.orderItemId,
      skuId: sku.id, variantName: sku.variantName, barcodeScanned: sku.barcode, quantity: 1, condition: 'ACCEPTABLE', expiryDate: '2031-12-31', idempotencyKey: randomUUID(),
    }).expect(201);
    expect((await listFor(hubA, hubAId)).find(r => r.orderId === order.id)).toMatchObject({ receivedQuantity: 1, remainingQuantity: 2 });
    expect((await listFor(hubB, hubBId)).some(r => r.orderId === order.id)).toBe(false);

    // Preparation queue shows the pending shipment to hub A only.
    const queue = await http().get(`/fulfillment/locations/${hubAId}/shipments`).query({ status: 'pending,ready_to_prepare' }).set(hubA.auth).expect(200);
    expect(queue.body.items.find((s: { orderId: string }) => s.orderId === order.id)).toMatchObject({ orderNumber: order.orderNumber, status: 'pending', itemCount: 3 });
    expect(JSON.stringify(queue.body)).not.toMatch(PII);
    await http().get(`/fulfillment/locations/${hubAId}/shipments`).set(hubB.auth).expect(403);
    await http().get(`/fulfillment/locations/${hubAId}/shipments`).query({ status: 'teleported' }).set(hubA.auth).expect(400);
    await http().get(`/fulfillment/locations/${hubAId}/shipments`).query({ take: 101 }).set(hubA.auth).expect(400);
  });

  it('runs and cash queues are scoped to the hub; drivers and customers are denied', async () => {
    const exact = await deliveredAtHubA(300, 300);
    const short = await deliveredAtHubA(450, 450);
    await http().post('/ordering/settlements/batch').set(hubA.auth).send({
      courierId: driverA.id, locationId: hubAId, reference: 'Q-' + randomUUID(), currency: 'EGP', totalCollected: 400,
      collections: [{ orderId: short.orderId, collectedAmount: 400 }],
    }).expect(201);

    const runs = await http().get(`/fulfillment/locations/${hubAId}/runs`).query({ status: 'dispatched' }).set(hubA.auth).expect(200);
    expect(runs.body.items.find((r: { id: string }) => r.id === exact.runId)).toMatchObject({ status: 'dispatched', stops: 1, attempts: { delivered: 1 } });
    await http().get(`/fulfillment/locations/${hubAId}/runs`).set(hubB.auth).expect(403);

    const collections = await http().get('/ordering/settlements/collections').query({ locationId: hubAId }).set(hubA.auth).expect(200);
    const byOrder = Object.fromEntries(collections.body.items.map((c: { orderId: string }) => [c.orderId, c]));
    expect(byOrder[exact.orderId]).toMatchObject({ status: 'collected', expectedAmount: '300.00', declaredAmount: '300.00', countedAmount: null, courierId: driverA.id });
    expect(byOrder[short.orderId]).toMatchObject({ status: 'short', countedAmount: '400.00', variance: '-50.00' });
    expect(JSON.stringify(collections.body)).not.toMatch(PII);
    const pending = await http().get('/ordering/settlements/collections').query({ status: 'collected', courierId: driverA.id }).set(hubA.auth).expect(200);
    expect(pending.body.items.every((c: { status: string; courierId: string }) => c.status === 'collected' && c.courierId === driverA.id)).toBe(true);

    await http().get('/ordering/settlements/collections').query({ locationId: hubAId }).set(hubB.auth).expect(403);
    const hubBView = await http().get('/ordering/settlements/collections').set(hubB.auth).expect(200);
    expect(hubBView.body.items.some((c: { locationId: string }) => c.locationId === hubAId)).toBe(false);
    for (const actor of [driverA, driverB, customer]) await http().get('/ordering/settlements/collections').set(actor.auth).expect(403);
    await http().get('/ordering/settlements/collections').query({ status: 'paid' }).set(hubA.auth).expect(400);

    const batches = await http().get('/ordering/settlements/batches').query({ locationId: hubAId }).set(hubA.auth).expect(200);
    expect(batches.body.total).toBeGreaterThanOrEqual(1);
    expect((await http().get('/ordering/settlements/batches').set(hubB.auth).expect(200)).body.items
      .some((b: { locationId: string }) => b.locationId === hubAId)).toBe(false);

    // Drivers keep using their own manifest; another driver never sees hub A's run.
    const manifestB = await http().get('/fulfillment/driver/runs').set(driverB.auth).expect(200);
    expect(JSON.stringify(manifestB.body)).not.toContain(exact.orderNumber);
  });

  it('admin attention queue gathers work waiting on humans, admin only, without PII', async () => {
    const failed = await deliveredAtHubA(200, -1);
    await http().post(`/fulfillment/shipments/${failed.shipmentId}/events`).set(driverA.auth).send({ type: 'FAILED', reasonCode: 'CUSTOMER_UNREACHABLE' }).expect(201);
    const queue = await http().get('/operations/queues/attention').set(admin.auth).expect(200);
    expect(Object.keys(queue.body).sort()).toEqual(['cashVariances', 'customerDecisionsPending', 'deliveredUnsettled', 'distributionRequired',
      'eventFailures', 'failedDeliveries', 'lateOrders', 'openCases', 'roundVariances', 'supplierResponses', 'supplyActionRequired', 'unsettledRounds'].sort());
    expect(queue.body.failedDeliveries.total).toBeGreaterThanOrEqual(1);
    expect(queue.body.cashVariances.short.total).toBeGreaterThanOrEqual(1);
    for (const section of ['supplyActionRequired', 'customerDecisionsPending', 'distributionRequired', 'failedDeliveries', 'deliveredUnsettled']) {
      expect(queue.body[section].items.length).toBeLessThanOrEqual(10);
    }
    expect(JSON.stringify(queue.body)).not.toMatch(PII);
    for (const actor of [hubA, driverA, customer]) await http().get('/operations/queues/attention').set(actor.auth).expect(403);

    const cases = await http().get('/operations/support/cases').query({ category: 'delivery', take: 5 }).set(admin.auth).expect(200);
    expect(cases.body.length).toBeLessThanOrEqual(5);
    expect(cases.body.every((c: { category: string }) => c.category === 'delivery')).toBe(true);
    await http().get('/operations/support/cases').query({ category: 'gossip' }).set(admin.auth).expect(400);
    await http().get('/operations/support/cases').set(customer.auth).expect(403);
  });
});
