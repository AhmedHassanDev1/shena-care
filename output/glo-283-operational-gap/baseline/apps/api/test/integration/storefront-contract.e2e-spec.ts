import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AiClient } from '../../src/platform/ai';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { createSellableSku } from '../fixtures/sellable-sku';
import { signInCustomer } from '../fixtures/checkout';

/**
 * GLO-199 contract test: the storefront (apps/web) reads these exact fields. If the API renames, drops or
 * retypes one, this suite fails before the screens do. Shapes mirror apps/web/src/features/catalog/api/
 * discovery.ts, apps/web/src/lib/cart.ts and apps/web/src/lib/orders.ts — update both sides together.
 */
type Kind = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'string|null' | 'number|null' | 'object|null';

function expectShape(value: unknown, shape: Record<string, Kind>, path = 'response') {
  expect(value).toEqual(expect.any(Object));
  const record = value as Record<string, unknown>;
  const problems: string[] = [];
  for (const [key, kind] of Object.entries(shape)) {
    const field = record[key];
    const actual = field === null ? 'null' : Array.isArray(field) ? 'array' : typeof field;
    if (!kind.split('|').includes(actual)) problems.push(`${path}.${key}: expected ${kind}, got ${actual}`);
  }
  expect(problems).toEqual([]);
}

describe('Storefront contract (GLO-199)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sku: Awaited<ReturnType<typeof createSellableSku>>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useValue(new DeterministicAiClient()).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useLogger(false);
    await app.init();
    prisma = app.get(PrismaService);
    sku = await createSellableSku(prisma);
    await prisma.fulfillmentLocation.upsert({ where: { name: 'Contract Hub' }, update: {}, create: { name: 'Contract Hub', address: 'C' } });
  });

  afterAll(async () => { if (app) await app.close(); });

  it('serves every field the listing, product page, cart, checkout and tracking screens read', async () => {
    const brand = (await prisma.product.findUniqueOrThrow({ where: { id: sku.productId }, include: { brand: true } })).brand.slug;

    // Listing (features/catalog/api/discovery.ts DiscoveryPage)
    const page = (await http().get('/products/discovery').query({ brand, limit: 1 }).expect(200)).body;
    expectShape(page, { items: 'array', total: 'number', facets: 'object', pageInfo: 'object' });
    expectShape(page.facets, { brands: 'array', categories: 'array', productLines: 'array' }, 'facets');
    expectShape(page.facets.brands[0], { slug: 'string', name: 'string', count: 'number' }, 'facet');
    expectShape(page.pageInfo, { limit: 'number', hasNextPage: 'boolean', nextCursor: 'string|null' }, 'pageInfo');
    const card = page.items[0];
    expectShape(card, { id: 'string', name: 'string', slug: 'string', brand: 'object', skus: 'array', media: 'array' }, 'item');
    expectShape(card.skus[0], { id: 'string', code: 'string', variantName: 'string', size: 'number|null', sizeUnit: 'string|null', price: 'object|null', canOrder: 'boolean' }, 'item.sku');
    expectShape(card.skus[0].price, { amount: 'number', currency: 'string', compareAtAmount: 'number|null' }, 'item.sku.price');
    expectShape(card.media[0], { id: 'string', type: 'string', url: 'string', altText: 'string|null', isPrimary: 'boolean' }, 'item.media');

    // Product page (ProductDetail / PublicVariant)
    const detail = (await http().get(`/products/${sku.productSlug}/detail`).query({ skuId: sku.id }).expect(200)).body;
    expectShape(detail, { id: 'string', name: 'string', slug: 'string', brand: 'object', skus: 'array', media: 'array', selectedSkuId: 'string', selectedVariant: 'object' });
    expectShape(detail.selectedVariant, {
      id: 'string', variantName: 'string', size: 'number|null', sizeUnit: 'string|null', price: 'object|null',
      canOrder: 'boolean', availability: 'object', media: 'array', content: 'object|null', promotions: 'object|null',
    }, 'selectedVariant');

    // Cart (lib/cart.ts BackendCart)
    const added = await http().post('/ordering/cart/add').send({ skuId: sku.id, quantity: 2 }).expect(201);
    // Sign-in adopts the guest cart; checkout and order reads use the customer session (SAHEL V18).
    const customer = await signInCustomer(app, added.body.guestCartToken);
    expectShape(added.body, { id: 'string', revision: 'number', items: 'array', totalAmount: 'number', guestCartToken: 'string' }, 'cart');
    expectShape(added.body.items[0], {
      skuId: 'string', quantity: 'number', price: 'number|null', priceAtAdd: 'number|null', priceChangedSinceAdd: 'boolean',
      canOrder: 'boolean', lineTotal: 'number',
    }, 'cart.item');

    // Checkout (lib/orders.ts CheckoutQuote / PlacedOrder)
    const quote = (await http().post('/ordering/checkout/quote').set(customer.auth)
      .send({ governorate: 'Cairo', area: 'Maadi' }).expect(201)).body;
    expectShape(quote, {
      quoteVersion: 'string', cartRevision: 'number', subtotal: 'number', shippingFee: 'number', codAmount: 'number',
      totalAmount: 'number', currency: 'string', governorate: 'string', area: 'string', items: 'array',
    }, 'quote');
    expectShape(quote.items[0], { skuId: 'string', productName: 'string', variantName: 'string', quantity: 'number', lineTotal: 'number' }, 'quote.item');
    const placed = (await http().post('/ordering/checkout').set(customer.auth).send({
      customerName: 'Contract Customer', customerPhone: '01012345678', governorate: 'Cairo', area: 'Maadi',
      shippingAddress: '1 Contract Street', notes: 'Gate 2', latitude: 29.9602, longitude: 31.2569, locationSource: 'map_pin', locationConfirmed: true, quoteVersion: quote.quoteVersion, cartRevision: quote.cartRevision,
      idempotencyKey: 'contract-' + quote.quoteVersion,
    }).expect(201)).body;
    expectShape(placed, { id: 'string', orderNumber: 'string', totalAmount: 'number', currency: 'string' }, 'order');

    // Tracking (lib/orders.ts OrderTracking) for the signed-in customer
    const tracking = (await http().get(`/ordering/orders/${placed.orderNumber}/tracking`)
      .set(customer.auth).expect(200)).body;
    expectShape(tracking, {
      orderNumber: 'string', createdAt: 'string', status: 'string', customerName: 'string', deliveryAddress: 'object',
      amounts: 'object', items: 'array', timeline: 'array', delivery: 'object', actionRequired: 'object|null', resolutions: 'array',
    }, 'tracking');
    expectShape(tracking.amounts, { originalCodAmount: 'number', currentCodAmount: 'number', subtotal: 'number', shippingFee: 'number', currency: 'string' }, 'tracking.amounts');
    expectShape(tracking.items[0], { id: 'string', productName: 'string|null', variantName: 'string|null', quantity: 'number', lineTotal: 'number', status: 'string' }, 'tracking.item');
    expectShape(tracking.delivery, { estimatedDate: 'string|null', deliveredAt: 'string|null', nextUpdateBy: 'string|null', promise: 'string|null' }, 'tracking.delivery');
    const decisions = (await http().get(`/ordering/orders/${placed.orderNumber}/availability-decisions`)
      .set(customer.auth).expect(200)).body;
    expect(Array.isArray(decisions)).toBe(true);
  });
});
