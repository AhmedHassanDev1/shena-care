import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { IngestionEligibilityService } from '../../src/modules/ingestion/services/ingestion-eligibility.service';
import { ProductIdentityService } from '../../src/modules/ingestion/services/product-identity.service';
import { ProductResearchService } from '../../src/modules/ingestion/services/product-research.service';
import { AiClient } from '../../src/platform/ai';
import { Actor, createActor } from '../fixtures/actors';
import { PreviewEligibilityPolicyDto } from '../../src/modules/ingestion/dto/eligibility-policy.dto';
import { ExportProfileService } from '../../src/modules/ingestion/services/export-profile.service';
import { FormatFingerprintService } from '../../src/modules/ingestion/services/format-fingerprint.service';
import { SpreadsheetParserService } from '../../src/modules/ingestion/services/spreadsheet-parser.service';
import { OfferBatchCommitService } from '../../src/modules/ingestion/services/offer-batch-commit.service';
import { createSellableSku } from '../fixtures/sellable-sku';
import { SourcingService } from '../../src/modules/sourcing/public';

describe('Dynamic ingestion eligibility (isolated PostgreSQL + production guards)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let admin: Actor;
  let otherAdmin: Actor;
  let supplierActor: Actor;
  let supplierId: string;
  let brandId: string;
  let deniedId: string;
  let leafId: string;
  let parentId: string;
  let config: PreviewEligibilityPolicyDto;
  let activeId: string;
  let version: number;
  const http = () => request(app.getHttpServer());
  let identity: jest.SpyInstance;
  let fingerprint: jest.SpyInstance;
  let ai: jest.SpyInstance;
  let research: jest.SpyInstance;
  const row = (brand = 'CeraVe Eligibility', category = 'Cleansers Eligibility') => ({ supplierSkuCode: 'R1',
    name: 'CeraVe Cleanser 200ml', brand, category, price: 100, priceType: 'PURCHASE_COST', currency: 'EGP' });
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    db = app.get(PrismaService);
    admin = await createActor(db, 'ADMIN');
    otherAdmin = await createActor(db, 'ADMIN');
    const marker = randomUUID();
    supplierId = (await db.supplier.create({ data: { name: `Eligibility ${marker}`, slug: `eligibility-${marker}` } })).id;
    supplierActor = await createActor(db, 'SUPPLIER', supplierId);
    brandId = (await db.brand.upsert({ where: { name: 'CeraVe Eligibility' }, update: {}, create: { name: 'CeraVe Eligibility', slug: `eligibility-cerave-${marker}` } })).id;
    deniedId = (await db.brand.upsert({ where: { name: 'Excluded Eligibility' }, update: {}, create: { name: 'Excluded Eligibility', slug: `eligibility-excluded-${marker}` } })).id;
    parentId = (await db.category.findFirst({ where: { name: 'Skin Eligibility' } }) ?? await db.category.create({ data: { name: 'Skin Eligibility', slug: `eligibility-parent-${marker}` } })).id;
    leafId = (await db.category.findFirst({ where: { name: 'Cleansers Eligibility', parentId } }) ?? await db.category.create({ data: { name: 'Cleansers Eligibility', slug: `eligibility-leaf-${marker}`, parentId } })).id;
    const service = app.get(IngestionEligibilityService);
    version = (await service.current())?.version ?? 0;
    config = { expectedVersion: version, reason: 'Reviewed integration fixture',
      brands: [{ id: brandId, effect: 'ALLOW', aliases: ['سيرافي اختبار'] }, { id: deniedId, effect: 'DENY', aliases: [] }],
      categories: [{ id: leafId, effect: 'ALLOW' }], mappings: [{ supplierId, label: 'غسول اختبار', categoryIds: [leafId] }] };
    identity = jest.spyOn(app.get(ProductIdentityService), 'classifyCandidateMatch');
    fingerprint = jest.spyOn(app.get(ProductIdentityService), 'rowFingerprint');
    ai = jest.spyOn(app.get(AiClient), 'enrichProduct');
    research = jest.spyOn(app.get(ProductResearchService), 'researchProductCandidate');
  }, 60000);
  afterAll(async () => { jest.restoreAllMocks(); if (app) await app.close(); });
  beforeEach(() => { identity?.mockClear(); fingerprint?.mockClear(); ai?.mockClear(); research?.mockClear(); });

  it('rejects anonymous, supplier, malformed, forged actor and oversized policy edits', async () => {
    await http().get('/ingestion/eligibility').expect(401);
    await http().get('/ingestion/eligibility/options').set(supplierActor.auth).expect(403);
    await http().post('/ingestion/eligibility/preview').set(supplierActor.auth).send(config).expect(403);
    await http().post('/ingestion/eligibility/preview').set(admin.auth).send({ ...config, actorId: otherAdmin.id }).expect(400);
    await http().post('/ingestion/eligibility/preview').set(admin.auth).send({ ...config, brands: [{ id: 'bad', effect: 'ALLOW', aliases: [] }] }).expect(400);
    await http().post('/ingestion/eligibility/preview').set(admin.auth).send({ ...config, brands: [{ id: brandId, effect: 'PERMIT', aliases: [] }] }).expect(400);
    await http().post('/ingestion/eligibility/preview').set(admin.auth).send({ ...config, brands: [{ id: brandId, effect: 'ALLOW', aliases: Array(41).fill('x') }] }).expect(400);
  });
  it('rejects alias collisions and parent ALLOW before saving a preview', async () => {
    await http().post('/ingestion/eligibility/preview').set(admin.auth).send({ ...config,
      brands: [{ id: brandId, effect: 'ALLOW', aliases: ['Excluded Eligibility'] }] }).expect(400);
    await http().post('/ingestion/eligibility/preview').set(admin.auth).send({ ...config,
      categories: [{ id: parentId, effect: 'ALLOW' }] }).expect(400);
  });
  it('requires reviewed preview ownership, records actor/reason and prevents replay', async () => {
    const preview = await http().post('/ingestion/eligibility/preview').set(admin.auth).send(config).expect(201);
    expect(preview.body).toMatchObject({ actorId: admin.id, reason: config.reason, status: 'PREVIEW', version: null,
      impact: { existingOffersChanged: 0, acceptedOrdersChanged: 0 } });
    await http().post(`/ingestion/eligibility/${preview.body.id}/approve`).set(otherAdmin.auth).expect(403);
    const approved = await http().post(`/ingestion/eligibility/${preview.body.id}/approve`).set(admin.auth).expect(201);
    version++;
    activeId = approved.body.id;
    expect(approved.body).toMatchObject({ version, status: 'APPROVED' });
    await http().post(`/ingestion/eligibility/${activeId}/approve`).set(admin.auth).expect(409);
    await expect(db.ingestionEligibilityPolicy.update({ where: { id: activeId }, data: { reason: 'Tampered audit' } })).rejects.toThrow();
  });
  it('holds unknown/ambiguous rows and skips excluded JSON rows with zero expensive work or catalog/offer writes', async () => {
    const productsBefore = await db.product.count();
    const offersBefore = await db.supplierOffer.count();
    const result = await http().post('/ingestion/jobs').set(supplierActor.auth).send({ supplierId, items: [
      row('Excluded Eligibility'), { ...row('Ceravee Eligibility'), supplierSkuCode: 'R2' },
      { ...row('CeraVe Eligibility', 'Unknown category'), supplierSkuCode: 'R3' },
    ] }).expect(201);
    expect(result.body.items).toHaveLength(0);
    const job = await db.ingestionJob.findUniqueOrThrow({ where: { id: result.body.id } });
    expect(job.eligibilityPolicyId).toBe(activeId);
    expect((job.rowOutcomes as Array<{ outcome: string }>).map(r => r.outcome)).toEqual(['POLICY_SKIP', 'POLICY_HOLD', 'POLICY_HOLD']);
    expect(identity).not.toHaveBeenCalled(); expect(fingerprint).not.toHaveBeenCalled();
    expect(ai).not.toHaveBeenCalled(); expect(research).not.toHaveBeenCalled();
    expect(await db.product.count()).toBe(productsBefore); expect(await db.supplierOffer.count()).toBe(offersBefore);
    const holds = await http().get('/ingestion/eligibility/holds').set(admin.auth).expect(200);
    expect(holds.body.rows.some((r: { jobId: string }) => r.jobId === job.id)).toBe(true);
  });
  it('admits reviewed Arabic aliases and leaves identity hard veto separate', async () => {
    const matching = identity.mockResolvedValueOnce({ classification: 'CONFLICT', matchedSkuId: null, reason: 'test_identity_veto', conflicts: ['size'], fingerprint: 'f', canonicalSku: null });
    const result = await http().post('/ingestion/jobs').set(supplierActor.auth).send({ supplierId, items: [row('سِيرافي اختبار', 'غسول اختبار')] }).expect(201);
    expect(result.body.items).toHaveLength(1);
    expect(matching).toHaveBeenCalledWith(expect.objectContaining({ brand: 'CeraVe Eligibility', eligibilityApproved: true }));
    const item = await db.ingestionItem.findUniqueOrThrow({ where: { id: result.body.items[0].id } });
    expect(item.status).toBe('review_required');
    expect(ai).not.toHaveBeenCalled();
  });
  it('pins spreadsheet receipts across policy changes and reuses identical bytes', async () => {
    const csv = 'Code,Name,Brand,Category,Cost\nA1,Perfume bottle,Excluded Eligibility,Cleansers Eligibility,100\nA2,Unknown product,Ceravee Eligibility,unknown,100';
    const parser = app.get(SpreadsheetParserService);
    const parsed = parser.parseSpreadsheet(Buffer.from(csv), 'eligibility.csv');
    const fp = app.get(FormatFingerprintService).computeFingerprint(parsed.headers, parsed.sheets);
    await app.get(ExportProfileService).saveProfile({ supplierId, formatFingerprint: fp, sampleHeaders: parsed.headers,
      isApproved: true, approvedBy: admin.id, mapping: { supplierSku: 'Code', name: 'Name', brand: 'Brand', category: 'Category', price: 'Cost', currency: 'EGP',
        semantics: { documentKind: 'PRICE_LIST', priceBasis: 'UNIT_PURCHASE_COST' } } });
    const upload = () => http().post('/ingestion/jobs/upload').set(supplierActor.auth).attach('file', Buffer.from(csv), { filename: 'eligibility.csv', contentType: 'text/csv' });
    const first = await upload().expect(201);
    expect(first.body.importedItemsCount).toBe(0);
    const service = app.get(IngestionEligibilityService);
    const preview = await service.preview({ ...config, expectedVersion: version, reason: 'Disable approved brand for future files',
      brands: config.brands.map(b => ({ ...b, effect: 'DENY' })) }, admin.id);
    const oldId = activeId;
    const next = await service.approve(preview.id, admin.id); activeId = next.id; version++;
    const second = await upload().expect(201);
    expect(second.body).toMatchObject({ jobId: first.body.jobId, reused: true });
    expect((await db.ingestionJob.findUniqueOrThrow({ where: { id: first.body.jobId } })).eligibilityPolicyId).toBe(oldId);
    expect(identity).not.toHaveBeenCalled(); expect(ai).not.toHaveBeenCalled(); expect(research).not.toHaveBeenCalled();
    const diff = await app.get(OfferBatchCommitService).computeJobDiff(first.body.jobId);
    expect(diff.sourceRows).toMatchObject({ outOfScope: 1, admitted: 0 });
  });
  it('HOLD remains reviewable, retries are idempotent partial successors, and supplier cannot recheck', async () => {
    const result = await http().post('/ingestion/jobs').set(supplierActor.auth).send({ supplierId, mode: 'FULL_SNAPSHOT', items: [row('Unknown reviewed brand', 'Unknown mapped category')] }).expect(201);
    const jobId = result.body.id;
    await http().post(`/ingestion/eligibility/jobs/${jobId}/recheck`).set(supplierActor.auth).send({ reason: 'Try recheck without authority' }).expect(403);
    const first = await http().post(`/ingestion/eligibility/jobs/${jobId}/recheck`).set(admin.auth).send({ reason: 'Review unknown labels without guessing' }).expect(201);
    const second = await http().post(`/ingestion/eligibility/jobs/${jobId}/recheck`).set(admin.auth).send({ reason: 'Repeat reviewed operation' }).expect(201);
    expect(first.body.jobId).toBe(second.body.jobId);
    expect(first.body.jobId).not.toBe(jobId);
    const successor = await db.ingestionJob.findUniqueOrThrow({ where: { id: first.body.jobId } });
    expect(successor.mode).toBe('PARTIAL_UPDATE');
    expect(identity).not.toHaveBeenCalled(); expect(ai).not.toHaveBeenCalled();
    const commit = await app.get(OfferBatchCommitService).commitJobOffers(jobId);
    expect(commit).toMatchObject({ status: 'review_required', heldForReviewCount: 1, deactivatedCount: 0 });
  });
  it('policy activation preserves existing supplier offers and accepted orders byte-for-byte', async () => {
    const sku = await createSellableSku(db);
    const offer = await db.supplierOffer.findUniqueOrThrow({ where: { supplierId_skuId: { supplierId: sku.supplierId, skuId: sku.id } } });
    const order = await db.order.create({ data: { orderNumber: `ELIGIBILITY-${randomUUID()}`, customerName: 'Local fixture',
      customerPhone: '01000000000', shippingAddress: 'Local isolated test', totalAmount: 100, currency: 'EGP', status: 'placed' } });
    const service = app.get(IngestionEligibilityService);
    const preview = await service.preview({ ...config, expectedVersion: version, reason: 'Measure exclusion impact without changing commitments' }, admin.id);
    expect((preview.impact as { existingOffersAffected: number }).existingOffersAffected).toBeGreaterThan(0);
    const next = await service.approve(preview.id, admin.id); activeId = next.id; version++;
    expect(await db.supplierOffer.findUniqueOrThrow({ where: { id: offer.id } })).toEqual(offer);
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toEqual(order);
  });
  it('keeps an already pinned admission valid when policy changes during matching', async () => {
    const pinned = activeId;
    const service = app.get(IngestionEligibilityService);
    const conflict = { classification: 'CONFLICT', matchedSkuId: null, reason: 'identity_review', conflicts: ['size'], fingerprint: 'f', canonicalSku: null };
    identity.mockImplementationOnce(async () => {
      const preview = await service.preview({ ...config, expectedVersion: version, reason: 'Change eligibility while admitted rows are matching',
        brands: config.brands.map(b => ({ ...b, effect: 'DENY' as const })) }, admin.id);
      const next = await service.approve(preview.id, admin.id); activeId = next.id; version++;
      return conflict;
    }).mockResolvedValueOnce(conflict);
    const result = await http().post('/ingestion/jobs').set(supplierActor.auth).send({ supplierId,
      items: [row(), { ...row(), supplierSkuCode: 'R2' }] }).expect(201);
    expect(result.body.items).toHaveLength(2);
    expect(identity).toHaveBeenCalledTimes(2);
    expect((await db.ingestionJob.findUniqueOrThrow({ where: { id: result.body.id } })).eligibilityPolicyId).toBe(pinned);
    const future = await http().post('/ingestion/jobs').set(supplierActor.auth).send({ supplierId, items: [row()] }).expect(201);
    expect(future.body.items).toHaveLength(0);
    expect(identity).toHaveBeenCalledTimes(2);
  });
  it('blocks full-snapshot deactivation when policy exclusions removed rows from the file', async () => {
    const sku = await createSellableSku(db);
    const offer = await db.supplierOffer.create({ data: { supplierId, skuId: sku.id, costPrice: 50, currency: 'EGP', isAvailable: true } });
    const result = await http().post('/ingestion/jobs').set(supplierActor.auth).send({ supplierId, mode: 'FULL_SNAPSHOT', items: [row('Excluded Eligibility')] }).expect(201);
    const batch = app.get(OfferBatchCommitService);
    const committed = await batch.commitJobOffers(result.body.id);
    expect(committed).toMatchObject({ skippedCount: 1, committedCount: 0, deactivatedCount: 0 });
    await expect(batch.approveDeactivations(result.body.id, admin.id, {
      supplierId, confirmedAssortmentCoverage: true, approvedSkuIds: [sku.id],
    })).rejects.toThrow('Snapshot has unresolved source rows');
    expect(await db.supplierOffer.findUniqueOrThrow({ where: { id: offer.id } })).toEqual(offer);
    expect(identity).not.toHaveBeenCalled(); expect(ai).not.toHaveBeenCalled();
  });
  it('releases reviewed HOLD labels under a new snapshot without editing the original job', async () => {
    const held = await http().post('/ingestion/jobs').set(supplierActor.auth).send({ supplierId,
      items: [row('Reviewed new Arabic label', 'Reviewed new supplier category')] }).expect(201);
    const original = await db.ingestionJob.findUniqueOrThrow({ where: { id: held.body.id } });
    const service = app.get(IngestionEligibilityService);
    const preview = await service.preview({ ...config, expectedVersion: version, reason: 'Resolve held brand alias and supplier category after review',
      brands: config.brands.map(b => b.id === brandId ? { ...b, aliases: [...b.aliases, 'Reviewed new Arabic label'] } : b),
      mappings: [...config.mappings, { supplierId, label: 'Reviewed new supplier category', categoryIds: [leafId] }],
    }, admin.id);
    const next = await service.approve(preview.id, admin.id); activeId = next.id; version++;
    identity.mockResolvedValueOnce({ classification: 'CONFLICT', matchedSkuId: null, reason: 'identity_still_requires_review', conflicts: [], fingerprint: 'f', canonicalSku: null });
    const retry = await http().post(`/ingestion/eligibility/jobs/${original.id}/recheck`).set(admin.auth).send({ reason: 'Apply reviewed alias and category mapping' }).expect(201);
    const successor = await db.ingestionJob.findUniqueOrThrow({ where: { id: retry.body.jobId }, include: { items: true } });
    expect(successor).toMatchObject({ eligibilityPolicyId: activeId, mode: 'PARTIAL_UPDATE' });
    expect(successor.items).toHaveLength(1);
    expect(successor.items[0].brand).toBe('CeraVe Eligibility');
    expect(await db.ingestionJob.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
    expect(ai).not.toHaveBeenCalled();
  });
  it('preserves the real known-SKU fast lane and F1 freshness under an approved dynamic policy', async () => {
    const sku = await createSellableSku(db);
    await db.product.update({ where: { id: sku.productId }, data: { brandId, categoryId: leafId, name: 'CeraVe Cleanser' } });
    await db.sku.update({ where: { id: sku.id }, data: { size: 200, variantName: '200 ml' } });
    await db.sellingPrice.updateMany({ where: { skuId: sku.id }, data: { amount: 200 } });
    await db.supplierOffer.updateMany({ where: { supplierId: sku.supplierId, skuId: sku.id }, data: { isAvailable: false } });
    const stale = new Date('2020-01-01T00:00:00Z');
    const offer = await db.supplierOffer.create({ data: { supplierId, skuId: sku.id, costPrice: 100, currency: 'EGP',
      lastObservedAt: stale, lastConfirmedAt: stale, quantityUpdatedAt: stale, availableQuantity: 7 } });
    const imported = await http().post('/ingestion/jobs').set(supplierActor.auth).send({ supplierId,
      items: [{ ...row(), supplierSkuCode: `REAL-${sku.id}`, barcode: sku.barcode, price: 110 }] }).expect(201);
    const item = await db.ingestionItem.findUniqueOrThrow({ where: { id: imported.body.items[0].id } });
    expect(item.matchedSkuId).toBe(sku.id);
    expect(identity).toHaveBeenCalledTimes(1);
    expect(ai).not.toHaveBeenCalled(); expect(research).not.toHaveBeenCalled();
    const committed = await app.get(OfferBatchCommitService).commitJobOffers(imported.body.id, { autoApplyLowRisk: true, allowPriceOnlyUpdates: true, actorId: admin.id });
    expect(committed.committedCount).toBe(1);
    const after = await db.supplierOffer.findUniqueOrThrow({ where: { id: offer.id } });
    expect(after.costPrice.toNumber()).toBe(110);
    expect(after.lastObservedAt).toEqual(stale); expect(after.quantityUpdatedAt).toEqual(stale);
    expect(await app.get(SourcingService).getPurchaseAvailability(sku.id)).toMatchObject({ orderable: false });
  });
  it('rejects stale previews and concurrent activation assigns a single next version', async () => {
    const service = app.get(IngestionEligibilityService);
    const a = await service.preview({ ...config, expectedVersion: version, reason: 'Concurrency preview A' }, admin.id);
    const b = await service.preview({ ...config, expectedVersion: version, reason: 'Concurrency preview B' }, admin.id);
    const results = await Promise.allSettled([service.approve(a.id, admin.id), service.approve(b.id, admin.id)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    version++;
  });
});
