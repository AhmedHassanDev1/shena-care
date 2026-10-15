import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { DomainEventsService } from '../../src/platform/events/domain-events.service';
import { PaymentsService, VerifiedProviderEvent } from '../../src/modules/ordering/services/payments.service';
import { AiClient } from '../../src/platform/ai';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { createActor, Actor } from '../fixtures/actors';
import { createSellableSku } from '../fixtures/sellable-sku';
import { CAIRO_PIN, placeGuestOrder } from '../fixtures/checkout';

/** TEST DOUBLE ONLY — stands in for a future signed-callback PSP; never registered by the app. */
const SECRET = 'test-double-secret-' + randomUUID();
const RUN = randomUUID().slice(0, 8); // provider event ids are unique per provider forever
const sign = (body: string) => createHmac('sha256', SECRET).update(body).digest('hex');
const testProvider = (name: string, methods: Array<'CARD' | 'MOBILE_WALLET'>) => ({
  name, methods,
  verify(rawBody: string, signature?: string): VerifiedProviderEvent {
    const expected = Buffer.from(sign(rawBody));
    if (!signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), expected)) throw new Error('bad signature');
    return JSON.parse(rawBody);
  },
});

/**
 * GLO-241: payment-method-aware orders without a live gateway. COD is unchanged; card/wallet are
 * unavailable without a connected provider; an online order is pending until a verified, exact,
 * once-only provider confirmation, is never sourced or dispatched before it, and never creates
 * driver cash.
 */
