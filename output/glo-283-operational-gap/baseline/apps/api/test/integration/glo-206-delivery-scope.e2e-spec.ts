import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AiClient } from '../../src/platform/ai';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { createActor, Actor } from '../fixtures/actors';

/**
 * GLO-206 GAP-05: object-level scope for drivers and hub operators. Two drivers and two hubs;
 * every request goes through the production guards with persisted sessions.
 */
describe('GLO-206 delivery object scope (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor; let hubA: Actor; let hubB: Actor; let driver1: Actor; let driver2: Actor;
  let locA: string; let locB: string;
  let s1: string; let s2: string; let s3: string; let s4: string;
  let run1: string; let run2: string; let planningA: string;
  const http = () => request(app.getHttpServer());
  const shipmentIds: string[] = []; const batchIds: string[] = []; const locationIds: string[] = [];

  const shipment = async (locationId: string, status: 'packed' | 'out_for_delivery') => {
    const created = await prisma.shipment.create({ data: { orderId: randomUUID(), locationId, status } });
    shipmentIds.push(created.id);
    return created.id;
  };
  const batch = async (locationId: string, driverId: string | null, status: string, stopIds: string[]) => {
    const created = await prisma.deliveryBatch.create({ data: { locationId, driverId, status,
      stops: { create: stopIds.map((shipmentId, i) => ({ shipmentId, sequence: i + 1 })) } } });
    batchIds.push(created.id);
    return created.id;
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
    hubA = await createActor(prisma, 'HUB_OPERATOR');
    hubB = await createActor(prisma, 'HUB_OPERATOR');
    driver1 = await createActor(prisma, 'DRIVER');
    driver2 = await createActor(prisma, 'DRIVER');
    locA = (await prisma.fulfillmentLocation.create({ data: { name: 'Scope Hub A ' + randomUUID(), address: 'A' } })).id;
    locB = (await prisma.fulfillmentLocation.create({ data: { name: 'Scope Hub B ' + randomUUID(), address: 'B' } })).id;
    locationIds.push(locA, locB);
    await prisma.fulfillmentLocationOperator.create({ data: { locationId: locA, operatorId: hubA.id } });
    await prisma.fulfillmentLocationOperator.create({ data: { locationId: locB, operatorId: hubB.id } });

    s1 = await shipment(locA, 'out_for_delivery'); // driver1's dispatched run
    s2 = await shipment(locA, 'out_for_delivery'); // driver2's dispatched run
    s3 = await shipment(locB, 'packed');           // hub B, unbatched
    s4 = await shipment(locA, 'packed');           // hub A, unbatched
    run1 = await batch(locA, driver1.id, 'dispatched', [s1]);
    run2 = await batch(locA, driver2.id, 'dispatched', [s2]);
    planningA = await batch(locA, null, 'planning', []);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.deliveryBatch.deleteMany({ where: { id: { in: batchIds } } });
      await prisma.shipmentEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
      await prisma.fulfillmentLocationOperator.deleteMany({ where: { locationId: { in: locationIds } } });
      await prisma.fulfillmentLocation.deleteMany({ where: { id: { in: locationIds } } });
    }
    if (app) await app.close();
  });

  describe('drivers', () => {
    it('read only shipments on their own run', async () => {
      await http().get(`/fulfillment/shipments/${s1}`).set(driver1.auth).expect(200);
      await http().get(`/fulfillment/shipments/${s1}`).set(driver2.auth).expect(404);
      await http().get(`/fulfillment/shipments/${s3}`).set(driver1.auth).expect(404);
    });

    it('cannot change status or record events on another driver\'s shipment', async () => {
      await http().patch(`/fulfillment/shipments/${s1}/status`).set(driver2.auth).send({ status: 'delivered' }).expect(404);
      await http().post(`/fulfillment/shipments/${s1}/events`).set(driver2.auth).send({ type: 'DELIVERED' }).expect(404);
      await http().post(`/fulfillment/shipments/${s1}/events`).set(driver2.auth).send({ type: 'FAILED' }).expect(404);
      const after = await prisma.shipment.findUniqueOrThrow({ where: { id: s1 } });
      expect(after.status).toBe('out_for_delivery');
      expect(await prisma.shipmentEvent.count({ where: { shipmentId: s1 } })).toBe(0);
    });

    it('are limited to delivery-stage transitions on their own shipment', async () => {
      await http().patch(`/fulfillment/shipments/${s1}/status`).set(driver1.auth).send({ status: 'packed' }).expect(403);
      await http().patch(`/fulfillment/shipments/${s1}/status`).set(driver1.auth).send({ status: 'returned' }).expect(403);
      await http().post(`/fulfillment/shipments/${s1}/events`).set(driver1.auth).send({ type: 'PACKED' }).expect(403);
      await http().post(`/fulfillment/shipments/${s1}/events`).set(driver1.auth).send({ type: 'LABEL_PRINTED' }).expect(403);
      await http().patch(`/fulfillment/shipments/${s1}/status`).set(driver1.auth).send({ status: 'out_for_delivery' }).expect(200);
    });

    it('cannot complete or re-sequence another driver\'s run, nor plan runs', async () => {
      await http().post(`/fulfillment/delivery-batches/${run1}/complete`).set(driver2.auth).expect(404);
      await http().patch(`/fulfillment/delivery-batches/${run1}/stops/sequence`).set(driver2.auth)
        .send({ stops: [{ shipmentId: s1, sequence: 1 }] }).expect(404);
      await http().post('/fulfillment/delivery-batches').set(driver1.auth).send({ hubId: locA, name: 'x' }).expect(403);
      await http().post(`/fulfillment/delivery-batches/${planningA}/stops`).set(driver1.auth).send({ stops: [{ shipmentId: s4 }] }).expect(403);
      await http().post(`/fulfillment/delivery-batches/${planningA}/dispatch`).set(driver1.auth).expect(403);
      expect((await prisma.deliveryBatch.findUniqueOrThrow({ where: { id: run1 } })).status).toBe('dispatched');
    });

    it('cannot read shipment by order or labels', async () => {
      const { orderId } = await prisma.shipment.findUniqueOrThrow({ where: { id: s1 } });
      await http().get(`/fulfillment/orders/${orderId}/shipment`).set(driver1.auth).expect(403);
      await http().post(`/fulfillment/shipments/${s1}/label`).set(driver1.auth).expect(403);
    });
  });

  describe('hub operators', () => {
    it('cannot reach another hub\'s shipments, runs, inventory or planning', async () => {
      await http().get(`/fulfillment/shipments/${s1}`).set(hubB.auth).expect(403);
      await http().patch(`/fulfillment/shipments/${s1}/status`).set(hubB.auth).send({ status: 'delivered' }).expect(403);
      await http().post(`/fulfillment/shipments/${s4}/events`).set(hubB.auth).send({ type: 'PACKED' }).expect(403);
      await http().post(`/fulfillment/shipments/${s4}/label`).set(hubB.auth).expect(403);
      await http().get(`/fulfillment/locations/${locA}/eligible-shipments`).set(hubB.auth).expect(403);
      await http().get(`/fulfillment/locations/${locA}/inventory`).set(hubB.auth).expect(403);
      await http().post('/fulfillment/delivery-batches').set(hubB.auth).send({ hubId: locA, name: 'Intruder run' }).expect(403);
      await http().post(`/fulfillment/delivery-batches/${run1}/complete`).set(hubB.auth).expect(403); // role
      await http().patch(`/fulfillment/delivery-batches/${run1}/stops/sequence`).set(hubB.auth)
        .send({ stops: [{ shipmentId: s1, sequence: 1 }] }).expect(404); // scope
      await http().post(`/fulfillment/delivery-batches/${planningA}/dispatch`).set(hubB.auth).expect(404);
      await http().post(`/fulfillment/delivery-batches/${planningA}/stops`).set(hubB.auth).send({ stops: [{ shipmentId: s3 }] }).expect(404);
      expect((await prisma.shipment.findUniqueOrThrow({ where: { id: s4 } })).status).toBe('packed');
    });

    it('operate on their own hub', async () => {
      await http().get(`/fulfillment/shipments/${s4}`).set(hubA.auth).expect(200);
      const eligible = await http().get(`/fulfillment/locations/${locA}/eligible-shipments`).set(hubA.auth).expect(200);
      expect(eligible.body.map((s: { id: string }) => s.id)).toContain(s4);
      const created = await http().post('/fulfillment/delivery-batches').set(hubA.auth)
        .send({ hubId: locA, name: 'Own run', driverId: driver1.id }).expect(201);
      batchIds.push(created.body.id);
      expect(created.body.locationId).toBe(locA);
    });

    it('cannot put another hub\'s shipment on their run', async () => {
      const res = await http().post(`/fulfillment/delivery-batches/${planningA}/stops`).set(admin.auth)
        .send({ stops: [{ shipmentId: s3 }] }).expect(400);
      expect(res.body.message).toMatch(/different hub/);
    });

    it('cannot remove a stop that belongs to a different run', async () => {
      await http().delete(`/fulfillment/delivery-batches/${planningA}/stops/${s2}`).set(hubA.auth).expect(404);
      expect(await prisma.deliveryStop.count({ where: { batchId: run2, shipmentId: s2 } })).toBe(1);
    });

    it('can only assign real driver accounts to a run', async () => {
      await http().post('/fulfillment/delivery-batches').set(hubA.auth).send({ hubId: locA, name: 'Bad', driverId: hubB.id }).expect(400);
      await http().post('/fulfillment/delivery-batches').set(hubA.auth).send({ hubId: locA, name: 'Bad', driverId: 'driver-1' }).expect(400);
    });
  });
});
