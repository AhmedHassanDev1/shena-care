import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { SupplyPlanService } from '../../src/modules/sourcing/services/supply-plan.service';
import request from 'supertest';

describe('Fulfillment supplier receiving and order allocation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let plans: SupplyPlanService;
  let adminAuth: string;
  let operatorAuth: string;
  let unassignedOperatorAuth: string;
  let customerAuth: string;
  let operatorId: string;
  let locationId: string;
  let noReceivingLocationId: string;

  const http = () => request(app.getHttpServer());

  const register = async (label: string) => {
    const registered = await http().post('/accounts/register').send({
      name: label,
      email: `${label.toLowerCase().replace(/\s/g, '-')}-${randomUUID()}@example.com`,
      password: 'password123',
    }).expect(201);
    const auth = `Bearer ${registered.body.token}`;
    const user = (await http().get('/accounts/me').set('Authorization', auth).expect(200)).body;
    return { auth, id: user.id };
  };

  const makeConfirmedAllocation = async (quantity = 3) => {
    const suffix = randomUUID();
    const brand = await prisma.brand.create({ data: { name: `Receive ${suffix}`, slug: `receive-${suffix}` } });
    const product = await prisma.product.create({ data: {
      brandId: brand.id,
      name: `Receive Product ${suffix}`,
      slug: `receive-product-${suffix}`,
    } });
    const sku = await prisma.sku.create({ data: {
      productId: product.id,
      code: `RCV-${suffix}`,
      variantName: 'Sensitive 200ml',
    } });
    const supplier = await prisma.supplier.create({ data: { name: `Receive ${suffix}`, slug: `receive-${suffix}` } });
    await prisma.supplierOffer.create({ data: {
      supplierId: supplier.id,
      skuId: sku.id,
      costPrice: 50,
      currency: 'EGP',
      isAvailable: true,
      lastObservedAt: new Date(),
    } });
    const order = await prisma.order.create({
      data: {
        orderNumber: `ORD-${randomUUID().toUpperCase()}`,
        customerName: 'Receiving Customer',
        customerPhone: '01012345678',
        shippingAddress: '1 Receiving Street',
        totalAmount: quantity * 100,
        currency: 'EGP',
        status: 'placed',
        items: { create: [{
          skuId: sku.id,
          quantity,
          price: 100,
          productName: 'Receive Product',
          skuCode: sku.code,
          variantName: sku.variantName,
          currency: 'EGP',
          lineTotal: quantity * 100,
        }] },
      },
      include: { items: true },
    });
    const plan = await plans.initiateForOrder(order.id);
    const allocationId = plan.lines[0].allocations[0].id;
    await plans.confirmAllocation(allocationId, { result: 'confirmed_full', confirmedQuantity: quantity });
    return { order, sku, allocationId, orderItemId: order.items[0].id };
  };

  beforeAll(async () => {
    process.env.TEST_BYPASS_AUTH = 'false';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    plans = app.get(SupplyPlanService);

    const admin = await register('Receiving Admin');
    adminAuth = admin.auth;
    await prisma.customer.update({ where: { id: admin.id }, data: { roles: ['ADMIN'] } });
    const operator = await register('Receiving Operator');
    operatorAuth = operator.auth;
    operatorId = operator.id;
    await prisma.customer.update({ where: { id: operator.id }, data: { roles: ['HUB_OPERATOR'] } });
    const unassigned = await register('Unassigned Operator');
    unassignedOperatorAuth = unassigned.auth;
    await prisma.customer.update({ where: { id: unassigned.id }, data: { roles: ['HUB_OPERATOR'] } });
    customerAuth = (await register('Receiving Customer')).auth;

    const location = await http().post('/fulfillment/locations').set('Authorization', adminAuth).send({
      name: `Receiving Hub ${randomUUID()}`,
      address: '1 Hub Street',
      capabilities: ['RECEIVE_SUPPLIER_GOODS', 'PREPARE_ORDERS'],
    }).expect(201);
    locationId = location.body.id;
    await http().post(`/fulfillment/locations/${locationId}/operators`).set('Authorization', adminAuth)
      .send({ operatorId }).expect(201);

    const noReceiving = await http().post('/fulfillment/locations').set('Authorization', adminAuth).send({
      name: `Preparation Only Hub ${randomUUID()}`,
      address: '2 Hub Street',
      capabilities: ['PREPARE_ORDERS'],
    }).expect(201);
    noReceivingLocationId = noReceiving.body.id;
    await http().post(`/fulfillment/locations/${noReceivingLocationId}/operators`).set('Authorization', adminAuth)
      .send({ operatorId }).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('enforces authentication, role, location ownership, and receiving capability', async () => {
    const fixture = await makeConfirmedAllocation(1);
    const body = {
      locationId,
      allocationId: fixture.allocationId,
      orderId: fixture.order.id,
      orderItemId: fixture.orderItemId,
      skuId: fixture.sku.id,
      variantName: fixture.sku.variantName,
      quantity: 1,
      condition: 'ACCEPTABLE',
      idempotencyKey: randomUUID(),
    };
    await http().post('/fulfillment/receipts').send(body).expect(401);
    await http().post('/fulfillment/receipts').set('Authorization', customerAuth).send(body).expect(403);
    await http().post('/fulfillment/receipts').set('Authorization', unassignedOperatorAuth).send(body).expect(403);
    await http().post('/fulfillment/receipts').set('Authorization', operatorAuth)
      .send({ ...body, locationId: noReceivingLocationId, idempotencyKey: randomUUID() }).expect(400);
  });

  it('rejects pending, mismatched, excessive, and unacceptable receipts without changing inventory', async () => {
    const fixture = await makeConfirmedAllocation(3);
    const base = {
      locationId,
      allocationId: fixture.allocationId,
      orderId: fixture.order.id,
      orderItemId: fixture.orderItemId,
      skuId: fixture.sku.id,
      variantName: fixture.sku.variantName,
      quantity: 1,
      condition: 'ACCEPTABLE',
      idempotencyKey: randomUUID(),
    };
    await http().post('/fulfillment/receipts').set('Authorization', operatorAuth)
      .send({ ...base, orderId: randomUUID(), idempotencyKey: randomUUID() }).expect(400);
    await http().post('/fulfillment/receipts').set('Authorization', operatorAuth)
      .send({ ...base, skuId: randomUUID(), idempotencyKey: randomUUID() }).expect(400);
    await http().post('/fulfillment/receipts').set('Authorization', operatorAuth)
      .send({ ...base, variantName: 'Wrong Variant', idempotencyKey: randomUUID() }).expect(400);
    await http().post('/fulfillment/receipts').set('Authorization', operatorAuth)
      .send({ ...base, condition: 'DAMAGED', idempotencyKey: randomUUID() }).expect(400);
    await http().post('/fulfillment/receipts').set('Authorization', operatorAuth)
      .send({ ...base, quantity: 4, idempotencyKey: randomUUID() }).expect(400);
    await http().post('/fulfillment/receipts').set('Authorization', operatorAuth)
      .send({ ...base, condition: 'UNKNOWN', idempotencyKey: randomUUID() }).expect(400);
    expect(await prisma.fulfillmentReceipt.count({ where: { orderId: fixture.order.id } })).toBe(0);
    expect(await prisma.inventoryBalance.findUnique({
      where: { locationId_skuId: { locationId, skuId: fixture.sku.id } },
    })).toBeNull();

    const pending = await makeConfirmedAllocation(1);
    const pendingAllocation = await prisma.sourceAllocation.update({
      where: { id: pending.allocationId },
      data: { result: 'pending', confirmedQuantity: 0, confirmedAt: null },
    });
    await http().post('/fulfillment/receipts').set('Authorization', operatorAuth).send({
      ...base,
      allocationId: pendingAllocation.id,
      orderId: pending.order.id,
      orderItemId: pending.orderItemId,
      skuId: pending.sku.id,
      variantName: pending.sku.variantName,
      idempotencyKey: randomUUID(),
    }).expect(409);
  });

  it('receives partial quantities idempotently and keeps allocated goods out of sellable stock', async () => {
    const fixture = await makeConfirmedAllocation(3);
    const firstKey = randomUUID();
    const first = {
      locationId,
      allocationId: fixture.allocationId,
      orderId: fixture.order.id,
      orderItemId: fixture.orderItemId,
      skuId: fixture.sku.id,
      variantName: fixture.sku.variantName,
      quantity: 1,
      condition: 'ACCEPTABLE',
      idempotencyKey: firstKey,
    };
    const concurrent = await Promise.all([
      http().post('/fulfillment/receipts').set('Authorization', operatorAuth).send(first),
      http().post('/fulfillment/receipts').set('Authorization', operatorAuth).send(first),
    ]);
    expect(concurrent.map(response => response.status)).toEqual([201, 201]);
    expect(concurrent[0].body.receipt.id).toBe(concurrent[1].body.receipt.id);
    expect(concurrent[0].body.allocation).toMatchObject({ confirmedQuantity: 3, receivedQuantity: 1, remainingQuantity: 2 });
    expect(concurrent[0].body.shipment.status).toBe('pending');

    await http().post('/fulfillment/receipts').set('Authorization', operatorAuth)
      .send({ ...first, quantity: 2 }).expect(409);

    const second = await http().post('/fulfillment/receipts').set('Authorization', operatorAuth)
      .send({ ...first, idempotencyKey: randomUUID() }).expect(201);
    expect(second.body.allocation).toMatchObject({ receivedQuantity: 2, remainingQuantity: 1 });
    expect(second.body.shipment.status).toBe('pending');

    const final = await http().post('/fulfillment/receipts').set('Authorization', operatorAuth)
      .send({ ...first, idempotencyKey: randomUUID() }).expect(201);
    expect(final.body.allocation).toMatchObject({ receivedQuantity: 3, remainingQuantity: 0 });
    expect(final.body.shipment).toMatchObject({ locationId, status: 'ready_to_prepare' });
    expect(final.body.inventory).toMatchObject({
      ownedOnHand: 0,
      reserved: 0,
      availableToSell: 0,
      orderAllocatedExternalGoods: 3,
    });

    await http().post('/fulfillment/receipts').set('Authorization', operatorAuth)
      .send({ ...first, idempotencyKey: randomUUID() }).expect(400);
    expect(await prisma.fulfillmentReceipt.count({ where: { sourceAllocationId: fixture.allocationId } })).toBe(3);
    expect(await prisma.inventoryTransaction.count({ where: {
      type: 'RECEIVE_ORDER_ALLOCATED',
      referenceId: fixture.allocationId,
    } })).toBe(3);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).status).toBe('packing');
  });
});
