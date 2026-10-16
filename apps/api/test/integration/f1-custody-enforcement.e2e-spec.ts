import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AiClient } from '../../src/platform/ai';
import { signShipmentBarcode } from '../../src/modules/fulfillment/services/shipment-label';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { createActor, Actor } from '../fixtures/actors';

/**
 * F1 (acceptance run 2026-10-16): driver custody is a server rule, not a UI gate. A parcel leaves
 * the hub only when its run's assigned driver scanned the label for this attempt; nothing is
 * delivered and no door cash is declared without that custody. Every refusal leaves the database
 * exactly as it was.
 */
describe('F1 driver custody enforcement (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor; let hub: Actor; let driver: Actor; let otherDriver: Actor;
  let locationId: string;
  const orderIds: string[] = []; const shipmentIds: string[] = []; const batchIds: string[] = [];
  const http = () => request(app.getHttpServer());

  /** A packed order (COD unless `codAmount` is 0) on a planning run of `runDriver` (none when null). */
  const plannedStop = async (opts: { codAmount?: number; runDriver?: Actor | null } = {}) => {
    const codAmount = opts.codAmount ?? 500;
    const order = await prisma.order.create({ data: {
      orderNumber: 'ORD-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(),
      customerName: 'Custody Customer', customerPhone: '01011112222', shippingAddress: '9 Custody St',
      latitude: 29.9602, longitude: 31.2569, locationSource: 'map_pin',
      subtotal: 500, shippingFee: 0, totalAmount: 500, codAmount, currency: 'EGP', status: 'packing',
    } });
    orderIds.push(order.id);
    const shipment = await prisma.shipment.create({ data: { orderId: order.id, locationId, status: 'packed' } });
    shipmentIds.push(shipment.id);
    const runDriver = opts.runDriver === undefined ? driver : opts.runDriver;
    const run = await http().post('/fulfillment/delivery-batches').set(hub.auth)
      .send({ hubId: locationId, name: 'Custody run', ...(runDriver ? { driverId: runDriver.id } : {}) }).expect(201);
    batchIds.push(run.body.id);
    await http().post(`/fulfillment/delivery-batches/${run.body.id}/stops`).set(hub.auth).send({ stops: [{ shipmentId: shipment.id }] }).expect(201);
    return { orderId: order.id, shipmentId: shipment.id, runId: run.body.id as string, barcode: signShipmentBarcode(shipment.id) };
  };
  const scan = (actor: Actor, shipmentId: string, barcode: string) =>
    http().post(`/fulfillment/shipments/${shipmentId}/events`).set(actor.auth).send({ type: 'HANDOFF_SCANNED', barcode });
  const dispatch = (actor: Actor, runId: string) => http().post(`/fulfillment/delivery-batches/${runId}/dispatch`).set(actor.auth);
  const deliver = (actor: Actor, shipmentId: string, body: Record<string, unknown> = {}) =>
    http().post(`/fulfillment/shipments/${shipmentId}/events`).set(actor.auth).send({ type: 'DELIVERED', ...body });
  const codeOf = (body: { code?: string; message?: { code?: string } | string }) =>
    body.code ?? (typeof body.message === 'object' ? body.message.code : undefined);
  const trail = async (shipmentId: string) =>
    (await prisma.shipmentEvent.findMany({ where: { shipmentId }, orderBy: { createdAt: 'asc' } })).map(event => event.type);

  /** Nothing about a refused dispatch reached the database. */
  const expectStillAtHub = async (stop: { orderId: string; shipmentId: string; runId: string }) => {
    expect((await prisma.deliveryBatch.findUniqueOrThrow({ where: { id: stop.runId } })).status).toBe('planning');
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: stop.shipmentId } })).status).toBe('packed');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: stop.orderId } })).status).toBe('packing');
    expect(await prisma.paymentCollection.count({ where: { orderId: stop.orderId } })).toBe(0);
    expect(await prisma.shipmentEvent.count({ where: { shipmentId: stop.shipmentId, type: 'OUT_FOR_DELIVERY' } })).toBe(0);
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useValue(new DeterministicAiClient()).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useLogger(false);
    await app.init();
    prisma = app.get(PrismaService);
    admin = await createActor(prisma, 'ADMIN');
    hub = await createActor(prisma, 'HUB_OPERATOR');
    driver = await createActor(prisma, 'DRIVER');
    otherDriver = await createActor(prisma, 'DRIVER');
    locationId = (await prisma.fulfillmentLocation.create({ data: { name: 'F1 Hub ' + randomUUID(), address: 'Cairo' } })).id;
    await prisma.fulfillmentLocationOperator.create({ data: { locationId, operatorId: hub.id } });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.paymentCollection.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.deliveryBatch.deleteMany({ where: { id: { in: batchIds } } });
      await prisma.shipmentEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
      await prisma.notificationOutbox.deleteMany({ where: { aggregateId: { in: shipmentIds } } });
      await prisma.orderStatusEvent.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
      await prisma.fulfillmentLocationOperator.deleteMany({ where: { locationId } });
      await prisma.fulfillmentLocation.deleteMany({ where: { id: locationId } });
    }
    if (app) await app.close();
  });

  it('refuses a direct API dispatch without the driver scan and changes nothing', async () => {
    const stop = await plannedStop();
    for (const actor of [hub, admin]) {
      const refused = await dispatch(actor, stop.runId).expect(409);
      expect(codeOf(refused.body)).toBe('CUSTODY_SCAN_REQUIRED');
    }
    await expectStillAtHub(stop);
  });

  it('refuses dispatch of a run that has no assigned driver', async () => {
    const stop = await plannedStop({ runDriver: null });
    const refused = await dispatch(hub, stop.runId).expect(409);
    expect(codeOf(refused.body)).toBe('RUN_DRIVER_REQUIRED');
    await expectStillAtHub(stop);
  });

  it('accepts custody only from the run\'s own driver with the parcel\'s own label', async () => {
    const stop = await plannedStop();
    // Staff hold the label but cannot record custody for the driver.
    for (const actor of [hub, admin]) {
      const refused = await scan(actor, stop.shipmentId, stop.barcode).expect(403);
      expect(codeOf(refused.body)).toBe('CUSTODY_SCAN_DRIVER_ONLY');
    }
    // A driver of another run cannot see, scan or deliver the parcel.
    await scan(otherDriver, stop.shipmentId, stop.barcode).expect(404);
    // The right driver with another parcel's label is refused.
    await scan(driver, stop.shipmentId, signShipmentBarcode(randomUUID())).expect(400);
    expect(await prisma.shipmentEvent.count({ where: { shipmentId: stop.shipmentId, type: 'HANDOFF_SCANNED' } })).toBe(0);
    expect(codeOf((await dispatch(hub, stop.runId).expect(409)).body)).toBe('CUSTODY_SCAN_REQUIRED');
    await expectStillAtHub(stop);
  });

  it('refuses dispatch when the scan belongs to a different driver than the run\'s', async () => {
    const stop = await plannedStop();
    // A scan by another driver (e.g. reassigned run) does not count as this run driver's custody.
    await prisma.shipmentEvent.create({ data: { shipmentId: stop.shipmentId, type: 'HANDOFF_SCANNED', actorId: otherDriver.id } });
    expect(codeOf((await dispatch(hub, stop.runId).expect(409)).body)).toBe('CUSTODY_SCAN_REQUIRED');
    await expectStillAtHub(stop);
  });

  it('dispatches after custody, writes the event trail once, and stays idempotent under duplicates', async () => {
    const stop = await plannedStop();
    const first = await scan(driver, stop.shipmentId, stop.barcode).expect(201);
    const again = await scan(driver, stop.shipmentId, stop.barcode).expect(201); // double tap / retry
    expect(again.body.id).toBe(first.body.id);
    expect(first.body.actorId).toBe(driver.id);

    const raced = await Promise.all([dispatch(hub, stop.runId), dispatch(hub, stop.runId)]);
    expect(raced.filter(r => r.status === 201)).toHaveLength(1);
    expect(raced.filter(r => r.status !== 201).every(r => r.status === 400 || r.status === 409)).toBe(true);
    await dispatch(hub, stop.runId).expect(400); // already dispatched

    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: stop.shipmentId } })).status).toBe('out_for_delivery');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: stop.orderId } })).status).toBe('shipped');
    expect(await prisma.shipmentEvent.findFirst({ where: { shipmentId: stop.shipmentId, type: 'OUT_FOR_DELIVERY' } }))
      .toMatchObject({ actorId: hub.id });
    expect(Number((await prisma.paymentCollection.findUniqueOrThrow({ where: { orderId: stop.orderId } })).expectedAmount)).toBe(500);
    // A replayed scan after the run left returns the original custody record; nothing new is written.
    expect((await scan(driver, stop.shipmentId, stop.barcode).expect(201)).body.id).toBe(first.body.id);

    // Only the run's driver delivers; a wrong driver cannot, and duplicates do not double-declare.
    await deliver(otherDriver, stop.shipmentId, { collectedAmount: 500 }).expect(404);
    const delivered = await deliver(driver, stop.shipmentId, { collectedAmount: 500 }).expect(201);
    expect((await deliver(driver, stop.shipmentId, { collectedAmount: 500 }).expect(201)).body.id).toBe(delivered.body.id);
    expect(await trail(stop.shipmentId)).toEqual(['HANDOFF_SCANNED', 'OUT_FOR_DELIVERY', 'DELIVERED']);
    expect(await prisma.paymentCollection.findUniqueOrThrow({ where: { orderId: stop.orderId } }))
      .toMatchObject({ status: 'collected', courierId: driver.id });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: stop.orderId } })).status).toBe('delivered');
  });

  it('rejects delivery and the COD declaration on a run that left without custody (pre-fix data)', async () => {
    const stop = await plannedStop();
    // A run dispatched before custody was enforced: on the road, but nobody scanned the parcel.
    await prisma.deliveryBatch.update({ where: { id: stop.runId }, data: { status: 'dispatched', dispatchedAt: new Date() } });
    await prisma.shipment.update({ where: { id: stop.shipmentId }, data: { status: 'out_for_delivery' } });
    await prisma.order.update({ where: { id: stop.orderId }, data: { status: 'shipped' } });

    // Custody cannot be backfilled once the run has left the hub.
    expect(codeOf((await scan(driver, stop.shipmentId, stop.barcode).expect(409)).body)).toBe('CUSTODY_SCAN_NOT_OPEN');
    for (const attempt of [
      () => deliver(driver, stop.shipmentId, { collectedAmount: 500 }),
      () => http().patch(`/fulfillment/shipments/${stop.shipmentId}/status`).set(driver.auth).send({ status: 'delivered', collectedAmount: 500 }),
    ]) {
      expect(codeOf((await attempt().expect(409)).body)).toBe('CUSTODY_SCAN_REQUIRED');
    }
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: stop.shipmentId } })).status).toBe('out_for_delivery');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: stop.orderId } })).status).toBe('shipped');
    const collection = await prisma.paymentCollection.findUnique({ where: { orderId: stop.orderId } });
    expect(collection?.declaredAmount ?? null).toBeNull();
    expect(await prisma.shipmentEvent.count({ where: { shipmentId: stop.shipmentId, type: 'DELIVERED' } })).toBe(0);
  });

  it('refuses staff delivery of a prepaid parcel without custody, and staff shortcuts out of the hub', async () => {
    const stop = await plannedStop({ codAmount: 0 });
    // Staff cannot move a packed parcel out of the hub except by dispatching its run.
    expect(codeOf((await http().patch(`/fulfillment/shipments/${stop.shipmentId}/status`).set(hub.auth)
      .send({ status: 'out_for_delivery' }).expect(409)).body)).toBe('RUN_DISPATCH_REQUIRED');
    expect(codeOf((await http().post(`/fulfillment/shipments/${stop.shipmentId}/events`).set(admin.auth)
      .send({ type: 'OUT_FOR_DELIVERY' }).expect(409)).body)).toBe('RUN_DISPATCH_REQUIRED');
    await expectStillAtHub(stop);

    // Even out of the hub (pre-fix data), a non-COD delivery needs the driver's custody.
    await prisma.deliveryBatch.update({ where: { id: stop.runId }, data: { status: 'dispatched', dispatchedAt: new Date() } });
    await prisma.shipment.update({ where: { id: stop.shipmentId }, data: { status: 'out_for_delivery' } });
    await prisma.order.update({ where: { id: stop.orderId }, data: { status: 'shipped' } });
    const refused = await http().patch(`/fulfillment/shipments/${stop.shipmentId}/status`).set(admin.auth)
      .send({ status: 'delivered' }).expect(409);
    expect(codeOf(refused.body)).toBe('CUSTODY_SCAN_REQUIRED');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: stop.orderId } })).status).toBe('shipped');
  });
});
