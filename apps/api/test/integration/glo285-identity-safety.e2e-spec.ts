import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { IngestionService } from '../../src/modules/ingestion/services/ingestion.service';
import { ProductIdentityService } from '../../src/modules/ingestion/services/product-identity.service';
import { OfferBatchCommitService } from '../../src/modules/ingestion/services/offer-batch-commit.service';
import { createActor, Actor } from '../fixtures/actors';

describe('GLO-285 P0 final identity boundary (disposable PostgreSQL)', () => {
  let app: INestApplication, db: PrismaService, ingestion: IngestionService, identity: ProductIdentityService;
  let admin: Actor, supplier: string, sku: string, brand: string, job: string;
  const marker = randomUUID();
  const payload = `29${BigInt(`0x${marker.replace(/-/g, '').slice(0, 12)}`).toString().padStart(11, '0').slice(-10)}`;
  const sum = [...payload].reverse().reduce((total, n, i) => total + Number(n) * (i % 2 ? 1 : 3), 0);
  const barcode = payload + ((10 - sum % 10) % 10);
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); app.useLogger(false); await app.init();
    db = app.get(PrismaService); ingestion = app.get(IngestionService); identity = app.get(ProductIdentityService);
    const database = new URL(process.env.DATABASE_URL!).pathname.slice(1);
    expect(database).toMatch(/_test$/);
    expect(await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`)
      .toEqual([{ name: database }]);
    admin = await createActor(db, 'ADMIN');
    supplier = (await db.supplier.create({ data: { name: marker, slug: marker } })).id;
    brand = (await db.brand.create({ data: { name: `P0 ${marker}`, slug: marker } })).id;
    const product = await db.product.create({ data: { name: 'Test Cleanser', slug: marker, brandId: brand } });
    sku = (await db.sku.create({ data: { productId: product.id, code: marker, barcode,
      size: 236, sizeUnit: 'ml', variantName: 'Default' } })).id;
    await db.supplierSkuAlias.create({ data: { supplierId: supplier, supplierSkuCode: 'REVIEWED', skuId: sku } });
    job = (await db.ingestionJob.create({ data: { supplierId: supplier, status: 'approved' } })).id;
  });
  afterAll(async () => {
    if (db && job) {
      await db.supplierOffer.deleteMany({ where: { supplierId: supplier } });
      await db.supplierSkuAlias.deleteMany({ where: { supplierId: supplier } });
      await db.ingestionItem.deleteMany({ where: { jobId: job } });
      await db.ingestionJob.delete({ where: { id: job } });
      await db.skuBarcodeAlias.deleteMany({ where: { sku: { product: { brandId: brand } } } });
      await db.sku.deleteMany({ where: { product: { brandId: brand } } });
      await db.product.deleteMany({ where: { brandId: brand } });
      await db.brand.delete({ where: { id: brand } });
      await db.supplier.delete({ where: { id: supplier } });
    }
    if (app) await app.close();
  });
  async function candidate(stored = true, name = 'Test Retinol Serum') {
    return db.ingestionItem.create({ data: { jobId: job, supplierSkuCode: randomUUID(), name,
      brand: `P0 ${marker}`, barcode, price: 100, currency: 'EGP',
      priceType: 'PURCHASE_COST', reportedQuantity: null, status: 'approved', matchedSkuId: stored ? sku : null,
      enrichment: { source: { normalized: { extractedSize: 236, extractedUnit: 'ml' },
        eligibility: { outcome: 'ALLOW', policyId: randomUUID(), version: 1, brandId: brand,
          brandName: `P0 ${marker}`, categoryId: randomUUID() } } } } });
  }
  const counts = async () => ({ products: await db.product.count(), skus: await db.sku.count(),
    aliases: await db.supplierSkuAlias.count(), offers: await db.supplierOffer.count() });
  const formats = [(s: string) => s, (s: string) => `  ${s}  `, (s: string) => s.replace(/ /g, '  '),
    (s: string) => `${s}.`, (s: string) => `(${s})`, (s: string) => `${s} !`, (s: string) => `${s} /`, (s: string) => `${s} -`];
  for (const [index, format] of formats.entries()) {
    it.each([[true, 'Test Retinol Serum', false], [true, 'سيرافي بتاع الحبوب', true],
      [false, 'Test Retinol Serum', false]])(`PostgreSQL unsafe baseline formatting ${index}: %s %s`, async (alias, name, vague) => {
      const result = await identity.classifyCandidateMatch({ eligibilityApproved: true, supplierId: supplier,
        supplierSkuCode: alias ? 'REVIEWED' : 'NEW', brand: `P0 ${marker}`, name: format(name),
        size: vague ? null : 236, sizeUnit: vague ? null : 'ml', barcode: alias ? null : barcode });
      expect(result.matchedSkuId).toBeNull(); expect(result.classification).not.toBe('EXACT_MATCH');
    });
    it.each([true, false])(`PostgreSQL exact control formatting ${index}: alias=%s`, async alias => {
      expect(await identity.classifyCandidateMatch({ eligibilityApproved: true, supplierId: supplier,
        supplierSkuCode: alias ? 'REVIEWED' : 'NEW', brand: `P0 ${marker}`, name: format('Test Cleanser'),
        size: 236, sizeUnit: 'ml', barcode: alias ? null : barcode }))
        .toMatchObject({ classification: 'EXACT_MATCH', matchedSkuId: sku, identityState: 'VERIFIED_IDENTITY' });
    });
  }
  it('stored matchedSkuId cannot bypass Admin approval; failure writes no identity state', async () => {
    const item = await candidate(); const before = await counts();
    await expect(ingestion.approveItem(item.id, undefined, admin.id)).rejects.toThrow();
    expect(await counts()).toEqual(before);
  });
  it('approval creates no alias when the supplied media identity review contradicts the SKU', async () => {
    const item = await candidate(true, 'Test Cleanser'); const before = await counts();
    await expect(ingestion.approveItem(item.id, { matchedSkuId: sku, mediaReviews: [{
      url: 'https://www.cerave.com/p0-fixture.png', sourceUrl: 'https://www.cerave.com/skincare/cleansers',
      sourceType: 'OFFICIAL_MANUFACTURER', barcode, size: 473, sizeUnit: 'ml', variantName: 'Default',
    }] }, admin.id)).rejects.toThrow();
    expect(await counts()).toEqual(before);
  });
  it('publication creates no alias when stored reviewed packaging contradicts the SKU', async () => {
    const item = await candidate(true, 'Test Cleanser');
    await db.ingestionItem.update({ where: { id: item.id }, data: { enrichment: {
      ...(item.enrichment as Record<string, Prisma.JsonValue>), media: [{ originType: 'verified', isTest: false,
        url: 'https://www.cerave.com/p0-fixture.png', review: { candidateId: item.id, reviewedBy: admin.id,
          reviewedAt: new Date().toISOString(), isTest: false, barcode, size: 473, sizeUnit: 'ml', variantName: 'Default',
          sourceType: 'OFFICIAL_MANUFACTURER', sourceUrl: 'https://www.cerave.com/skincare/cleansers' } }],
    } } });
    const before = await counts();
    const ready = jest.spyOn(ingestion, 'getCandidateReviewRecord').mockResolvedValue({ canPublish: true } as never);
    await expect(ingestion.publishCandidate(item.id, admin.id)).rejects.toThrow();
    expect(await counts()).toEqual(before); ready.mockRestore();
  });
  it('new SKU publication validates source against reviewed packaging before catalog creation', async () => {
    const item = await candidate(false, 'Completely New Cleanser');
    await db.ingestionItem.update({ where: { id: item.id }, data: { barcode: '036000291452', enrichment: {
      ...(item.enrichment as Record<string, Prisma.JsonValue>), media: [{ originType: 'verified', isTest: false,
        url: 'https://www.cerave.com/p0-new-fixture.png', review: { candidateId: item.id, reviewedBy: admin.id,
          reviewedAt: new Date().toISOString(), isTest: false, barcode: '036000291452', size: 473, sizeUnit: 'ml',
          variantName: 'Default', sourceType: 'OFFICIAL_MANUFACTURER', sourceUrl: 'https://www.cerave.com/skincare/cleansers' } }],
    } } });
    const before = await counts();
    const ready = jest.spyOn(ingestion, 'getCandidateReviewRecord').mockResolvedValue({ canPublish: true } as never);
    await expect(ingestion.publishCandidate(item.id, admin.id)).rejects.toThrow();
    expect(await counts()).toEqual(before); ready.mockRestore();
  });
  it.each([true, false])('publication blocks stored-ID/barcode reuse before writes (stored=%s)', async stored => {
    const item = await candidate(stored); const before = await counts();
    // Isolate the identity boundary from unrelated media/content readiness checks.
    const ready = jest.spyOn(ingestion, 'getCandidateReviewRecord').mockResolvedValue({ canPublish: true } as never);
    await expect(ingestion.publishCandidate(item.id, admin.id)).rejects.toThrow(/CONFLICT|EVIDENCE|identity/i);
    expect(await counts()).toEqual(before); ready.mockRestore();
  });
  it('direct candidate offer commit cannot trust a stale stored association', async () => {
    const item = await candidate(); const before = await counts();
    await expect(app.get(OfferBatchCommitService).commitCandidateOffer(item.id, sku)).rejects.toThrow();
    expect(await counts()).toEqual(before);
  });
  it('batch offer commit also revalidates stored associations and rolls back unsafe writes', async () => {
    await candidate(); const before = await counts();
    await expect(app.get(OfferBatchCommitService).commitJobOffers(job,
      { autoApplyLowRisk: true, allowPriceOnlyUpdates: true, actorId: admin.id })).rejects.toThrow(/EXPLICIT_CONFLICT/);
    expect(await counts()).toEqual(before);
  });
  it('invalid checksum is rejected before publication catalog creation', async () => {
    const item = await candidate(false, 'Test New Cleanser');
    await db.ingestionItem.update({ where: { id: item.id }, data: { barcode: '1234567890123' } });
    const before = await counts();
    const ready = jest.spyOn(ingestion, 'getCandidateReviewRecord').mockResolvedValue({ canPublish: true } as never);
    await expect(ingestion.publishCandidate(item.id, admin.id)).rejects.toThrow(/gtin|CONFLICT/i);
    expect(await counts()).toEqual(before); ready.mockRestore();
  });
  it('non-Admin cannot approve or publish a stored association', async () => {
    const actor = await createActor(db, 'HUB_OPERATOR'); const item = await candidate();
    await expect(ingestion.approveItem(item.id, undefined, actor.id)).rejects.toThrow('Only Admin');
    await expect(ingestion.publishCandidate(item.id, actor.id)).rejects.toThrow('Only Admin');
  });
  it('same-name barcode identity passes the final read-only boundary', async () => {
    const item = await candidate(true, 'Test Cleanser');
    await expect(identity.assertSkuAssociation({ supplierId: supplier, supplierSkuCode: item.supplierSkuCode,
      name: item.name, brand: item.brand, barcode: item.barcode, size: 236, sizeUnit: 'ml' }, sku)).resolves.toBeUndefined();
  });
  it('a reviewed barcode alias passes the same final identity boundary', async () => {
    await db.skuBarcodeAlias.create({ data: { skuId: sku, barcode: '96385074', source: 'manufacturer_list',
      approvedBy: admin.id, reason: 'Synthetic checked EAN-8 fixture' } });
    const input = { supplierId: supplier, supplierSkuCode: 'ALT-BARCODE', name: 'Test Cleanser',
      brand: `P0 ${marker}`, barcode: '96385074', size: 236, sizeUnit: 'ml' };
    expect(await identity.classifyCandidateMatch(input)).toMatchObject({ classification: 'EXACT_MATCH', matchedSkuId: sku });
    await expect(identity.assertSkuAssociation(input, sku)).resolves.toBeUndefined();
  });
  it('reviewed English and Arabic aliases retain nonliteral descriptions with physical corroboration', async () => {
    for (const name of ['Test Face Wash 236ml', 'غسول تيست ٢٣٦ مل']) {
      expect(await identity.classifyCandidateMatch({ eligibilityApproved: true, supplierId: supplier,
        supplierSkuCode: 'REVIEWED', name, brand: `P0 ${marker}`, size: 236, sizeUnit: 'ml' }))
        .toMatchObject({ classification: 'EXACT_MATCH', matchedSkuId: sku });
    }
  });
});
