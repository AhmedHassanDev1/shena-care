import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { SupplyPlanService } from '../../src/modules/sourcing/services/supply-plan.service';
import { SourcingEventListener } from '../../src/modules/sourcing/services/sourcing-event.listener';
import { OrderPlacedEvent } from '../../src/platform/events/integration.events';
import { createSellableSku } from '../fixtures/sellable-sku';
const request = require('supertest');

describe('Availability confirmation and supply plan (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let plans: SupplyPlanService;
  let listener: SourcingEventListener;
  let customerId: string;
  let customerAuth: string;
  let adminAuth: string;
  const http = () => request(app.getHttpServer());

  const makeSku = async () => {
    const suffix = randomUUID();
    const brand = await prisma.brand.create({ data: { name: 'Supply ' + suffix, slug: 'supply-' + suffix } });
    const product = await prisma.product.create({ data: {
      brandId: brand.id, name: 'Supply Product ' + suffix, slug: 'supply-product-' + suffix,
    } });
    const sku = await prisma.sku.create({ data: { productId: product.id, code: 'SUP-' + suffix, variantName: 'Original' } });
    return sku.id;
  };

  const makeOffer = async (skuId: string, cost: number, observedAt = new Date(), isAvailable = true) => {
    const suffix = randomUUID();
    const supplier = await prisma.supplier.create({ data: { name: 'Supply ' + suffix, slug: 'supply-' + suffix } });
    return prisma.supplierOffer.create({ data: {
      supplierId: supplier.id, skuId, costPrice: cost, currency: 'EGP',
      lastObservedAt: observedAt, isAvailable,
    } });
  };

  const makeOrder = async (skuId: string, quantity = 3) => {
    const order = await prisma.order.create({ data: {
      orderNumber: 'ORD-' + randomUUID().toUpperCase(), customerId,
      customerName: 'Supply Customer', customerPhone: '01012345678',
      shippingAddress: '1 Supply Street', totalAmount: 300, shippingFee: 0,
      currency: 'EGP', status: 'placed', items: { create: [{
        skuId, quantity, price: 100, productName: 'Original Product', skuCode: 'ORIGINAL',
        currency: 'EGP', lineTotal: 100 * quantity,
      }] },
    }, include: { items: true } });
    return order;
  };

  const eventFor = (order: Awaited<ReturnType<typeof makeOrder>>) =>
    new OrderPlacedEvent(order.id, order.orderNumber, customerId,
      order.items.map(item => ({ skuId: item.skuId, quantity: item.quantity })), order.shippingAddress);

  beforeAll(async () => {
    process.env.TEST_BYPASS_AUTH = 'false';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    plans = app.get(SupplyPlanService);
    listener = app.get(SourcingEventListener);
    const customer = await http().post('/accounts/register').send({
      name: 'Supply Customer', email: 'supply-customer-' + randomUUID() + '@example.com', password: 'password123',
    }).expect(201);
    customerAuth = 'Bearer ' + customer.body.token;
    customerId = (await http().get('/accounts/me').set('Authorization', customerAuth).expect(200)).body.id;
    const admin = await http().post('/accounts/register').send({
      name: 'Supply Admin', email: 'supply-admin-' + randomUUID() + '@example.com', password: 'password123',
    }).expect(201);
    adminAuth = 'Bearer ' + admin.body.token;
    const adminId = (await http().get('/accounts/me').set('Authorization', adminAuth).expect(200)).body.id;
    await prisma.customer.update({ where: { id: adminId }, data: { roles: ['ADMIN'] } });
  });
  afterAll(async () => { await app.close(); });

  it('turns a real submitted checkout into one sourcing request', async () => {
    const fixture = await createSellableSku(prisma);
    const product = await http().get('/products/' + fixture.productSlug).expect(200);
    const skuId = product.body.skus[0].id;
    const cart = await http().post('/ordering/cart/add').send({ skuId, quantity: 2 }).expect(201);
    const token = cart.body.guestCartToken;
    const quote = await http().post('/ordering/checkout/quote').set('x-cart-token', token)
      .send({ governorate: 'Cairo', area: 'Maadi' }).expect(201);
    const submitted = await http().post('/ordering/checkout').set('x-cart-token', token).send({
      customerName: 'Supply Customer', customerPhone: '01012345678', shippingAddress: '1 Supply Street',
      governorate: 'Cairo', area: 'Maadi', quoteVersion: quote.body.quoteVersion,
      cartRevision: quote.body.revision, idempotencyKey: randomUUID(),
    }).expect(201);
    let count = 0;
    for (let attempt = 0; attempt < 40; attempt++) {
      count = await prisma.supplyRequest.count({ where: { orderId: submitted.body.id } });
      if (count) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    expect(count).toBe(1);
    const plan = await plans.initiateForOrder(submitted.body.id);
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0]).toMatchObject({
      orderItemId: submitted.body.items[0].id, skuId, requiredQuantity: 2,
    });
    expect(await prisma.supplyRequest.count({ where: { orderId: submitted.body.id } })).toBe(1);
  });

  it('creates one request, uses eligible ranked offers, and confirms without exposing suppliers in tracking', async () => {
    const skuId = await makeSku();
    const stale = await makeOffer(skuId, 1, new Date(Date.now() - 9 * 86400_000));
    const expensive = await makeOffer(skuId, 100);
    const cheaper = await makeOffer(skuId, 50);
    const order = await makeOrder(skuId);
    await listener.handleOrderPlacedEvent(eventFor(order));
    const first = await plans.getPlan(order.id);
    expect(first.status).toBe('CONFIRMING');
    expect(first.lines[0].allocations).toHaveLength(1);
    expect(first.lines[0].allocations[0].supplierOfferId).toBe(cheaper.id);
    expect(first.lines[0].allocations[0].supplierOfferId).not.toBe(stale.id);
    expect(first.lines[0].allocations[0].supplierOfferId).not.toBe(expensive.id);
    await Promise.all([plans.initiateForOrder(order.id), plans.initiateForOrder(order.id)]);
    expect(await prisma.supplyRequest.count({ where: { orderId: order.id } })).toBe(1);
    expect(await prisma.sourceAllocation.count({ where: { requirement: { supplyRequest: { orderId: order.id } } } })).toBe(1);
    const path = '/ordering/orders/' + order.orderNumber + '/tracking';
    let tracking = (await http().get(path).set('Authorization', customerAuth).expect(200)).body;
    expect(tracking.status).toBe('CONFIRMING_PRODUCTS');
    await http().get('/sourcing/supply-plans/orders/' + order.id).expect(401);
    await http().get('/sourcing/supply-plans/orders/' + order.id).set('Authorization', customerAuth).expect(403);
    const confirmation = { result: 'confirmed_full', confirmedQuantity: 3, evidenceRef: 'supplier-email-1' };
    await http().post('/sourcing/supply-plans/allocations/' + first.lines[0].allocations[0].id + '/confirm')
      .send(confirmation).expect(401);
    await http().post('/sourcing/supply-plans/allocations/' + first.lines[0].allocations[0].id + '/confirm')
      .set('Authorization', customerAuth).send(confirmation).expect(403);
    await http().post('/sourcing/supply-plans/allocations/not-a-uuid/confirm')
      .set('Authorization', adminAuth).send(confirmation).expect(400);
    await http().post('/sourcing/supply-plans/allocations/' + first.lines[0].allocations[0].id + '/confirm')
      .set('Authorization', adminAuth).send({ result: 'pending', confirmedQuantity: 0 }).expect(400);
    await http().post('/sourcing/supply-plans/allocations/' + first.lines[0].allocations[0].id + '/confirm')
      .set('Authorization', adminAuth).send({ result: 'confirmed_full', confirmedQuantity: 4 }).expect(400);
    const confirmed = await http().post('/sourcing/supply-plans/allocations/' + first.lines[0].allocations[0].id + '/confirm')
      .set('Authorization', adminAuth).send(confirmation).expect(201);
    expect(confirmed.body.status).toBe('COVERED');
    tracking = (await http().get(path).set('Authorization', customerAuth).expect(200)).body;
    expect(tracking.status).toBe('CONFIRMED');
    expect(tracking.availabilityConfirmed).toBe(true);
    expect(tracking.items[0].status).toBe('confirmed');
    expect(tracking.actionRequired).toBeNull();
    const serialized = JSON.stringify(tracking).toLowerCase();
    for (const hidden of ['supplier', 'costprice', 'selectedcost', 'ranking', 'fallback']) expect(serialized).not.toContain(hidden);
    const historical = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    expect(historical.items[0]).toMatchObject({ skuId, quantity: 3, productName: 'Original Product' });
    expect(historical.items[0].price.toNumber()).toBe(100);
  });

  it('falls back for the same SKU after partial confirmation and handles duplicate confirmation safely', async () => {
    const skuId = await makeSku();
    const firstOffer = await makeOffer(skuId, 30);
    const secondOffer = await makeOffer(skuId, 60);
    const order = await makeOrder(skuId);
    const initial = await plans.initiateForOrder(order.id);
    const allocationId = initial.lines[0].allocations[0].id;
    expect(initial.lines[0].allocations[0].supplierOfferId).toBe(firstOffer.id);
    const input = { result: 'confirmed_partial' as const, confirmedQuantity: 1, evidenceRef: 'partial-1' };
    const afterPartial = await plans.confirmAllocation(allocationId, input);
    expect(afterPartial.lines[0].allocations).toHaveLength(2);
    const fallback = afterPartial.lines[0].allocations.find(a => a.supplierOfferId === secondOffer.id)!;
    expect(fallback.allocatedQuantity).toBe(2);
    expect(fallback.result).toBe('pending');
    await Promise.all([plans.confirmAllocation(allocationId, input), plans.initiateForOrder(order.id)]);
    expect(await prisma.sourceAllocation.count({ where: { requirement: { supplyRequest: { orderId: order.id } } } })).toBe(2);
    const covered = await plans.confirmAllocation(fallback.id, { result: 'confirmed_full', confirmedQuantity: 2 });
    expect(covered.status).toBe('COVERED');
    expect(covered.lines[0].coveredQuantity).toBe(3);
    expect(covered.lines[0].actionRequirement).toBeNull();
    await expect(plans.confirmAllocation(allocationId, { result: 'confirmed_full', confirmedQuantity: 3 }))
      .rejects.toMatchObject({ status: 409 });
  });

  it('emits a typed shortage only after sources are exhausted and keeps the original order unchanged', async () => {
    const skuId = await makeSku();
    const offer = await makeOffer(skuId, 40);
    const order = await makeOrder(skuId);
    const pending = await plans.initiateForOrder(order.id);
    const initialId = pending.lines[0].allocations[0].id;
    await prisma.supplierOffer.update({ where: { id: offer.id }, data: { costPrice: 90 } });
    const exhausted = await plans.confirmAllocation(initialId, { result: 'confirmed_full', confirmedQuantity: 3 });
    expect(exhausted.status).toBe('UNAVAILABLE');
    expect(exhausted.lines[0].allocations[0].result).toBe('price_changed');
    expect(exhausted.lines[0].coveredQuantity).toBe(0);
    expect(exhausted.lines[0].actionRequirement).toMatchObject({
      category: 'SOURCE_EXHAUSTED', unresolvedQuantity: 3,
    });
    const replay = await plans.confirmAllocation(initialId, { result: 'confirmed_full', confirmedQuantity: 3 });
    expect(replay.status).toBe('UNAVAILABLE');
    expect(replay.lines[0].allocations).toHaveLength(1);
    const tracking = (await http().get('/ordering/orders/' + order.orderNumber + '/tracking')
      .set('Authorization', customerAuth).expect(200)).body;
    expect(tracking.status).toBe('ACTION_REQUIRED');
    expect(tracking.actionRequired).toMatchObject({ category: 'availability', affectedItemIds: [order.items[0].id] });
    expect(tracking.actionRequired.issues[0]).toMatchObject({
      orderItemId: order.items[0].id, category: 'unavailable', unresolvedQuantity: 3,
    });
    expect(new Date(tracking.actionRequired.issues[0].occurredAt).getTime()).toBeGreaterThan(0);
    expect(tracking.items[0].status).toBe('action-required');
    expect(tracking.delivery.nextUpdateBy).toBeNull();
    const unchanged = await prisma.orderItem.findUniqueOrThrow({ where: { id: order.items[0].id } });
    expect(unchanged.skuId).toBe(skuId);
    expect(unchanged.price.toNumber()).toBe(100);
  });

  it('reports a partial shortage after fallback rejects and serializes concurrent confirmation attempts', async () => {
    const skuId = await makeSku();
    await makeOffer(skuId, 20);
    await makeOffer(skuId, 50);
    const order = await makeOrder(skuId);
    const initial = await plans.initiateForOrder(order.id);
    const firstId = initial.lines[0].allocations[0].id;
    const input = { result: 'confirmed_partial' as const, confirmedQuantity: 1 };
    const concurrent = await Promise.all([
      plans.confirmAllocation(firstId, input), plans.confirmAllocation(firstId, input),
    ]);
    expect(concurrent.every(plan => plan.lines[0].coveredQuantity === 1)).toBe(true);
    const fallback = (await plans.getPlan(order.id)).lines[0].allocations.find(a => a.id !== firstId)!;
    const unresolved = await plans.confirmAllocation(fallback.id, { result: 'rejected', confirmedQuantity: 0 });
    expect(unresolved.status).toBe('PARTIALLY_UNAVAILABLE');
    expect(unresolved.lines[0]).toMatchObject({ coveredQuantity: 1, unresolvedQuantity: 2 });
    expect(unresolved.lines[0].actionRequirement).toMatchObject({
      category: 'SOURCE_EXHAUSTED', unresolvedQuantity: 2,
    });
    expect(await prisma.sourceAllocation.count({ where: { requirement: { supplyRequest: { orderId: order.id } } } })).toBe(2);
    expect(await prisma.availabilityActionRequirement.count({ where: {
      requirement: { supplyRequest: { orderId: order.id } },
    } })).toBe(1);
  });

  it('does not count confirmation from a source that became unavailable', async () => {
    const skuId = await makeSku();
    const offer = await makeOffer(skuId, 25);
    const order = await makeOrder(skuId);
    const pending = await plans.initiateForOrder(order.id);
    await prisma.supplierOffer.update({ where: { id: offer.id }, data: { isAvailable: false } });
    const result = await plans.confirmAllocation(pending.lines[0].allocations[0].id,
      { result: 'confirmed_full', confirmedQuantity: 3 });
    expect(result.status).toBe('UNAVAILABLE');
    expect(result.lines[0].coveredQuantity).toBe(0);
    expect(result.lines[0].allocations[0].result).toBe('unavailable');
    expect(result.lines[0].actionRequirement?.unresolvedQuantity).toBe(3);
  });
});
