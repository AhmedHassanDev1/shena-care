import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
const request = require('supertest');

describe('Promotions & Price Integrity (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let skuId: string;
  const http = () => request(app.getHttpServer());
  const quoteAddress = { governorate: 'Cairo', area: 'Maadi' };

  const guestCart = async () => {
    const added = await http().post('/ordering/cart/add').send({ skuId, quantity: 2 }).expect(201);
    return { token: added.body.guestCartToken as string, revision: added.body.revision as number };
  };
  const quote = async (token: string, overrides: any = {}) =>
    (await http().post('/ordering/checkout/quote').set('x-cart-token', token).send({ ...quoteAddress, ...overrides }).expect(201)).body;
  
  const submit = (token: string, q: any, overrides: Record<string, unknown> = {}) =>
    http().post('/ordering/checkout').set('x-cart-token', token).send({
      ...quoteAddress, customerName: 'Promo Tester', customerPhone: '01012345678',
      shippingAddress: '123 Promo St', quoteVersion: q.quoteVersion,
      cartRevision: q.revision, idempotencyKey: randomUUID(), ...overrides,
    });

  beforeAll(async () => {
    process.env.TEST_BYPASS_AUTH = 'false';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    const product = await http().get('/products/cerave-moisturizing-cream').expect(200);
    skuId = product.body.skus[0].id;
  });

  afterEach(async () => {
    await prisma.promotion.deleteMany({});
  });

  afterAll(async () => {
    await app.close();
  });

  it('evaluates and applies free shipping automatically if threshold met', async () => {
    // 1. Create free shipping promotion
    await prisma.promotion.create({
      data: {
        campaignName: 'Free Shipping Threshold',
        benefitType: 'free_shipping',
        minBasketValue: 10, // Ensure it applies for small basket
        isActive: true,
        validFrom: new Date(),
      }
    });

    const { token } = await guestCart();
    
    // 2. Request quote
    const q = await quote(token);
    
    // Shipping fee should be 0, appliedPromotions should reflect it
    expect(q.shippingFee).toBe(0);
    expect(q.appliedPromotions).toBeDefined();
    expect(q.appliedPromotions).toHaveLength(1);
    expect(q.appliedPromotions[0].benefitType).toBe('free_shipping');

    // 3. Submit
    const res = await submit(token, q).expect(201);
    expect(res.body.shippingFee).toBe(0);
    
    // Verify snapshot in DB
    const order = await prisma.order.findUnique({ where: { id: res.body.id } });
    expect(order?.shippingFee.toNumber()).toBe(0);
    expect((order?.appliedPromotions as any[]).length).toBe(1);
  });

  it('evaluates and applies order-level discount with manual coupon code', async () => {
    // 1. Create percentage off coupon
    await prisma.promotion.create({
      data: {
        campaignName: '10% Off',
        code: 'SAVE10',
        benefitType: 'order_discount',
        discountType: 'percentage',
        discountValue: 10,
        isActive: true,
        validFrom: new Date(),
      }
    });

    const { token } = await guestCart();
    
    // 2. Request quote with coupon
    const q = await quote(token, { couponCode: 'SAVE10' });
    
    // Should have order discount applied
    const expectedDiscount = Math.round(q.items[0].lineTotal * 0.1 * 100) / 100;
    expect(q.subtotal).toBe(q.items[0].lineTotal);
    expect(q.appliedPromotions).toBeDefined();
    expect(q.appliedPromotions).toHaveLength(1);
    expect(q.appliedPromotions[0].campaignName).toBe('10% Off');
    expect(q.appliedPromotions[0].valueApplied).toBe(expectedDiscount);
    
    // Note: ordering.service calculates totalAmount with finalSubtotal
    const expectedTotal = q.items[0].lineTotal - expectedDiscount + q.shippingFee;
    expect(q.totalAmount).toBe(expectedTotal);

    // 3. Submit
    const res = await submit(token, q, { couponCode: 'SAVE10' }).expect(201);
    expect(res.body.totalAmount).toBe(expectedTotal);
    
    // Verify DB
    const order = await prisma.order.findUnique({ where: { id: res.body.id } });
    expect(order?.totalAmount.toNumber()).toBe(expectedTotal);
    expect((order?.appliedPromotions as any[])[0].valueApplied).toBe(expectedDiscount);
  });

  it('rejects submission if promotion expires before checkout', async () => {
    const promo = await prisma.promotion.create({
      data: {
        campaignName: 'Flash Sale',
        code: 'FLASH',
        benefitType: 'order_discount',
        discountType: 'fixed_amount',
        discountValue: 50,
        isActive: true,
        validFrom: new Date(),
      }
    });

    const { token } = await guestCart();
    const q = await quote(token, { couponCode: 'FLASH' });

    // Expire the promo
    await prisma.promotion.update({
      where: { id: promo.id },
      data: { validUntil: new Date(Date.now() - 1000) }
    });

    // Submitting should throw 409 Review Required because current snapshot won't match accepted snapshot
    const res = await submit(token, q, { couponCode: 'FLASH' }).expect(409);
    expect(res.body.code).toBe('CHECKOUT_REVIEW_REQUIRED');
  });

});
