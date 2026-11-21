/* eslint-disable @typescript-eslint/no-explicit-any -- HTTP response bodies are asserted structurally */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { SupplyPlanService } from '../../src/modules/sourcing/services/supply-plan.service';

/**
 * QA lifecycle matrix — cancellation against the MVP's INTERNAL_BUY_LIST sourcing: before anything is bought, after part of it was
 * bought, and after all of it was bought. Staff cancel through the real Admin endpoint (not a status write), and every other order
 * sharing the product keeps its demand, its coverage and its place in the list.
 */
describe('QA lifecycle matrix: cancellation with the internal Buy List (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let plans: SupplyPlanService;
  let adminAuth: string;
  let operatorAuth: string;
  const previousMode = process.env.SOURCING_MODE;
  const http = () => request(app.getHttpServer());

  const register = async (label: string) => {
    const registered = await http().post('/accounts/register').send({ name: label, email: `${label.toLowerCase().replace(/\s/g, '-')}-${randomUUID()}@example.com`, password: 'password123' }).expect(201);
    const auth = `Bearer ${registered.body.token}`;
    const user = (await http().get('/accounts/me').set('Authorization', auth).expect(200)).body;
    return { auth, id: user.id as string };
  };
  const makeSku = async (variantName: string) => {
    const suffix = randomUUID();
    const brand = await prisma.brand.create({ data: { name: `QA BL ${suffix}`, slug: `qa-bl-${suffix}` } });
    const product = await prisma.product.create({ data: { brandId: brand.id, name: `QA BL Product ${suffix}`, slug: `qa-bl-product-${suffix}` } });
    return prisma.sku.create({ data: { productId: product.id, code: `QBL-${suffix}`, variantName, barcode: `QBL-BAR-${suffix}` } });
  };
  const placeOrder = async (sku: { id: string; code: string; variantName: string }, quantity: number) => {
    const order = await prisma.order.create({ data: {
      orderNumber: `ORD-${randomUUID().toUpperCase()}`, customerName: 'QA Customer', customerPhone: '01012345678', shippingAddress: '1 QA Street',
      totalAmount: quantity * 100, subtotal: quantity * 100, shippingFee: 0, currency: 'EGP', status: 'placed', paymentMethod: 'COD',
      items: { create: [{ skuId: sku.id, quantity, price: 100, productName: 'QA Product', skuCode: sku.code, variantName: sku.variantName, currency: 'EGP', lineTotal: quantity * 100 }] },
    } });
    await plans.initiateForOrder(order.id);
    return order;
  };
  const list = async () => (await http().get('/buy-list').set('Authorization', operatorAuth).expect(200)).body as { items: Array<any> };
  const row = async (skuId: string) => (await list()).items.find(i => i.skuId === skuId);
  const acquire = (skuId: string, quantity: number) => http().post('/buy-list/acquire').set('Authorization', operatorAuth).send({ skuId, quantity, idempotencyKey: randomUUID() });
  const cancel = (orderId: string) => http().post(`/ordering/orders/${orderId}/cancel`).set('Authorization', adminAuth).send({ reasonCode: 'CUSTOMER_REQUEST' });
  const statusOf = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id } })).status;

  beforeAll(async () => {
    process.env.TEST_BYPASS_AUTH = 'false';
    process.env.SOURCING_MODE = 'INTERNAL_BUY_LIST';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    plans = app.get(SupplyPlanService);
    const admin = await register('QA BL Admin');
    adminAuth = admin.auth;
    await prisma.customer.update({ where: { id: admin.id }, data: { roles: ['ADMIN'] } });
    const operator = await register('QA BL Operator');
    operatorAuth = operator.auth;
    await prisma.customer.update({ where: { id: operator.id }, data: { roles: ['HUB_OPERATOR'] } });
    const location = await http().post('/fulfillment/locations').set('Authorization', adminAuth).send({ name: `QA BL Hub ${randomUUID()}`, address: '1 Hub Street', capabilities: ['RECEIVE_SUPPLIER_GOODS', 'PREPARE_ORDERS'] }).expect(201);
    await http().post(`/fulfillment/locations/${location.body.id}/operators`).set('Authorization', adminAuth).send({ operatorId: operator.id }).expect(201);
  });
  afterAll(async () => {
    if (previousMode === undefined) delete process.env.SOURCING_MODE; else process.env.SOURCING_MODE = previousMode;
    await app.close();
  });

  it('before anything is bought: the order leaves the list, the other order keeps its demand, and no exception is needed', async () => {
    const sku = await makeSku('Before');
    const a = await placeOrder(sku, 2); const k = await placeOrder(sku, 1);
    expect(await row(sku.id)).toMatchObject({ toBuy: 3, orderCount: 2 });

    const done = await cancel(a.id).expect(201);
    expect(done.body).toMatchObject({ alreadyCancelled: false, boughtUnits: 0, exceptionCaseId: null });
    expect(await row(sku.id)).toMatchObject({ toBuy: 1, orderCount: 1 });
    expect(await statusOf(a.id)).toBe('cancelled');
    expect(await statusOf(k.id)).toBe('placed');
    await acquire(sku.id, 2).expect(409); // only the surviving order's unit is outstanding
    await acquire(sku.id, 1).expect(200);
    expect((await plans.getPlan(k.id)).status).toBe('COVERED');
  });

  it('after part of it was bought: the bought units raise one actionable exception instead of vanishing, and the other order is untouched', async () => {
    const sku = await makeSku('Partial');
    const a = await placeOrder(sku, 2); const k = await placeOrder(sku, 1);
    await acquire(sku.id, 2).expect(200); // oldest first: the cancelled order's two units are the ones bought
    expect(await row(sku.id)).toMatchObject({ acquired: 2, toBuy: 1 });

    const done = await cancel(a.id).expect(201);
    expect(done.body).toMatchObject({ boughtUnits: 2 });
    expect(done.body.exceptionCaseId).toEqual(expect.any(String));
    const exception = await prisma.supportCase.findUniqueOrThrow({ where: { id: done.body.exceptionCaseId } });
    expect(exception).toMatchObject({ category: 'cancellation', priority: 'high', orderId: a.id });
    expect(exception.description ?? JSON.stringify(exception)).toMatch(/2 unit\(s\) were already bought/);
    // The other order still needs its own unit (no silent re-allocation of the cancelled order's purchase) and stays open.
    expect(await row(sku.id)).toMatchObject({ toBuy: 1, orderCount: 1 });
    expect(await statusOf(k.id)).toBe('placed');
    expect((await plans.getPlan(k.id)).status).not.toBe('COVERED');
  });

  it('after everything was bought: one exception for the cancelled order, the other order stays covered, and a replay opens nothing new', async () => {
    const sku = await makeSku('All');
    const a = await placeOrder(sku, 2); const k = await placeOrder(sku, 1);
    await acquire(sku.id, 3).expect(200);

    const done = await cancel(a.id).expect(201);
    expect(done.body).toMatchObject({ boughtUnits: 2 });
    expect(done.body.exceptionCaseId).toEqual(expect.any(String));
    expect(await row(sku.id)).toMatchObject({ acquired: 1, toBuy: 0, orderCount: 1 });
    expect((await plans.getPlan(k.id)).status).toBe('COVERED');
    expect(await statusOf(k.id)).toBe('placed');

    const replay = await cancel(a.id).expect(201);
    expect(replay.body).toMatchObject({ alreadyCancelled: true, exceptionCaseId: null });
    expect(await prisma.supportCase.count({ where: { orderId: a.id, category: 'cancellation' } })).toBe(1);
  });
});