describe('GLO-241 payment method foundation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: DomainEventsService;
  let payments: PaymentsService;
  let hub: Actor; let driver: Actor;
  let skuId: string; let locationId: string;
  const http = () => request(app.getHttpServer());
  const callback = (provider: string, body: Record<string, unknown>, signature?: string) => {
    const raw = JSON.stringify(body);
    return http().post(`/payments/webhooks/${provider}`).set('x-provider-signature', signature ?? sign(raw)).send(body);
  };
  const settleEvents = async (aggregateId: string) => {
    for (let i = 0; i < 100; i++) {
      await events.dispatchPending({ aggregateId });
      if (!await prisma.domainEvent.count({ where: { aggregateId, status: { not: 'delivered' } } })) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
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
    payments = app.get(PaymentsService);
    hub = await createActor(prisma, 'HUB_OPERATOR');
    driver = await createActor(prisma, 'DRIVER');
    skuId = (await createSellableSku(prisma)).id;
    locationId = (await prisma.fulfillmentLocation.create({ data: { name: 'Pay Hub ' + randomUUID(), address: 'Cairo' } })).id;
    await prisma.fulfillmentLocationOperator.create({ data: { locationId, operatorId: hub.id } });
  });
  afterAll(async () => { if (app) await app.close(); });

  it('keeps COD as the unchanged default with driver cash expected', async () => {
    const order = await placeGuestOrder(app.getHttpServer(), [{ skuId, quantity: 1 }]);
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored).toMatchObject({ paymentMethod: 'COD', paymentProvider: null });
    expect(Number(stored.codAmount)).toBe(Number(stored.totalAmount));
    expect(await prisma.paymentAttempt.count({ where: { orderId: order.id } })).toBe(0);
    expect(await prisma.domainEvent.count({ where: { aggregateId: order.id, eventType: 'order.placed' } })).toBe(1);
  });

  it('refuses card and wallet while no provider is connected, and invalid methods', async () => {
    const added = await http().post('/ordering/cart/add').send({ skuId, quantity: 1 }).expect(201);
    const token = added.body.guestCartToken;
    const quote = await http().post('/ordering/checkout/quote').set('x-cart-token', token).send({ governorate: 'Cairo', area: 'Maadi' }).expect(201);
    const submit = (extra: Record<string, unknown>) => http().post('/ordering/checkout').set('x-cart-token', token).send({
      governorate: 'Cairo', area: 'Maadi', customerName: 'Pay', customerPhone: '01012345678', shippingAddress: '1 Pay St', ...CAIRO_PIN,
      quoteVersion: quote.body.quoteVersion, cartRevision: quote.body.revision, idempotencyKey: randomUUID(), ...extra,
    });
    for (const method of ['CARD', 'MOBILE_WALLET']) {
      expect((await submit({ paymentMethod: method }).expect(422)).body.code).toBe('PAYMENT_METHOD_UNAVAILABLE');
    }
    await submit({ paymentMethod: 'BITCOIN' }).expect(400);
    await submit({ cardNumber: '4111111111111111' }).expect(400); // card data is never accepted
    expect((await http().get('/ordering/cart').set('x-cart-token', token).expect(200)).body.items).toHaveLength(1);
    await http().post('/payments/webhooks/no-such-psp').send({}).expect(404);
  });

  it('online order: pending → verified exact confirmation once → sourcing → dispatch, never driver cash', async () => {
    payments.registerProvider(testProvider('test-card-psp', ['CARD']));
    const order = await placeGuestOrder(app.getHttpServer(), [{ skuId, quantity: 2 }], { paymentMethod: 'CARD' });
    const response = order as unknown as { paymentMethod: string; payment: Record<string, unknown> };
    expect(response.paymentMethod).toBe('CARD');
    const attempt = await prisma.paymentAttempt.findFirstOrThrow({ where: { orderId: order.id } });
    expect(response.payment).toMatchObject({ method: 'CARD', provider: 'test-card-psp', reference: attempt.reference, status: 'pending' });
    expect(attempt).toMatchObject({ method: 'CARD', provider: 'test-card-psp', status: 'pending', currency: 'EGP' });
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(Number(stored.codAmount)).toBe(0);
    expect(Number(attempt.amount)).toBe(Number(stored.totalAmount));
    // Not sourced and not dispatchable before payment.
    expect(await prisma.domainEvent.count({ where: { aggregateId: order.id } })).toBe(0);
    const shipment = await prisma.shipment.create({ data: { orderId: order.id, locationId, status: 'packed' } });
    const run = await http().post('/fulfillment/delivery-batches').set(hub.auth).send({ hubId: locationId, name: 'Pay run', driverId: driver.id }).expect(201);
    expect((await http().post(`/fulfillment/delivery-batches/${run.body.id}/stops`).set(hub.auth).send({ stops: [{ shipmentId: shipment.id }] }).expect(409)).body.code)
      .toBe('PAYMENT_NOT_CONFIRMED');

    const confirmed = (eventId: string, amount: string) => ({
      eventId, type: 'payment.confirmed', reference: attempt.reference, amount, currency: 'EGP', providerTransactionId: 'psp-tx-1',
    });
    // Forged or unsigned callbacks change nothing.
    await callback('test-card-psp', confirmed(`evt-forged-${RUN}`, attempt.amount.toFixed(2)), 'deadbeef').expect(401);
    await http().post('/payments/webhooks/test-card-psp').send(confirmed(`evt-unsigned-${RUN}`, attempt.amount.toFixed(2))).expect(401);
    // A signed callback for the wrong amount is recorded and rejected.
    expect((await callback('test-card-psp', confirmed(`evt-short-${RUN}`, '1.00')).expect(200)).body.outcome).toBe('rejected');
    expect((await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status).toBe('pending');

    // The real confirmation, concurrently replayed: applied exactly once.
    const body = confirmed(`evt-ok-${RUN}`, attempt.amount.toFixed(2));
    const results = await Promise.all([callback('test-card-psp', body), callback('test-card-psp', body), callback('test-card-psp', body)]);
    expect(results.map(r => r.body.outcome).sort()).toEqual(['applied', 'duplicate', 'duplicate']);
    expect(await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } }))
      .toMatchObject({ status: 'confirmed', providerTransactionId: 'psp-tx-1' });
    // Out-of-order failure after confirmation is ignored.
    expect((await callback('test-card-psp', { eventId: `evt-late-fail-${RUN}`, type: 'payment.failed', reference: attempt.reference, amount: '0', currency: 'EGP' })
      .expect(200)).body.outcome).toBe('ignored');
    expect(await prisma.paymentProviderEvent.count({ where: { reference: attempt.reference } })).toBe(3); // short, ok, late-fail

    // Paid → enters sourcing once, and can be dispatched.
    await settleEvents(order.id);
    expect(await prisma.supplyRequest.count({ where: { orderId: order.id } })).toBe(1);
    await http().post(`/fulfillment/delivery-batches/${run.body.id}/stops`).set(hub.auth).send({ stops: [{ shipmentId: shipment.id }] }).expect(201);
    await prisma.order.update({ where: { id: order.id }, data: { status: 'packing' } });
    await http().post(`/fulfillment/delivery-batches/${run.body.id}/dispatch`).set(hub.auth).expect(201);
    expect(await prisma.paymentCollection.count({ where: { orderId: order.id } })).toBe(0); // no driver cash due
    await http().post(`/fulfillment/shipments/${shipment.id}/events`).set(driver.auth).send({ type: 'DELIVERED', collectedAmount: 10 }).expect(400);
    await http().post(`/fulfillment/shipments/${shipment.id}/events`).set(driver.auth).send({ type: 'DELIVERED' }).expect(201);
    expect(await prisma.paymentCollection.count({ where: { orderId: order.id } })).toBe(0);
  });

  it('a wallet payment that fails stays unpaid and never enters sourcing', async () => {
    payments.registerProvider(testProvider('vodafone_cash', ['MOBILE_WALLET']));
    const order = await placeGuestOrder(app.getHttpServer(), [{ skuId, quantity: 1 }], { paymentMethod: 'MOBILE_WALLET', paymentProvider: 'vodafone_cash' });
    const attempt = await prisma.paymentAttempt.findFirstOrThrow({ where: { orderId: order.id } });
    expect(attempt).toMatchObject({ method: 'MOBILE_WALLET', provider: 'vodafone_cash' });
    // Another provider cannot answer for this attempt.
    expect((await callback('test-card-psp', { eventId: 'x-' + randomUUID(), type: 'payment.confirmed', reference: attempt.reference, amount: attempt.amount.toFixed(2), currency: 'EGP' })
      .expect(200)).body.outcome).toBe('rejected');
    expect((await callback('vodafone_cash', { eventId: `vf-1-${RUN}`, type: 'payment.failed', reference: attempt.reference, amount: '0', currency: 'EGP', failureReason: 'insufficient balance' })
      .expect(200)).body.outcome).toBe('applied');
    expect((await callback('vodafone_cash', { eventId: `vf-2-${RUN}`, type: 'payment.confirmed', reference: attempt.reference, amount: attempt.amount.toFixed(2), currency: 'EGP' })
      .expect(200)).body.outcome).toBe('ignored');
    expect(await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).toMatchObject({ status: 'failed', failureReason: 'insufficient balance' });
    expect(await prisma.domainEvent.count({ where: { aggregateId: order.id } })).toBe(0);
  });
});
