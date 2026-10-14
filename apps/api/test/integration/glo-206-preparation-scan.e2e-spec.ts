import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AiClient } from '../../src/platform/ai';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { createActor, Actor } from '../fixtures/actors';

/** GLO-209 / GLO-206: concurrent or retried preparation scans never over-count a line. */
describe('GLO-206 preparation scan concurrency (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor;
  let locationId: string; let shipmentId: string;
  const skuId = randomUUID();
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useValue(new DeterministicAiClient()).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useLogger(false);
    await app.init();
    prisma = app.get(PrismaService);
    admin = await createActor(prisma, 'ADMIN');
    locationId = (await prisma.fulfillmentLocation.create({ data: { name: 'Scan Hub ' + randomUUID(), address: 'S' } })).id;
    shipmentId = (await prisma.shipment.create({ data: { orderId: randomUUID(), locationId, status: 'ready_to_prepare',
      items: { create: [{ skuId, quantity: 2 }] } } })).id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.shipment.deleteMany({ where: { id: shipmentId } });
      await prisma.fulfillmentLocation.deleteMany({ where: { id: locationId } });
    }
    if (app) await app.close();
  });

  it('records exactly the expected quantity under concurrent scans, then completes', async () => {
    const session = await http().post(`/fulfillment/shipments/${shipmentId}/preparation`).set(admin.auth).send({}).expect(201);
    expect(session.body.operatorId).toBe(admin.id);
    const scans = await Promise.all(Array.from({ length: 6 }, () =>
      http().post(`/fulfillment/preparation-sessions/${session.body.id}/scan`).set(admin.auth).send({ skuId })));
    expect(scans.every(res => res.status === 201)).toBe(true);
    expect(scans.filter(res => res.body.isSuccessful).length).toBe(2);
    expect(scans.filter(res => res.body.errorReason === 'EXCESS_QUANTITY').length).toBe(4);

    await http().post(`/fulfillment/preparation-sessions/${session.body.id}/complete`).set(admin.auth).expect(201);
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })).status).toBe('prepared');
    await http().post(`/fulfillment/preparation-sessions/${session.body.id}/scan`).set(admin.auth).send({ skuId }).expect(400);
  });
});
