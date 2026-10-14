import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AiClient } from '../../src/platform/ai';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { createActor, Actor } from '../fixtures/actors';

/** GLO-206 W24 F-06: a support case's customer, order and supplier come from the session. */
describe('GLO-206 support case attribution (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor; let victim: Actor; let customer: Actor; let driver: Actor; let supplier: Actor;
  let supplierId: string; let otherSupplierId: string; let victimOrder: string; let ownOrder: string;
  const caseIds: string[] = [];
  const http = () => request(app.getHttpServer());

  const order = async (customerId: string) => (await prisma.order.create({ data: {
    orderNumber: 'ORD-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(), customerId,
    customerName: 'Case Customer', customerPhone: '01012345678', shippingAddress: '1 Case Street',
    totalAmount: 100, currency: 'EGP',
  } })).id;
  const open = (actor: Actor, extra: object = {}) =>
    http().post('/operations/support/cases').set(actor.auth).send({ title: 'Help', description: 'Issue', ...extra });

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useValue(new DeterministicAiClient()).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useLogger(false);
    await app.init();
    prisma = app.get(PrismaService);
    supplierId = (await prisma.supplier.create({ data: { name: 'Case Supplier ' + randomUUID(), slug: 'case-' + randomUUID() } })).id;
    otherSupplierId = (await prisma.supplier.create({ data: { name: 'Other Supplier ' + randomUUID(), slug: 'other-' + randomUUID() } })).id;
    admin = await createActor(prisma, 'ADMIN');
    victim = await createActor(prisma, 'CUSTOMER');
    customer = await createActor(prisma, 'CUSTOMER');
    driver = await createActor(prisma, 'DRIVER');
    supplier = await createActor(prisma, 'SUPPLIER', supplierId);
    victimOrder = await order(victim.id);
    ownOrder = await order(customer.id);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.supportCase.deleteMany({ where: { OR: [{ id: { in: caseIds } }, { customerId: { in: [victim.id, customer.id] } }] } });
      await prisma.order.deleteMany({ where: { id: { in: [victimOrder, ownOrder] } } });
      await prisma.customer.updateMany({ where: { supplierId: { in: [supplierId, otherSupplierId] } }, data: { supplierId: null } });
      await prisma.supplier.deleteMany({ where: { id: { in: [supplierId, otherSupplierId] } } });
    }
    if (app) await app.close();
  });

  it('drivers cannot file cases as a customer or about a customer order', async () => {
    await open(driver, { customerId: victim.id }).expect(403);
    await open(driver, { orderId: victimOrder }).expect(404);
    await open(driver, { supplierId }).expect(403);
    const plain = await open(driver).expect(201);
    caseIds.push(plain.body.id);
    expect(plain.body.customerId).toBeNull();
    expect(await prisma.supportCase.count({ where: { customerId: victim.id } })).toBe(0);
  });

  it('customers file only for themselves and their own orders', async () => {
    await open(customer, { customerId: victim.id }).expect(403);
    await open(customer, { orderId: victimOrder }).expect(404);
    await open(customer, { supplierId }).expect(403);
    const own = await open(customer, { orderId: ownOrder }).expect(201);
    expect(own.body.customerId).toBe(customer.id);
    expect(own.body.orderId).toBe(ownOrder);
    await http().get(`/operations/support/cases/${own.body.id}`).set(victim.auth).expect(404);
  });

  it('suppliers file only for their own supplier', async () => {
    await open(supplier, { supplierId: otherSupplierId }).expect(403);
    const own = await open(supplier).expect(201);
    caseIds.push(own.body.id);
    expect(own.body.supplierId).toBe(supplierId);
    expect(own.body.customerId).toBeNull();
  });

  it('staff may file on a customer\'s behalf', async () => {
    const filed = await open(admin, { customerId: victim.id, orderId: victimOrder }).expect(201);
    expect(filed.body.customerId).toBe(victim.id);
    await http().get(`/operations/support/cases/${filed.body.id}`).set(victim.auth).expect(200);
  });
});
