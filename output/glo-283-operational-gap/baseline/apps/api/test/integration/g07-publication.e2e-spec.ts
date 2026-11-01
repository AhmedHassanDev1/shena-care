// GLO-279 Gate 07 — reviewer-confirmed usage rules and evidence-backed concentrations survive publication, via HTTP.
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { FILE_STORAGE_PORT, FileStoragePort } from '../../src/platform/storage/storage.port';
import { AiClient } from '../../src/platform/ai';
import { OfferBatchCommitService } from '../../src/modules/ingestion/services/offer-batch-commit.service';
import { createActor, Actor } from '../fixtures/actors';
import { reviewCandidateMedia, FIXTURE_PNG } from '../fixtures/candidate-review';

const HEADER = 'Code,Item,Brand,Barcode,Cost EGP,On Hand';
const semantics = { documentKind: 'STOCK_FEED', priceBasis: 'UNIT_PURCHASE_COST', quantityBasis: 'ON_HAND' };
const mapping = { supplierSku: 'Code', name: 'Item', brand: 'Brand', barcode: 'Barcode', price: 'Cost EGP', quantity: 'On Hand', semantics };
const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
const DOC_URL = 'https://docs.manufacturer.example/g07-serum-specification.pdf';

describe('GLO-279 Gate 07: verified product intelligence through publication (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storagePort: FileStoragePort;
  let admin: Actor, supplier1: Actor, supplier2: Actor;
  const s1 = randomUUID();
  const s2 = randomUUID();
  const run = randomUUID().slice(0, 8);
  const RUN = run.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const brandName = `G07 Brand ${run}`;
  const bcSerum = `29${digits(11)}`;
  const bcCream = `29${digits(11)}`;
  const inci = { A: `G07ACTIVEA${RUN}`, B: `G07ACTIVEB${RUN}`, C: `G07ACTIVEC${RUN}` };
  const ingredientIds: Record<'A' | 'B' | 'C', string> = { A: '', B: '', C: '' };
  let brandId: string;
  let serumItemId: string, serumSkuId: string, serumProductId: string;
  const server = () => app.getHttpServer();

  /** Supplier file → approved mapping → matching: returns the admitted candidate row. */
  const admit = async (actor: Actor, row: string) => {
    const res = await request(server()).post('/ingestion/jobs/upload').set(actor.auth)
      .attach('file', Buffer.from(`${HEADER}\n${row}\n`), { filename: `${randomUUID()}.csv`, contentType: 'text/csv' });
    if (res.body.requiresMapping) await request(server()).post(`/ingestion/jobs/${res.body.jobId}/mapping`).set(admin.auth).send({ mapping });
    return prisma.ingestionItem.findFirstOrThrow({ where: { jobId: res.body.jobId } });
  };
  const uploadLabel = async (itemId: string) => (await request(server()).post(`/ingestion/candidates/${itemId}/media`).set(admin.auth)
    .attach('file', FIXTURE_PNG, { filename: 'back-label.png', contentType: 'image/png' }).expect(201)).body.url as string;
  const evidence = (itemId: string, fields: object[]) =>
    request(server()).patch(`/ingestion/candidates/${itemId}/evidence`).set(admin.auth).send({ fields });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    storagePort = app.get(FILE_STORAGE_PORT);
    jest.spyOn(app.get(AiClient), 'enrichProduct').mockRejectedValue(new Error('AI disabled in Gate 07 tests'));
    await prisma.supplier.create({ data: { id: s1, name: `G07 Supplier 1 ${run}`, slug: `g07-s1-${run}` } });
    await prisma.supplier.create({ data: { id: s2, name: `G07 Supplier 2 ${run}`, slug: `g07-s2-${run}` } });
    brandId = (await prisma.brand.create({ data: { name: brandName, slug: `g07-brand-${run}` } })).id;
    for (const key of ['A', 'B', 'C'] as const) {
      ingredientIds[key] = (await prisma.ingredient.create({ data: { name: `G07 Active ${key} ${run}`, slug: `g07-active-${key.toLowerCase()}-${run}`,
        inciName: inci[key], primaryFunction: 'Humectant', status: 'APPROVED' } })).id;
    }
    admin = await createActor(prisma, 'ADMIN');
    supplier1 = await createActor(prisma, 'SUPPLIER', s1);
    supplier2 = await createActor(prisma, 'SUPPLIER', s2);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    const suppliers = [s1, s2];
    const products = await prisma.product.findMany({ where: { brandId }, include: { skus: true, media: true } });
    const skuIds = products.flatMap(p => p.skus.map(s => s.id));
    for (const media of products.flatMap(p => p.media)) {
      const key = media.url.split('/storage/')[1];
      if (key) await storagePort.delete(key);
    }
    for (const job of await prisma.ingestionJob.findMany({ where: { supplierId: { in: suppliers } }, include: { items: true } })) {
      if (job.sourceKey) await storagePort.delete(job.sourceKey);
      for (const item of job.items) {
        for (const media of ((item.enrichment as { media?: Array<{ url: string }> } | null)?.media ?? [])) {
          const key = media.url.split('/storage/')[1];
          if (key) await storagePort.delete(key);
        }
      }
    }
    await prisma.supplierOffer.deleteMany({ where: { supplierId: { in: suppliers } } });
    await prisma.supplierSkuAlias.deleteMany({ where: { supplierId: { in: suppliers } } });
    await prisma.sellingPrice.deleteMany({ where: { skuId: { in: skuIds } } });
    await prisma.listing.deleteMany({ where: { skuId: { in: skuIds } } });
    await prisma.productMedia.deleteMany({ where: { productId: { in: products.map(p => p.id) } } });
    await prisma.productUsageRule.deleteMany({ where: { productId: { in: products.map(p => p.id) } } });
    await prisma.productIngredient.deleteMany({ where: { productId: { in: products.map(p => p.id) } } });
    await prisma.sku.deleteMany({ where: { id: { in: skuIds } } });
    await prisma.product.deleteMany({ where: { brandId } });
    await prisma.brand.deleteMany({ where: { id: brandId } });
    await prisma.ingredient.deleteMany({ where: { id: { in: Object.values(ingredientIds).filter(Boolean) } } });
    await prisma.ingestionItem.deleteMany({ where: { job: { supplierId: { in: suppliers } } } });
    await prisma.ingestionJob.deleteMany({ where: { supplierId: { in: suppliers } } });
    await prisma.exportProfile.deleteMany({ where: { supplierId: { in: suppliers } } });
    const actors = [admin, supplier1, supplier2].map(a => a.id);
    await prisma.session.deleteMany({ where: { customerId: { in: actors } } });
    await prisma.customer.deleteMany({ where: { id: { in: actors } } });
    await prisma.supplier.deleteMany({ where: { id: { in: suppliers } } });
    await app.close();
  });

  it('approves a candidate with label directions, document INCI and confirmed usage rules', async () => {
    const item = await admit(supplier1, `G07-1,G07 Calm Serum 30ml,${brandName},${bcSerum},100.00,5`);
    serumItemId = item.id;
    const mediaReviews = await reviewCandidateMedia(app, admin.auth, item.id, bcSerum, 30, 'ml');
    const labelUrl = await uploadLabel(item.id);
    const recorded = await evidence(item.id, [
      { field: 'usage', evidenceKind: 'PRODUCT_LABEL', labelMediaUrl: labelUrl, sourceType: 'OFFICIAL_MANUFACTURER', marketVersion: 'EG 2026',
        value: `Apply to face once daily in the evening. Apply to the scalp twice a week. Avoid contact with eyes. Contains ${inci.C} 4%.`,
        excerpt: 'Back label, directions panel' },
      { field: 'ingredients', evidenceKind: 'MANUFACTURER_DOCUMENT', sourceUrl: DOC_URL, sourceType: 'OFFICIAL_MANUFACTURER',
        value: `Aqua, ${inci.A} 5%, ${inci.B}, ${inci.C} 3%`, excerpt: 'Specification sheet, composition table' },
    ]);
    expect(recorded.status).toBe(200);
    await request(server()).post(`/ingestion/candidates/${item.id}/enrich-ingredients`).set(admin.auth)
      .send({ rawIngredients: `Aqua, ${inci.A} 5%, ${inci.B} 2%, ${inci.C} 3%` }).expect(201);
    const approved = await request(server()).patch(`/ingestion/candidates/${item.id}/approve`).set(admin.auth)
      .send({ mediaReviews, approvedIngredientIds: Object.values(ingredientIds), confirmUsageRules: true });
    expect(approved.status).toBe(200);
    const review = ((await prisma.ingestionItem.findUniqueOrThrow({ where: { id: item.id } })).enrichment as { catalogReview: Record<string, unknown[] | string | undefined> }).catalogReview;
    expect(review.usageRulesStatus).toBe('CONFIRMED');
    expect(review.usageRules).toHaveLength(2);
    expect(review.concentrations).toEqual([expect.objectContaining({ ingredientId: ingredientIds.A, value: 5, unit: '%' })]);
    expect(review.unverifiedConcentrations).toEqual(expect.arrayContaining([
      expect.objectContaining({ ingredientId: ingredientIds.B, reason: 'not_stated_in_official_evidence' }),
      expect.objectContaining({ ingredientId: ingredientIds.C, reason: 'contradictory_official_evidence' }),
    ]));
  });

  it('leaves no visible or duplicated catalog state when publication fails midway, and converges on retry', async () => {
    jest.spyOn(app.get(OfferBatchCommitService), 'commitCandidateOffer').mockRejectedValueOnce(new ConflictException('simulated offer failure'));
    const failed = await request(server()).post(`/ingestion/candidates/${serumItemId}/publish`).set(admin.auth);
    expect(failed.status).toBe(409);
    expect((await prisma.ingestionItem.findUniqueOrThrow({ where: { id: serumItemId } })).status).toBe('approved');
    const halfway = await prisma.sku.findMany({ where: { barcode: bcSerum }, include: { product: true } });
    expect(halfway.every(s => !s.product.isPublished)).toBe(true); // never publicly visible
    expect(await prisma.productUsageRule.count({ where: { product: { brandId } } })).toBe(0);

    const published = await request(server()).post(`/ingestion/candidates/${serumItemId}/publish`).set(admin.auth);
    expect(published.status).toBe(200);
    serumSkuId = published.body.matchedSkuId;
    const sku = await prisma.sku.findUniqueOrThrow({ where: { id: serumSkuId } });
    serumProductId = sku.productId;
    expect(await prisma.sku.count({ where: { barcode: bcSerum } })).toBe(1);
    expect(await prisma.product.count({ where: { brandId } })).toBe(1);
    expect(await prisma.productMedia.count({ where: { productId: serumProductId } })).toBe(1);
    expect(await prisma.supplierOffer.count({ where: { supplierId: s1, skuId: serumSkuId } })).toBe(1);

    const again = await request(server()).post(`/ingestion/candidates/${serumItemId}/publish`).set(admin.auth);
    expect(again.status).toBe(400); // already published: no second write
    expect(await prisma.productUsageRule.count({ where: { skuId: serumSkuId } })).toBe(2);
  });

  it('persists the reviewer-confirmed rules and only the evidence-backed concentration', async () => {
    const rules = await prisma.productUsageRule.findMany({ where: { skuId: serumSkuId }, orderBy: { targetArea: 'asc' } });
    expect(rules).toEqual([
      expect.objectContaining({ targetArea: 'FACE', routinePeriod: 'PM', frequencyUnit: 'DAY', usesMin: 1, usesMax: 1,
        sourceType: 'OFFICIAL_MANUFACTURER', reviewedBy: admin.id, sourceCandidateId: serumItemId }),
      expect.objectContaining({ targetArea: 'SCALP', frequencyUnit: 'WEEK', usesMin: 2, usesMax: 2 }),
    ]);
    expect(rules.every(r => r.sourceUrl.includes('/storage/private/'))).toBe(true); // the label photo, not a web page
    const links = await prisma.productIngredient.findMany({ where: { productId: serumProductId } });
    const a = links.find(l => l.ingredientId === ingredientIds.A)!;
    expect(a.concentrationValue?.toNumber()).toBe(5);
    expect(a.concentrationUnit).toBe('%');
    expect(a.concentrationEvidence).toMatchObject({ sourceUrl: DOC_URL, sourceType: 'OFFICIAL_MANUFACTURER', reviewedBy: admin.id });
    for (const key of ['B', 'C'] as const) {
      const link = links.find(l => l.ingredientId === ingredientIds[key])!;
      expect(link.concentrationValue).toBeNull(); // unsupported (B) and contradictory (C) stay UNKNOWN
    }
  });

  it('exposes the verified rules through the public product detail API once Stage 08 makes the product sellable', async () => {
    // Stage 08 decisions (publication, listing, approved selling price) are owner actions outside Gate 07; set as fixtures here.
    await prisma.product.update({ where: { id: serumProductId }, data: { isPublished: true } });
    await prisma.listing.create({ data: { skuId: serumSkuId, isListed: true, listedAt: new Date() } });
    await prisma.sellingPrice.create({ data: { skuId: serumSkuId, amount: 250, currency: 'EGP', validFrom: new Date(Date.now() - 60000) } });
    // Public availability needs an explicit supplier availability confirmation (a reported file quantity is only a signal).
    await prisma.supplierOffer.updateMany({ where: { supplierId: s1, skuId: serumSkuId }, data: { lastConfirmedAt: new Date() } });
    const detail = await request(server()).get(`/products/${serumProductId}/detail`);
    expect(detail.status).toBe(200);
    const sku = detail.body.skus.find((s: { id: string }) => s.id === serumSkuId);
    expect(sku.usageRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetArea: 'FACE', routinePeriod: 'PM', frequencyUnit: 'DAY', usesMax: 1 }),
      expect.objectContaining({ targetArea: 'SCALP', frequencyUnit: 'WEEK', usesMax: 2 }),
    ]));
  });

  it('never overwrites reviewed rules when a second supplier\'s candidate for the same SKU is published', async () => {
    const item = await admit(supplier2, `G07-2,G07 Calm Serum 30ml,${brandName},${bcSerum},95.00,3`);
    expect(item.matchedSkuId).toBe(serumSkuId); // same product, linked not duplicated
    const mediaReviews = await reviewCandidateMedia(app, admin.auth, item.id, bcSerum, 30, 'ml');
    const labelUrl = await uploadLabel(item.id);
    await evidence(item.id, [{ field: 'usage', evidenceKind: 'PRODUCT_LABEL', labelMediaUrl: labelUrl, sourceType: 'OFFICIAL_MANUFACTURER',
      value: 'Apply twice daily, morning and evening.', excerpt: 'Different market label' }]).expect(200);
    await request(server()).patch(`/ingestion/candidates/${item.id}/approve`).set(admin.auth)
      .send({ mediaReviews, confirmUsageRules: true }).expect(200);
    await request(server()).post(`/ingestion/candidates/${item.id}/publish`).set(admin.auth).expect(200);
    const rules = await prisma.productUsageRule.findMany({ where: { skuId: serumSkuId } });
    expect(rules).toHaveLength(2);
    expect(rules.every(r => r.sourceCandidateId === serumItemId)).toBe(true);
    const enrichment = (await prisma.ingestionItem.findUniqueOrThrow({ where: { id: item.id } })).enrichment as Record<string, unknown>;
    expect(enrichment.usageRulesNotApplied).toBe('sku_already_has_reviewed_usage_rules');
    expect(await prisma.sku.count({ where: { barcode: bcSerum } })).toBe(1);
  });

  it('publishes a product without verified directions, inventing no usage rules', async () => {
    const item = await admit(supplier1, `G07-3,G07 Night Cream 50ml,${brandName},${bcCream},120.00,4`);
    const mediaReviews = await reviewCandidateMedia(app, admin.auth, item.id, bcCream, 50, 'ml');
    await request(server()).patch(`/ingestion/candidates/${item.id}/approve`).set(admin.auth)
      .send({ mediaReviews, confirmUsageRules: true }).expect(200);
    const review = ((await prisma.ingestionItem.findUniqueOrThrow({ where: { id: item.id } })).enrichment as { catalogReview: Record<string, unknown> }).catalogReview;
    expect(review.usageRulesStatus).toBe('NO_VERIFIED_DIRECTIONS');
    const published = await request(server()).post(`/ingestion/candidates/${item.id}/publish`).set(admin.auth).expect(200);
    expect(await prisma.productUsageRule.count({ where: { skuId: published.body.matchedSkuId } })).toBe(0);
  });
});
