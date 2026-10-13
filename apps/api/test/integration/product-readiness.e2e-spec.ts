import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { CatalogService } from '../../src/modules/catalog/public';
import { IngestionService } from '../../src/modules/ingestion/public';
import { AiClient } from '../../src/platform/ai';
import { DataRetentionService } from '../../src/modules/operations/services/data-retention.service';
import { OutboxService } from '../../src/modules/operations/services/outbox.service';
import { StorageService } from '../../src/platform/storage/storage.service';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/bkAAAAASUVORK5CYII=', 'base64');
const sourceUrl = 'https://www.cerave.com/skincare/moisturizers/moisturizing-cream';

// All evidence, stock, image bytes and prices are synthetic and confined to a disposable DB.
describe('Product readiness: source -> human review -> catalog -> public PDP', () => {
  jest.setTimeout(60000);
  let app: INestApplication;
  let db: PrismaService;
  let supplierId: string;
  let catalog: CatalogService;
  let ingestion: IngestionService;
  const run = randomUUID();
  const tokens: Record<string, string> = {};
  const jobs: string[] = [];
  const products: string[] = [];
  const customers: string[] = [];
  let mainSku: string;
  let secondSku: string;
  let productId: string;
  let itemId: string;
  const row = (n = 1) => ({ supplierSkuCode: `READY-${run}-${n}`, name: `Readiness Cream ${run}-${n}`,
    brand: `Readiness ${run}`, barcode: `ready-${run}-${n}`, price: 31, currency: 'EGP', sourceRow: n + 1 });
  const auth = (role = 'ADMIN') => ({ Authorization: `Bearer ${tokens[role]}` });

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useValue({ enrichProduct: async () => ({ suggestions: { description: 'UNREVIEWED_AI_CLAIM' } }) })
      .overrideProvider(DataRetentionService).useValue({})
      .overrideProvider(OutboxService).useValue({ enqueue: async () => undefined }).compile();
    app = module.createNestApplication(); app.useLogger(false);
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init(); db = app.get(PrismaService); catalog = app.get(CatalogService); ingestion = app.get(IngestionService);
    supplierId = (await db.supplier.create({ data: { name: `Readiness ${run}`, slug: `ready-${run}` } })).id;
    for (const role of ['ADMIN', 'CUSTOMER', 'SUPPLIER']) {
      const user = await db.customer.create({ data: { name: 'Fixture', email: `${run}-${role}@ready.test`, roles: [role],
        supplierId: role === 'SUPPLIER' ? supplierId : null } });
      customers.push(user.id);
      tokens[role] = (await db.session.create({ data: { customerId: user.id, token: randomUUID(), expiresAt: new Date(Date.now() + 3600000) } })).token;
    }
  });

  afterAll(async () => {
    if (db) {
      const skus = await db.sku.findMany({ where: { productId: { in: products } } });
      const ids = skus.map(s => s.id);
      await db.listing.deleteMany({ where: { skuId: { in: ids } } });
      await db.sellingPrice.deleteMany({ where: { skuId: { in: ids } } });
      await db.supplierOffer.deleteMany({ where: { supplierId } });
      await db.supplierSkuAlias.deleteMany({ where: { supplierId } });
      await db.ingestionJob.deleteMany({ where: { supplierId } });
      await db.productMedia.deleteMany({ where: { productId: { in: products } } });
      await db.sku.deleteMany({ where: { id: { in: ids } } });
      await db.product.deleteMany({ where: { id: { in: products } } });
      await db.brand.deleteMany({ where: { slug: `readiness-${run}` } });
      await db.customer.deleteMany({ where: { id: { in: customers } } });
      if (supplierId) await db.supplier.delete({ where: { id: supplierId } });
    }
    if (app) await app.close();
  });

  async function uploadSource(bytes = Buffer.from('supplierSkuCode,name,brand,barcode,price,currency\nfixture,cream,brand,barcode,31,EGP\n')) {
    const result = await request(app.getHttpServer()).post('/ingestion/jobs/upload').set(auth())
      .field('supplierId', supplierId).attach('file', bytes, { filename: 'supplier.csv', contentType: 'text/csv' }).expect(201);
    if (!jobs.includes(result.body.jobId)) jobs.push(result.body.jobId);
    return result.body;
  }

  async function reviewedCandidate(n: number, name?: string, size = 50) {
    const source = await uploadSource(Buffer.from(`source ${run} ${n}`));
    const result = await request(app.getHttpServer()).post('/ingestion/jobs').set(auth()).send({ supplierId,
      sourceJobId: source.jobId, items: [{ ...row(n), ...(name && { name }) }] }).expect(201);
    const item = result.body.items[0];
    const deadline = Date.now() + 5000;
    let persisted = await db.ingestionItem.findUniqueOrThrow({ where: { id: item.id } });
    while (persisted.enrichmentStatus === 'pending' && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 30));
      persisted = await db.ingestionItem.findUniqueOrThrow({ where: { id: item.id } });
    }
    await request(app.getHttpServer()).patch(`/ingestion/candidates/${item.id}/evidence`).set(auth()).send({ fields: [
      { field: 'size', sourceUrl, sourceType: 'OFFICIAL_MANUFACTURER', size, sizeUnit: 'ml', excerpt: `Synthetic package: ${size} ml` },
      { field: 'description', sourceUrl, sourceType: 'OFFICIAL_MANUFACTURER', value: 'Synthetic evidence: moisturizing cream', excerpt: 'Synthetic source excerpt' },
    ] }).expect(200);
    const media = await request(app.getHttpServer()).post(`/ingestion/candidates/${item.id}/media`).set(auth())
      .attach('file', png, { filename: 'packshot.png', contentType: 'image/png' }).expect(201);
    await request(app.getHttpServer()).patch(`/ingestion/candidates/${item.id}/approve`).set(auth()).send({ mediaReviews: [{
      url: media.body.url, sourceUrl, sourceType: 'OFFICIAL_MANUFACTURER', barcode: item.barcode, size, sizeUnit: 'ml', variantName: `${size} ml`,
    }] }).expect(200);
    return item;
  }

  async function makeSellable(skuId: string, amount: number) {
    await db.listing.create({ data: { skuId } });
    await db.sellingPrice.create({ data: { skuId, amount, currency: 'EGP', validFrom: new Date('2020-01-01') } });
    await db.supplierOffer.update({ where: { supplierId_skuId: { supplierId, skuId } }, data: { isAvailable: true, lastConfirmedAt: new Date() } });
  }

  it('reuses identical supplier originals and associates normalized rows without losing provenance', async () => {
    const source = await uploadSource();
    const repeated = await uploadSource();
    expect(repeated).toEqual(source);
    const payload = { supplierId, sourceJobId: source.jobId, items: [row(101)] };
    const result = await request(app.getHttpServer()).post('/ingestion/jobs').set(auth()).send(payload).expect(201);
    expect(result.body.id).toBe(source.jobId);
    const replay = await request(app.getHttpServer()).post('/ingestion/jobs').set(auth()).send(payload).expect(201);
    expect(replay.body.items.map((i: any) => i.id)).toEqual(result.body.items.map((i: any) => i.id));
    const persisted = await db.ingestionItem.findUniqueOrThrow({ where: { id: result.body.items[0].id } });
    expect(persisted.enrichment).toMatchObject({ source: { objectKey: source.sourceKey, row: 102 } });
    await request(app.getHttpServer()).get(`/storage/${source.sourceKey}`).expect(401);
    await request(app.getHttpServer()).get(`/storage/${source.sourceKey}`).set(auth('CUSTOMER')).expect(403);
    await request(app.getHttpServer()).get(`/storage/${source.sourceKey}`).set(auth('SUPPLIER')).expect(200);
    await request(app.getHttpServer()).post('/ingestion/jobs').set(auth()).send({ ...payload, items: [row(102)] }).expect(409);
    const storage = app.get(StorageService);
    await storage.deleteFile(source.sourceKey);
    expect(await storage.exists(source.sourceKey)).toBe(false);
    expect(await uploadSource()).toEqual(source);
    await request(app.getHttpServer()).get(`/storage/${source.sourceKey}`).set(auth('SUPPLIER')).expect(200);
    expect((await db.ingestionItem.findUniqueOrThrow({ where: { id: persisted.id } })).enrichment).toMatchObject({ source: { objectKey: source.sourceKey } });
  });

  it('rejects empty rows, ambiguous source rows, malformed currency and cross-supplier attachment', async () => {
    const source = await uploadSource(Buffer.from('validation source'));
    for (const items of [[], [{ ...row(), name: ' ' }], [{ ...row(), currency: 'EG' }], [row(), row()], [{ ...row(), sourceRow: 0 }]]) {
      await request(app.getHttpServer()).post('/ingestion/jobs').set(auth()).send({ supplierId, sourceJobId: source.jobId, items }).expect(400);
    }
    await request(app.getHttpServer()).post('/ingestion/jobs').set(auth()).send({ supplierId: randomUUID(), sourceJobId: source.jobId, items: [row()] }).expect(404);
    await request(app.getHttpServer()).post('/ingestion/jobs').send({ supplierId, items: [row()] }).expect(401);
    await request(app.getHttpServer()).post('/ingestion/jobs').set(auth('CUSTOMER')).send({ supplierId, items: [row()] }).expect(403);
  });

  it('publishes reviewed identity while withholding generated claims and procurement prices', async () => {
    const item = await reviewedCandidate(1); itemId = item.id;
    const published = await request(app.getHttpServer()).post(`/ingestion/candidates/${item.id}/publish`).set(auth()).expect(200);
    mainSku = published.body.matchedSkuId;
    const sku = await db.sku.findUniqueOrThrow({ where: { id: mainSku }, include: { product: true } });
    productId = sku.productId; products.push(productId);
    expect(sku.product.description).toBeNull();
    expect(sku.product.isPublished).toBe(false);
    await request(app.getHttpServer()).get(`/products/${productId}/detail`).expect(404);
    expect(await db.sellingPrice.count({ where: { skuId: mainSku } })).toBe(0);
    await makeSellable(mainSku, 125);
    await catalog.updateProduct(productId, { isPublished: true });
    const detail = await request(app.getHttpServer()).get(`/products/${productId}/detail`).expect(200);
    expect(detail.body.skus[0].price.amount).toBe(125);
    expect(JSON.stringify(detail.body)).not.toMatch(/UNREVIEWED_AI_CLAIM|costPrice|sourceKey|reviewedBy/);
  });

  it('requires source-backed Arabic human content review and returns it only for the exact published variant', async () => {
    const item = await reviewedCandidate(2, `Readiness Cream ${run}-1`, 100);
    const payload = { fields: [{ field: 'description', value: 'كريم مرطب', sourceUrl, sourceType: 'OFFICIAL_MANUFACTURER' }] };
    await request(app.getHttpServer()).patch(`/ingestion/candidates/${item.id}/content/review`).send(payload).expect(401);
    await request(app.getHttpServer()).patch(`/ingestion/candidates/${item.id}/content/review`).set(auth('SUPPLIER')).send(payload).expect(403);
    await request(app.getHttpServer()).patch(`/ingestion/candidates/${item.id}/content/review`).set(auth()).send({ fields: [{ ...payload.fields[0], field: 'warnings' }] }).expect(400);
    await request(app.getHttpServer()).patch(`/ingestion/candidates/${item.id}/content/review`).set(auth()).send(payload).expect(200);
    const result = await request(app.getHttpServer()).post(`/ingestion/candidates/${item.id}/publish`).set(auth()).expect(200);
    secondSku = result.body.matchedSkuId;
    await makeSellable(secondSku, 175);
    const detail = await request(app.getHttpServer()).get(`/products/${productId}/detail`).query({ skuId: secondSku }).expect(200);
    expect(detail.body.selectedVariant).toMatchObject({ id: secondSku, price: { amount: 175 }, content: { language: 'ar', description: 'كريم مرطب' } });
    expect(detail.body.selectedVariant.media.every((m: any) => m.skuId === secondSku)).toBe(true);
    expect(JSON.stringify(detail.body)).not.toMatch(/reviewedBy|enrichment|sourceKey|supplierId|costPrice/);
  });

  it('switches variant price, media, facts and content together; rejects foreign or malformed SKU IDs', async () => {
    const first = await request(app.getHttpServer()).get(`/products/${productId}`).query({ skuId: mainSku }).expect(200);
    const second = await request(app.getHttpServer()).get(`/products/${productId}/detail`).query({ skuId: secondSku }).expect(200);
    expect(first.body.selectedVariant).toMatchObject({ id: mainSku, price: { amount: 125 }, content: null });
    expect(second.body.selectedVariant).toMatchObject({ id: secondSku, size: 100, sizeUnit: 'ml', variantName: '100 ml', price: { amount: 175 } });
    expect(first.body.selectedVariant.media[0].url).not.toBe(second.body.selectedVariant.media[0].url);
    expect(second.body.selectedVariant.verifiedFacts.every((f: any) => f.skuId === secondSku)).toBe(true);
    await request(app.getHttpServer()).get(`/products/${productId}/detail`).query({ skuId: randomUUID() }).expect(404);
    await request(app.getHttpServer()).get(`/products/${productId}/detail`).query({ skuId: 'broken' }).expect(400);
    await request(app.getHttpServer()).get(`/products/${productId}/detail`).query({ supplierId }).expect(400);
  });

  it('rejects a selected variant with stale stock while preserving its fresh sibling', async () => {
    await db.supplierOffer.update({ where: { supplierId_skuId: { supplierId, skuId: secondSku } }, data: { lastConfirmedAt: new Date(Date.now() - 48 * 3600000) } });
    await request(app.getHttpServer()).get(`/products/${productId}/detail`).query({ skuId: secondSku }).expect(404);
    const result = await request(app.getHttpServer()).get(`/products/${productId}/detail`).query({ skuId: mainSku }).expect(200);
    expect(result.body.selectedVariant.availability.isFresh).toBe(true);
    await db.supplierOffer.update({ where: { supplierId_skuId: { supplierId, skuId: secondSku } }, data: { lastConfirmedAt: new Date() } });
  });

  it('advertises selection and the public detail response in Swagger', () => {
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Readiness').setVersion('1').build());
    const operation = doc.paths['/products/{slugOrId}/detail'].get!;
    expect(operation.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'skuId', in: 'query' })]));
    expect(operation.responses['200']).toHaveProperty('content.application/json.schema');
  });

  it('uses the Commerce promotion evaluator for a clearly scoped order preview on each variant', async () => {
    const promo = await db.promotion.create({ data: { campaignName: `Readiness-${run}`, benefitType: 'order_discount',
      discountType: 'percentage', discountValue: 10, validFrom: new Date('2020-01-01') } });
    try {
      const first = await request(app.getHttpServer()).get(`/products/${productId}/detail`).query({ skuId: mainSku }).expect(200);
      const second = await request(app.getHttpServer()).get(`/products/${productId}/detail`).query({ skuId: secondSku }).expect(200);
      expect(first.body.selectedVariant.price.amount).toBe(125);
      expect(first.body.selectedVariant.promotions).toMatchObject({ context: 'single_item_order_preview', orderDiscountAmount: 12.5, subtotalAfterDiscount: 112.5,
        requiresCheckoutConfirmation: true, appliedPromotions: [{ promotionId: promo.id }] });
      expect(second.body.selectedVariant.promotions.orderDiscountAmount).toBe(17.5);
      await db.promotion.update({ where: { id: promo.id }, data: { validUntil: new Date('2020-01-02') } });
      const expired = await request(app.getHttpServer()).get(`/products/${productId}/detail`).query({ skuId: mainSku }).expect(200);
      expect(expired.body.selectedVariant.promotions.appliedPromotions).toEqual([]);
    } finally { await db.promotion.delete({ where: { id: promo.id } }); }
  });

  it('withholds legacy catalog content that has no source-backed human review', async () => {
    await catalog.updateProduct(productId, { description: 'UNREVIEWED_CATALOG_CLAIM', usage: 'UNREVIEWED_USAGE', warnings: 'UNREVIEWED_WARNING' });
    const result = await request(app.getHttpServer()).get(`/products/${productId}/detail`).query({ skuId: mainSku }).expect(200);
    expect(result.body).toMatchObject({ description: null, usage: null, warnings: null });
    const list = await request(app.getHttpServer()).get('/products').query({ brand: `readiness-${run}` }).expect(200);
    expect(JSON.stringify(list.body)).not.toMatch(/UNREVIEWED_CATALOG_CLAIM|UNREVIEWED_USAGE|UNREVIEWED_WARNING/);
  });

  it('prevents a concurrent candidate correction from publishing an obsolete approval', async () => {
    const item = await reviewedCandidate(3);
    const storage = app.get(StorageService);
    const original = storage.copyToPublic.bind(storage);
    let release!: () => void;
    let reached!: () => void;
    const paused = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { reached = resolve; });
    const spy = jest.spyOn(storage, 'copyToPublic').mockImplementation(async (...args) => { reached(); await paused; return original(...args); });
    try {
      const publishing = request(app.getHttpServer()).post(`/ingestion/candidates/${item.id}/publish`).set(auth()).then(r => r);
      await entered;
      const editing = request(app.getHttpServer()).patch(`/ingestion/candidates/${item.id}`).set(auth()).send({ name: 'Changed during publish' }).then(r => r);
      await Promise.race([editing, new Promise(resolve => setTimeout(resolve, 200))]);
      release();
      const published = await publishing;
      const edited = await editing;
      expect(published.status).toBe(200);
      const sku = await db.sku.findUniqueOrThrow({ where: { id: published.body.matchedSkuId } }); products.push(sku.productId);
      expect(edited.status).toBe(400);
      expect(await db.ingestionItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ status: 'published', name: item.name });
    } finally { release(); spy.mockRestore(); }
  });

  it('resumes a failed media publication without duplicating canonical identities or public media', async () => {
    const item = await reviewedCandidate(4);
    const storage = app.get(StorageService);
    const original = storage.copyToPublic.bind(storage);
    const spy = jest.spyOn(storage, 'copyToPublic').mockRejectedValueOnce(new Error('Fixture storage outage')).mockImplementation(original);
    try {
      await request(app.getHttpServer()).post(`/ingestion/jobs/${item.jobId}/publish`).set(auth()).expect(400);
      expect((await db.ingestionItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe('approved');
      const existing = await db.sku.findUniqueOrThrow({ where: { barcode: item.barcode } }); products.push(existing.productId);
      await request(app.getHttpServer()).get(`/products/${existing.productId}/detail`).expect(404);
      const published = await request(app.getHttpServer()).post(`/ingestion/jobs/${item.jobId}/publish`).set(auth()).expect(201);
      expect(published.body.items[0].matchedSkuId).toBe(existing.id);
      expect(await db.sku.count({ where: { barcode: item.barcode } })).toBe(1);
      expect(await db.productMedia.count({ where: { productId: existing.productId } })).toBe(1);
      await request(app.getHttpServer()).post(`/ingestion/jobs/${item.jobId}/publish`).set(auth()).expect(400);
    } finally { spy.mockRestore(); }
  });

  it('rejects invalid candidate corrections and supplier price precision before database writes', async () => {
    const item = await reviewedCandidate(5);
    for (const change of [{ name: ' ' }, { brand: '' }, { supplierSkuCode: '' }, { currency: 'EG' }, { price: 1e100 }, { price: 1.001 }]) {
      await request(app.getHttpServer()).patch(`/ingestion/candidates/${item.id}`).set(auth()).send(change).expect(400);
    }
    for (const price of [1e100, 1.001]) await request(app.getHttpServer()).post('/ingestion/jobs').set(auth())
      .send({ supplierId, items: [{ ...row(500), price }] }).expect(400);
    expect((await db.ingestionItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe('approved');
  });

  it('records human source evidence without AI, preserves provenance, and rejects unsupported sources and roles', async () => {
    const source = await uploadSource(Buffer.from('manual evidence source'));
    const created = await request(app.getHttpServer()).post('/ingestion/jobs').set(auth()).send({ supplierId, sourceJobId: source.jobId, items: [row(6)] }).expect(201);
    const id = created.body.items[0].id;
    const fields = [{ field: 'size', size: 50, sizeUnit: 'ml', sourceUrl, sourceType: 'OFFICIAL_MANUFACTURER', excerpt: 'Synthetic package label: 50 ml' },
      { field: 'description', value: 'Synthetic source describes a moisturizing cream', sourceUrl, sourceType: 'OFFICIAL_MANUFACTURER', excerpt: 'Synthetic source excerpt' }];
    await request(app.getHttpServer()).patch(`/ingestion/candidates/${id}/evidence`).send({ fields }).expect(401);
    await request(app.getHttpServer()).patch(`/ingestion/candidates/${id}/evidence`).set(auth('SUPPLIER')).send({ fields }).expect(403);
    await request(app.getHttpServer()).patch(`/ingestion/candidates/${id}/evidence`).set(auth()).send({ fields: [{ ...fields[0], sourceUrl: 'https://evil.example/claim' }] }).expect(400);
    await request(app.getHttpServer()).patch(`/ingestion/candidates/${id}/evidence`).set(auth()).send({ fields }).expect(200);
    const item = await db.ingestionItem.findUniqueOrThrow({ where: { id } });
    expect(item.enrichment).toMatchObject({ source: { objectKey: source.sourceKey }, research: { fieldEvidences: expect.arrayContaining([
      expect.objectContaining({ fieldName: 'size', proposedValue: { value: 50, unit: 'ml' }, verificationStatus: 'SUPPORTED', reviewedBy: customers[0] }),
    ]) } });
  });

  it('supports a deterministic 12-product pilot through the actual authenticated batch flow', async () => {
    const items = Array.from({ length: 12 }, (_, n) => ({ ...row(200 + n), sourceRow: n + 2 }));
    const csv = ['supplierSkuCode,name,brand,barcode,price,currency', ...items.map(i =>
      [i.supplierSkuCode, i.name, i.brand, i.barcode, i.price, i.currency].join(','))].join('\n');
    const source = await uploadSource(Buffer.from(csv));
    const imported = await request(app.getHttpServer()).post('/ingestion/jobs').set(auth('SUPPLIER'))
      .send({ supplierId, sourceJobId: source.jobId, items }).expect(201);
    expect(imported.body.items).toHaveLength(12);
    await request(app.getHttpServer()).post(`/ingestion/jobs/${source.jobId}/publish`).set(auth()).expect(400);
    for (const item of imported.body.items) {
      let current = await db.ingestionItem.findUniqueOrThrow({ where: { id: item.id } });
      const deadline = Date.now() + 5000;
      while (current.enrichmentStatus === 'pending' && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 20));
        current = await db.ingestionItem.findUniqueOrThrow({ where: { id: item.id } });
      }
      await request(app.getHttpServer()).patch(`/ingestion/candidates/${item.id}/evidence`).set(auth()).send({ fields: [{
        field: 'size', sourceUrl, sourceType: 'OFFICIAL_MANUFACTURER', size: 50, sizeUnit: 'ml', excerpt: 'Synthetic package: 50 ml',
      }] }).expect(200);
      const media = await request(app.getHttpServer()).post(`/ingestion/candidates/${item.id}/media`).set(auth())
        .attach('file', png, { filename: 'packshot.png', contentType: 'image/png' }).expect(201);
      await request(app.getHttpServer()).patch(`/ingestion/candidates/${item.id}/approve`).set(auth()).send({ mediaReviews: [{
        url: media.body.url, sourceUrl, sourceType: 'OFFICIAL_MANUFACTURER', barcode: item.barcode, size: 50, sizeUnit: 'ml', variantName: '50 ml',
      }] }).expect(200);
    }
    const published = await request(app.getHttpServer()).post(`/ingestion/jobs/${source.jobId}/publish`).set(auth()).expect(201);
    expect(published.body.status).toBe('published');
    const pilotSkus: string[] = [];
    for (const item of published.body.items) {
      expect(item.status).toBe('published');
      const sku = await db.sku.findUniqueOrThrow({ where: { id: item.matchedSkuId } });
      pilotSkus.push(sku.id); products.push(sku.productId);
      await request(app.getHttpServer()).get(`/products/${sku.productId}/detail`).expect(404);
      await makeSellable(sku.id, 99);
      await request(app.getHttpServer()).patch(`/products/${sku.productId}`).set(auth()).send({ isPublished: true }).expect(200);
      const detail = await request(app.getHttpServer()).get(`/products/${sku.productId}/detail`).query({ skuId: sku.id }).expect(200);
      expect(detail.body.selectedVariant).toMatchObject({ id: sku.id, price: { amount: 99, currency: 'EGP' }, canOrder: true });
      expect(detail.body.selectedVariant.media).toHaveLength(1);
      expect(JSON.stringify(detail.body)).not.toMatch(/UNREVIEWED_AI_CLAIM|costPrice|supplierId|sourceKey|reviewedBy/);
    }
    await request(app.getHttpServer()).post(`/ingestion/jobs/${source.jobId}/publish`).set(auth()).expect(400);
    await request(app.getHttpServer()).post(`/ingestion/candidates/${published.body.items[0].id}/publish`).set(auth()).expect(400);
    expect(await db.sku.count({ where: { id: { in: pilotSkus } } })).toBe(12);
    expect(await db.productMedia.count({ where: { productId: { in: products.slice(-12) } } })).toBe(12);
    const replay = await request(app.getHttpServer()).post('/ingestion/jobs').set(auth('SUPPLIER'))
      .send({ supplierId, sourceJobId: source.jobId, items }).expect(201);
    expect(replay.body.items.map((i: any) => i.id).sort()).toEqual(published.body.items.map((i: any) => i.id).sort());
  });
});
