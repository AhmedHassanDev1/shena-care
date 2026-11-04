// GLO-285: the identity route and Top-K candidates a reviewer sees and confirms, over HTTP against a real PostgreSQL.
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { IngestionService } from '../../src/modules/ingestion/services/ingestion.service';
import { createActor, Actor } from '../fixtures/actors';
import { gtin } from '../fixtures/glo285-matching-corpus';

describe('GLO-285 candidate review contract (disposable PostgreSQL)', () => {
  let app: INestApplication, db: PrismaService, ingestion: IngestionService;
  let admin: Actor, operator: Actor, supplier: string, brandId: string, job: string;
  const marker = randomUUID().slice(0, 8);
  const brandName = `Glo${marker}`;
  const barcodeOf = (n: number) => gtin(`29${parseInt(marker, 16).toString().padStart(9, '0').slice(-9)}${n}`);
  const skus: Record<string, string> = {};

  const product = async (name: string, packs: Array<{ key: string; size: number | null; unit: string | null; pack?: number; barcode?: string }>) => {
    const created = await db.product.create({ data: { name, slug: `${marker}-${Object.keys(skus).length}`, brandId } });
    for (const p of packs) skus[p.key] = (await db.sku.create({ data: { productId: created.id, code: `${marker}-${p.key}`,
      variantName: 'Default', size: p.size, sizeUnit: p.unit, packCount: p.pack, barcode: p.barcode } })).id;
  };

  const matched = async (name: string, facts: { size?: number; unit?: string; pack?: number; barcode?: string; code?: string } = {}) => {
    const item = await db.ingestionItem.create({ data: { jobId: job, supplierSkuCode: facts.code ?? randomUUID(), name, brand: brandName,
      barcode: facts.barcode ?? null, price: 100, currency: 'EGP', priceType: 'PURCHASE_COST', reportedQuantity: null, status: 'pending',
      enrichment: { source: { normalized: { extractedSize: facts.size ?? null, extractedUnit: facts.unit ?? null, extractedPackCount: facts.pack ?? null },
        eligibility: { outcome: 'ALLOW', policyId: randomUUID(), version: 1, brandId, brandName, categoryId: randomUUID() } } } } });
    await ingestion.processMatching(job);
    return item.id;
  };
  const record = (id: string, actor: Actor = admin) => request(app.getHttpServer()).get(`/ingestion/candidates/${id}/review-record`).set(actor.auth);
  const confirm = (id: string, skuId: string, actor: Actor = admin) =>
    request(app.getHttpServer()).patch(`/ingestion/candidates/${id}/approve`).set(actor.auth).send({ matchedSkuId: skuId, identityEvidence: 'Checked against the supplier invoice' });
  const stored = async (id: string) => {
    const row = await db.ingestionItem.findUniqueOrThrow({ where: { id } });
    return { status: row.status, matchedSkuId: row.matchedSkuId, enrichment: row.enrichment as Record<string, any> };
  };
  const aliasCount = () => db.supplierSkuAlias.count({ where: { supplierId: supplier } });

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); app.useLogger(false);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get(PrismaService); ingestion = app.get(IngestionService);
    const database = new URL(process.env.DATABASE_URL!).pathname.slice(1);
    expect(database).toMatch(/_test$/);
    expect(await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`).toEqual([{ name: database }]);
    admin = await createActor(db, 'ADMIN');
    operator = await createActor(db, 'HUB_OPERATOR');
    supplier = (await db.supplier.create({ data: { name: marker, slug: marker } })).id;
    brandId = (await db.brand.create({ data: { name: brandName, slug: marker } })).id;
    await product('Hydrating Facial Cleanser', [{ key: 'hydra236', size: 236, unit: 'ml', pack: 1 }, { key: 'hydra473', size: 473, unit: 'ml', barcode: barcodeOf(2) }]);
    await product('Foaming Facial Cleanser', [{ key: 'foam236', size: 236, unit: 'ml' }]);
    await product('Daily Moisturizing Lotion', [{ key: 'lotion', size: null, unit: null }]);
    await product('Vitamin Glow Serum', [{ key: 'serum', size: 30, unit: 'ml', barcode: barcodeOf(3) }]);
    job = (await db.ingestionJob.create({ data: { supplierId: supplier, status: 'review_required' } })).id;
  });

  afterAll(async () => {
    if (db && brandId) {
      await db.supplierSkuAlias.deleteMany({ where: { supplierId: supplier } });
      await db.ingestionItem.deleteMany({ where: { jobId: job } });
      await db.ingestionJob.deleteMany({ where: { id: job } });
      await db.sku.deleteMany({ where: { product: { brandId } } });
      await db.product.deleteMany({ where: { brandId } });
      await db.brand.delete({ where: { id: brandId } });
      await db.supplier.delete({ where: { id: supplier } });
    }
    if (app) await app.close();
  });

  it('returns the stored route, suggestion, ranked candidates and conflict reasons', async () => {
    const id = await matched(`${brandName} Hydrating Facial Cleanser 236ml`, { size: 236, unit: 'ml', pack: 1 });
    const { body } = await record(id).expect(200);
    const identity = (await stored(id)).enrichment.identity;

    expect(body.identityMatch).toMatchObject({ route: 'AMBIGUOUS', suggestedSkuId: skus.hydra236, suggestedSku: null, confirmable: true,
      conflicts: ['candidate_requires_identity_review'], matchReason: 'retrieved_candidate_requires_review', matchedAt: identity.matchedAt });
    expect(body.identityMatch.candidates).toEqual(identity.candidates.map((candidate: object) => ({ ...candidate, imageUrl: null })));
    expect(body.identityMatch.candidates[0]).toMatchObject({ skuId: skus.hydra236, code: `${marker}-hydra236`, productName: 'Hydrating Facial Cleanser',
      size: 236, sizeUnit: 'ml', packCount: 1, score: expect.any(Number), samePackaging: true });
  });

  it('keeps the stored rank order instead of re-sorting by score', async () => {
    const id = await matched(`${brandName} Facial Cleanser 236ml`, { size: 236, unit: 'ml' });
    const before = await stored(id);
    const reversed = [...before.enrichment.identity.candidates].reverse();
    expect(reversed.length).toBeGreaterThan(1);
    await db.ingestionItem.update({ where: { id }, data: { enrichment: { ...before.enrichment,
      identity: { ...before.enrichment.identity, candidates: reversed } } as Prisma.InputJsonValue } });

    const { body } = await record(id).expect(200);
    expect(body.identityMatch.candidates.map((c: { skuId: string }) => c.skuId)).toEqual(reversed.map(c => c.skuId));
  });

  it('reports an empty state for a new product and for a row matching never reached', async () => {
    const fresh = await matched(`${brandName} Unrelated Sunscreen Stick 15g`, { size: 15, unit: 'g' });
    const { body: created } = await record(fresh).expect(200);
    expect(created.identityMatch).toMatchObject({ route: 'NEW', suggestedSkuId: null, suggestedSku: null, candidates: [], confirmable: false });

    const unmatched = await db.ingestionItem.create({ data: { jobId: job, supplierSkuCode: randomUUID(), name: `${brandName} Unmatched`, brand: brandName,
      price: 100, currency: 'EGP', priceType: 'PURCHASE_COST', status: 'review_required',
      enrichment: { source: { eligibility: { outcome: 'ALLOW', policyId: randomUUID(), version: 1, brandId, brandName, categoryId: randomUUID() } } } } });
    const { body: legacy } = await record(unmatched.id).expect(200);
    expect(legacy.identityMatch).toMatchObject({ route: null, suggestedSkuId: null, suggestedSku: null, candidates: [], conflicts: [], matchReason: null, matchedAt: null, confirmable: false });
  });

  it('shows a barcode suggestion that retrieval never ranked, with its packaging', async () => {
    const id = await matched(`${brandName} Serum Unknown Words 30ml`, { size: 30, unit: 'ml', barcode: barcodeOf(3) });
    const { body } = await record(id).expect(200);
    expect(body.identityMatch).toMatchObject({ route: 'AMBIGUOUS', suggestedSkuId: skus.serum, candidates: [], confirmable: true,
      suggestedSku: { id: skus.serum, code: `${marker}-serum`, size: 30, sizeUnit: 'ml' } });
  });

  it('lists a conflict without offering confirmation', async () => {
    const id = await matched(`${brandName} Hydrating Facial Cleanser 100ml`, { size: 100, unit: 'ml', barcode: barcodeOf(2) });
    const { body } = await record(id).expect(200);
    expect(body.identityMatch).toMatchObject({ route: 'CONFLICT', confirmable: false });
    expect(body.identityMatch.conflicts).toContain('barcode_size_mismatch');
  });

  it('lets an Admin confirm a listed candidate in one call, then reuses that wording on the next import', async () => {
    const code = randomUUID();
    const wording = `${brandName} Hydrating Facial Cleanser 236ml`;
    const id = await matched(wording, { size: 236, unit: 'ml', pack: 1, code });
    await confirm(id, skus.hydra236).expect(200);

    const { body } = await record(id).expect(200);
    expect(body.status).toBe('approved');
    expect(body.normalizedIdentity.matchedSkuId).toBe(skus.hydra236);
    expect(body.identityMatch.confirmable).toBe(false);
    expect(await db.supplierSkuAlias.findUnique({ where: { supplierId_supplierSkuCode: { supplierId: supplier, supplierSkuCode: code } } }))
      .toMatchObject({ skuId: skus.hydra236 });

    const again = await matched(wording, { size: 236, unit: 'ml', pack: 1, code });
    expect(await stored(again)).toMatchObject({ matchedSkuId: skus.hydra236 });
    const { body: reused } = await record(again).expect(200);
    expect(reused.identityMatch).toMatchObject({ route: 'VERIFIED', candidates: [], confirmable: false });
  });

  it('refuses a listed candidate whose packaging is unknown and writes nothing', async () => {
    const id = await matched(`${brandName} Daily Moisturizing Lotion`);
    const { body } = await record(id).expect(200);
    const candidate = body.identityMatch.candidates.find((c: { skuId: string }) => c.skuId === skus.lotion);
    expect(candidate).toMatchObject({ samePackaging: false, size: null, sizeUnit: null });
    const [before, aliases] = [await stored(id), await aliasCount()];

    const refused = await confirm(id, skus.lotion).expect(409);
    expect(refused.body.message).toMatch(/^INSUFFICIENT_EVIDENCE: identity_requires_independent_evidence/);
    expect(await stored(id)).toEqual(before);
    expect(await aliasCount()).toBe(aliases);
  });

  it('refuses a SKU the row never listed and writes nothing', async () => {
    const id = await matched(`${brandName} Hydrating Facial Cleanser 236ml`, { size: 236, unit: 'ml', pack: 1 });
    const { body } = await record(id).expect(200);
    expect(body.identityMatch.candidates.map((c: { skuId: string }) => c.skuId)).not.toContain(skus.serum);
    const [before, aliases] = [await stored(id), await aliasCount()];

    await confirm(id, skus.serum).expect(409);
    expect(await stored(id)).toEqual(before);
    expect(await aliasCount()).toBe(aliases);
  });

  it('refuses a candidate retired after it was stored, though the record still lists it', async () => {
    const id = await matched(`${brandName} Foaming Facial Cleanser 236ml`, { size: 236, unit: 'ml' });
    const { body } = await record(id).expect(200);
    expect(body.identityMatch.candidates.map((c: { skuId: string }) => c.skuId)).toContain(skus.foam236);
    const before = await stored(id);
    await db.sku.update({ where: { id: skus.foam236 }, data: { isActive: false } });
    try {
      const refused = await confirm(id, skus.foam236).expect(409);
      expect(refused.body.message).toContain('canonical_sku_inactive');
      expect(await stored(id)).toEqual(before);
    } finally {
      await db.sku.update({ where: { id: skus.foam236 }, data: { isActive: true } });
    }
  });

  it('lets a hub operator read the contract but not confirm', async () => {
    const id = await matched(`${brandName} Hydrating Facial Cleanser 236ml`, { size: 236, unit: 'ml', pack: 1 });
    const { body } = await record(id, operator).expect(200);
    expect(body.identityMatch.candidates.length).toBeGreaterThan(0);
    await confirm(id, skus.hydra236, operator).expect(403);
    expect(await stored(id)).toMatchObject({ status: 'review_required', matchedSkuId: null });
  });

  it('replaces stored candidates when a reviewer corrects the wording', async () => {
    const id = await matched(`${brandName} Foaming Facial Cleanser 236ml`);
    const { body: first } = await record(id).expect(200);
    expect(first.identityMatch.candidates[0].skuId).toBe(skus.foam236);

    await request(app.getHttpServer()).patch(`/ingestion/candidates/${id}/correct`).set(admin.auth)
      .send({ name: `${brandName} Totally Different Sunscreen 15g`, reason: 'Supplier sent the wrong title' }).expect(200);
    const { body: corrected } = await record(id).expect(200);
    expect(corrected.identityMatch).toMatchObject({ route: 'NEW', candidates: [], suggestedSkuId: null, confirmable: false });
  });
});
