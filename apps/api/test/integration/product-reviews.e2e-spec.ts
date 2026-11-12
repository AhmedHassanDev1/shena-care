import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  OrderItemLineState,
  OrderResolutionStatus,
  OrderResolutionType,
  OrderStatus,
  PaymentMethod,
  RefundStatus,
  Role,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { attachReviewedMedia } from '../fixtures/sellable-sku';

describe('Product Reviews — Purchase Verification & Isolated Dev Mode (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const createdCustomerIds: string[] = [];
  const createdBrandIds: string[] = [];
  const createdSupplierIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdOrderIds: string[] = [];

  let productSlug = '';
  let productId = '';
  let skuId = '';

  let deliveredBuyerToken = '';
  let deliveredBuyerRatingOnlyToken = '';
  let cancelledBuyerToken = '';
  let refundedBuyerToken = '';
  let shippedBuyerToken = '';
  let nonBuyerToken = '';
  let devAdminToken = '';

  const origNodeEnv = process.env.NODE_ENV;
  const origDevFlag = process.env.ENABLE_DEV_TEST_REVIEWS;
  const origBypass = process.env.TEST_BYPASS_AUTH;
  const origAppEnv = process.env.APP_ENV;

  async function createCustomerWithSession(name: string, roles: Role[], emailPrefix: string) {
    const suffix = randomUUID();
    const customer = await prisma.customer.create({
      data: {
        name,
        email: `${emailPrefix}-${suffix}@reviews.test.local`,
        roles,
        isActive: true,
        identities: {
          create: {
            provider: 'PHONE',
            providerId: `+2015${Math.floor(10000000 + Math.random() * 89999999)}`,
          },
        },
      },
    });
    createdCustomerIds.push(customer.id);

    const token = randomUUID();
    await prisma.session.create({
      data: {
        customerId: customer.id,
        token,
        expiresAt: new Date(Date.now() + 3600_000),
        isValid: true,
      },
    });

    return { customer, token };
  }

  async function createOrderForCustomer(customerId: string, status: OrderStatus) {
    const order = await prisma.order.create({
      data: {
        orderNumber: `REV-${randomUUID().replace(/-/g, '').slice(0, 14).toUpperCase()}`,
        customerId,
        customerName: 'Review Test Customer',
        customerPhone: '+201000000000',
        shippingAddress: '10 Tahrir Square, Cairo',
        totalAmount: 250,
        currency: 'EGP',
        status,
        paymentMethod: PaymentMethod.COD,
        items: {
          create: {
            productId,
            skuId,
            productName: 'Review Fixture Product',
            skuCode: 'REV-SKU',
            quantity: 1,
            price: 250,
            currency: 'EGP',
            lineState: OrderItemLineState.active,
          },
        },
      },
      include: { items: true },
    });
    createdOrderIds.push(order.id);
    return order;
  }

  beforeAll(async () => {
    process.env.TEST_BYPASS_AUTH = 'false';
    process.env.ENABLE_DEV_TEST_REVIEWS = 'false';
    delete process.env.APP_ENV;

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);

    const suffix = randomUUID();
    const brand = await prisma.brand.create({
      data: { name: `RevBrand-${suffix}`, slug: `rev-brand-${suffix}` },
    });
    createdBrandIds.push(brand.id);

    const product = await prisma.product.create({
      data: {
        brandId: brand.id,
        name: `RevProduct ${suffix}`,
        slug: `rev-product-${suffix}`,
        isPublished: true,
      },
    });
    createdProductIds.push(product.id);
    productId = product.id;
    productSlug = product.slug;

    const sku = await prisma.sku.create({
      data: {
        productId: product.id,
        code: `REV-SKU-${suffix}`,
        variantName: '50ml',
      },
    });
    skuId = sku.id;
    await attachReviewedMedia(prisma, sku.id);
    await prisma.listing.create({ data: { skuId: sku.id, isListed: true } });
    await prisma.sellingPrice.create({
      data: {
        skuId: sku.id,
        amount: 250,
        currency: 'EGP',
        validFrom: new Date(Date.now() - 1000),
        isActive: true,
      },
    });
    const supplier = await prisma.supplier.create({
      data: { name: `RevSup-${suffix}`, slug: `rev-sup-${suffix}` },
    });
    createdSupplierIds.push(supplier.id);
    await prisma.supplierOffer.create({
      data: {
        supplierId: supplier.id,
        skuId: sku.id,
        costPrice: 120,
        currency: 'EGP',
        lastObservedAt: new Date(),
        lastConfirmedAt: new Date(),
      },
    });

    const deliveredBuyer1 = await createCustomerWithSession('سارة علي', [Role.CUSTOMER], 'delivered1');
    deliveredBuyerToken = deliveredBuyer1.token;
    await createOrderForCustomer(deliveredBuyer1.customer.id, OrderStatus.delivered);

    const deliveredBuyer2 = await createCustomerWithSession('مريم عادل', [Role.CUSTOMER], 'delivered2');
    deliveredBuyerRatingOnlyToken = deliveredBuyer2.token;
    await createOrderForCustomer(deliveredBuyer2.customer.id, OrderStatus.delivered);

    const cancelledBuyer = await createCustomerWithSession('نور مصطفى', [Role.CUSTOMER], 'cancelled');
    cancelledBuyerToken = cancelledBuyer.token;
    await createOrderForCustomer(cancelledBuyer.customer.id, OrderStatus.cancelled);

    const refundedBuyer = await createCustomerWithSession('هنا كريم', [Role.CUSTOMER], 'refunded');
    refundedBuyerToken = refundedBuyer.token;
    const refundedOrder = await createOrderForCustomer(refundedBuyer.customer.id, OrderStatus.delivered);
    const resolution = await prisma.orderResolution.create({
      data: {
        orderId: refundedOrder.id,
        type: OrderResolutionType.refund,
        status: OrderResolutionStatus.resolved,
        reasonCode: 'customer_request',
        notes: 'Customer refund',
        actorId: refundedBuyer.customer.id,
        items: { create: { orderItemId: refundedOrder.items[0].id, quantity: 1 } },
      },
    });
    await prisma.refundTransaction.create({
      data: {
        orderId: refundedOrder.id,
        resolutionId: resolution.id,
        amount: 250,
        currency: 'EGP',
        status: RefundStatus.succeeded,
      },
    });

    const shippedBuyer = await createCustomerWithSession('ليلى حسن', [Role.CUSTOMER], 'shipped');
    shippedBuyerToken = shippedBuyer.token;
    await createOrderForCustomer(shippedBuyer.customer.id, OrderStatus.shipped);

    const nonBuyer = await createCustomerWithSession('نهى سامي', [Role.CUSTOMER], 'nobuy');
    nonBuyerToken = nonBuyer.token;

    const devAdmin = await createCustomerWithSession('Dev Reviewer', [Role.ADMIN], 'devadmin');
    devAdminToken = devAdmin.token;
  });

  afterAll(async () => {
    process.env.NODE_ENV = origNodeEnv;
    process.env.ENABLE_DEV_TEST_REVIEWS = origDevFlag;
    process.env.TEST_BYPASS_AUTH = origBypass;
    if (origAppEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = origAppEnv;

    if (prisma) {
      await prisma.productReview.deleteMany({ where: { productId: { in: createdProductIds } } });
      await prisma.refundTransaction.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.orderResolutionItem.deleteMany({
        where: { resolution: { orderId: { in: createdOrderIds } } },
      });
      await prisma.orderResolution.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
      await prisma.session.deleteMany({ where: { customerId: { in: createdCustomerIds } } });
      await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
      await prisma.supplierOffer.deleteMany({ where: { supplierId: { in: createdSupplierIds } } });
      if (skuId) {
        await prisma.sellingPrice.deleteMany({ where: { skuId } });
        await prisma.listing.deleteMany({ where: { skuId } });
      }
      await prisma.productMedia.deleteMany({ where: { productId: { in: createdProductIds } } });
      await prisma.sku.deleteMany({ where: { productId: { in: createdProductIds } } });
      await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
      await prisma.brand.deleteMany({ where: { id: { in: createdBrandIds } } });
      await prisma.supplier.deleteMany({ where: { id: { in: createdSupplierIds } } });
    }
    if (app) await app.close();
  });

  it('Scenario 1: treats unauthenticated visitors as guests and blocks POST with 401', async () => {
    const eligRes = await request(app.getHttpServer())
      .get(`/products/${productSlug}/reviews/eligibility`)
      .expect(200);
    expect(eligRes.body).toEqual({
      authenticated: false,
      canReview: false,
      reason: 'GUEST',
      isTestMode: false,
      existingReview: null,
    });

    await request(app.getHttpServer())
      .post(`/products/${productSlug}/reviews`)
      .send({ rating: 5, body: 'Guest review attempt' })
      .expect(401);
  });

  it('Scenario 2 & 4: blocks authenticated non-buyers, in-progress orders, cancelled orders, and refunded orders', async () => {
    const nonBuyerElig = await request(app.getHttpServer())
      .get(`/products/${productSlug}/reviews/eligibility`)
      .set('Authorization', `Bearer ${nonBuyerToken}`)
      .expect(200);
    expect(nonBuyerElig.body).toMatchObject({ authenticated: true, canReview: false, reason: 'NO_PURCHASE' });
    await request(app.getHttpServer())
      .post(`/products/${productSlug}/reviews`)
      .set('Authorization', `Bearer ${nonBuyerToken}`)
      .send({ rating: 5 })
      .expect(403);

    const shippedElig = await request(app.getHttpServer())
      .get(`/products/${productSlug}/reviews/eligibility`)
      .set('Authorization', `Bearer ${shippedBuyerToken}`)
      .expect(200);
    expect(shippedElig.body).toMatchObject({ canReview: false, reason: 'NOT_YET_DELIVERED' });
    await request(app.getHttpServer())
      .post(`/products/${productSlug}/reviews`)
      .set('Authorization', `Bearer ${shippedBuyerToken}`)
      .send({ rating: 5 })
      .expect(403);

    const cancelledElig = await request(app.getHttpServer())
      .get(`/products/${productSlug}/reviews/eligibility`)
      .set('Authorization', `Bearer ${cancelledBuyerToken}`)
      .expect(200);
    expect(cancelledElig.body).toMatchObject({ canReview: false, reason: 'CANCELLED_OR_REFUNDED' });
    await request(app.getHttpServer())
      .post(`/products/${productSlug}/reviews`)
      .set('Authorization', `Bearer ${cancelledBuyerToken}`)
      .send({ rating: 5 })
      .expect(403);

    const refundedElig = await request(app.getHttpServer())
      .get(`/products/${productSlug}/reviews/eligibility`)
      .set('Authorization', `Bearer ${refundedBuyerToken}`)
      .expect(200);
    expect(refundedElig.body).toMatchObject({ canReview: false, reason: 'CANCELLED_OR_REFUNDED' });
    await request(app.getHttpServer())
      .post(`/products/${productSlug}/reviews`)
      .set('Authorization', `Bearer ${refundedBuyerToken}`)
      .send({ rating: 5 })
      .expect(403);
  });

  it('rejects malformed payloads and client-forged verified/test fields with 400', async () => {
    await request(app.getHttpServer())
      .post(`/products/${productSlug}/reviews`)
      .set('Authorization', `Bearer ${deliveredBuyerToken}`)
      .send({ rating: 5, isVerifiedPurchase: false })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/products/${productSlug}/reviews`)
      .set('Authorization', `Bearer ${deliveredBuyerToken}`)
      .send({ rating: 7 })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/products/${productSlug}/reviews`)
      .set('Authorization', `Bearer ${deliveredBuyerToken}`)
      .send({ rating: 5, skuId: randomUUID() })
      .expect(400);
  });

  it('Scenario 3, 5, 8, 9: allows delivered buyer, persists across refresh, updates summary, allows rating-only, and blocks duplicates', async () => {
    const eligRes = await request(app.getHttpServer())
      .get(`/products/${productSlug}/reviews/eligibility`)
      .set('Authorization', `Bearer ${deliveredBuyerToken}`)
      .expect(200);
    expect(eligRes.body).toMatchObject({
      authenticated: true,
      canReview: true,
      reason: 'ELIGIBLE_PURCHASE',
      isTestMode: false,
    });

    const createRes = await request(app.getHttpServer())
      .post(`/products/${productSlug}/reviews`)
      .set('Authorization', `Bearer ${deliveredBuyerToken}`)
      .send({ rating: 5, body: 'منتج ممتاز وثباته لطيف جداً', skuId })
      .expect(201);

    expect(createRes.body.review).toMatchObject({
      rating: 5,
      body: 'منتج ممتاز وثباته لطيف جداً',
      isVerifiedPurchase: true,
      isTest: false,
    });
    expect(createRes.body.summary).toMatchObject({
      average: 5,
      count: 1,
      verifiedCount: 1,
      recommendPercent: 100,
    });

    // Scenario 5: duplicate review by same user blocked both on eligibility and POST (409)
    const afterElig = await request(app.getHttpServer())
      .get(`/products/${productSlug}/reviews/eligibility`)
      .set('Authorization', `Bearer ${deliveredBuyerToken}`)
      .expect(200);
    expect(afterElig.body).toMatchObject({ canReview: false, reason: 'ALREADY_REVIEWED' });

    await request(app.getHttpServer())
      .post(`/products/${productSlug}/reviews`)
      .set('Authorization', `Bearer ${deliveredBuyerToken}`)
      .send({ rating: 4, body: 'Duplicate attempt' })
      .expect(409);

    // Optional written review (rating-only) by second delivered buyer updates summary math
    const ratingOnlyRes = await request(app.getHttpServer())
      .post(`/products/${productSlug}/reviews`)
      .set('Authorization', `Bearer ${deliveredBuyerRatingOnlyToken}`)
      .send({ rating: 4 })
      .expect(201);
    expect(ratingOnlyRes.body.review.body).toBeNull();
    expect(ratingOnlyRes.body.review.isVerifiedPurchase).toBe(true);
    expect(ratingOnlyRes.body.summary).toMatchObject({
      average: 4.5,
      count: 2,
      verifiedCount: 2,
      recommendPercent: 100,
    });

    // Scenario 8: public refresh persists both reviews
    const refreshRes = await request(app.getHttpServer())
      .get(`/products/${productSlug}/reviews`)
      .expect(200);
    expect(refreshRes.body.items).toHaveLength(2);
    expect(refreshRes.body.summary).toMatchObject({ average: 4.5, count: 2, verifiedCount: 2 });
  });

  it('Scenario 6 & 7: enforces strict dev-only isolated test reviews and always rejects override in production', async () => {
    // Disabled by default, even when TEST_BYPASS_AUTH=true
    process.env.TEST_BYPASS_AUTH = 'true';
    process.env.ENABLE_DEV_TEST_REVIEWS = 'false';

    const disabledElig = await request(app.getHttpServer())
      .get(`/products/${productSlug}/reviews/eligibility`)
      .set('Authorization', `Bearer ${devAdminToken}`)
      .expect(200);
    expect(disabledElig.body).toMatchObject({ canReview: false, reason: 'NO_PURCHASE', isTestMode: false });

    await request(app.getHttpServer())
      .post(`/products/${productSlug}/reviews`)
      .set('Authorization', `Bearer ${devAdminToken}`)
      .send({ rating: 2, body: 'Should fail while flag is off' })
      .expect(403);

    process.env.TEST_BYPASS_AUTH = 'false';

    // Production lockdown even if flag is mistakenly true
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_DEV_TEST_REVIEWS = 'true';
    await request(app.getHttpServer())
      .post(`/products/${productSlug}/reviews`)
      .set('Authorization', `Bearer ${devAdminToken}`)
      .send({ rating: 1, body: 'Must fail in production' })
      .expect(403);

    // Secondary production env misconfiguration guard when NODE_ENV=development
    process.env.NODE_ENV = 'development';
    process.env.APP_ENV = 'production';
    await request(app.getHttpServer())
      .post(`/products/${productSlug}/reviews`)
      .set('Authorization', `Bearer ${devAdminToken}`)
      .send({ rating: 1, body: 'Must fail under APP_ENV=production' })
      .expect(403);
    delete process.env.APP_ENV;

    // Ordinary customer still blocked even when dev flag is active
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_DEV_TEST_REVIEWS = 'true';
    await request(app.getHttpServer())
      .post(`/products/${productSlug}/reviews`)
      .set('Authorization', `Bearer ${nonBuyerToken}`)
      .send({ rating: 5, body: 'Non-dev customer blocked' })
      .expect(403);

    // Authorized dev in test env with explicit flag enabled succeeds cleanly
    const devElig = await request(app.getHttpServer())
      .get(`/products/${productSlug}/reviews/eligibility`)
      .set('Authorization', `Bearer ${devAdminToken}`)
      .expect(200);
    expect(devElig.body).toMatchObject({
      authenticated: true,
      canReview: true,
      reason: 'ELIGIBLE_DEV_TEST',
      isTestMode: true,
    });

    const devRes = await request(app.getHttpServer())
      .post(`/products/${productSlug}/reviews`)
      .set('Authorization', `Bearer ${devAdminToken}`)
      .send({ rating: 1, body: 'Dev UI test review' })
      .expect(201);

    expect(devRes.body.review).toMatchObject({
      rating: 1,
      body: 'Dev UI test review',
      isTest: true,
      isVerifiedPurchase: false,
    });
    // Critical: dev test review must NEVER affect production ratings or verifiedCount!
    expect(devRes.body.summary).toMatchObject({
      average: 4.5,
      count: 2,
      verifiedCount: 2,
    });

    // Public visitor still sees ONLY the 2 real reviews
    const publicList = await request(app.getHttpServer())
      .get(`/products/${productSlug}/reviews`)
      .expect(200);
    expect(publicList.body.items).toHaveLength(2);
    expect(publicList.body.items.every((item: { isTest: boolean }) => item.isTest === false)).toBe(true);

    // Authorized developer refresh sees their persisted TEST review, still excluded from summary!
    const devList = await request(app.getHttpServer())
      .get(`/products/${productSlug}/reviews`)
      .set('Authorization', `Bearer ${devAdminToken}`)
      .expect(200);
    expect(devList.body.items).toHaveLength(3);
    expect(devList.body.items.some((item: { isTest: boolean }) => item.isTest === true)).toBe(true);
    expect(devList.body.summary).toMatchObject({ average: 4.5, count: 2, verifiedCount: 2 });
  });
});
