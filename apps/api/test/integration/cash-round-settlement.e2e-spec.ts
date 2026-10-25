import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { ReconciliationService } from '../../src/modules/ordering/services/reconciliation.service';
import { createActor } from '../fixtures/actors';
import request from 'supertest';

/** Owner decision 2026-10-25: the cashier counts a driver's whole round as one total; the difference shows on the round. */
describe('Cash settlement by round (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let hub: { id: string; auth: Record<string, string> };
  let otherHub: { id: string; auth: Record<string, string> };
  let admin: { auth: Record<string, string> };
  let locationId: string;
  const http = () => request(app.getHttpServer());

  /** A delivered COD order whose driver declared `declared` against `expected` expected at dispatch. */
  const delivered = async (courierId: string, expected: number, declared: number, declaredHoursAgo = 1) => {
    const order = await prisma.order.create({ data: {
      orderNumber: 'ORD-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(), customerName: 'Round Customer', customerPhone: '01012345678',
      shippingAddress: '1 Round St', currency: 'EGP', status: 'delivered', subtotal: expected - 30, shippingFee: 30, totalAmount: expected, codAmount: expected,
    } });
    await prisma.paymentCollection.create({ data: {
      orderId: order.id, expectedAmount: expected, declaredAmount: declared, declaredAt: new Date(Date.now() - declaredHoursAgo * 3_600_000),
      courierId, locationId, currency: 'EGP', status: 'collected',
    } });
    return order.id;
  };

  beforeAll(async () => {
    process.env.TEST_BYPASS_AUTH = 'false';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    locationId = (await prisma.fulfillmentLocation.create({ data: { name: 'Round Hub ' + randomUUID(), address: '1 Hub' } })).id;
    const other = (await prisma.fulfillmentLocation.create({ data: { name: 'Other Hub ' + randomUUID(), address: '2 Hub' } })).id;
    const operator = await createActor(prisma, Role.HUB_OPERATOR);
    const stranger = await createActor(prisma, Role.HUB_OPERATOR);
    await prisma.fulfillmentLocationOperator.create({ data: { locationId, operatorId: operator.id } });
    await prisma.fulfillmentLocationOperator.create({ data: { locationId: other, operatorId: stranger.id } });
    hub = operator; otherHub = stranger;
    admin = await createActor(prisma, Role.ADMIN);
  });
  afterAll(async () => { await app.close(); });

  it('shows the expected and declared cash of a round before it is counted, and counts it once as one total', async () => {
    const driver = await createActor(prisma, Role.DRIVER);
    const ids = [await delivered(driver.id, 130, 130), await delivered(driver.id, 230, 230), await delivered(driver.id, 80, 70)];
    const open = (await http().get('/ordering/settlements/rounds/open').set(hub.auth).expect(200)).body as Array<Record<string, unknown>>;
    expect(open.find(r => r.courierId === driver.id)).toMatchObject({ orders: 3, expectedTotal: '440.00', declaredTotal: '430.00', locationId });
    await http().get('/ordering/settlements/rounds/open').set(otherHub.auth).expect(200)
      .then(res => expect((res.body as Array<{ courierId: string }>).some(r => r.courierId === driver.id)).toBe(false));

    const reference = 'ROUND-' + randomUUID();
    const body = { courierId: driver.id, locationId, reference, countedTotal: 430, fees: 0 };
    await http().post('/ordering/settlements/rounds').set(otherHub.auth).send(body).expect(403);
    const batch = (await http().post('/ordering/settlements/rounds').set(hub.auth).send(body).expect(201)).body;
    expect(batch).toMatchObject({ expectedTotal: '440.00', declaredTotal: '430.00', countedTotal: '430.00', variance: '-10.00', varianceVsDeclared: '0.00' });
    expect(batch.lines).toHaveLength(3);
    expect((await prisma.paymentCollection.findMany({ where: { orderId: { in: ids } } })).map(c => c.status).sort()).toEqual(['settled', 'settled', 'short']);

    // The same count replays; a different count under the same reference conflicts; nothing is left to count.
    expect((await http().post('/ordering/settlements/rounds').set(hub.auth).send(body).expect(201)).body.id).toBe(batch.id);
    await http().post('/ordering/settlements/rounds').set(hub.auth).send({ ...body, countedTotal: 400 }).expect(409);
    const none = await http().post('/ordering/settlements/rounds').set(hub.auth).send({ ...body, reference: 'ROUND-' + randomUUID() }).expect(409);
    expect(none.body.code ?? none.body.message).toBeDefined();
  });

  it('marks a large round difference and lists it first; a small one is flagged as small', async () => {
    const reconciliation = app.get(ReconciliationService);
    const settle = async (declared: number, counted: number) => {
      const driver = await createActor(prisma, Role.DRIVER);
      await delivered(driver.id, 130, declared);
      return (await http().post('/ordering/settlements/rounds').set(hub.auth).send({
        courierId: driver.id, locationId, reference: 'ROUND-' + randomUUID(), countedTotal: counted,
      }).expect(201)).body;
    };
    const small = await settle(130, 125);   // −5
    const large = await settle(130, 60);    // −70
    const { items } = await reconciliation.listRoundVariances('all', 200);
    expect(items.find(i => i.batchId === small.id)).toMatchObject({ variance: '-5.00', severity: 'small' });
    expect(items.find(i => i.batchId === large.id)).toMatchObject({ variance: '-70.00', severity: 'large' });
    expect(items.findIndex(i => i.batchId === large.id)).toBeLessThan(items.findIndex(i => i.batchId === small.id));
    const attention = (await http().get('/operations/queues/attention').query({ take: 100 }).set(admin.auth).expect(200)).body;
    expect(attention.roundVariances.items.some((i: { batchId: string }) => i.batchId === large.id)).toBe(true);
  });

  it('flags a round that was not counted within 12 hours', async () => {
    const lateDriver = await createActor(prisma, Role.DRIVER);
    const freshDriver = await createActor(prisma, Role.DRIVER);
    await delivered(lateDriver.id, 130, 130, 13);
    await delivered(freshDriver.id, 130, 130, 2);
    const overdue = await app.get(ReconciliationService).listOpenRounds('all', 12);
    expect(overdue.some(r => r.courierId === lateDriver.id)).toBe(true);
    expect(overdue.some(r => r.courierId === freshDriver.id)).toBe(false);
    const attention = (await http().get('/operations/queues/attention').query({ take: 100 }).set(admin.auth).expect(200)).body;
    expect(attention.unsettledRounds.items.some((r: { courierId: string }) => r.courierId === lateDriver.id)).toBe(true);
  });

  it('validates the count', async () => {
    const driver = await createActor(prisma, Role.DRIVER);
    const body = { courierId: driver.id, locationId, reference: 'ROUND-' + randomUUID(), countedTotal: 10 };
    await http().post('/ordering/settlements/rounds').set(hub.auth).send({ ...body, countedTotal: -1 }).expect(400);
    await http().post('/ordering/settlements/rounds').set(hub.auth).send({ ...body, countedTotal: 10.123 }).expect(400);
    await http().post('/ordering/settlements/rounds').set(hub.auth).send({ ...body, fees: 50 }).expect(400);
    await http().post('/ordering/settlements/rounds').send(body).expect(401);
  });
});
