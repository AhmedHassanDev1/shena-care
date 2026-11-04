// GLO-285: retrieval, routing and write boundaries against a real PostgreSQL. Synthetic entities only.
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { IngestionService } from '../../src/modules/ingestion/services/ingestion.service';
import { CandidateItemIdentityInput, ProductIdentityService } from '../../src/modules/ingestion/services/product-identity.service';
import { OfferBatchCommitService } from '../../src/modules/ingestion/services/offer-batch-commit.service';
import { createActor, Actor } from '../fixtures/actors';
import { gtin } from '../fixtures/glo285-matching-corpus';

describe('GLO-285 layered SKU matching (disposable PostgreSQL)', () => {
  let app: INestApplication, db: PrismaService, ingestion: IngestionService, identity: ProductIdentityService;
  let admin: Actor, supplierA: string, supplierB: string, brandId: string, jobA: string, jobB: string;
  const marker = randomUUID().slice(0, 8);
  const brandName = `Glo${marker}`;
  const barcodeOf = (n: number) => gtin(`29${parseInt(marker, 16).toString().padStart(9, '0').slice(-9)}${n}`);
  const skus: Record<string, string> = {};

  const product = async (name: string, packs: Array<{ key: string; size: number; unit: string; pack?: number; barcode?: string; spf?: number; variant?: string; active?: boolean }>) => {
    const created = await db.product.create({ data: { name, slug: `${marker}-${Object.keys(skus).length}`, brandId } });
    for (const p of packs) skus[p.key] = (await db.sku.create({ data: { productId: created.id, code: `${marker}-${p.key}`,
      variantName: p.variant ?? 'Default', size: p.size, sizeUnit: p.unit, packCount: p.pack, barcode: p.barcode, isActive: p.active ?? true } })).id;
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); app.useLogger(false); await app.init();
    db = app.get(PrismaService); ingestion = app.get(IngestionService); identity = app.get(ProductIdentityService);
    const database = new URL(process.env.DATABASE_URL!).pathname.slice(1);
    expect(database).toMatch(/_test$/);
    expect(await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`).toEqual([{ name: database }]);
    const [version] = await db.$queryRaw<Array<{ version: string }>>`SELECT version() AS version`;
    expect(version.version).toMatch(/^PostgreSQL 17/);
    admin = await createActor(db, 'ADMIN');
    supplierA = (await db.supplier.create({ data: { name: `${marker}-A`, slug: `${marker}-a` } })).id;
    supplierB = (await db.supplier.create({ data: { name: `${marker}-B`, slug: `${marker}-b` } })).id;
    brandId = (await db.brand.create({ data: { name: brandName, slug: marker } })).id;
    await product('Hydrating Facial Cleanser', [{ key: 'hydra236', size: 236, unit: 'ml', barcode: barcodeOf(1) }, { key: 'hydra473', size: 473, unit: 'ml', barcode: barcodeOf(2) }]);
    await product('Foaming Facial Cleanser', [{ key: 'foam236', size: 236, unit: 'ml', barcode: barcodeOf(3) }]);
    await product('Retinol Serum 0.3%', [{ key: 'retinol03', size: 30, unit: 'ml' }]);
    await product('Retinol Serum 1%', [{ key: 'retinol1', size: 30, unit: 'ml' }]);
    await product('Velora Glow Cream', [{ key: 'rose', size: 50, unit: 'g', variant: 'Rose' }, { key: 'lavender', size: 50, unit: 'g', variant: 'Lavender' }]);
    await product('Retired Gel Cleanser', [{ key: 'retired', size: 100, unit: 'ml', active: false }]);
    jobA = (await db.ingestionJob.create({ data: { supplierId: supplierA, status: 'approved' } })).id;
    jobB = (await db.ingestionJob.create({ data: { supplierId: supplierB, status: 'approved' } })).id;
  });

  afterAll(async () => {
    if (db && brandId) {
      for (const supplierId of [supplierA, supplierB]) {
        await db.supplierOffer.deleteMany({ where: { supplierId } });
        await db.supplierSkuAlias.deleteMany({ where: { supplierId } });
      }
      await db.ingestionItem.deleteMany({ where: { jobId: { in: [jobA, jobB] } } });
      await db.ingestionJob.deleteMany({ where: { id: { in: [jobA, jobB] } } });
      await db.sku.deleteMany({ where: { product: { brandId } } });
      await db.product.deleteMany({ where: { brandId } });
      await db.brand.delete({ where: { id: brandId } });
      await db.supplier.deleteMany({ where: { id: { in: [supplierA, supplierB] } } });
    }
    if (app) await app.close();
  });

  const row = (name: string, patch: Partial<CandidateItemIdentityInput> = {}): CandidateItemIdentityInput => ({
    eligibilityApproved: true, brandId, supplierId: supplierA, supplierSkuCode: randomUUID(), name, brand: brandName, ...patch,
  });
  const candidate = async (name: string, patch: { matchedSkuId?: string; barcode?: string; code?: string; jobId?: string; size?: number; unit?: string } = {}) =>
    db.ingestionItem.create({ data: { jobId: patch.jobId ?? jobA, supplierSkuCode: patch.code ?? randomUUID(), name, brand: brandName,
      barcode: patch.barcode, price: 100, currency: 'EGP', priceType: 'PURCHASE_COST', reportedQuantity: null, status: 'review_required',
      matchedSkuId: patch.matchedSkuId, enrichment: { source: { normalized: { extractedSize: patch.size, extractedUnit: patch.unit },
        eligibility: { outcome: 'ALLOW', policyId: randomUUID(), version: 1, brandId, brandName, categoryId: randomUUID() } } } } });
  const counts = async () => ({ aliases: await db.supplierSkuAlias.count({ where: { supplierId: { in: [supplierA, supplierB] } } }),
    offers: await db.supplierOffer.count({ where: { supplierId: { in: [supplierA, supplierB] } } }),
    matched: await db.ingestionItem.count({ where: { jobId: { in: [jobA, jobB] }, matchedSkuId: { not: null } } }) });

  describe('retrieval suggests, it never links', () => {
    it.each([
      ['Arabic translation', 'غسول مرطب للوجه 236 مل', 'hydra236'],
      ['Arabic digits', 'غسول مرطب للوجه ٢٣٦ مل', 'hydra236'],
      ['transliteration', 'هيدراتينج فيشيال كلينزر 236 مل', 'hydra236'],
      ['mixed script', 'Hydrating غسول للوجه 236ml', 'hydra236'],
      ['Latin typo', 'Hydrting Facial Cleanser 236ml', 'hydra236'],
      ['Arabic typo', 'غسول مرطپ للوجه 236 مل', 'hydra236'],
      ['tashkeel and invisible marks', 'غَسول‌ مرطب للوجه 236 مل', 'hydra236'],
    ])('%s reaches the right SKU in Top-K and auto-links nothing', async (_kind, name, expected) => {
      const result = await identity.classifyCandidateMatch(row(name));
      expect(result.matchedSkuId).toBeNull();
      expect(result.route).toBe('AMBIGUOUS');
      expect(result.candidates?.[0]?.skuId).toBe(skus[expected]);
    });

    it('missing size stays unknown: every packaging is listed and none is elected', async () => {
      const result = await identity.classifyCandidateMatch(row('غسول مرطب للوجه'));
      expect(result).toMatchObject({ route: 'AMBIGUOUS', matchedSkuId: null, suggestedSkuId: null });
      expect(result.candidates?.slice(0, 2).map(c => c.skuId).sort()).toEqual([skus.hydra236, skus.hydra473].sort());
    });
    it('two SKUs that differ only by an unstated variant are ambiguous, in a stable order', async () => {
      const first = await identity.classifyCandidateMatch(row('Velora Glow Cream 50g'));
      expect(first).toMatchObject({ route: 'AMBIGUOUS', matchedSkuId: null, suggestedSkuId: null });
      expect(first.candidates?.map(c => c.skuId).sort()).toEqual([skus.rose, skus.lavender].sort());
      expect((await identity.classifyCandidateMatch(row('Velora Glow Cream 50g'))).candidates).toEqual(first.candidates);
    });
    it('a stated variant selects its SKU; a contradicted one is refused', async () => {
      expect((await identity.classifyCandidateMatch(row('Velora Glow Cream 50g', { variantName: 'Rose' }))).suggestedSkuId).toBe(skus.rose);
      expect((await identity.classifyCandidateMatch(row('Velora Glow Cream 50g', { variantName: 'Mint' }))).candidates).toEqual([]);
    });
    it('a formulation sibling is not offered as a candidate for a stated concentration', async () => {
      const result = await identity.classifyCandidateMatch(row('سيروم ريتينول ١٪ 30 مل'));
      expect(result.candidates?.map(c => c.skuId)).toEqual([skus.retinol1]);
    });
    it('multipack notation is a pack fact, so a single-unit SKU cannot be suggested', async () => {
      const result = await identity.classifyCandidateMatch(row('Hydrating Facial Cleanser 2 x 236ml'));
      expect(result).toMatchObject({ matchedSkuId: null, candidates: [] });
      expect(result.suggestedSkuId ?? null).toBeNull();
    });
    it('an unknown product of a known brand is new, not its nearest relative', async () => {
      expect(await identity.classifyCandidateMatch(row('Charcoal Peel Mask 75ml'))).toMatchObject({ route: 'NEW', classification: 'NO_MATCH', matchedSkuId: null });
    });
    it('an inactive SKU is existing identity, never new and never linked', async () => {
      expect(await identity.classifyCandidateMatch(row('Retired Gel Cleanser 100ml'))).toMatchObject({ route: 'CONFLICT', reason: 'name_size_matches_inactive_canonical_sku', matchedSkuId: null });
    });
  });

  describe('verified mappings', () => {
    it('a reviewed alias reuses across imports and is scoped to its supplier', async () => {
      await db.supplierSkuAlias.create({ data: { supplierId: supplierA, supplierSkuCode: 'A-1', skuId: skus.hydra236 } });
      const reviewed = { supplierSkuCode: 'A-1', name: 'غسول مرطب للوجه 236 مل' };
      expect(await identity.classifyCandidateMatch(row(reviewed.name, reviewed))).toMatchObject({ route: 'VERIFIED', matchedSkuId: skus.hydra236 });
      expect(await identity.classifyCandidateMatch(row(reviewed.name, { ...reviewed, supplierId: supplierB }))).toMatchObject({ matchedSkuId: null, route: 'AMBIGUOUS' });
    });
    it('multiple suppliers share one SKU through their own codes and GTIN', async () => {
      await db.supplierSkuAlias.create({ data: { supplierId: supplierB, supplierSkuCode: 'A-1', skuId: skus.hydra236 } });
      for (const supplierId of [supplierA, supplierB]) {
        expect(await identity.classifyCandidateMatch(row('Hydrating Facial Cleanser 236ml', { supplierId, supplierSkuCode: 'A-1' }))).toMatchObject({ matchedSkuId: skus.hydra236 });
      }
      expect(await identity.classifyCandidateMatch(row('Hydrating Facial Cleanser 236ml', { supplierId: supplierB, barcode: barcodeOf(1) }))).toMatchObject({ route: 'VERIFIED', matchedSkuId: skus.hydra236 });
    });
    it('a reused code describing a sibling never verifies: a stated contradiction conflicts, unexplained wording abstains', async () => {
      for (const name of ['Foaming Facial Cleanser 236ml', 'غسول رغوي للوجه 236 مل']) {
        expect(await identity.classifyCandidateMatch(row(name, { supplierSkuCode: 'A-1' }))).toMatchObject({ route: 'AMBIGUOUS', matchedSkuId: null });
      }
      for (const name of ['Hydrating Facial Serum 236ml', 'سيروم مرطب للوجه 236 مل', 'غسول مرطب للجسم 236 مل']) {
        expect(await identity.classifyCandidateMatch(row(name, { supplierSkuCode: 'A-1' }))).toMatchObject({ route: 'CONFLICT', matchedSkuId: null });
      }
    });
    it('a checksum-valid GTIN of a sibling cannot override the wording', async () => {
      expect(await identity.classifyCandidateMatch(row('Foaming Facial Cleanser 236ml', { barcode: barcodeOf(1) }))).toMatchObject({ route: 'AMBIGUOUS', matchedSkuId: null });
      expect(await identity.classifyCandidateMatch(row('Hydrating Facial Serum 236ml', { barcode: barcodeOf(1) }))).toMatchObject({ route: 'CONFLICT', matchedSkuId: null });
    });
  });

  describe('write boundaries', () => {
    it('a reviewer confirms a retrieved candidate once; the same wording then links without review', async () => {
      const code = `C-${randomUUID()}`;
      const name = 'فيشال غسول مرطب مستخدم في الصالونات 236 مل';
      const item = await candidate(name, { code, size: 236, unit: 'ml' });
      expect(await identity.classifyCandidateMatch(row(name, { supplierSkuCode: code }))).toMatchObject({ route: 'AMBIGUOUS', matchedSkuId: null });
      await ingestion.approveItem(item.id, { matchedSkuId: skus.hydra236, identityEvidence: 'Checked against the supplier invoice' }, admin.id);
      expect(await db.supplierSkuAlias.findUnique({ where: { supplierId_supplierSkuCode: { supplierId: supplierA, supplierSkuCode: code } } })).toMatchObject({ skuId: skus.hydra236 });
      expect(await identity.classifyCandidateMatch(row(name, { supplierSkuCode: code, candidateItemId: randomUUID() }))).toMatchObject({ route: 'VERIFIED', matchedSkuId: skus.hydra236 });
      // Changed wording under the reviewed code is back to review, and contradicted wording is refused.
      expect(await identity.classifyCandidateMatch(row('غسول مرطب مختلف جدا اكسترا 236 مل', { supplierSkuCode: code }))).toMatchObject({ route: 'AMBIGUOUS', matchedSkuId: null });
      expect(await identity.classifyCandidateMatch(row(`${name} للبشرة الدهنية سيروم`, { supplierSkuCode: code }))).toMatchObject({ matchedSkuId: null });
    });
    it('changed wording under a reviewed code can be confirmed for that code, and only that wording is reused', async () => {
      const code = `W-${randomUUID()}`;
      await db.supplierSkuAlias.create({ data: { supplierId: supplierA, supplierSkuCode: code, skuId: skus.hydra236 } });
      const name = 'غسول مرطب بتركيبة صالونات 236 مل';
      expect(await identity.classifyCandidateMatch(row(name, { supplierSkuCode: code }))).toMatchObject({ route: 'AMBIGUOUS', matchedSkuId: null, suggestedSkuId: skus.hydra236 });
      const item = await candidate(name, { code, size: 236, unit: 'ml' });
      await ingestion.approveItem(item.id, { matchedSkuId: skus.hydra236, identityEvidence: 'Checked against the supplier invoice' }, admin.id);
      expect(await identity.classifyCandidateMatch(row(name, { supplierSkuCode: code }))).toMatchObject({ route: 'VERIFIED', matchedSkuId: skus.hydra236 });
      expect(await identity.classifyCandidateMatch(row(name, { supplierSkuCode: code, supplierId: supplierB }))).toMatchObject({ matchedSkuId: null });
    });
    it('a reviewer cannot confirm a SKU retrieval rejected, and nothing is written', async () => {
      const item = await candidate('سيروم ريتينول ١٪ 30 مل', { size: 30, unit: 'ml' });
      const before = await counts();
      await expect(ingestion.approveItem(item.id, { matchedSkuId: skus.retinol03, identityEvidence: 'Checked against the supplier invoice' }, admin.id)).rejects.toThrow(/CONFLICT/);
      expect(await counts()).toEqual(before);
    });
    it('stored IDs cannot be published, approved or committed against the wording', async () => {
      for (const [name, pattern] of [['سيروم مرطب للوجه 236 مل', /EXPLICIT_CONFLICT/], ['غسول رغوي للوجه 236 مل', /INSUFFICIENT_EVIDENCE/]] as const) {
        const item = await db.ingestionItem.update({ where: { id: (await candidate(name, { size: 236, unit: 'ml' })).id },
          data: { matchedSkuId: skus.hydra236, status: 'approved' } });
        const before = await counts();
        await expect(ingestion.approveItem(item.id, undefined, admin.id)).rejects.toThrow(pattern);
        await expect(app.get(OfferBatchCommitService).commitCandidateOffer(item.id, skus.hydra236)).rejects.toThrow(pattern);
        await expect(identity.assertSkuAssociation({ supplierId: supplierA, supplierSkuCode: item.supplierSkuCode, name: item.name, brand: item.brand, size: 236, sizeUnit: 'ml' }, skus.hydra236)).rejects.toThrow(pattern);
        expect(await counts()).toEqual({ ...before, matched: before.matched });
        await db.ingestionItem.update({ where: { id: item.id }, data: { matchedSkuId: null, status: 'rejected' } });
      }
    });
    it('a fuzzy candidate alone never passes the final boundary', async () => {
      await expect(identity.assertSkuAssociation(row('Hydrting Facial Cleanser 236ml', { supplierSkuCode: `F-${randomUUID()}`, size: 236, sizeUnit: 'ml' }), skus.hydra236))
        .rejects.toThrow(/INSUFFICIENT_EVIDENCE/);
    });
  });

  describe('open candidate sweep', () => {
    it('a possible duplicate of this brand is found behind more than 500 same-size rows of other brands', async () => {
      const otherBrand = (i: number) => ({ jobId: jobA, supplierSkuCode: `NOISE-${marker}-${i}`, name: `Noise Product ${i} 60ml`, brand: 'Some Other Brand',
        price: 1, currency: 'EGP', status: 'review_required' as const, enrichment: { source: { fingerprint: `noise-${marker}-${i}`, normalized: { extractedSize: 60, extractedUnit: 'ml' } } } });
      await db.ingestionItem.createMany({ data: Array.from({ length: 520 }, (_, i) => otherBrand(i)) });
      // Prisma orders a capped read by ID, so whether a row falls behind the cap depends on its random UUID.
      const twin = await db.ingestionItem.create({ data: { id: `ffffffff-ffff-4fff-bfff-${marker}0000`, jobId: jobA, supplierSkuCode: `TWIN-${marker}`, name: 'Zephyra Peel 60ml', brand: brandName, price: 1, currency: 'EGP',
        status: 'review_required', enrichment: { source: { fingerprint: `twin-${marker}`, normalized: { extractedSize: 60, extractedUnit: 'ml' } } } } });
      const result = await identity.classifyCandidateMatch(row('زيفيرا بيل 60 مل'));
      expect(result.possibleDuplicateCandidateIds).toContain(twin.id);
      expect(result.route).toBe('AMBIGUOUS');
      await db.ingestionItem.deleteMany({ where: { supplierSkuCode: { startsWith: 'NOISE-' }, jobId: jobA } });
      await db.ingestionItem.delete({ where: { id: twin.id } });
    });
    it('a row stored under the older v1 folding still dedupes against the same product today', async () => {
      const name = 'Mirelle مهدئ Balm 60ml';
      const stored = identity.generateFingerprint({ brand: brandName, name, size: 60, sizeUnit: 'ml' }, true);
      expect(stored).not.toBe(identity.generateFingerprint({ brand: brandName, name, size: 60, sizeUnit: 'ml' }));
      const older = await db.ingestionItem.create({ data: { jobId: jobA, supplierSkuCode: `LEGACY-${marker}`, name, brand: brandName, price: 1, currency: 'EGP',
        status: 'review_required', enrichment: { source: { fingerprint: stored, normalized: { extractedSize: 60, extractedUnit: 'ml' } } } } });
      expect(await identity.classifyCandidateMatch(row(name, { size: 60, sizeUnit: 'ml' }))).toMatchObject({ classification: 'NO_MATCH', existingCandidateId: older.id });
      await db.ingestionItem.delete({ where: { id: older.id } });
    });
  });

  describe('malformed GTIN', () => {
    const wrong = () => barcodeOf(1).slice(0, -1) + String((Number(barcodeOf(1).at(-1)) + 1) % 10);
    it('holds identity instead of discarding the row, and still shows candidates', async () => {
      const result = await identity.classifyCandidateMatch(row('Hydrating Facial Cleanser 236ml', { barcode: wrong() }));
      expect(result).toMatchObject({ route: 'AMBIGUOUS', matchedSkuId: null });
      expect(result.conflicts).toContain('invalid_gtin');
      expect(result.candidates?.[0]?.skuId).toBe(skus.hydra236);
    });
    it('a verified alias cannot auto-link across an unreviewed malformed barcode', async () => {
      const result = await identity.classifyCandidateMatch(row('Hydrating Facial Cleanser 236ml', { supplierSkuCode: 'A-1', invalidBarcode: 'ABC-123' }));
      expect(result).toMatchObject({ route: 'AMBIGUOUS', matchedSkuId: null, suggestedSkuId: skus.hydra236 });
      expect(result.conflicts).toContain('invalid_gtin');
    });
    it('a new product with a malformed barcode earns no research until a person looks', async () => {
      const result = await identity.classifyCandidateMatch(row('Charcoal Peel Mask 75ml', { invalidBarcode: 'ABC-123' }));
      expect(result).toMatchObject({ classification: 'LIKELY_MATCH', route: 'AMBIGUOUS', matchedSkuId: null, reason: 'invalid_gtin_held' });
    });
    it('a stored ID cannot pass the final boundary over a malformed barcode without a review', async () => {
      await expect(identity.assertSkuAssociation(row('Hydrating Facial Cleanser 236ml', { supplierSkuCode: 'A-1', size: 236, sizeUnit: 'ml', invalidBarcode: 'ABC-123' }), skus.hydra236))
        .rejects.toThrow(/INSUFFICIENT_EVIDENCE/);
    });
  });

  describe('efficiency', () => {
    it('a batch uses one lookup per kind, with the same answers as classifying one row at a time', async () => {
      const inputs = [row('Hydrating Facial Cleanser 236ml', { barcode: barcodeOf(1) }), row('Hydrating Facial Cleanser 236ml', { supplierSkuCode: 'A-1' }),
        row('غسول مرطب للوجه 236 مل'), row('هيدراتينج فيشيال كلينزر 473 مل'), row('Foaming Facial Cleanser 236ml'), row('سيروم ريتينول ١٪ 30 مل')];
      const single = [];
      for (const input of inputs) single.push(await identity.classifyCandidateMatch(input));
      const spy = jest.spyOn(db, '$queryRaw');
      const aliasSpy = jest.spyOn(db.supplierSkuAlias, 'findMany');
      const batch = await identity.prepareBatch(inputs);
      const batched = [];
      for (const input of inputs) batched.push(await identity.classifyCandidateMatch(input, batch));
      expect(aliasSpy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
      spy.mockRestore(); aliasSpy.mockRestore();
      expect(batched.map(r => [r.route, r.matchedSkuId, r.candidates?.map(c => c.skuId)])).toEqual(single.map(r => [r.route, r.matchedSkuId, r.candidates?.map(c => c.skuId)]));
    });
    it('retrieval returns a bounded set per block', async () => {
      const found = await app.get(ProductIdentityService)['catalogService'].findSkuIdentityCandidates(
        [{ key: 'k', brandId, query: 'cleanser', size: 236, sizeUnit: 'ml' }], 2);
      expect(found.get('k')!.length).toBeLessThanOrEqual(4);
    });
  });
});
