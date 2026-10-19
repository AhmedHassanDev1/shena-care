import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { Role } from '@prisma/client';
import { createSellableSku } from '../fixtures/sellable-sku';
import { createActor } from '../fixtures/actors';
import { signInCustomer } from '../fixtures/checkout';
const request = require('supertest');

describe('Order submission (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let skuId: string;
  const http = () => request(app.getHttpServer());
  const quoteAddress = { governorate: 'Cairo', area: 'Maadi' };

  type Owner = Record<string, string>;
  /** A signed-in customer's cart (order placement requires a customer session since SAHEL V18). */
  const guestCart = async () => {
    const customer = await signInCustomer(app);
    const added = await http().post('/ordering/cart/add').set(customer.auth).send({ skuId, quantity: 2 }).expect(201);
    return { token: customer.auth as Owner, revision: added.body.revision as number };
  };
  const quote = async (token: Owner) =>
    (await http().post('/ordering/checkout/quote').set(token).send(quoteAddress).expect(201)).body;
  const submission = (q: any, overrides: Record<string, unknown> = {}) => ({
    ...quoteAddress, customerName: 'Order Tester', customerPhone: '01012345678',
    shippingAddress: '123 Test Street', latitude: 29.9602, longitude: 31.2569, locationSource: 'map_pin', locationConfirmed: true, quoteVersion: q.quoteVersion,
    cartRevision: q.revision, idempotencyKey: randomUUID(), ...overrides,
  });
  const submit = (token: Owner, body: any) =>
    http().post('/ordering/checkout').set(token).send(body);

  beforeAll(async () => {
    process.env.TEST_BYPASS_AUTH = 'false';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    const fixture = await createSellableSku(prisma);
    const product = await http().get('/products/' + fixture.productSlug).expect(200);
    skuId = product.body.skus[0].id;
  });
  afterAll(async () => { await app.close(); });

  it('submits one order, snapshots accepted terms, clears the cart, and replays after a lost response', async () => {
    const { token, revision } = await guestCart();
    const q = await quote(token);
    expect(q.revision).toBe(revision);
    expect(q.items).toHaveLength(1);
    const body = submission(q, { latitude: 30.0561, longitude: 31.3301, locationSource: 'current_location' });
    const first = await submit(token, body).expect(201);
    expect(first.body).toMatchObject({
      totalAmount: q.totalAmount, subtotal: q.subtotal, shippingFee: q.shippingFee,
      codAmount: q.codAmount, availabilityCertainty: 'not_confirmed',
      orderReceived: true, availabilityConfirmed: false, status: 'placed',
      shippingAddress: body.shippingAddress, latitude: body.latitude, longitude: body.longitude,
    });
    expect(first.body.items[0]).toMatchObject({
      skuId, productName: q.items[0].productName, skuCode: q.items[0].skuCode,
      quantity: 2, price: q.items[0].unitPrice, discountAmount: q.items[0].discountAmount, lineTotal: q.items[0].lineTotal,
    });
    const cart = await http().get('/ordering/cart').set(token).expect(200);
    expect(cart.body.items).toHaveLength(0);
    expect(cart.body.revision).toBe(revision + 1);
    const replay = await submit(token, body).expect(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(await prisma.order.count({ where: { idempotencyKey: body.idempotencyKey } })).toBe(1);
    expect((await prisma.checkoutQuote.findUnique({ where: { id: q.quoteVersion } }))?.orderId).toBe(first.body.id);
    const stored = await prisma.order.findUnique({ where: { id: first.body.id }, include: { items: true } });
    expect(stored?.items[0].productName).toBe(q.items[0].productName);
    expect(stored?.items[0].price.toNumber()).toBe(q.items[0].unitPrice);
    const product = await prisma.product.findUniqueOrThrow({ where: { id: stored!.items[0].productId! } });
    await prisma.product.update({ where: { id: product.id }, data: { name: 'Renamed after purchase' } });
    try {
      const historical = await prisma.order.findUniqueOrThrow({ where: { id: first.body.id }, include: { items: true } });
      expect(historical.items[0].productName).toBe(q.items[0].productName);
    } finally {
      await prisma.product.update({ where: { id: product.id }, data: { name: product.name } });
    }
  });

  it('creates only one order when the same submission is sent concurrently', async () => {
    const { token } = await guestCart();
    const q = await quote(token);
    const body = submission(q);
    const results = await Promise.all([submit(token, body), submit(token, body)]);
    expect(results.map((result: any) => result.status)).toEqual([201, 201]);
    expect(results[0].body.id).toBe(results[1].body.id);
    expect(await prisma.order.count({ where: { idempotencyKey: body.idempotencyKey } })).toBe(1);
  });

  it('rejects a changed commercial quote with typed review-required conflict', async () => {
    const { token } = await guestCart();
    const q = await quote(token);
    const price = await prisma.sellingPrice.create({
      data: { skuId, amount: q.items[0].unitPrice + 7, currency: q.currency, validFrom: new Date(), isActive: true },
    });
    try {
      const result = await submit(token, submission(q)).expect(409);
      expect(result.body.code).toBe('CHECKOUT_REVIEW_REQUIRED');
      expect(await prisma.cartItem.count({ where: { cartId: (await prisma.checkoutQuote.findUnique({ where: { id: q.quoteVersion } }))!.cartId } })).toBe(1);
    } finally {
      await prisma.sellingPrice.delete({ where: { id: price.id } });
    }
  });

  it('rejects a stale cart revision and leaves the quote unconsumed', async () => {
    const { token } = await guestCart();
    const q = await quote(token);
    await http().patch('/ordering/cart/quantity').set(token)
      .send({ skuId, quantity: 3, expectedRevision: q.revision }).expect(200);
    const result = await submit(token, submission(q)).expect(409);
    expect(result.body.code).toBe('CHECKOUT_REVIEW_REQUIRED');
    expect((await prisma.checkoutQuote.findUnique({ where: { id: q.quoteVersion } }))?.consumedAt).toBeNull();
  });

  it('rolls back the cart claim when order creation fails', async () => {
    const { token } = await guestCart();
    const q = await quote(token);
    const body = submission(q);
    // Test database only: force the order INSERT to fail after the cart revision is claimed.
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "ordering"."orders" ADD CONSTRAINT "test_order_insert_failure" CHECK ("idempotency_key" <> '${body.idempotencyKey}')`,
    );
    try {
      await submit(token, body).expect(500);
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "ordering"."orders" DROP CONSTRAINT "test_order_insert_failure"');
    }
    const cart = await http().get('/ordering/cart').set(token).expect(200);
    expect(cart.body.revision).toBe(q.revision);
    expect(cart.body.items).toHaveLength(1);
    expect((await prisma.checkoutQuote.findUnique({ where: { id: q.quoteVersion } }))?.consumedAt).toBeNull();
    expect(await prisma.order.count({ where: { idempotencyKey: body.idempotencyKey } })).toBe(0);
    await submit(token, body).expect(201);
  });

  it('rejects key reuse with a different request and rejects another cart owner', async () => {
    const firstCart = await guestCart();
    const q = await quote(firstCart.token);
    const body = submission(q);
    await submit(firstCart.token, body).expect(201);
    expect((await submit(firstCart.token, { ...body, shippingAddress: 'Changed' }).expect(409)).body.code)
      .toBe('IDEMPOTENCY_KEY_REUSED');
    const secondCart = await guestCart();
    await submit(secondCart.token, body).expect(409);
    await submit(firstCart.token, { ...body, quoteVersion: 'invalid' }).expect(400);
  });

  describe('sign-in required to place an order (owner decision 2026-10-18, supersedes GLO-71 guest checkout)', () => {
    const anonymousCart = async () => {
      const added = await http().post('/ordering/cart/add').send({ skuId, quantity: 1 }).expect(201);
      return added.body.guestCartToken as string;
    };

    it('keeps the guest cart and the quote open without a session', async () => {
      const token = await anonymousCart();
      const q = (await http().post('/ordering/checkout/quote').set('x-cart-token', token).send(quoteAddress).expect(201)).body;
      expect(q.items).toHaveLength(1);
      expect(q.quoteVersion).toEqual(expect.any(String));
    });

    it('refuses a guest submission with SIGN_IN_REQUIRED and creates nothing', async () => {
      const token = await anonymousCart();
      const q = (await http().post('/ordering/checkout/quote').set('x-cart-token', token).send(quoteAddress).expect(201)).body;
      const body = submission(q);
      for (const headers of [{ 'x-cart-token': token }, {}, { Authorization: 'Bearer ' + randomUUID() }]) {
        const refused = await http().post('/ordering/checkout').set(headers).send(body).expect(401);
        expect(refused.body.code).toBe('SIGN_IN_REQUIRED');
      }
      expect(await prisma.order.count({ where: { idempotencyKey: body.idempotencyKey } })).toBe(0);
      expect((await prisma.checkoutQuote.findUnique({ where: { id: q.quoteVersion } }))?.consumedAt).toBeNull();
      const cart = await http().get('/ordering/cart').set('x-cart-token', token).expect(200);
      expect(cart.body.items).toHaveLength(1);
    });

    it('refuses a staff session with CUSTOMER_ACCOUNT_REQUIRED', async () => {
      const staff = await createActor(prisma, Role.ADMIN);
      const added = await http().post('/ordering/cart/add').set(staff.auth).send({ skuId, quantity: 1 }).expect(201);
      expect(added.body.items).toHaveLength(1);
      const q = await quote(staff.auth);
      const refused = await submit(staff.auth, submission(q)).expect(403);
      expect(refused.body.code).toBe('CUSTOMER_ACCOUNT_REQUIRED');
    });

    it('places the guest cart once after sign-in adopts it, and a replay returns the same order', async () => {
      const token = await anonymousCart();
      const customer = await signInCustomer(app, token);
      const q = await quote(customer.auth);
      expect(q.items).toHaveLength(1);
      const body = submission(q);
      const placed = await submit(customer.auth, body).expect(201);
      const replay = await submit(customer.auth, body).expect(201);
      expect(replay.body.id).toBe(placed.body.id);
      expect(await prisma.order.count({ where: { customerId: customer.id } })).toBe(1);
    });
  });
});
