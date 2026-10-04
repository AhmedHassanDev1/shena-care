import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { OrderingService } from '../../src/modules/ordering/services/ordering.service';
import { ReconciliationService } from '../../src/modules/ordering/services/reconciliation.service';
import { FulfillmentService } from '../../src/modules/fulfillment/services/fulfillment.service';
const request = require('supertest');

describe('Customer order read and tracking (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ordering: OrderingService;
  let reconciliation: ReconciliationService;
  let fulfillment: FulfillmentService;
  let skuId: string;
  const http = () => request(app.getHttpServer());

  const customer = async () => {
    const registration = await http().post('/accounts/register').send({
      name: 'Tracking Customer', email: 'tracking-' + randomUUID() + '@example.com', password: 'password123',
    }).expect(201);
    const auth = 'Bearer ' + registration.body.token;
    const me = await http().get('/accounts/me').set('Authorization', auth).expect(200);
    return { auth, id: me.body.id as string };
  };

  const submit = async (auth?: string) => {
    const addRequest = http().post('/ordering/cart/add');
    if (auth) addRequest.set('Authorization', auth);
    const added = await addRequest.send({ skuId, quantity: 2 }).expect(201);
    const guestCartToken = added.body.guestCartToken as string | undefined;
    const quoteRequest = http().post('/ordering/checkout/quote');
    if (auth) quoteRequest.set('Authorization', auth);
    else quoteRequest.set('x-cart-token', guestCartToken!);
    const quote = await quoteRequest.send({ governorate: 'Cairo', area: 'Maadi' }).expect(201);
    const body = {
      customerName: 'Tracking Customer', customerPhone: '01012345678',
      governorate: 'Cairo', area: 'Maadi', shippingAddress: '1 Tracking Street',
      quoteVersion: quote.body.quoteVersion, cartRevision: quote.body.revision,
      idempotencyKey: randomUUID(),
    };
    const checkoutRequest = http().post('/ordering/checkout');
    if (auth) checkoutRequest.set('Authorization', auth);
    else checkoutRequest.set('x-cart-token', guestCartToken!);
    const placed = await checkoutRequest.send(body).expect(201);
    return { order: placed.body, body, guestCartToken };
  };

  beforeAll(async () => {
    process.env.TEST_BYPASS_AUTH = 'false';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    ordering = app.get(OrderingService);
    reconciliation = app.get(ReconciliationService);
    fulfillment = app.get(FulfillmentService);
    const product = await http().get('/products/cerave-moisturizing-cream').expect(200);
    skuId = product.body.skus[0].id;
  });
  afterAll(async () => { await app.close(); });

  it('lets only the authenticated owner read details and tracking, with no operational fields', async () => {
    const owner = await customer();
    const stranger = await customer();
    const placed = await submit(owner.auth);
    expect(placed.order.guestAccessToken).toBeUndefined();
    const path = '/ordering/orders/' + placed.order.orderNumber;
    const details = await http().get(path).set('Authorization', owner.auth).expect(200);
    const tracking = await http().get(path + '/tracking').set('Authorization', owner.auth).expect(200);
    expect(tracking.body.orderNumber).toBe(details.body.orderNumber);
    expect(tracking.body.items[0].unitPrice).toBe(details.body.items[0].unitPrice);
    expect(['RECEIVED', 'CONFIRMING_PRODUCTS', 'ACTION_REQUIRED']).toContain(tracking.body.status);
    expect(details.body).toMatchObject({
      orderReceived: true, availabilityConfirmed: false,
      deliveryAddress: { address: '1 Tracking Street' },
      delivery: { certainty: 'unknown', estimatedDate: null, nextUpdateBy: null },
      amounts: { originalCodAmount: placed.order.codAmount, currentCodAmount: placed.order.codAmount },
    });
    expect(['RECEIVED', 'CONFIRMING_PRODUCTS', 'ACTION_REQUIRED']).toContain(details.body.status);
    expect(details.body.items[0]).toMatchObject({ skuId, quantity: 2, productName: placed.order.items[0].productName });
    expect(details.body.timeline[0].status).toBe('RECEIVED');
    const serialized = JSON.stringify(details.body).toLowerCase();
    for (const forbidden of ['supplier', 'costprice', 'ranking', 'purchaseorder', 'idempotencykey', 'submissionhash', 'guestaccesstokenhash']) {
      expect(serialized).not.toContain(forbidden);
    }
    await http().get(path).set('Authorization', stranger.auth).expect(404);
    await http().get(path + '/tracking').set('Authorization', stranger.auth).expect(404);
    await http().get(path).expect(401);
    await http().get('/ordering/orders/ORD-NOT-REAL').set('Authorization', owner.auth).expect(404);
  });

  it('scopes guest access to one order and rejects absent, invalid, expired, and revoked tokens', async () => {
    const placed = await submit();
    expect(placed.order.guestAccessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const path = '/ordering/guest/orders/' + placed.order.orderNumber + '/tracking';
    const read = () => http().get(path).set('x-order-access-token', placed.order.guestAccessToken);
    expect(['RECEIVED', 'CONFIRMING_PRODUCTS', 'ACTION_REQUIRED'])
      .toContain((await read().expect(200)).body.status);
    await http().get(path).expect(401);
    await http().get(path).set('x-order-access-token', 'invalid').expect(401);
    await http().get(path).set('x-order-access-token', 'A'.repeat(43)).expect(404);
    await http().get('/ordering/guest/orders/ORD-NOT-REAL/tracking')
      .set('x-order-access-token', placed.order.guestAccessToken).expect(404);
    const other = await submit();
    await http().get('/ordering/guest/orders/' + other.order.orderNumber + '/tracking')
      .set('x-order-access-token', placed.order.guestAccessToken).expect(404);
    const replay = await http().post('/ordering/checkout').set('x-cart-token', placed.guestCartToken!)
      .send(placed.body).expect(201);
    expect(replay.body.guestAccessToken).toBe(placed.order.guestAccessToken);

    await prisma.order.update({ where: { id: placed.order.id }, data: { guestAccessExpiresAt: new Date(Date.now() - 1000) } });
    await read().expect(404);
    await prisma.order.update({ where: { id: placed.order.id }, data: {
      guestAccessExpiresAt: new Date(Date.now() + 60_000), guestAccessRevokedAt: new Date(),
    } });
    await read().expect(404);
    await http().post('/ordering/checkout').set('x-cart-token', placed.guestCartToken!)
      .send(placed.body).expect(401);
    await http().get('/ordering/orders/' + placed.order.orderNumber).expect(401);
  });

  it('projects confirmed, preparation, dispatch, and delivery from persisted state without invented history', async () => {
    const owner = await customer();
    const placed = await submit(owner.auth);
    const path = '/ordering/orders/' + placed.order.orderNumber + '/tracking';
    await ordering.updateOrderStatus(placed.order.id, 'confirmed');
    let read = await http().get(path).set('Authorization', owner.auth).expect(200);
    expect(read.body.status).toBe('CONFIRMED');
    expect(read.body.items[0].status).toBe('confirmed');
    expect(read.body.availabilityConfirmed).toBe(true);

    const location = await prisma.fulfillmentLocation.create({ data: {
      name: 'Tracking Hub ' + randomUUID(), address: '1 Warehouse Street',
    } });
    await ordering.updateOrderStatus(placed.order.id, 'packing');
    const shipment = await prisma.shipment.create({ data: {
      orderId: placed.order.id, locationId: location.id, status: 'pending',
    } });
    read = await http().get(path).set('Authorization', owner.auth).expect(200);
    expect(read.body.status).toBe('CONFIRMED');
    await fulfillment.startPreparationSession(shipment.id, { operatorId: owner.id });
    read = await http().get(path).set('Authorization', owner.auth).expect(200);
    expect(read.body.status).toBe('PREPARING');
    expect(read.body.delivery.certainty).toBe('unknown');
    expect(read.body.timeline.map((event: any) => event.status)
      .filter((status: string) => status !== 'CONFIRMING_PRODUCTS')).toEqual(['RECEIVED', 'CONFIRMED', 'PREPARING']);

    const dispatchedAt = new Date();
    await prisma.shipment.update({ where: { id: shipment.id }, data: { status: 'out_for_delivery', dispatchedAt } });
    read = await http().get(path).set('Authorization', owner.auth).expect(200);
    expect(read.body.status).toBe('OUT_FOR_DELIVERY');
    expect(read.body.timeline.map((event: any) => event.status)).toContain('OUT_FOR_DELIVERY');

    await prisma.shipment.update({ where: { id: shipment.id }, data: { status: 'delivered', deliveredAt: new Date() } });
    await ordering.updateOrderStatus(placed.order.id, 'delivered');
    read = await http().get(path).set('Authorization', owner.auth).expect(200);
    expect(read.body.status).toBe('DELIVERED');
    expect(read.body.delivery.certainty).toBe('confirmed');
    expect(read.body.timeline.map((event: any) => event.status)).toContain('DELIVERED');
  });

  it('shows cancellation requested until final, and uses collection expectation for current COD', async () => {
    const owner = await customer();
    const placed = await submit(owner.auth);
    const path = '/ordering/orders/' + placed.order.orderNumber + '/tracking';
    await prisma.paymentCollection.create({ data: {
      orderId: placed.order.id, expectedAmount: placed.order.codAmount - 5,
      currency: placed.order.currency,
    } });
    const resolution = await reconciliation.createResolution({
      orderId: placed.order.id, type: 'cancellation', actorId: owner.id,
      items: [{ orderItemId: placed.order.items[0].id, quantity: 1 }],
    });
    let read = await http().get(path).set('Authorization', owner.auth).expect(200);
    expect(read.body.status).toBe('CANCELLATION_REQUESTED');
    expect(read.body.resolutions[0]).toMatchObject({
      category: 'cancellation', status: 'requested',
      affectedItemIds: [placed.order.items[0].id], allowedActions: [],
    });
    expect(read.body.amounts).toMatchObject({
      originalCodAmount: placed.order.codAmount, currentCodAmount: placed.order.codAmount - 5,
    });
    expect(read.body.actionRequired).toBeNull();
    expect(read.body.timeline.map((event: any) => event.status)).toContain('CANCELLATION_REQUESTED');
    await reconciliation.updateResolutionStatus(resolution.id, 'rejected', owner.id);
    read = await http().get(path).set('Authorization', owner.auth).expect(200);
    expect(['RECEIVED', 'CONFIRMING_PRODUCTS']).toContain(read.body.status);
    await ordering.updateOrderStatus(placed.order.id, 'cancelled');
    read = await http().get(path).set('Authorization', owner.auth).expect(200);
    expect(read.body.status).toBe('CANCELLED');
    expect(read.body.items[0].status).toBe('resolved');
  });
});
