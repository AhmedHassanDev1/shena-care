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
import { EligibilityDocument } from '../../src/modules/ingestion/services/ingestion-eligibility.policy';
import { ExportProfileService } from '../../src/modules/ingestion/services/export-profile.service';
import { SpreadsheetParserService } from '../../src/modules/ingestion/services/spreadsheet-parser.service';
import { FormatFingerprintService } from '../../src/modules/ingestion/services/format-fingerprint.service';

describe('Egyptian supplier operational eligibility — isolated PostgreSQL', () => {
  let app: INestApplication;
  let db: PrismaService;
  let service: IngestionEligibilityService;
  let admin: Actor;
  let supplierActor: Actor;
  let supplierId: string;
  let secondSupplierId: string;
  let brandId: string;
  let excludedBrandId: string;
  let categoryId: string;
  let excludedCategoryId: string;
  let version: number;
  let originalJobId: string;
  let identity: jest.SpyInstance;
  let ai: jest.SpyInstance;
  let research: jest.SpyInstance;
  const http = () => request(app.getHttpServer());
  const row = (code: string, brand: string, category: string) => ({ supplierSkuCode: code, name: `Supplier cleanser ${code} 200ml`,
    brand, category, price: 100, priceType: 'PURCHASE_COST', currency: 'EGP' });
  const rules = (doc: EligibilityDocument) => ({
    brands: doc.brands.filter(b => b.effect).map(b => [b.id, b.effect]).sort(),
    categories: doc.categories.filter(c => c.effect).map(c => [c.id, c.effect]).sort(),
  });
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); app.useLogger(false);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init(); db = app.get(PrismaService); service = app.get(IngestionEligibilityService);
    admin = await createActor(db, 'ADMIN');
    const marker = randomUUID();
    supplierId = (await db.supplier.create({ data: { name: `Operational A ${marker}`, slug: `operational-a-${marker}` } })).id;
    secondSupplierId = (await db.supplier.create({ data: { name: `Operational B ${marker}`, slug: `operational-b-${marker}` } })).id;
    supplierActor = await createActor(db, 'SUPPLIER', supplierId);
    brandId = (await db.brand.upsert({ where: { name: 'CeraVe' }, update: {}, create: { name: 'CeraVe', slug: 'operational-cerave' } })).id;
    excludedBrandId = (await db.brand.upsert({ where: { name: 'Operational Excluded Brand' }, update: {}, create: { name: 'Operational Excluded Brand', slug: 'operational-excluded' } })).id;
    categoryId = (await db.category.upsert({ where: { slug: 'operational-facial-cleansers' }, update: {}, create: { name: 'Operational Facial Cleansers', slug: 'operational-facial-cleansers' } })).id;
    excludedCategoryId = (await db.category.upsert({ where: { slug: 'operational-perfumes' }, update: {}, create: { name: 'Operational Perfumes', slug: 'operational-perfumes' } })).id;
    version = (await service.current())?.version ?? 0;
    const preview = await service.preview({ expectedVersion: version, reason: 'Reviewed Egyptian supplier fixture labels',
      brands: [{ id: brandId, effect: 'ALLOW', aliases: ['سيرافي', 'سرافي'] }, { id: excludedBrandId, effect: 'DENY', aliases: [] }],
      categories: [{ id: categoryId, effect: 'ALLOW', aliases: ['غسول الوجه'] }, { id: excludedCategoryId, effect: 'DENY' }],
      mappings: [{ supplierId, label: 'غسول بشرة', categoryIds: [categoryId] },
        { supplierId: secondSupplierId, label: 'Face Wash B', categoryIds: [categoryId] },
        { supplierId, label: 'عناية', categoryIds: [categoryId, excludedCategoryId] }],
    }, admin.id);
    await service.approve(preview.id, admin.id); version++;
    identity = jest.spyOn(app.get(ProductIdentityService), 'classifyCandidateMatch').mockResolvedValue({ classification: 'CONFLICT',
      matchedSkuId: null, fingerprint: 'fixture', reason: 'hard_identity_review_still_required', conflicts: ['identity_unverified'], canonicalSku: null });
    ai = jest.spyOn(app.get(AiClient), 'enrichProduct');
    research = jest.spyOn(app.get(ProductResearchService), 'researchProductCandidate');
  }, 60000);
  afterAll(async () => { jest.restoreAllMocks(); if (app) await app.close(); });
  beforeEach(() => { identity?.mockClear(); ai?.mockClear(); research?.mockClear(); });

  it('reports four ALLOW, two SKIP and four HOLD without creating products, offers or unsafe SKU links', async () => {
    const products = await db.product.findMany(); const offers = await db.supplierOffer.findMany();
    const response = await http().post('/ingestion/jobs').set(supplierActor.auth).send({ supplierId, items: [
      row('A1', 'CeraVe', 'غسول بشرة'), row('A2', 'سيرافي', 'غسول-بشرة'), row('A3', 'سرافي', 'غسول الوجه'), row('A4', 'ماركة Cera-Ve أصلي', 'غسول الوجه'),
      row('S1', 'CeraVe', 'Operational Perfumes'), row('S2', 'Operational Excluded Brand', 'غسول بشرة'),
      row('H1', 'Ceravee', 'غسول بشرة'), row('H2', 'شبيه سيرافي', 'غسول بشرة'), row('H3', 'CeraVe', ''), row('H4', 'CeraVe', 'عناية'),
    ] }).expect(201);
    originalJobId = response.body.id;
    const job = await db.ingestionJob.findUniqueOrThrow({ where: { id: originalJobId }, include: { items: true } });
    const outcomes = job.rowOutcomes as Array<{ outcome: string; reason: string }>;
    expect(outcomes.filter(r => r.outcome === 'IMPORTED_MANUAL')).toHaveLength(4);
    expect(outcomes.filter(r => r.outcome === 'POLICY_SKIP')).toHaveLength(2);
    expect(outcomes.filter(r => r.outcome === 'POLICY_HOLD')).toHaveLength(4);
    expect(job.items.every(i => i.matchedSkuId === null)).toBe(true);
    expect(identity).toHaveBeenCalledTimes(4); expect(ai).not.toHaveBeenCalled(); expect(research).not.toHaveBeenCalled();
    expect(await db.product.findMany()).toEqual(products); expect(await db.supplierOffer.findMany()).toEqual(offers);
    console.info('Egyptian fixture: ALLOW=4 SKIP=2 HOLD=4; four identity reviews remain separate from eligibility.');
  });
  it('uses the same global brand approvals for a second supplier with its own reviewed category label', async () => {
    const result = await http().post('/ingestion/jobs').set(admin.auth).send({ supplierId: secondSupplierId,
      items: ['CeraVe', 'سرافي', 'C E R A V E'].map((b, i) => row(`B${i}`, b, 'Face-Wash B')) }).expect(201);
    expect(result.body.items).toHaveLength(3);
    expect(result.body.items.every((i: { brand: string }) => i.brand === 'CeraVe')).toBe(true);
    expect(identity).toHaveBeenCalledTimes(3);
  });
  it('makes zero identity, AI, research or Product/Offer changes for an excluded-only import', async () => {
    const products = await db.product.findMany(); const offers = await db.supplierOffer.findMany();
    const result = await http().post('/ingestion/jobs').set(supplierActor.auth).send({ supplierId,
      items: [row('ONLY-S1', 'Cera-Ve', 'Operational Perfumes'), row('ONLY-S2', 'Operational Excluded Brand', '')] }).expect(201);
    const job = await db.ingestionJob.findUniqueOrThrow({ where: { id: result.body.id } });
    expect((job.rowOutcomes as Array<{ outcome: string }>).every(r => r.outcome === 'POLICY_SKIP')).toBe(true);
    expect(result.body.items).toHaveLength(0);
    expect(identity).not.toHaveBeenCalled(); expect(ai).not.toHaveBeenCalled(); expect(research).not.toHaveBeenCalled();
    expect(await db.product.findMany()).toEqual(products); expect(await db.supplierOffer.findMany()).toEqual(offers);
  });
  it('retrieves grouped suggestions while preserving explicit missing/ambiguous category reasons', async () => {
    const response = await http().get('/ingestion/eligibility/holds').set(admin.auth).expect(200);
    const groups = response.body.groups.filter((g: { supplierId: string }) => g.supplierId === supplierId);
    expect(groups).toHaveLength(4);
    expect(groups.find((g: { brandKey: string }) => g.brandKey === 'ceravee')).toMatchObject({ count: 1, jobCount: 1,
      reasons: ['BRAND_UNKNOWN'], suggestions: expect.arrayContaining([expect.objectContaining({ brandId })]) });
    expect(groups.some((g: { reasons: string[] }) => g.reasons.includes('CATEGORY_UNKNOWN'))).toBe(true);
    expect(groups.some((g: { reasons: string[] }) => g.reasons.includes('CATEGORY_AMBIGUOUS'))).toBe(true);
    expect(identity).not.toHaveBeenCalled(); expect(ai).not.toHaveBeenCalled();
  });
  it('denies supplier mapping approval and forged central rule changes through the mapping-only endpoint', async () => {
    const payload = { expectedVersion: version, reason: 'Review reusable supplier naming', brands: [], categories: [], mappings: [] };
    await http().post('/ingestion/eligibility/mappings/preview').send(payload).expect(401);
    await http().post('/ingestion/eligibility/mappings/preview').set(supplierActor.auth).send(payload).expect(403);
    await http().post('/ingestion/eligibility/mappings/preview').set(admin.auth).send({ ...payload,
      brands: [{ id: excludedBrandId, effect: 'ALLOW', aliases: ['Sneaky brand'] }] }).expect(400);
    await http().post('/ingestion/eligibility/mappings/preview').set(admin.auth).send({ ...payload,
      categories: [{ id: categoryId, aliases: ['Operational Perfumes'] }] }).expect(400);
    await http().post('/ingestion/eligibility/mappings/preview').set(admin.auth).send({ ...payload,
      brands: [{ id: excludedBrandId, aliases: ['Cera Ve'] }] }).expect(400);
    await http().post('/ingestion/eligibility/holds/recheck').set(supplierActor.auth).send({ supplierId, brand: 'Ceravee', category: 'غسول بشرة', expectedVersion: version, reason: 'Unauthorized bulk recheck' }).expect(403);
  });
  it('learns an explicitly reviewed reusable alias once without expanding the central policy, then bulk releases it', async () => {
    const before = await service.current(); const doc = before!.document as unknown as EligibilityDocument;
    const original = await db.ingestionJob.findUniqueOrThrow({ where: { id: originalJobId }, include: { items: true } });
    const preview = await http().post('/ingestion/eligibility/mappings/preview').set(admin.auth).send({ expectedVersion: version,
      reason: 'Reviewed Ceravee as a genuine supplier spelling of CeraVe',
      brands: [{ id: brandId, aliases: ['سيرافي', 'سرافي', 'Ceravee'] }], categories: [], mappings: doc.mappings }).expect(201);
    expect(rules(preview.body.document)).toEqual(rules(doc));
    await http().post(`/ingestion/eligibility/${preview.body.id}/approve`).set(admin.auth).expect(201); version++;
    const payload = { supplierId, brand: 'Ceravee', category: 'غسول بشرة', expectedVersion: version, reason: 'Apply the reviewed reusable alias across source files' };
    const result = await http().post('/ingestion/eligibility/holds/recheck').set(admin.auth).send(payload).expect(201);
    expect(result.body).toMatchObject({ recheckedJobs: 1, hasMore: false, results: [expect.objectContaining({ counts: { ALLOW: 1, SKIP: 0, HOLD: 3 } })] });
    const replay = await http().post('/ingestion/eligibility/holds/recheck').set(admin.auth).send(payload).expect(201);
    expect(replay.body.recheckedJobs).toBe(0);
    expect(await db.ingestionJob.findUniqueOrThrow({ where: { id: originalJobId }, include: { items: true } })).toEqual(original);
    const groups = (await http().get('/ingestion/eligibility/holds').set(admin.auth).expect(200)).body.groups.filter((g: { supplierId: string }) => g.supplierId === supplierId);
    expect(groups.reduce((n: number, g: { count: number }) => n + g.count, 0)).toBe(3);
    expect(identity).toHaveBeenCalledTimes(1);
    const future = await http().post('/ingestion/jobs').set(supplierActor.auth).send({ supplierId, items: [row('F1', 'Cera-vee', 'غسول بشرة')] }).expect(201);
    expect(future.body.items).toHaveLength(1);
  });
  it('counts all repeated labels before the 200-group response limit, across files and Arabic formatting', async () => {
    for (let file = 0; file < 2; file++) await http().post('/ingestion/jobs').set(supplierActor.auth).send({ supplierId,
      items: Array.from({ length: 300 }, (_, i) => row(`G${file}-${i}`, i % 2 ? 'مجهول تجريبي' : 'مَجهول-تجريبي', 'غسول بشرة')) }).expect(201);
    const response = await http().get('/ingestion/eligibility/holds').set(admin.auth).expect(200);
    const group = response.body.groups.find((g: { supplierId: string; brandKey: string }) => g.supplierId === supplierId && g.brandKey === 'مجهولتجريبي');
    expect(group).toMatchObject({ count: 600, jobCount: 2 });
    expect(group.examples).toHaveLength(3);
    expect(identity).not.toHaveBeenCalled(); expect(ai).not.toHaveBeenCalled(); expect(research).not.toHaveBeenCalled();
  });
  it('preserves verified CSV provenance through successive bulk label resolutions and duplicate uploads', async () => {
    const brandLabel = 'CSV Raw CeraVe Label'; const categoryLabel = 'CSV face gel';
    const csv = `Code,Name,Brand,Category,Cost\nCSV1,CSV Cleanser 200ml,${brandLabel},${categoryLabel},100`;
    const parsed = app.get(SpreadsheetParserService).parseSpreadsheet(Buffer.from(csv), 'operational.csv');
    const fingerprint = app.get(FormatFingerprintService).computeFingerprint(parsed.headers, parsed.sheets);
    await app.get(ExportProfileService).saveProfile({ supplierId, formatFingerprint: fingerprint, sampleHeaders: parsed.headers,
      isApproved: true, approvedBy: admin.id, mapping: { supplierSku: 'Code', name: 'Name', brand: 'Brand', category: 'Category', price: 'Cost', currency: 'EGP',
        semantics: { documentKind: 'PRICE_LIST', priceBasis: 'UNIT_PURCHASE_COST' } } });
    const upload = () => http().post('/ingestion/jobs/upload').set(supplierActor.auth).attach('file', Buffer.from(csv), { filename: 'operational.csv', contentType: 'text/csv' });
    const receipt = await upload().expect(201);
    const original = await db.ingestionJob.findUniqueOrThrow({ where: { id: receipt.body.jobId } });
    expect((await upload().expect(201)).body).toMatchObject({ jobId: original.id, reused: true, requiresMapping: false });
    const firstDoc = (await service.current())!.document as unknown as EligibilityDocument;
    const first = await service.previewMappings({ expectedVersion: version, reason: 'Review reusable CSV brand spelling first', categories: [], mappings: firstDoc.mappings,
      brands: [{ id: brandId, aliases: [...firstDoc.brands.find(b => b.id === brandId)!.aliases, brandLabel] }] }, admin.id);
    await service.approve(first.id, admin.id); version++;
    const recheck = () => http().post('/ingestion/eligibility/holds/recheck').set(admin.auth).send({ supplierId, brand: brandLabel,
      category: categoryLabel, expectedVersion: version, reason: 'Bulk recheck reviewed CSV labels' });
    const held = await recheck().expect(201);
    expect(held.body.results[0].counts).toMatchObject({ ALLOW: 0, HOLD: 1 });
    const nextDoc = (await service.current())!.document as unknown as EligibilityDocument;
    const next = await service.previewMappings({ expectedVersion: version, reason: 'Review independent canonical category alias next', brands: [], mappings: nextDoc.mappings,
      categories: [{ id: categoryId, aliases: [...(nextDoc.categories.find(c => c.id === categoryId)!.aliases ?? []), categoryLabel] }] }, admin.id);
    await service.approve(next.id, admin.id); version++;
    const resolved = await recheck().expect(201);
    expect(resolved.body.results[0].counts).toMatchObject({ ALLOW: 1, HOLD: 0 });
    const successor = await db.ingestionJob.findUniqueOrThrow({ where: { id: resolved.body.results[0].jobId }, include: { items: true } });
    expect(successor.mode).toBe('PARTIAL_UPDATE'); expect(successor.items).toHaveLength(1);
    expect((successor.items[0].enrichment as { source: { checksum: string } }).source.checksum).toBe(original.sourceChecksum);
    expect(await db.ingestionJob.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
    expect(ai).not.toHaveBeenCalled(); expect(research).not.toHaveBeenCalled();
  });
  it('compiles an immutable snapshot at most once and does not query per repeated row', async () => {
    const current = (await service.current())!;
    const lookup = jest.spyOn(db.ingestionEligibilityPolicy, 'findUnique');
    for (let job = 0; job < 100; job++) {
      const policy = await service.compile(current.id);
      for (let i = 0; i < 100; i++) expect(policy.evaluate(supplierId, 'سرافي', 'غسول الوجه').outcome).toBe('ALLOW');
    }
    expect(lookup.mock.calls.length).toBeLessThanOrEqual(1); lookup.mockRestore();
    expect(identity).not.toHaveBeenCalled(); expect(ai).not.toHaveBeenCalled();
  });
  it('resolves a reusable name across more than one bounded batch without per-file approvals or replay', async () => {
    const label = 'Confirmed repeat label';
    for (let file = 0; file < 21; file++) await http().post('/ingestion/jobs').set(supplierActor.auth).send({ supplierId,
      items: [row(`BULK-${file}`, label, 'غسول بشرة')] }).expect(201);
    const doc = (await service.current())!.document as unknown as EligibilityDocument;
    const preview = await service.previewMappings({ expectedVersion: version, reason: 'Review one shared label for twenty-one supplier files', categories: [], mappings: doc.mappings,
      brands: [{ id: brandId, aliases: [...doc.brands.find(b => b.id === brandId)!.aliases, label] }] }, admin.id);
    await service.approve(preview.id, admin.id); version++;
    const payload = { supplierId, brand: label, category: 'غسول بشرة', expectedVersion: version, reason: 'Bulk apply the single approved reusable label' };
    const batch = () => http().post('/ingestion/eligibility/holds/recheck').set(admin.auth).send(payload);
    expect((await batch().expect(201)).body).toMatchObject({ recheckedJobs: 20, hasMore: true });
    expect((await batch().expect(201)).body).toMatchObject({ recheckedJobs: 1, hasMore: false });
    expect((await batch().expect(201)).body).toMatchObject({ recheckedJobs: 0, hasMore: false });
    expect(identity).toHaveBeenCalledTimes(21); expect(ai).not.toHaveBeenCalled(); expect(research).not.toHaveBeenCalled();
  });
  it('rejects a stale bulk-recheck version before touching source jobs', async () => {
    const before = await db.ingestionJob.count();
    await http().post('/ingestion/eligibility/holds/recheck').set(admin.auth).send({ supplierId, brand: 'Ceravee', category: 'غسول بشرة',
      expectedVersion: version - 1, reason: 'An old browser must reload policy state' }).expect(409);
    expect(await db.ingestionJob.count()).toBe(before); expect(identity).not.toHaveBeenCalled();
  });
  it('uses lineage order for equal timestamps instead of reviving a resolved historical HOLD', async () => {
    const policy = (await service.current())!;
    const parentId = `f${randomUUID().slice(1)}`; const childId = `0${randomUUID().slice(1)}`;
    const createdAt = new Date();
    await db.$transaction(async tx => {
      await tx.ingestionJob.create({ data: { id: parentId, supplierId, eligibilityPolicyId: policy.id, createdAt,
        rowOutcomes: [{ sourceRow: 1, supplierSku: 'TIE', outcome: 'POLICY_HOLD', brand: 'Timestamp fixture', category: 'غسول بشرة', reason: 'BRAND_UNKNOWN' }] } });
      await tx.ingestionJob.create({ data: { id: childId, supplierId, eligibilityPolicyId: policy.id, createdAt,
        sourceMetadata: { eligibilityRetryOf: parentId }, rowOutcomes: [{ sourceRow: 1, supplierSku: 'TIE', outcome: 'IMPORTED_MANUAL' }] } });
    });
    const response = await http().get('/ingestion/eligibility/holds').set(admin.auth).expect(200);
    expect(response.body.groups.some((g: { supplierId: string; brandKey: string }) => g.supplierId === supplierId && g.brandKey === 'timestampfixture')).toBe(false);
  });
});
