import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { createSellableSku } from '../fixtures/sellable-sku';
import { signInCustomer } from '../fixtures/checkout';
import request from 'supertest';

// Default policy (no DELIVERY_FEE_POLICY): ≤15 km 30 EGP, ≤30 km 40, beyond 50; −5/−10/−15/−20 from 100/200/300/400; free from 500.
describe('Delivery fee policy at quote and checkout (owner decision 2026-10-25)', () => {
  let app: INestApplication;
  let skuId: string;
  const http = () => request(app.getHttpServer());
  const address = { governorate: 'Cairo', area: 'Maadi' };
  // Hub is at 29.997164, 31.149644. Maadi is ~11 km away, 6th of October City ~30 km, Ain Sokhna road ~48 km.
  const NEAR = { latitude: 29.9602, longitude: 31.2569 };
  const MID = { latitude: 29.97, longitude: 31.45 };
  const FAR = { latitude: 30.28, longitude: 31.7 };

  const cartWith = async (quantity: number) => {
    delete process.env.DELIVERY_FEE_POLICY;
    const customer = await signInCustomer(app);
    await http().post('/ordering/cart/add').set(customer.auth).send({ skuId, quantity }).expect(201);
    return customer.auth as Record<string, string>;
  };
  const quote = (auth: Record<string, string>, pin?: { latitude: number; longitude: number }) =>
    http().post('/ordering/checkout/quote').set(auth).send({ ...address, ...(pin ?? {}) });
  const order = (q: { quoteVersion: string; revision: number }, pin: { latitude: number; longitude: number }) => ({
    ...address, customerName: 'Fee Tester', customerPhone: '01012345678', shippingAddress: '1 Test St',
    ...pin, locationSource: 'map_pin', locationConfirmed: true,
    quoteVersion: q.quoteVersion, cartRevision: q.revision, idempotencyKey: randomUUID(),
  });

  beforeAll(async () => {
    delete process.env.DELIVERY_FEE_POLICY;
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    const prisma = app.get(PrismaService);
    const fixture = await createSellableSku(prisma); // 100 EGP per unit
    skuId = (await http().get('/products/' + fixture.productSlug).expect(200)).body.skus[0].id;
  });
  afterAll(async () => { await app.close(); });

  it('prices the base fee by distance from the hub and discounts it by invoice size', async () => {
    const auth = await cartWith(1); // invoice 100 → −5
    expect((await quote(auth, NEAR).expect(201)).body).toMatchObject({ subtotal: 100, deliveryFeeBase: 30, deliveryDiscount: 5, shippingFee: 25, totalAmount: 125, codAmount: 125 });
    expect((await quote(auth, MID).expect(201)).body).toMatchObject({ deliveryFeeBase: 40, shippingFee: 35, totalAmount: 135 });
    expect((await quote(auth, FAR).expect(201)).body).toMatchObject({ deliveryFeeBase: 50, shippingFee: 45, totalAmount: 145 });
    // Without a pin the nearest band applies (the storefront re-quotes as soon as the pin is placed).
    expect((await quote(auth).expect(201)).body).toMatchObject({ deliveryFeeBase: 30, shippingFee: 25 });
  });

  it('absorbs more of the fee on bigger invoices and ships free from 500', async () => {
    const mid = await cartWith(4); // invoice 400 → −20
    expect((await quote(mid, FAR).expect(201)).body).toMatchObject({ subtotal: 400, shippingFee: 30, totalAmount: 430 });
    const big = await cartWith(5); // invoice 500 → free
    expect((await quote(big, FAR).expect(201)).body).toMatchObject({ subtotal: 500, shippingFee: 0, deliveryDiscount: 50, totalAmount: 500, codAmount: 500 });
  });

  it('refuses a pin outside the service area when quoting', async () => {
    const auth = await cartWith(1);
    await quote(auth, { latitude: 31.2, longitude: 29.9 }).expect(422);
  });

  it('asks the customer to review when the confirmed pin moves the fee after the quote', async () => {
    const auth = await cartWith(1);
    const q = (await quote(auth, NEAR).expect(201)).body; // 25 EGP
    const refused = await http().post('/ordering/checkout').set(auth).send(order(q, FAR)).expect(409); // a far pin costs 45
    expect(refused.body.code).toBe('CHECKOUT_REVIEW_REQUIRED');
    const requote = (await quote(auth, FAR).expect(201)).body;
    const placed = await http().post('/ordering/checkout').set(auth).send(order(requote, FAR)).expect(201);
    expect(placed.body).toMatchObject({ shippingFee: 45, totalAmount: 145, codAmount: 145 });
  });
});
