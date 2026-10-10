import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { CatalogService } from '../../src/modules/catalog/public';
import { AiClient } from '../../src/platform/ai';
import { DataRetentionService } from '../../src/modules/operations/services/data-retention.service';
import { OutboxService } from '../../src/modules/operations/services/outbox.service';

// Synthetic receipts, stock and prices exercise contracts only in the disposable test DB.
describe('GLO-182 public discovery (PostgreSQL)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let catalog: CatalogService;
  let brandId: string;
  let supplierId: string;
  let reviewerId: string;
  const run = randomUUID();
  const brandSlug = `contract-${run}`;
  const prefix = run.slice(0, 24);
  const products: string[] = [];
  const skuIds: string[] = [];
  const id = (n: number) => prefix + String(n).padStart(12, '0');
  let firstSku: string;

  async function fixture(n: number, state = 'sellable', createdAt = new Date('2026-01-01')) {
    const product = await db.product.create({ data: { id: id(n), name: `Contract Cream ${n}`, slug: `${brandSlug}-${n}`,
      brandId, isPublished: state !== 'unpublished', createdAt } });
    products.push(product.id);
    const sku = await db.sku.create({ data: { productId: product.id, code: `CONTRACT-${run}-${n}`, barcode: `contract-barcode-${n}`,
      variantName: '50 ml', size: 50, sizeUnit: 'ml' } });
    skuIds.push(sku.id);
    if (state !== 'unreviewed') await catalog.addMedia(product.id, { type: 'image', url: `https://www.cerave.com/contract-fixture-${run}-${n}.png`, originType: 'verified',
      generationMetadata: { skuId: sku.id, barcode: sku.barcode, size: 50, sizeUnit: 'ml', variantName: '50 ml', isTest: false,
        sourceUrl: 'https://www.cerave.com/skincare/moisturizers/moisturizing-cream', sourceType: 'OFFICIAL_MANUFACTURER', reviewedBy: reviewerId, reviewedAt: new Date().toISOString() } }, reviewerId);
    await db.listing.create({ data: { skuId: sku.id, isListed: state !== 'unlisted' } });
    if (state !== 'unpriced') await db.sellingPrice.create({ data: { skuId: sku.id, amount: 89, currency: 'SAR', validFrom: new Date('2026-01-01'),
      validUntil: state === 'expired-price' ? new Date('2026-01-02') : null } });
    await db.supplierOffer.create({ data: { supplierId, skuId: sku.id, costPrice: 50, currency: 'SAR', isAvailable: state !== 'unavailable',
      lastConfirmedAt: state === 'unconfirmed' ? null : state === 'stale' ? new Date(Date.now() - 48 * 3600000) : new Date() } });
    return sku;
  }

  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('_test')) throw new Error('Dedicated test DB required');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useValue({ enrichProduct: async () => ({ suggestions: {} }) })
      .overrideProvider(DataRetentionService).useValue({})
      .overrideProvider(OutboxService).useValue({ enqueue: async () => undefined }).compile();
    app = module.createNestApplication(); app.useLogger(false);
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init(); db = app.get(PrismaService); catalog = app.get(CatalogService);
    reviewerId = (await db.customer.create({ data: { name: 'Synthetic reviewer', email: `${run}@contract.test`, roles: ['ADMIN'] } })).id;
    brandId = (await db.brand.create({ data: { name: brandSlug, slug: brandSlug } })).id;
    supplierId = (await db.supplier.create({ data: { name: 'Synthetic contract supplier', slug: brandSlug } })).id;
    for (const [n, state] of ['sellable', 'unpriced', 'stale', 'unpublished', 'unlisted', 'unreviewed', 'sellable', 'unconfirmed', 'unavailable', 'expired-price'].entries()) {
      const sku = await fixture(n + 1, state); if (n === 0) firstSku = sku.id;
    }
    // A sibling with price and stock but no exact reviewed image must remain hidden.
    const sibling = await db.sku.create({ data: { productId: id(1), code: `UNREVIEWED-${run}`, variantName: '100 ml', size: 100, sizeUnit: 'ml' } });
    skuIds.push(sibling.id);
    await db.listing.create({ data: { skuId: sibling.id } });
    await db.sellingPrice.create({ data: { skuId: sibling.id, amount: 120, currency: 'SAR', validFrom: new Date('2026-01-01') } });
    await db.supplierOffer.create({ data: { supplierId, skuId: sibling.id, costPrice: 60, currency: 'SAR', lastConfirmedAt: new Date() } });
  });

  afterAll(async () => {
    if (db) {
      await db.listing.deleteMany({ where: { skuId: { in: skuIds } } });
      await db.sellingPrice.deleteMany({ where: { skuId: { in: skuIds } } });
      if (supplierId) await db.supplierOffer.deleteMany({ where: { supplierId } });
      await db.productMedia.deleteMany({ where: { productId: { in: products } } });
      await db.sku.deleteMany({ where: { id: { in: skuIds } } });
      await db.product.deleteMany({ where: { id: { in: products } } });
      if (brandId) await db.brand.delete({ where: { id: brandId } });
      if (supplierId) await db.supplier.delete({ where: { id: supplierId } });
      if (reviewerId) await db.customer.delete({ where: { id: reviewerId } });
    }
    if (app) await app.close();
  });

  it('groups eligible variants, counts eligible products and fills pages after all gates', async () => {
    const result = await request(app.getHttpServer()).get('/products/discovery').query({ brand: brandSlug, limit: 1 }).expect(200);
    expect(result.body.total).toBe(2);
    expect(result.body.items.map((p: any) => p.id)).toEqual([id(1)]);
    expect(result.body.items[0].skus.map((s: any) => s.id)).toEqual([firstSku]);
    expect(result.body.facets.brands).toEqual([{ slug: brandSlug, name: brandSlug, count: 2 }]);
    expect(result.body.pageInfo.hasNextPage).toBe(true);
    const second = await request(app.getHttpServer()).get('/products/discovery').query({ brand: brandSlug, limit: 1, cursor: result.body.pageInfo.nextCursor }).expect(200);
    expect(second.body.items.map((p: any) => p.id)).toEqual([id(7)]);
    expect(second.body.pageInfo.nextCursor).toBeNull();
    const legacy = await request(app.getHttpServer()).get('/products').query({ brand: brandSlug, limit: 1, page: 2 }).expect(200);
    expect(legacy.body.map((p: any) => p.id)).toEqual([id(7)]);
    expect(JSON.stringify(result.body)).not.toMatch(/costPrice|supplierId|reviewedBy/);
  });

  it('searches names, SKU codes and barcode; combines filters and validates input', async () => {
    for (const q of [`CONTRACT-${run}-1`, 'contract-barcode-1', 'Cream 1']) {
      const result = await request(app.getHttpServer()).get('/products/discovery').query({ brand: brandSlug, q }).expect(200);
      expect(result.body.items.map((p: any) => p.id)).toEqual([id(1)]);
    }
    const none = await request(app.getHttpServer()).get('/products/discovery').query({ brand: brandSlug, category: 'missing-category' }).expect(200);
    expect(none.body).toMatchObject({ items: [], total: 0, facets: { brands: [] } });
    for (const query of [{ limit: 101 }, { limit: -1 }, { limit: 'NaN' }, { cursor: 'garbage' }, { q: 'x'.repeat(121) }, { unknown: 'x' }])
      await request(app.getHttpServer()).get('/products/discovery').query(query).expect(400);
    await request(app.getHttpServer()).get('/products').query({ page: -1 }).expect(400);
  });

  it('keeps the insertion watermark and rejects cursor reuse with changed filters', async () => {
    const page = await request(app.getHttpServer()).get('/products/discovery').query({ brand: brandSlug, limit: 1 }).expect(200);
    await fixture(11, 'sellable', new Date(Date.now() + 1000));
    const next = await request(app.getHttpServer()).get('/products/discovery').query({ brand: brandSlug, limit: 100, cursor: page.body.pageInfo.nextCursor }).expect(200);
    expect(next.body.items.map((p: any) => p.id)).toEqual([id(7)]);
    await request(app.getHttpServer()).get('/products/discovery').query({ brand: brandSlug, q: 'changed', cursor: page.body.pageInfo.nextCursor }).expect(400);
  });

  it('reacts immediately to withdrawn supplier availability without leaking an incomplete detail', async () => {
    await db.supplierOffer.update({ where: { supplierId_skuId: { supplierId, skuId: firstSku } }, data: { isAvailable: false } });
    await request(app.getHttpServer()).get(`/products/${id(1)}`).expect(404);
    await request(app.getHttpServer()).get(`/products/${id(1)}/skus`).expect(404);
    const result = await request(app.getHttpServer()).get('/products/discovery').query({ brand: brandSlug }).expect(200);
    expect(result.body.items.some((p: any) => p.id === id(1))).toBe(false);
    await db.supplierOffer.update({ where: { supplierId_skuId: { supplierId, skuId: firstSku } }, data: { isAvailable: true } });
  });
});
