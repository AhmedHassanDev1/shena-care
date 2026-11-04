// GLO-285 closure: the whole matching lifecycle through real uploads, HTTP review and offer commit. Synthetic entities only.
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AiClient } from '../../src/platform/ai';
import { IngestionEligibilityService } from '../../src/modules/ingestion/services/ingestion-eligibility.service';
import { ProductResearchService } from '../../src/modules/ingestion/services/product-research.service';
import { IngestionService } from '../../src/modules/ingestion/services/ingestion.service';
import { Actor, createActor } from '../fixtures/actors';
import { reviewCandidateMedia } from '../fixtures/candidate-review';
import { gtin } from '../fixtures/glo285-matching-corpus';

const HEADER = 'Code,Item,Brand,Category,Barcode,Cost EGP,On Hand';
const semantics = { documentKind: 'STOCK_FEED', priceBasis: 'UNIT_PURCHASE_COST', quantityBasis: 'ON_HAND' };
const mapping = { supplierSku: 'Code', name: 'Item', brand: 'Brand', category: 'Category', barcode: 'Barcode', price: 'Cost EGP', quantity: 'On Hand', semantics };

describe('GLO-285 matching and review lifecycle (disposable PostgreSQL 17)', () => {
  let app: INestApplication, db: PrismaService;
  let admin: Actor, hub: Actor, actorA: Actor, actorB: Actor;
  let supplierA: string, supplierB: string, brandId: string, categoryId: string;
  let ai: jest.SpyInstance, research: jest.SpyInstance;
  const marker = randomUUID().slice(0, 8);
  const brand = `Lifecycle${marker}`;
  const category = `Cleansers${marker}`;
  const serial = parseInt(marker, 16).toString().padStart(9, '0').slice(-9);
  const barcodeOf = (n: number) => gtin(`29${serial}${n}`);
  const skus: Record<string, string> = {};
  const http = () => request(app.getHttpServer());

  const importRows = async (actor: Actor, rows: string[]) => {
    const body = Buffer.from([HEADER, ...rows].join('\n') + '\n');
    const received = await http().post('/ingestion/jobs/upload').set(actor.auth).attach('file', body, { filename: `${randomUUID()}.csv`, contentType: 'text/csv' }).expect(201);
    // An approved layout admits the next file by itself; only the first file of a supplier needs its mapping approved.
    const mapped = received.body.requiresMapping ? await http().post(`/ingestion/jobs/${received.body.jobId}/mapping`).set(admin.auth).send({ mapping }) : received;
    expect(mapped.status).toBe(201);
    const items = await db.ingestionItem.findMany({ where: { jobId: received.body.jobId } });
    return { jobId: received.body.jobId as string, matching: mapped.body.matching, outcomes: mapped.body, items: Object.fromEntries(items.map(i => [i.supplierSkuCode, i])) };
  };
  const identityOf = (item: { enrichment: unknown }) => (item.enrichment as { identity: { route: string; reason: string; conflicts: string[]; candidates: Array<{ skuId: string }>; suggestedSkuId: string | null; existingCandidateId: string | null } }).identity;
  const review = (itemId: string) => http().get(`/ingestion/candidates/${itemId}/review-record`).set(admin.auth).expect(200);
  const confirm = (itemId: string, skuId: string, evidence = 'Checked the supplier invoice against the catalog pack') =>
    http().patch(`/ingestion/candidates/${itemId}/approve`).set(admin.auth).send({ matchedSkuId: skuId, identityEvidence: evidence });
  // Each file differs by cost, so a deliberately repeated row is a new import rather than a byte-identical replay.
  let serialCost = 10000;
  const row = (code: string, name: string, barcode = '', cost = (++serialCost / 100).toFixed(2)) => `${code},${name},${brand},${category},${barcode},${cost},5`;
  const offers = () => db.supplierOffer.findMany({ where: { supplierId: { in: [supplierA, supplierB] } }, orderBy: { id: 'asc' } });
  const writes = async () => ({ offers: await db.supplierOffer.count({ where: { supplierId: { in: [supplierA, supplierB] } } }),
    aliases: await db.supplierSkuAlias.count({ where: { supplierId: { in: [supplierA, supplierB] } } }), products: await db.product.count(), skus: await db.sku.count() });

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); app.useLogger(false);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get(PrismaService);
    const database = new URL(process.env.DATABASE_URL!).pathname.slice(1);
    expect(database).toMatch(/_test$/);
    const [server] = await db.$queryRaw<Array<{ name: string; version: string }>>`SELECT current_database() AS name, version() AS version`;
    expect(server.name).toBe(database);
    expect(server.version).toMatch(/^PostgreSQL 17/);
    admin = await createActor(db, 'ADMIN');
    hub = await createActor(db, 'HUB_OPERATOR');
    supplierA = (await db.supplier.create({ data: { name: `Lifecycle A ${marker}`, slug: `lifecycle-a-${marker}` } })).id;
    supplierB = (await db.supplier.create({ data: { name: `Lifecycle B ${marker}`, slug: `lifecycle-b-${marker}` } })).id;
    actorA = await createActor(db, 'SUPPLIER', supplierA);
    actorB = await createActor(db, 'SUPPLIER', supplierB);
    brandId = (await db.brand.create({ data: { name: brand, slug: `lifecycle-${marker}` } })).id;
    categoryId = (await db.category.create({ data: { name: category, slug: `lifecycle-${marker}` } })).id;
    const addProduct = async (name: string, packs: Array<{ key: string; size: number; barcode?: string; pack?: number; variant?: string }>) => {
      const product = await db.product.create({ data: { name, slug: `lifecycle-${marker}-${Object.keys(skus).length}`, brandId, categoryId } });
      for (const p of packs) skus[p.key] = (await db.sku.create({ data: { productId: product.id, code: `${marker}-${p.key}`, variantName: p.variant ?? 'Default', size: p.size, sizeUnit: 'ml', packCount: p.pack, barcode: p.barcode } })).id;
    };
    await addProduct('Hydrating Facial Cleanser', [{ key: 'hydra236', size: 236, barcode: barcodeOf(1) }, { key: 'hydra473', size: 473, barcode: barcodeOf(2) }]);
    await addProduct('Foaming Facial Cleanser', [{ key: 'foam236', size: 236, barcode: barcodeOf(3) }]);
    await addProduct('Retinol Serum 0.3%', [{ key: 'retinol03', size: 30 }]);
    await addProduct('Retinol Serum 1%', [{ key: 'retinol1', size: 30 }]);
    await addProduct('Silk Barrier Lotion', [{ key: 'silk', size: 200 }]);
    const eligibility = app.get(IngestionEligibilityService);
    const current = await eligibility.current();
    const preview = await eligibility.preview({ expectedVersion: current?.version ?? 0, reason: 'Lifecycle fixture policy',
      brands: [{ id: brandId, effect: 'ALLOW', aliases: [] }], categories: [{ id: categoryId, effect: 'ALLOW' }], mappings: [] }, admin.id);
    await eligibility.approve(preview.id, admin.id);
    ai = jest.spyOn(app.get(AiClient), 'enrichProduct').mockRejectedValue(new Error('AI disabled in lifecycle tests'));
    research = jest.spyOn(app.get(ProductResearchService), 'researchProductCandidate');
  }, 60000);
  afterAll(async () => { jest.restoreAllMocks(); if (app) await app.close(); });
  beforeEach(() => { ai.mockClear(); research.mockClear(); });

  describe('1. known exact SKU', () => {
    it('links automatically and writes a supplier-specific offer without AI or review', async () => {
      const { jobId, items, matching } = await importRows(actorA, [row('EX-1', 'Hydrating Facial Cleanser 236ml', barcodeOf(1), '100.00')]);
      expect(matching).toMatchObject({ exactMatches: 1, needsReview: 0, aiEnrichmentRequests: 0 });
      expect(items['EX-1'].matchedSkuId).toBe(skus.hydra236);
      expect(identityOf(items['EX-1'])).toMatchObject({ route: 'VERIFIED' });
      const committed = await http().post(`/ingestion/jobs/${jobId}/commit-offers`).set(actorA.auth).send({ autoApplyLowRisk: true }).expect(201);
      expect(committed.body.committedCount).toBe(1);
      expect(await db.supplierOffer.findUniqueOrThrow({ where: { supplierId_skuId: { supplierId: supplierA, skuId: skus.hydra236 } } })).toMatchObject({ supplierId: supplierA });
      expect(ai).not.toHaveBeenCalled(); expect(research).not.toHaveBeenCalled();
    });
    it('a verified row creates no review task, and stays visible in the unfiltered list', async () => {
      const { items } = await importRows(actorA, [row('EX-2', 'Hydrating Facial Cleanser 473ml', barcodeOf(2)), row('EX-3', 'غسول مرطب للوجه 473 مل')]);
      const queue = (await http().get('/ingestion/candidates?status=review_required').set(admin.auth).expect(200)).body.map((c: { id: string }) => c.id);
      expect(queue).not.toContain(items['EX-2'].id);
      expect(queue).toContain(items['EX-3'].id);
      expect((await http().get('/ingestion/candidates').set(admin.auth).expect(200)).body.map((c: { id: string }) => c.id)).toContain(items['EX-2'].id);
    });
  });

  describe('2-3. retrieval without a verified identifier', () => {
    it('Arabic misspelling and English naming retrieve the SKU safely', async () => {
      const { items } = await importRows(actorA, [row('AR-1', 'غسول مرطپ للوجه 236 مل'), row('EN-1', 'Hydrting Facial Cleanser 236ml')]);
      for (const code of ['AR-1', 'EN-1']) {
        expect(items[code].matchedSkuId).toBeNull();
        expect(identityOf(items[code]).route).toBe('AMBIGUOUS');
        expect(identityOf(items[code]).candidates[0].skuId).toBe(skus.hydra236);
      }
      expect(ai).not.toHaveBeenCalled();
    });
    it('candidates carry a verified catalog image when one exists, and never a generated one', async () => {
      const product = await db.sku.findUniqueOrThrow({ where: { id: skus.foam236 }, select: { productId: true } });
      await db.productMedia.create({ data: { productId: product.productId, type: 'image', url: 'https://example.test/generated.png', originType: 'generated', isPrimary: true } });
      const { items } = await importRows(actorA, [row('IMG-1', 'غسول رغوي للوجه 236 مل')]);
      const listed = (await review(items['IMG-1'].id)).body.identityMatch.candidates.find((c: { skuId: string }) => c.skuId === skus.foam236);
      expect(listed.imageUrl).toBeNull();
      await db.productMedia.create({ data: { productId: product.productId, type: 'image', url: 'https://example.test/verified.png', originType: 'verified' } });
      const again = (await review(items['IMG-1'].id)).body.identityMatch.candidates.find((c: { skuId: string }) => c.skuId === skus.foam236);
      expect(again.imageUrl).toBe('https://example.test/verified.png');
    });
    it('an ambiguous title shows ranked candidates to the reviewer and links nothing', async () => {
      const { items } = await importRows(actorA, [row('AMB-1', 'غسول مرطب للوجه')]);
      expect(items['AMB-1'].matchedSkuId).toBeNull();
      const record = await review(items['AMB-1'].id);
      expect(record.body.identityMatch).toMatchObject({ route: 'AMBIGUOUS', suggestedSkuId: null });
      expect(record.body.identityMatch.candidates.slice(0, 2).map((c: { skuId: string }) => c.skuId).sort()).toEqual([skus.hydra236, skus.hydra473].sort());
    });
  });

  describe('4-6. one confirmation, then reuse, then invalidation', () => {
    const wording = 'غسول مرطب للوجه ماركة الصالون 236 مل';
    let reviewedItemId: string;
    it('requires evidence and an Admin, and saves reviewed provenance', async () => {
      const { items } = await importRows(actorA, [row('REV-1', wording)]);
      reviewedItemId = items['REV-1'].id;
      await http().patch(`/ingestion/candidates/${reviewedItemId}/approve`).set(hub.auth).send({ matchedSkuId: skus.hydra236, identityEvidence: 'x'.repeat(20) }).expect(403);
      await http().patch(`/ingestion/candidates/${reviewedItemId}/approve`).set(actorA.auth).send({ matchedSkuId: skus.hydra236, identityEvidence: 'x'.repeat(20) }).expect(403);
      expect((await http().patch(`/ingestion/candidates/${reviewedItemId}/approve`).set(admin.auth).send({ matchedSkuId: skus.hydra236 })).status).toBe(400);
      expect((await confirm(reviewedItemId, skus.hydra236)).status).toBe(200);
      const stored = await db.ingestionItem.findUniqueOrThrow({ where: { id: reviewedItemId } });
      expect(stored.matchedSkuId).toBe(skus.hydra236);
      expect((stored.enrichment as { identityReview: unknown }).identityReview).toMatchObject({ decision: 'EXISTING_SKU', skuId: skus.hydra236, reviewedBy: admin.id,
        evidence: 'Checked the supplier invoice against the catalog pack', reviewedAt: expect.any(String) });
      expect(await db.supplierSkuAlias.findUnique({ where: { supplierId_supplierSkuCode: { supplierId: supplierA, supplierSkuCode: 'REV-1' } } })).toMatchObject({ skuId: skus.hydra236 });
      expect(await db.product.count({ where: { name: wording } })).toBe(0);
    });
    it('the same supplier row returns through the Fast Lane with no review and no AI', async () => {
      const { jobId, items, matching } = await importRows(actorA, [row('REV-1', wording, '', '101.00')]);
      expect(matching).toMatchObject({ exactMatches: 1, needsReview: 0, aiEnrichmentRequests: 0 });
      expect(items['REV-1'].matchedSkuId).toBe(skus.hydra236);
      const committed = await http().post(`/ingestion/jobs/${jobId}/commit-offers`).set(actorA.auth).send({ autoApplyLowRisk: true }).expect(201);
      expect(committed.body.committedCount).toBe(1);
      expect(ai).not.toHaveBeenCalled();
    });
    it('another supplier does not inherit the mapping', async () => {
      const { items } = await importRows(actorB, [row('REV-1', wording)]);
      expect(items['REV-1'].matchedSkuId).toBeNull();
      expect(identityOf(items['REV-1']).route).toBe('AMBIGUOUS');
    });
    it.each([
      ['changed formula', 'سيروم مرطب للوجه 236 مل', '', 'CONFLICT'],
      ['changed size', `${wording.replace('236', '473')}`, '', 'CONFLICT'],
      ['changed pack', `${wording} عبوة من 2`, '', 'CONFLICT'],
      ['changed wording', 'غسول مرطب للوجه ماركة مختلفة تماما 236 مل', '', 'AMBIGUOUS'],
    ])('%s invalidates the reused mapping', async (_kind, name, barcode, route) => {
      const { items } = await importRows(actorA, [row('REV-1', name, barcode)]);
      expect(items['REV-1'].matchedSkuId).toBeNull();
      expect(identityOf(items['REV-1']).route).toBe(route);
    });
    it('a changed barcode invalidates it, whether or not the SKU records a barcode', async () => {
      const onRecorded = await importRows(actorA, [row('REV-1', wording, barcodeOf(3))]);
      expect(onRecorded.items['REV-1'].matchedSkuId).toBeNull();
      expect(identityOf(onRecorded.items['REV-1']).route).toBe('CONFLICT');
      await db.supplierSkuAlias.create({ data: { supplierId: supplierA, supplierSkuCode: 'SILK-1', skuId: skus.silk } });
      const onUnrecorded = await importRows(actorA, [row('SILK-1', 'Silk Barrier Lotion 200ml', barcodeOf(8))]);
      expect(onUnrecorded.items['SILK-1'].matchedSkuId).toBeNull();
      expect(identityOf(onUnrecorded.items['SILK-1']).route).toBe('AMBIGUOUS');
    });
    it('a changed supplier code starts over', async () => {
      const { items } = await importRows(actorA, [row('REV-2', wording)]);
      expect(items['REV-2'].matchedSkuId).toBeNull();
    });
    it('a reviewer can never confirm through a hard conflict', async () => {
      const { items } = await importRows(actorA, [row('RET-1', 'سيروم ريتينول ١٪ 30 مل')]);
      const before = await writes();
      expect((await confirm(items['RET-1'].id, skus.retinol03)).status).toBeGreaterThanOrEqual(400);
      expect((await confirm(items['RET-1'].id, skus.hydra236)).status).toBeGreaterThanOrEqual(400);
      expect(await writes()).toEqual(before);
    });
  });

  describe('7. genuinely new product', () => {
    it('becomes one candidate across suppliers, never a false SKU match', async () => {
      const name = `Cedar Scalp Tonic ${marker} 75ml`;
      const first = await importRows(actorA, [row('NEW-1', name)]);
      expect(first.matching).toMatchObject({ newCandidates: 1, aiEnrichmentRequests: 1 });
      expect(identityOf(first.items['NEW-1'])).toMatchObject({ route: 'NEW' });
      const second = await importRows(actorB, [row('NEW-B', name)]);
      expect(second.matching).toMatchObject({ newCandidates: 0, linkedToExistingCandidate: 1, aiEnrichmentRequests: 0 });
      expect(identityOf(second.items['NEW-B']).existingCandidateId).toBe(first.items['NEW-1'].id);
      expect(await db.product.count({ where: { name } })).toBe(0);
    });
    it('Different Product records the decision and does not publish', async () => {
      const { items } = await importRows(actorA, [row('DIFF-1', 'غسول مرطب للوجه بتركيبة النعناع الجديدة 236 مل')]);
      expect(identityOf(items['DIFF-1']).candidates.length).toBeGreaterThan(0);
      const before = await writes();
      expect((await http().patch(`/ingestion/candidates/${items['DIFF-1'].id}/approve`).set(admin.auth).send({ createNewProduct: true })).status).toBe(400);
      expect((await http().patch(`/ingestion/candidates/${items['DIFF-1'].id}/approve`).set(admin.auth).send({ createNewProduct: true, identityEvidence: 'Different scent shown on the supplier photo' })).status).toBe(200);
      const stored = await db.ingestionItem.findUniqueOrThrow({ where: { id: items['DIFF-1'].id } });
      expect(stored).toMatchObject({ status: 'approved', matchedSkuId: null });
      expect((stored.enrichment as { identityReview: unknown }).identityReview).toMatchObject({ decision: 'NEW_PRODUCT', reviewedBy: admin.id });
      expect(await writes()).toEqual(before);
    });
    it('publication cannot bypass the review: same name and packaging is still refused as new', async () => {
      const { items } = await importRows(actorA, [row('BYPASS-1', 'Hydrating Facial Cleanser 236ml')]);
      await http().patch(`/ingestion/candidates/${items['BYPASS-1'].id}/approve`).set(admin.auth).send({ createNewProduct: true, identityEvidence: 'Trying to create a duplicate' });
      const ready = jest.spyOn(app.get(IngestionService), 'getCandidateReviewRecord').mockResolvedValue({ canPublish: true } as never);
      const before = await writes();
      const refused = await http().post(`/ingestion/candidates/${items['BYPASS-1'].id}/publish`).set(admin.auth);
      expect(refused.status).toBe(409);
      expect(refused.body.message).toMatch(/identity requires review: brand_name_size_match_requires_review/);
      expect(await writes()).toEqual(before);
      ready.mockRestore();
    });
    it('a row a reviewer called different publishes as its own SKU through the existing candidate flow, only after that decision', async () => {
      const name = 'Hydrating Facial Cleanser Mint 236ml';
      const code = barcodeOf(7);
      const { items } = await importRows(actorA, [row('DIFF-2', name, code)]);
      expect(identityOf(items['DIFF-2']).route).toBe('AMBIGUOUS');
      const id = items['DIFF-2'].id;
      const reviews = await reviewCandidateMedia(app, admin.auth, id, code, 236, 'ml');
      const ready = jest.spyOn(app.get(IngestionService), 'getCandidateReviewRecord').mockResolvedValue({ canPublish: true } as never);
      await db.ingestionItem.update({ where: { id }, data: { status: 'approved' } });
      const undecided = await http().post(`/ingestion/candidates/${id}/publish`).set(admin.auth);
      expect(undecided.status).toBeGreaterThanOrEqual(400);
      expect((await http().patch(`/ingestion/candidates/${id}/approve`).set(admin.auth).send({ createNewProduct: true, mediaReviews: reviews,
        identityEvidence: 'Mint variant is a separate pack on the supplier invoice' })).status).toBe(200);
      const before = await db.product.count({ where: { brandId } });
      const published = await http().post(`/ingestion/candidates/${id}/publish`).set(admin.auth);
      ready.mockRestore();
      expect(published.status).toBe(200);
      expect(await db.product.count({ where: { brandId } })).toBe(before + 1);
      const created = await db.sku.findUniqueOrThrow({ where: { barcode: code } });
      expect(created.id).not.toBe(skus.hydra236);
      expect(await db.sku.findUniqueOrThrow({ where: { id: skus.hydra236 } })).toMatchObject({ barcode: barcodeOf(1) });
    });
  });

  describe('8. several suppliers', () => {
    it('share one canonical SKU with separate offers', async () => {
      const a = await importRows(actorA, [row('SH-A', 'Foaming Facial Cleanser 236ml', barcodeOf(3), '90.00')]);
      const b = await importRows(actorB, [row('SH-B', 'Foaming Facial Cleanser 236ml', barcodeOf(3), '95.00')]);
      await http().post(`/ingestion/jobs/${a.jobId}/commit-offers`).set(actorA.auth).send({ autoApplyLowRisk: true }).expect(201);
      await http().post(`/ingestion/jobs/${b.jobId}/commit-offers`).set(actorB.auth).send({ autoApplyLowRisk: true }).expect(201);
      const shared = (await offers()).filter(o => o.skuId === skus.foam236);
      expect(shared.map(o => [o.supplierId, o.costPrice.toNumber()]).sort()).toEqual([[supplierA, 90], [supplierB, 95]].sort());
      expect(await db.sku.count({ where: { barcode: barcodeOf(3) } })).toBe(1);
    });
  });

  describe('9. messy evidence and permissions', () => {
    it('a malformed GTIN keeps the row, its raw value and a visible hold; a missing one is different', async () => {
      const { items, jobId, matching } = await importRows(actorA, [row('BAD-1', 'Hydrating Facial Cleanser 236ml', '12-ABC'), row('BAD-2', 'Hydrating Facial Cleanser 236ml', barcodeOf(1).slice(0, -1) + String((Number(barcodeOf(1).at(-1)) + 1) % 10)), row('NONE-1', 'Hydrating Facial Cleanser 236ml')]);
      expect(matching.exactMatches).toBe(0);
      for (const code of ['BAD-1', 'BAD-2']) {
        expect(items[code]).toMatchObject({ barcode: null, matchedSkuId: null });
        expect(identityOf(items[code]).conflicts).toContain('invalid_gtin');
        expect(identityOf(items[code]).candidates[0].skuId).toBe(skus.hydra236);
      }
      expect((items['BAD-1'].enrichment as { source: { normalized: { invalidBarcode: string }; rawRow: Record<string, string> } }).source.normalized.invalidBarcode).toBe('12-ABC');
      expect((items['BAD-1'].enrichment as { source: { rawRow: Record<string, string> } }).source.rawRow.Barcode).toBe('12-ABC');
      expect(identityOf(items['NONE-1']).conflicts).not.toContain('invalid_gtin');
      const record = await review(items['BAD-1'].id);
      expect(record.body.originalSupplierRow).toMatchObject({ barcode: null, invalidBarcode: '12-ABC' });
      const job = await db.ingestionJob.findUniqueOrThrow({ where: { id: jobId } });
      expect((job.rowOutcomes as Array<{ supplierSku: string; outcome: string }>).find(r => r.supplierSku === 'BAD-1')?.outcome).toBe('IMPORTED');
    });
    it('confirming a malformed-barcode row reuses only that exact cell', async () => {
      const { items } = await importRows(actorA, [row('BAD-3', 'Hydrating Facial Cleanser 236ml', '12-ABC')]);
      expect((await confirm(items['BAD-3'].id, skus.hydra236)).status).toBe(200);
      const same = await importRows(actorA, [row('BAD-3', 'Hydrating Facial Cleanser 236ml', '12-ABC')]);
      expect(same.items['BAD-3'].matchedSkuId).toBe(skus.hydra236);
      const changed = await importRows(actorA, [row('BAD-3', 'Hydrating Facial Cleanser 236ml', '99-XYZ')]);
      expect(changed.items['BAD-3'].matchedSkuId).toBeNull();
    });
    it('a translated row with a GTIN verifies; missing facts do not', async () => {
      const { items } = await importRows(actorA, [row('TR-1', 'غسول رغوي للوجه 236 مل', barcodeOf(3)), row('MISS-1', 'غسول رغوي للوجه', '')]);
      expect(items['TR-1'].matchedSkuId).toBe(skus.foam236);
      expect(items['MISS-1'].matchedSkuId).toBeNull();
      expect((await confirm(items['MISS-1'].id, skus.foam236)).status).toBeGreaterThanOrEqual(400);
    });
    it('Hold for Evidence keeps the row unresolved; Reject needs a reason and an Admin', async () => {
      const { items } = await importRows(actorA, [row('HOLD-1', 'غسول مرطب للوجه 236 مل'), row('REJ-1', 'غسول مرطب للوجه 473 مل')]);
      const before = await writes();
      await http().post(`/ingestion/candidates/${items['HOLD-1'].id}/request-more`).set(actorA.auth).send({ requestedInfo: 'Photo of the pack' }).expect(403);
      await http().post(`/ingestion/candidates/${items['HOLD-1'].id}/request-more`).set(admin.auth).send({ requestedInfo: 'Photo of the pack' }).expect(201);
      expect(await db.ingestionItem.findUniqueOrThrow({ where: { id: items['HOLD-1'].id } })).toMatchObject({ status: 'review_required', matchedSkuId: null });
      await http().patch(`/ingestion/candidates/${items['REJ-1'].id}/reject`).set(hub.auth).send({ reason: 'Not a product' }).expect(403);
      expect((await http().patch(`/ingestion/candidates/${items['REJ-1'].id}/reject`).set(admin.auth).send({})).status).toBe(400);
      await http().patch(`/ingestion/candidates/${items['REJ-1'].id}/reject`).set(admin.auth).send({ reason: 'Supplier row is a promotional bundle' }).expect(200);
      expect(await db.ingestionItem.findUniqueOrThrow({ where: { id: items['REJ-1'].id } })).toMatchObject({ status: 'rejected', matchedSkuId: null });
      expect(await writes()).toEqual(before);
    });
    it('a supplier cannot read or act on review routes', async () => {
      const { items } = await importRows(actorA, [row('PERM-1', 'غسول مرطب للوجه 236 مل')]);
      await http().get(`/ingestion/candidates/${items['PERM-1'].id}/review-record`).set(actorB.auth).expect(403);
      await http().patch(`/ingestion/candidates/${items['PERM-1'].id}/approve`).expect(401);
    });
  });

  describe('10. concurrency, replay and snapshots', () => {
    it('byte-identical replay reuses the job and creates nothing new', async () => {
      const bytes = Buffer.from([HEADER, row('REPLAY-1', 'Foaming Facial Cleanser 236ml', barcodeOf(3), '91.00')].join('\n') + '\n');
      const send = () => http().post('/ingestion/jobs/upload').set(actorA.auth).attach('file', bytes, { filename: 'same.csv', contentType: 'text/csv' });
      const first = await send();
      const second = await send();
      expect(second.body.jobId).toBe(first.body.jobId);
    });
    it('concurrent imports of one new product elect one primary candidate', async () => {
      const name = `Juniper Sleep Balm ${marker} 40ml`;
      const [a, b] = await Promise.all([importRows(actorA, [row('RACE-A', name)]), importRows(actorB, [row('RACE-B', name)])]);
      const links = [identityOf(a.items['RACE-A']).existingCandidateId, identityOf(b.items['RACE-B']).existingCandidateId];
      expect(links.filter(Boolean)).toHaveLength(1);
      expect(await db.product.count({ where: { name } })).toBe(0);
    });
    it('concurrent commits of one job apply once', async () => {
      const { jobId } = await importRows(actorA, [row('CC-1', 'Hydrating Facial Cleanser 473ml', barcodeOf(2), '150.00')]);
      const results = await Promise.allSettled([1, 2].map(() => http().post(`/ingestion/jobs/${jobId}/commit-offers`).set(actorA.auth).send({ autoApplyLowRisk: true })));
      expect(results.every(r => r.status === 'fulfilled')).toBe(true);
      expect(await db.supplierOffer.count({ where: { supplierId: supplierA, skuId: skus.hydra473 } })).toBe(1);
    });
    it('a partial upload leaves omitted offers alone; a full snapshot with held identity cannot deactivate', async () => {
      const before = await db.supplierOffer.findUniqueOrThrow({ where: { supplierId_skuId: { supplierId: supplierA, skuId: skus.hydra236 } } });
      const partial = await importRows(actorA, [row('PART-1', 'Foaming Facial Cleanser 236ml', barcodeOf(3), '92.00')]);
      await http().post(`/ingestion/jobs/${partial.jobId}/commit-offers`).set(actorA.auth).send({ autoApplyLowRisk: true }).expect(201);
      expect((await db.supplierOffer.findUniqueOrThrow({ where: { id: before.id } })).isAvailable).toBe(before.isAvailable);
      const snapshot = await http().post('/ingestion/jobs').set(actorA.auth).send({ supplierId: supplierA, mode: 'FULL_SNAPSHOT',
        items: [{ supplierSkuCode: 'SNAP-1', name: 'غسول مرطب للوجه 236 مل', brand, category, price: 100, priceType: 'PURCHASE_COST', currency: 'EGP' }] }).expect(201);
      await http().post(`/ingestion/jobs/${snapshot.body.id}/commit-offers`).set(admin.auth).send({ autoApplyLowRisk: true }).expect(201);
      await http().post(`/ingestion/jobs/${snapshot.body.id}/approve-deactivations`).set(admin.auth)
        .send({ supplierId: supplierA, confirmedAssortmentCoverage: true, approvedSkuIds: [skus.hydra236] }).expect(res => expect(res.status).toBeGreaterThanOrEqual(400));
      expect((await db.supplierOffer.findUniqueOrThrow({ where: { id: before.id } })).isAvailable).toBe(before.isAvailable);
    });
  });
});
