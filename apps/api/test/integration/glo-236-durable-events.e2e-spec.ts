import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { DomainEventsService } from '../../src/platform/events/domain-events.service';
import { SourcingEventListener, SUPPLY_PLAN_CONSUMER } from '../../src/modules/sourcing/services/sourcing-event.listener';
import { OutboxService } from '../../src/modules/operations/services/outbox.service';
import { AiClient } from '../../src/platform/ai';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { createActor, Actor } from '../fixtures/actors';
import { scanIntoCustody } from '../fixtures/custody';
import { createSellableSku } from '../fixtures/sellable-sku';
import { placeGuestOrder } from '../fixtures/checkout';

/**
 * GLO-236: order.placed is durable (written with the order, delivered with retry, replayable,
 * exactly-once in effect); shipment/order/cash transitions commit together; notification and
 * export status never report success that did not happen.
 */
describe('GLO-236 durable events and atomic transitions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: DomainEventsService;
  let admin: Actor; let hub: Actor; let driver: Actor; let customer: Actor;
  let skuId: string;
  let locationId: string;
  const http = () => request(app.getHttpServer());

  const eventsFor = (orderId: string) => prisma.domainEvent.findMany({ where: { aggregateId: orderId } });
  const restoreConsumer = () => app.get(SourcingEventListener).onModuleInit();
  const settle = () => new Promise(resolve => setTimeout(resolve, 150));

  /** A packed COD order on a planning run of `driver`. */
  const packedStop = async (codAmount: number, status: 'packing' | 'delivered' = 'packing') => {
    const order = await prisma.order.create({ data: {
      orderNumber: 'ORD-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(),
      customerName: 'Atomic Customer', customerPhone: '01011112222', shippingAddress: '3 Atomic St', latitude: 29.9602, longitude: 31.2569, locationSource: 'map_pin',
      subtotal: codAmount, shippingFee: 0, totalAmount: codAmount, codAmount, currency: 'EGP', status,
    } });
    const shipment = await prisma.shipment.create({ data: { orderId: order.id, locationId, status: 'packed' } });
    return { orderId: order.id, shipmentId: shipment.id };
  };
  /** A planning run of `driver` holding these parcels, each scanned into the driver's custody. */
  const runOf = async (...shipmentIds: string[]) => {
    const run = await prisma.deliveryBatch.create({ data: {
      locationId, driverId: driver.id, status: 'planning',
      stops: { create: shipmentIds.map((shipmentId, index) => ({ shipmentId, sequence: index + 1 })) },
    } });
    await scanIntoCustody(app, driver, ...shipmentIds);
    return run;
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
    hub = await createActor(prisma, 'HUB_OPERATOR');
    driver = await createActor(prisma, 'DRIVER');
    customer = await createActor(prisma, 'CUSTOMER');
    skuId = (await createSellableSku(prisma)).id;
    locationId = (await prisma.fulfillmentLocation.create({ data: { name: 'GLO-236 Hub ' + randomUUID(), address: 'Cairo' } })).id;
    await prisma.fulfillmentLocationOperator.create({ data: { locationId, operatorId: hub.id } });
  });

  afterAll(async () => {
    restoreConsumer();
    if (app) await app.close();
  });

  describe('order.placed → supply plan', () => {
    it('is written with the order and delivered exactly once', async () => {
      const order = await placeGuestOrder(app.getHttpServer(), [{ skuId, quantity: 2 }]);
      const rows = await eventsFor(order.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ eventType: 'order.placed', consumer: SUPPLY_PLAN_CONSUMER, aggregateType: 'Order' });

      await events.dispatchPending({ aggregateId: order.id });
      await settle();
      const [row] = await eventsFor(order.id);
      expect(row.status).toBe('delivered');
      expect(await prisma.supplyRequest.count({ where: { orderId: order.id } })).toBe(1);

      // Redelivery (operator replay) is harmless: still one request and one allocation.
      await prisma.domainEvent.update({ where: { id: row.id }, data: { status: 'pending' } });
      await Promise.all([events.dispatchPending({ aggregateId: order.id }), events.dispatchPending({ aggregateId: order.id })]);
      expect(await prisma.supplyRequest.count({ where: { orderId: order.id } })).toBe(1);
      expect(await prisma.sourceAllocation.count({ where: { requirement: { supplyRequest: { orderId: order.id } } } })).toBe(1);
    });

    it('survives a failing consumer and recovers through retry and operator replay', async () => {
      events.registerHandler(SUPPLY_PLAN_CONSUMER, async () => { throw new Error('sourcing temporarily down'); });
      let order;
      try {
        order = await placeGuestOrder(app.getHttpServer(), [{ skuId, quantity: 1 }]);
        await settle();
        await events.dispatchPending({ aggregateId: order.id });
      } finally {
        restoreConsumer();
      }
      const [failed] = await eventsFor(order.id);
      expect(failed.status).toBe('failed');
      expect(failed.lastError).toContain('sourcing temporarily down');
      expect(failed.attempts).toBeGreaterThanOrEqual(1);
      expect(await prisma.supplyRequest.count({ where: { orderId: order.id } })).toBe(0);
      // The order itself is intact and visible to the operator.
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('placed');

      const listed = await http().get('/operations/events').query({ aggregateId: order.id }).set(admin.auth).expect(200);
      expect(listed.body[0]).toMatchObject({ status: 'failed', consumer: SUPPLY_PLAN_CONSUMER });
      await http().get('/operations/events').set(customer.auth).expect(403);
      await http().post(`/operations/events/${failed.id}/requeue`).set(hub.auth).expect(403);

      await http().post(`/operations/events/${failed.id}/requeue`).set(admin.auth).expect(201);
      await events.dispatchPending({ aggregateId: order.id });
      const [recovered] = await eventsFor(order.id);
      expect(recovered.status).toBe('delivered');
      expect(await prisma.supplyRequest.count({ where: { orderId: order.id } })).toBe(1);
    });

    it('reclaims a row whose dispatcher crashed mid-delivery (expired lease)', async () => {
      events.registerHandler(SUPPLY_PLAN_CONSUMER, async () => { throw new Error('never reached'); });
      let order;
      try {
        order = await placeGuestOrder(app.getHttpServer(), [{ skuId, quantity: 1 }]);
        await settle();
      } finally {
        restoreConsumer();
      }
      // Simulate a dispatcher that claimed the row and died before finishing.
      await prisma.domainEvent.updateMany({ where: { aggregateId: order.id }, data: {
        status: 'processing', lockedUntil: new Date(Date.now() - 1000), lastError: null,
      } });
      await events.dispatchPending({ aggregateId: order.id });
      expect((await eventsFor(order.id))[0].status).toBe('delivered');
      expect(await prisma.supplyRequest.count({ where: { orderId: order.id } })).toBe(1);
    });

    it('writes no event when the order transaction rolls back', async () => {
      const before = await prisma.domainEvent.count();
      const added = await http().post('/ordering/cart/add').send({ skuId, quantity: 1 }).expect(201);
      const quote = await http().post('/ordering/checkout/quote').set('x-cart-token', added.body.guestCartToken)
        .send({ governorate: 'Cairo', area: 'Maadi' }).expect(201);
      const idempotencyKey = randomUUID();
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "operations"."domain_events" ADD CONSTRAINT "test_event_insert_failure" CHECK (event_type <> 'order.placed') NOT VALID`);
      try {
        await http().post('/ordering/checkout').set('x-cart-token', added.body.guestCartToken).send({
          governorate: 'Cairo', area: 'Maadi', customerName: 'Rollback', customerPhone: '01012345678',
          shippingAddress: '1 Rollback St', latitude: 29.9602, longitude: 31.2569, locationSource: 'map_pin', locationConfirmed: true,
          quoteVersion: quote.body.quoteVersion, cartRevision: quote.body.revision, idempotencyKey,
        }).expect(500);
      } finally {
        await prisma.$executeRawUnsafe('ALTER TABLE "operations"."domain_events" DROP CONSTRAINT "test_event_insert_failure"');
      }
      expect(await prisma.order.count({ where: { idempotencyKey } })).toBe(0);
      expect(await prisma.domainEvent.count()).toBe(before);
    });
  });

  describe('shipment, order and cash move together', () => {
    it('a delivery that cannot move the order changes nothing (no cash, no event, no notification)', async () => {
      const { orderId, shipmentId } = await packedStop(450);
      const run = await runOf(shipmentId);
      await http().post(`/fulfillment/delivery-batches/${run.id}/dispatch`).set(hub.auth).expect(201);
      // Another actor cancelled the order while the driver was on the road.
      await prisma.order.update({ where: { id: orderId }, data: { status: 'cancelled' } });

      await http().post(`/fulfillment/shipments/${shipmentId}/events`).set(driver.auth)
        .send({ type: 'DELIVERED', collectedAmount: 450 }).expect(409);
      expect((await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })).status).toBe('out_for_delivery');
      const collection = await prisma.paymentCollection.findUniqueOrThrow({ where: { orderId } });
      expect(collection).toMatchObject({ status: 'expected', declaredAmount: null, courierId: null });
      expect(await prisma.shipmentEvent.count({ where: { shipmentId, type: 'DELIVERED' } })).toBe(0);
      expect(await prisma.notificationOutbox.count({ where: { aggregateId: shipmentId, eventType: 'shipment.delivered' } })).toBe(0);
    });

    it('concurrent conflicting deliveries record exactly one declaration, event and order transition', async () => {
      const { orderId, shipmentId } = await packedStop(450);
      const run = await runOf(shipmentId);
      await http().post(`/fulfillment/delivery-batches/${run.id}/dispatch`).set(hub.auth).expect(201);
      const results = await Promise.all([
        http().post(`/fulfillment/shipments/${shipmentId}/events`).set(driver.auth).send({ type: 'DELIVERED', collectedAmount: 450 }),
        http().post(`/fulfillment/shipments/${shipmentId}/events`).set(driver.auth).send({ type: 'DELIVERED', collectedAmount: 400 }),
      ]);
      expect(results.map(r => r.status).sort()).toEqual([201, 409]);
      const winner = results.find(r => r.status === 201)!;
      const collection = await prisma.paymentCollection.findUniqueOrThrow({ where: { orderId } });
      expect(collection.status).toBe('collected');
      expect(await prisma.shipmentEvent.count({ where: { shipmentId, type: 'DELIVERED' } })).toBe(1);
      expect(await prisma.orderStatusEvent.count({ where: { orderId, status: 'delivered' } })).toBe(1);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('delivered');
      expect(winner.body.type).toBe('DELIVERED');

      // A faithful replay returns the original event and creates nothing new.
      const replay = await http().post(`/fulfillment/shipments/${shipmentId}/events`).set(driver.auth)
        .send({ type: 'DELIVERED', collectedAmount: Number(collection.declaredAmount) }).expect(201);
      expect(replay.body.id).toBe(winner.body.id);
      expect(await prisma.shipmentEvent.count({ where: { shipmentId, type: 'DELIVERED' } })).toBe(1);
    });

    it('dispatch is all-or-nothing across shipments, orders and expected cash', async () => {
      const good = await packedStop(200);
      const bad = await packedStop(300, 'delivered'); // cannot move to shipped
      const run = await runOf(good.shipmentId, bad.shipmentId);
      await http().post(`/fulfillment/delivery-batches/${run.id}/dispatch`).set(hub.auth).expect(409);

      expect((await prisma.deliveryBatch.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('planning');
      for (const stop of [good, bad]) {
        expect((await prisma.shipment.findUniqueOrThrow({ where: { id: stop.shipmentId } })).status).toBe('packed');
        expect(await prisma.paymentCollection.count({ where: { orderId: stop.orderId } })).toBe(0);
        expect(await prisma.shipmentEvent.count({ where: { shipmentId: stop.shipmentId, type: 'OUT_FOR_DELIVERY' } })).toBe(0);
      }
      expect((await prisma.order.findUniqueOrThrow({ where: { id: good.orderId } })).status).toBe('packing');
      expect(await prisma.orderStatusEvent.count({ where: { orderId: good.orderId, status: 'shipped' } })).toBe(0);
    });
  });

  describe('honest delivery status', () => {
    it('holds notifications when no provider is connected and sends only through a real provider', async () => {
      const outbox = app.get(OutboxService);
      const held = await outbox.enqueue(null, {
        eventType: 'test.notice', aggregateId: randomUUID(), payload: {}, channelIntent: 'whatsapp',
        deduplicationKey: 'glo-236-held-' + randomUUID(),
      });
      const internal = await outbox.enqueue(null, {
        eventType: 'test.internal', aggregateId: randomUUID(), payload: {}, deduplicationKey: 'glo-236-internal-' + randomUUID(),
      });
      const drain = async () => {
        for (let pass = 0; pass < 200; pass++) {
          const run = await outbox.processOutbox();
          if (run.sent + run.held + run.failed === 0) return;
        }
      };
      await drain();
      expect(await prisma.notificationOutbox.findUniqueOrThrow({ where: { id: held.id } }))
        .toMatchObject({ status: 'held', sentAt: null, lastError: { code: 'PROVIDER_NOT_CONNECTED', channel: 'whatsapp' } });
      expect(await prisma.notificationOutbox.findUniqueOrThrow({ where: { id: internal.id } }))
        .toMatchObject({ status: 'held', sentAt: null, lastError: { code: 'NO_DELIVERY_CHANNEL' } });
      expect(await prisma.notificationOutbox.count({ where: { status: 'sent', sentAt: null } })).toBe(0);

      const channel = 'test-channel-' + randomUUID();
      const sent: string[] = [];
      outbox.registerProvider({ channel, send: async n => { sent.push(n.id); return { providerMessageId: 'p-1' }; } });
      const delivered = await outbox.enqueue(null, {
        eventType: 'test.notice', aggregateId: randomUUID(), payload: {}, channelIntent: channel,
        deduplicationKey: 'glo-236-sent-' + randomUUID(),
      });
      await drain();
      expect(sent).toContain(delivered.id);
      expect((await prisma.notificationOutbox.findUniqueOrThrow({ where: { id: delivered.id } })).status).toBe('sent');
    });

    it('does not report a fabricated accounting export as completed', async () => {
      const job = await http().post('/operations/finance/exports').set(admin.auth)
        .send({ startDate: '2026-10-01', endDate: '2026-10-15' }).expect(201);
      expect(job.body).toMatchObject({ status: 'failed', fileUrl: null, error: 'ACCOUNTING_EXPORT_DESTINATION_NOT_CONFIGURED' });
    });
  });
});
