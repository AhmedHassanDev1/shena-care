import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { CatalogService } from '../../src/modules/catalog/public';
import { IngestionService } from '../../src/modules/ingestion/services/ingestion.service';
import { StorageService } from '../../src/platform/storage/storage.service';
import { AiClient } from '../../src/platform/ai';
import { DataRetentionService } from '../../src/modules/operations/services/data-retention.service';
import { OutboxService } from '../../src/modules/operations/services/outbox.service';
import { CommerceService } from '../../src/modules/commerce/public';
import { SourcingService } from '../../src/modules/sourcing/public';

// Synthetic fixture bytes and evidence are confined to the dedicated PostgreSQL test DB.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/bkAAAAASUVORK5CYII=', 'base64');
const sourceUrl = 'https://www.cerave.com/skincare/moisturizers/moisturizing-cream';

describe('GLO-123/124 media, tenant storage and publication invariants (PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let catalog: CatalogService;
  let ingestion: IngestionService;
  let storage: StorageService;
  let supplierA: string;
  let supplierB: string;
  let adminId: string;
  let tokens: Record<string, string>;
  const fixtureId = randomUUID();
  const customers: string[] = [];
  const jobs: string[] = [];
  const products: string[] = [];
  const brands: string[] = [];
  const objects: string[] = [];

  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('_test')) throw new Error('Dedicated test DB required');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useValue({ enrichProduct: async () => ({ suggestions: {} }) })
      .overrideProvider(DataRetentionService).useValue({})
      .overrideProvider(OutboxService).useValue({ enqueue: async () => undefined }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    catalog = app.get(CatalogService);
    ingestion = app.get(IngestionService);
    storage = app.get(StorageService);
    supplierA = (await prisma.supplier.create({ data: { name: `Pipeline A ${fixtureId}`, slug: `pipeline-a-${fixtureId}` } })).id;
    supplierB = (await prisma.supplier.create({ data: { name: `Pipeline B ${fixtureId}`, slug: `pipeline-b-${fixtureId}` } })).id;
    tokens = {};
    for (const [role, supplierId] of [['ADMIN', null], ['SUPPLIER', supplierA], ['SUPPLIER_B', supplierB], ['CUSTOMER', null], ['UNLINKED', null]] as const) {
      const user = await prisma.customer.create({ data: { name: role, email: `${role}-${fixtureId}@shenacare.test`,
        roles: [role === 'SUPPLIER_B' || role === 'UNLINKED' ? 'SUPPLIER' : role], supplierId } });
      customers.push(user.id);
      if (role === 'ADMIN') adminId = user.id;
      tokens[role] = (await prisma.session.create({ data: { customerId: user.id, token: randomUUID(), expiresAt: new Date(Date.now() + 3600000) } })).token;
    }
  });

  afterAll(async () => {
    if (!prisma) { if (app) await app.close(); return; }
    const skus = await prisma.sku.findMany({ where: { productId: { in: products } } });
    const skuIds = skus.map(s => s.id);
    await prisma.listing.deleteMany({ where: { skuId: { in: skuIds } } });
    await prisma.sellingPrice.deleteMany({ where: { skuId: { in: skuIds } } });
    await prisma.supplierOffer.deleteMany({ where: { supplierId: { in: [supplierA, supplierB] } } });
    await prisma.supplierSkuAlias.deleteMany({ where: { supplierId: { in: [supplierA, supplierB] } } });
    await prisma.ingestionJob.deleteMany({ where: { id: { in: jobs } } });
    await prisma.productMedia.deleteMany({ where: { productId: { in: products } } });
    await prisma.sku.deleteMany({ where: { id: { in: skuIds } } });
    await prisma.product.deleteMany({ where: { id: { in: products } } });
    await prisma.brand.deleteMany({ where: { id: { in: brands } } });
    await prisma.customer.deleteMany({ where: { id: { in: customers } } });
    await prisma.supplier.deleteMany({ where: { id: { in: [supplierA, supplierB] } } });
    for (const object of objects) if (fs.existsSync(object)) fs.unlinkSync(object);
    await app.close();
  });

  function auth(role = 'ADMIN') { return { Authorization: `Bearer ${tokens[role]}` }; }
  function route(url: string) { return new URL(url).pathname; }
  async function candidate() {
    const id = randomUUID();
    const job = await prisma.ingestionJob.create({ data: { supplierId: supplierA, items: { create: {
      supplierSkuCode: `PIPE-${id}`, name: `Pipeline Cream ${id}`, brand: `Pipeline Brand ${id}`, barcode: id,
      price: 50, currency: 'SAR', status: 'review_required', enrichment: { research: { fieldEvidences: [{
        fieldName: 'size', sourceUrl, sourceType: 'OFFICIAL_MANUFACTURER', verificationStatus: 'SUPPORTED', proposedValue: { value: 50, unit: 'ml' },
      }] } },
    } } }, include: { items: true } });
    jobs.push(job.id);
    return job.items[0];
  }
  async function upload(id: string, filename = 'packshot.png') {
    const res = await request(app.getHttpServer()).post(`/ingestion/candidates/${id}/media`).set(auth())
      .attach('file', png, { filename, contentType: 'image/png' }).expect(201);
    objects.push(storage.getFilePath(route(res.body.url).slice('/storage/'.length)));
    return res.body;
  }
  function review(url: string, barcode: string) { return { url, sourceUrl, sourceType: 'OFFICIAL_MANUFACTURER', barcode, size: 50, sizeUnit: 'ml', variantName: '50 ml' }; }
  async function approve(id: string, url: string, barcode: string) {
    await request(app.getHttpServer()).patch(`/ingestion/candidates/${id}/approve`).set(auth())
      .send({ mediaReviews: [review(url, barcode)] }).expect(200);
  }
  async function publish(id: string) {
    const res = await request(app.getHttpServer()).post(`/ingestion/candidates/${id}/publish`).set(auth()).expect(200);
    const sku = await prisma.sku.findUniqueOrThrow({ where: { id: res.body.matchedSkuId }, include: { product: true } });
    if (!products.includes(sku.productId)) { products.push(sku.productId); brands.push(sku.product.brandId); }
    return sku;
  }

  it('rejects the original pilot signature-only PNG and MIME spoofing', async () => {
    const item = await candidate();
    for (const bytes of [Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('<script>bad</script>')]) {
      await request(app.getHttpServer()).post(`/ingestion/candidates/${item.id}/media`).set(auth())
        .attach('file', bytes, { filename: 'packshot.png', contentType: 'image/png' }).expect(400);
    }
    const persisted = await prisma.ingestionItem.findUniqueOrThrow({ where: { id: item.id } });
    expect((persisted.enrichment as any).media).toBeUndefined();
  });

  it('rejects missing files, SVG, oversized uploads and traversal/private-owner fallback', async () => {
    const item = await candidate();
    await request(app.getHttpServer()).post(`/ingestion/candidates/${item.id}/media`).set(auth()).expect(400);
    await request(app.getHttpServer()).post(`/ingestion/candidates/${item.id}/media`).set(auth())
      .attach('file', Buffer.from('<svg/>'), { filename: 'x.svg', contentType: 'image/svg+xml' }).expect(400);
    await request(app.getHttpServer()).post(`/ingestion/candidates/${item.id}/media`).set(auth())
      .attach('file', Buffer.alloc(5 * 1024 * 1024 + 1), { filename: 'x.png', contentType: 'image/png' }).expect(413);
    expect(() => storage.getFilePath('../secret.png')).toThrow();
    await expect(storage.uploadFile({ buffer: png, originalname: 'x.png', mimetype: 'image/png' } as any, true, 'originals')).rejects.toThrow();
  });

  it('keeps mock/test media TEST even when an admin attempts review', async () => {
    const item = await candidate();
    const media = await upload(item.id, 'mock-test.png');
    expect(media.originType).toBe('test');
    await request(app.getHttpServer()).patch(`/ingestion/candidates/${item.id}/approve`).set(auth())
      .send({ mediaReviews: [review(media.url, item.barcode!)] }).expect(400);
    expect((await prisma.ingestionItem.findUniqueOrThrow({ where: { id: item.id } })).enrichment).toMatchObject({ media: [{ originType: 'test' }] });
  });

  it('keeps ordinary uploads unverified and rejects URL-only approval, foreign URLs and wrong identity', async () => {
    const item = await candidate();
    const media = await upload(item.id);
    expect(media.originType).toBe('unverified');
    const attempts = [
      { verifiedMediaUrls: [media.url] },
      { mediaReviews: [review(media.url, 'different-barcode')] },
      { mediaReviews: [{ ...review(media.url, item.barcode!), size: 100 }] },
      { mediaReviews: [{ ...review(media.url, item.barcode!), sourceUrl: 'https://cerave.com.evil.example/image' }] },
      { mediaReviews: [review('https://www.cerave.com/foreign.png', item.barcode!)] },
    ];
    for (const body of attempts) await request(app.getHttpServer()).patch(`/ingestion/candidates/${item.id}/approve`).set(auth()).send(body).expect(400);
    expect((await prisma.ingestionItem.findUniqueOrThrow({ where: { id: item.id } })).enrichment).toMatchObject({ media: [{ originType: 'unverified' }] });
  });

  it('denies anonymous, cross-supplier and customer downloads; permits the owning supplier and admin', async () => {
    const item = await candidate();
    const media = await upload(item.id);
    const url = route(media.url);
    await request(app.getHttpServer()).get(url).expect(401);
    await request(app.getHttpServer()).get(url).set(auth('SUPPLIER_B')).expect(403);
    await request(app.getHttpServer()).get(url).set(auth('CUSTOMER')).expect(403);
    await request(app.getHttpServer()).get(url).set(auth('SUPPLIER')).expect(200);
    await request(app.getHttpServer()).get(url).set(auth()).expect(200);
    await request(app.getHttpServer()).patch(`/ingestion/candidates/${item.id}/approve`).set(auth('SUPPLIER')).send({}).expect(403);
  });

  it('stores supplier originals behind the same private boundary', async () => {
    const url = await storage.uploadFile({ originalname: 'original.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nSupplier original\n%%EOF') } as any, true, 'originals', supplierA);
    objects.push(storage.getFilePath(route(url).slice('/storage/'.length)));
    await request(app.getHttpServer()).get(route(url)).expect(401);
    await request(app.getHttpServer()).get(route(url)).set(auth('SUPPLIER_B')).expect(403);
    await request(app.getHttpServer()).get(route(url)).set(auth('SUPPLIER')).expect(200);
  });

  it('rejects supplier job submission without a linked tenant and across tenants', async () => {
    for (const [role, supplierId] of [['UNLINKED', supplierA], ['SUPPLIER', supplierB]]) {
      await request(app.getHttpServer()).post('/ingestion/jobs').set(auth(role)).send({ supplierId, items: [] }).expect(403);
    }
  });

  it('blocks unapproved and media-incomplete publication on candidate and job paths', async () => {
    const item = await candidate();
    await request(app.getHttpServer()).post(`/ingestion/candidates/${item.id}/publish`).set(auth()).expect(400);
    await request(app.getHttpServer()).patch(`/ingestion/candidates/${item.id}/approve`).set(auth()).send({}).expect(200);
    await request(app.getHttpServer()).post(`/ingestion/candidates/${item.id}/publish`).set(auth()).expect(400);
    await request(app.getHttpServer()).post(`/ingestion/jobs/${item.jobId}/publish`).set(auth()).expect(400);
    expect((await prisma.ingestionItem.findUniqueOrThrow({ where: { id: item.id } })).matchedSkuId).toBeNull();
  });

  it('persists exact reviewed Product/SKU media, deduplicates retries, and keeps supplier cost separate from SellingPrice', async () => {
    const item = await candidate();
    const media = await upload(item.id);
    await approve(item.id, media.url, item.barcode!);
    const sku = await publish(item.id);
    const rows = await prisma.productMedia.findMany({ where: { productId: sku.productId } });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.generationMetadata).toMatchObject({ skuId: sku.id, barcode: item.barcode, size: 50, sizeUnit: 'ml', reviewedBy: adminId, isTest: false });
    objects.push(storage.getFilePath(route(row.url).slice('/storage/'.length)));
    await request(app.getHttpServer()).post(`/ingestion/candidates/${item.id}/publish`).set(auth()).expect(400);
    await Promise.all([catalog.addMedia(sku.productId, { type: 'image', url: row.url, originType: 'verified', generationMetadata: row.generationMetadata as any }, adminId),
      catalog.addMedia(sku.productId, { type: 'image', url: row.url, originType: 'verified', generationMetadata: row.generationMetadata as any }, adminId)]);
    expect(await prisma.productMedia.count({ where: { productId: sku.productId } })).toBe(1);
    expect(await prisma.sellingPrice.count({ where: { skuId: sku.id } })).toBe(0);
    expect(await prisma.supplierOffer.findUnique({ where: { supplierId_skuId: { supplierId: supplierA, skuId: sku.id } } })).toMatchObject({ isAvailable: false, lastConfirmedAt: null });
    await request(app.getHttpServer()).get(`/products/${sku.productId}`).expect(404);
    await request(app.getHttpServer()).get(route(row.url)).expect(404);
    // Even accidental publication cannot expose an item without Commerce terms.
    await catalog.updateProduct(sku.productId, { isPublished: true });
    await request(app.getHttpServer()).get(`/products/${sku.productId}`).expect(404);
    await request(app.getHttpServer()).get(`/products/${sku.productId}/media`).expect(404);
    await request(app.getHttpServer()).get(route(row.url)).expect(200);
    const commerce = app.get(CommerceService);
    const sourcing = app.get(SourcingService);
    await commerce.createListing(sku.id);
    await commerce.addSellingPrice({ skuId: sku.id, amount: 89, currency: 'SAR' });
    await request(app.getHttpServer()).get(`/products/${sku.productId}`).expect(404);
    const offer = await prisma.supplierOffer.findUniqueOrThrow({ where: { supplierId_skuId: { supplierId: supplierA, skuId: sku.id } } });
    await sourcing.updateSupplierOffer(offer.id, { isAvailable: true });
    await request(app.getHttpServer()).get(`/products/${sku.productId}`).expect(404);
    await sourcing.confirmSupplierOfferAvailability(offer.id, true);
    const visible = await request(app.getHttpServer()).get(`/products/${sku.productId}`).expect(200);
    expect(visible.body.skus[0]).toMatchObject({ id: sku.id, price: { amount: 89, currency: 'SAR' }, canOrder: true });
    expect(visible.body.media[0]).toMatchObject({ skuId: sku.id, originType: 'verified' });
    expect((await prisma.supplierOffer.findUniqueOrThrow({ where: { id: offer.id } })).costPrice.toNumber()).toBe(50);
    await catalog.updateSku(sku.id, { size: 100 });
    await request(app.getHttpServer()).get(`/products/${sku.productId}`).expect(404);
    await request(app.getHttpServer()).get(route(row.url)).expect(404);
    await request(app.getHttpServer()).post(`/ingestion/candidates/${item.id}/media`).set(auth()).attach('file', png, { filename: 'packshot.png', contentType: 'image/png' }).expect(400);
  });

  it('rejects wrong-SKU media approval and anonymous/customer catalog mutation', async () => {
    const item = await candidate();
    const media = await upload(item.id);
    await approve(item.id, media.url, item.barcode!);
    const sku = await publish(item.id);
    const row = await prisma.productMedia.findFirstOrThrow({ where: { productId: sku.productId } });
    objects.push(storage.getFilePath(route(row.url).slice('/storage/'.length)));
    await request(app.getHttpServer()).post(`/products/${sku.productId}/media`).send({ type: 'image', url: row.url }).expect(401);
    await request(app.getHttpServer()).patch(`/products/media/${row.id}`).set(auth('CUSTOMER')).send({ isPrimary: true }).expect(403);
    await request(app.getHttpServer()).post(`/products/${sku.productId}/media`).set(auth()).send({ type: 'image', url: row.url }).expect(400);
    await request(app.getHttpServer()).patch(`/products/media/${row.id}`).set(auth())
      .send({ generationMetadata: { ...(row.generationMetadata as any), skuId: randomUUID() } }).expect(400);
    await request(app.getHttpServer()).patch(`/products/media/${row.id}`).set(auth())
      .send({ url: 'https://www.cerave.com/changed.png' }).expect(400);
    expect((await prisma.productMedia.findUniqueOrThrow({ where: { id: row.id } })).url).toBe(row.url);
  });

  it('invalidates prior review after candidate identity changes', async () => {
    const item = await candidate();
    const media = await upload(item.id);
    await approve(item.id, media.url, item.barcode!);
    await request(app.getHttpServer()).patch(`/ingestion/candidates/${item.id}`).set(auth()).send({ name: 'Corrected candidate' }).expect(200);
    const persisted = await prisma.ingestionItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(persisted.status).toBe('review_required');
    expect((await prisma.ingestionJob.findUniqueOrThrow({ where: { id: item.jobId } })).status).toBe('review_required');
    await request(app.getHttpServer()).post(`/ingestion/jobs/${item.jobId}/publish`).set(auth()).expect(400);
    expect(persisted.enrichment).toMatchObject({ media: [{ originType: 'unverified', review: null }] });
  });

  it('does not publicly serve orphan, unreviewed legacy, or arbitrary-folder assets', async () => {
    const url = await storage.uploadFile({ buffer: png, originalname: 'packshot.png', mimetype: 'image/png' } as any, false, 'media');
    objects.push(storage.getFilePath(route(url).slice('/storage/'.length)));
    await request(app.getHttpServer()).get(route(url)).expect(404);
    await request(app.getHttpServer()).get('/storage/public/candidates/orphan.png').expect(404);
  });
});
