// GLO-285 early eligibility gate at file scale, through the real HTTP upload and the real policy. Synthetic rows.
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AiClient, AiClientError, AiErrorKind } from '../../src/platform/ai';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { IngestionEligibilityService } from '../../src/modules/ingestion/services/ingestion-eligibility.service';
import { IngestionService } from '../../src/modules/ingestion/services/ingestion.service';
import { OfferBatchCommitService } from '../../src/modules/ingestion/services/offer-batch-commit.service';
import { ProductIdentityService } from '../../src/modules/ingestion/services/product-identity.service';
import { ProductResearchService } from '../../src/modules/ingestion/services/product-research.service';
import { RowNormalizationService } from '../../src/modules/ingestion/services/row-normalization.service';
import { Actor, createActor } from '../fixtures/actors';
import { uniqueGtin } from '../fixtures/gtin';

const HEADER = 'Code,Item,Brand,Category,Cost,Qty,Currency';
const mapping = { supplierSku: 'Code', name: 'Item', brand: 'Brand', category: 'Category', price: 'Cost', quantity: 'Qty', currencyColumn: 'Currency',
  semantics: { documentKind: 'PRICE_LIST', priceBasis: 'UNIT_PURCHASE_COST', quantityBasis: 'ON_HAND' } };

describe('GLO-285 early eligibility gate at scale', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor;
  let supplier: Actor;
  const run = randomUUID().slice(0, 8);
  const supplierId = randomUUID();
  const allowed = `Scale Allow ${run}`;
  const denied = `Scale Deny ${run}`;
  const leaf = `Scale Leaf ${run}`;
  const deniedLeaf = `Scale Denied Leaf ${run}`;
  const spies: Record<string, jest.SpyInstance> = {};
  const excludedRow = (i: number) => `X-${i},Excluded Product ${i} 100ml,${denied},${leaf},50,3,EGP`;
  const server = () => app.getHttpServer();
  const upload = (rows: string[], actor = supplier, mode = 'PARTIAL_UPDATE', filename = `${randomUUID()}.csv`) =>
    request(server()).post('/ingestion/jobs/upload').set(actor.auth).field('mode', mode)
      .attach('file', Buffer.from(`${HEADER}\n${rows.join('\n')}\n`), { filename, contentType: 'text/csv' });
  const uploadAdmitted = async (rows: string[], mode = 'PARTIAL_UPDATE') => {
    const res = await upload(rows, supplier, mode);
    expect(res.status).toBe(201);
    if (!res.body.requiresMapping) return res.body;
    const mapped = await request(server()).post(`/ingestion/jobs/${res.body.jobId}/mapping`).set(admin.auth).send({ mapping }).expect(201);
    return { ...res.body, ...mapped.body };
  };
  const job = (id: string) => prisma.ingestionJob.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    admin = await createActor(prisma, 'ADMIN');
    await prisma.supplier.create({ data: { id: supplierId, name: `Scale ${run}`, slug: `scale-${run}` } });
    supplier = await createActor(prisma, 'SUPPLIER', supplierId);
    const [allow, deny] = [await prisma.brand.create({ data: { name: allowed, slug: `scale-a-${run}` } }), await prisma.brand.create({ data: { name: denied, slug: `scale-d-${run}` } })];
    const root = await prisma.category.create({ data: { name: `Scale Root ${run}`, slug: `scale-root-${run}` } });
    const okLeaf = await prisma.category.create({ data: { name: leaf, slug: `scale-leaf-${run}`, parentId: root.id } });
    const badLeaf = await prisma.category.create({ data: { name: deniedLeaf, slug: `scale-bad-${run}`, parentId: root.id } });
    const eligibility = app.get(IngestionEligibilityService);
    const current = await eligibility.current();
    const preview = await eligibility.preview({ expectedVersion: current?.version ?? 0, reason: 'Scale gate fixture policy',
      brands: [{ id: allow.id, effect: 'ALLOW', aliases: [] }, { id: deny.id, effect: 'DENY', aliases: [] }],
      categories: [{ id: okLeaf.id, effect: 'ALLOW' }, { id: badLeaf.id, effect: 'DENY' }], mappings: [] }, admin.id);
    await eligibility.approve(preview.id, admin.id);
    spies.ai = jest.spyOn(app.get(AiClient), 'enrichProduct').mockRejectedValue(new Error('not expected'));
    spies.research = jest.spyOn(app.get(ProductResearchService), 'researchProductCandidate');
    spies.classify = jest.spyOn(app.get(ProductIdentityService), 'classifyCandidateMatch');
    spies.prepare = jest.spyOn(app.get(ProductIdentityService), 'prepareBatch');
    spies.fingerprint = jest.spyOn(app.get(ProductIdentityService), 'rowFingerprint');
    spies.normalize = jest.spyOn(app.get(RowNormalizationService), 'normalizeRow');
    // Approve the layout once; each later file of this layout admits directly.
    await uploadAdmitted([excludedRow(0)]);
  }, 60000);
  beforeEach(() => Object.values(spies).forEach(spy => spy.mockClear()));
  afterAll(async () => { jest.restoreAllMocks(); await app.close(); });

  it('50,000 excluded rows: zero downstream work, zero writes, one compact record, every row accounted for', async () => {
    const rows = Array.from({ length: 50000 }, (_, i) => excludedRow(i + 1));
    const [products, skus, offers] = [await prisma.product.count(), await prisma.sku.count(), await prisma.supplierOffer.count()];
    const res = await upload(rows);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ totalRows: 50000, importedItemsCount: 0, requiresMapping: false });
    expect(res.body.rowAccounting).toMatchObject({ totalRows: 50000, policyExcluded: 50000, eligible: 0, unresolvedScope: 0, invalid: 0 });
    for (const name of ['ai', 'research', 'classify', 'prepare', 'fingerprint', 'normalize']) expect(spies[name]).not.toHaveBeenCalled();
    expect(await prisma.ingestionItem.count({ where: { jobId: res.body.jobId } })).toBe(0);
    expect([await prisma.product.count(), await prisma.sku.count(), await prisma.supplierOffer.count()]).toEqual([products, skus, offers]);
    const stored = (await job(res.body.jobId)).rowOutcomes as Array<{ outcome: string; count: number; rowRanges: Array<[number, number]>; topBrands: unknown[] }>;
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ outcome: 'POLICY_SKIP', reason: 'BRAND_NOT_ALLOWED', count: 50000, rowRanges: [[2, 50001]] });
    expect(JSON.stringify(stored).length).toBeLessThan(500);
  }, 120000);

  it('more rows than the limit, and a file over the size limit, are refused outright', async () => {
    const tooMany = await upload(Array.from({ length: 50001 }, (_, i) => excludedRow(i)));
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.message).toContain('maximum allowed rows');
    const huge = await upload([`A,${'x'.repeat(26 * 1024 * 1024)},${denied},${leaf},1,1,EGP`]).catch((error: Error) => ({ status: 413, body: { message: error.message } }));
    expect([400, 413]).toContain(huge.status);
  }, 120000);

  it('a mixed file routes each row once and accounts for all of them', async () => {
    const rows = [
      ...Array.from({ length: 95 }, (_, i) => excludedRow(1000 + i)),
      `E-1,Scale Allowed Serum 30ml,${allowed},${leaf},100,5,EGP`,
      `E-2,Scale Allowed Cream 50ml,${allowed},${deniedLeaf},100,5,EGP`, // explicit category deny beats an allowed brand
      `U-1,Scale Unknown Serum 30ml,Unknown Brand ${run},${leaf},100,5,EGP`,
      `U-2,Scale Allowed No Leaf 30ml,${allowed},Unmapped Label,100,5,EGP`,
      `I-1,,${allowed},${leaf},100,5,EGP`,
    ];
    const res = await uploadAdmitted(rows);
    expect(res.rowAccounting).toMatchObject({ totalRows: 100, eligible: 1, policyExcluded: 96, unresolvedScope: 2, invalid: 1 });
    const stored = (await job(res.jobId)).rowOutcomes as Array<Record<string, unknown>>;
    const held = stored.filter(entry => entry.outcome === 'POLICY_HOLD');
    expect(held).toHaveLength(2);
    // A held row is a lightweight pointer: the retained original and pinned policy hold the rest.
    expect(held.every(entry => !('rawRow' in entry) && !('eligibility' in entry))).toBe(true);
    expect(stored.filter(entry => entry.outcome === 'POLICY_SKIP').reduce((sum, entry) => sum + (entry.count as number), 0)).toBe(96);
    expect(spies.normalize).toHaveBeenCalledTimes(2); // the eligible row and the invalid row, not the 98 stopped by policy
  }, 60000);

  it('a held row can still be released by policy, from the retained original', async () => {
    const res = await uploadAdmitted([`H-1,Release Me Serum 30ml,Release Brand ${run},${leaf},100,5,EGP`]);
    expect(res.rowAccounting).toMatchObject({ unresolvedScope: 1, eligible: 0 });
    const eligibility = app.get(IngestionEligibilityService);
    const current = (await eligibility.current())!;
    const brand = await prisma.brand.create({ data: { name: `Release Brand ${run}`, slug: `release-${run}` } });
    const doc = current.document as unknown as { brands: Array<{ id: string; effect: 'ALLOW' | 'DENY' | null; aliases: string[] }>; categories: Array<{ id: string; effect: 'ALLOW' | 'DENY' | null; aliases?: string[] }>; mappings: [] };
    const preview = await eligibility.preview({ expectedVersion: current.version!, reason: 'Release the held test brand',
      brands: [...doc.brands.filter(b => b.effect).map(b => ({ id: b.id, effect: b.effect!, aliases: b.aliases })), { id: brand.id, effect: 'ALLOW', aliases: [] }],
      categories: doc.categories.filter(c => c.effect).map(c => ({ id: c.id, effect: c.effect!, aliases: c.aliases ?? [] })), mappings: [] }, admin.id);
    await eligibility.approve(preview.id, admin.id);
    const recheck = await app.get(IngestionService).recheckEligibilityHolds(res.jobId, admin.id, 'Policy now allows this brand');
    expect(recheck.counts).toMatchObject({ ALLOW: 1, HOLD: 0 });
  }, 60000);

  it('a full snapshot containing excluded rows cannot authorize deactivation', async () => {
    const res = await uploadAdmitted([excludedRow(5000), `F-1,Snapshot Serum 30ml,${allowed},${leaf},100,5,EGP`], 'FULL_SNAPSHOT');
    await expect(app.get(OfferBatchCommitService).approveDeactivations(res.jobId, admin.id, { approvedSkuIds: [randomUUID()] } as never))
      .rejects.toThrow(/Snapshot|deactivation|commit/i);
    const diff = await request(server()).get(`/ingestion/jobs/${res.jobId}/diff`).set(admin.auth).expect(200);
    expect(diff.body.sourceRows).toMatchObject({ total: 2, admitted: 1, policySkipped: 1 });
    expect(diff.body.sourceRows.skippedByReason[0]).toMatchObject({ reason: 'BRAND_NOT_ALLOWED', count: 1 });
  }, 60000);

  it('a repeat of the same 50,000-row bytes is one receipt and never loads its rows', async () => {
    const rows = Array.from({ length: 50000 }, (_, i) => excludedRow(100000 + i));
    const body = Buffer.from(`${HEADER}\n${rows.join('\n')}\n`);
    const send = () => request(server()).post('/ingestion/jobs/upload').set(supplier.auth).attach('file', body, { filename: 'same.csv', contentType: 'text/csv' });
    const first = await send().expect(201);
    const second = await send().expect(201);
    expect(second.body).toMatchObject({ jobId: first.body.jobId, reused: true });
  }, 120000);

  it('a malformed barcode holds that row alone at commit; the rest of the file still applies', async () => {
    const brand = await prisma.brand.findUniqueOrThrow({ where: { name: allowed } });
    const product = await prisma.product.create({ data: { brandId: brand.id, name: 'Commit Isolation Serum', slug: `commit-isolation-${run}` } });
    const [good, malformed] = await Promise.all([30, 60].map(size => prisma.sku.create({ data: { productId: product.id, code: `ISO-${size}-${run}`, variantName: 'Default', size, sizeUnit: 'ml', barcode: uniqueGtin() } })));
    await prisma.supplierSkuAlias.createMany({ data: [{ supplierId, supplierSkuCode: 'ISO-A', skuId: good.id }, { supplierId, supplierSkuCode: 'ISO-B', skuId: malformed.id }] });
    const res = await uploadAdmitted([
      `ISO-A,Commit Isolation Serum 30ml,${allowed},${leaf},100,5,EGP`,
      `ISO-B,Commit Isolation Serum 60ml,${allowed},${leaf},100,5,EGP`,
    ]);
    const items = await prisma.ingestionItem.findMany({ where: { jobId: res.jobId } });
    const [itemA, itemB] = [items.find(i => i.supplierSkuCode === 'ISO-A')!, items.find(i => i.supplierSkuCode === 'ISO-B')!];
    await prisma.ingestionItem.update({ where: { id: itemA.id }, data: { matchedSkuId: good.id } });
    // The state a row with a contaminated barcode cell reaches once linked: this commit used to answer 409 for the whole file.
    await prisma.ingestionItem.update({ where: { id: itemB.id }, data: { matchedSkuId: malformed.id, barcode: '6221000000001' } });
    const commit = await request(server()).post(`/ingestion/jobs/${res.jobId}/commit-offers`).set(admin.auth).send({});
    expect(commit.status).toBe(201);
    const outcome = (code: string) => commit.body.itemOutcomes.find((o: { supplierSkuCode: string }) => o.supplierSkuCode === code);
    expect(outcome('ISO-B')).toMatchObject({ status: 'HELD_FOR_REVIEW', reason: expect.stringContaining('invalid_gtin') });
    expect(outcome('ISO-A').status).toBe('COMMITTED');
    expect(await prisma.supplierOffer.count({ where: { supplierId, skuId: good.id } })).toBe(1);
    expect(await prisma.supplierOffer.count({ where: { supplierId, skuId: malformed.id } })).toBe(0);
  }, 60000);

  it('the job list stays usable after a large file', async () => {
    const res = await request(server()).get('/ingestion/jobs').set(supplier.auth).expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((entry: Record<string, unknown>) => !('rowOutcomes' in entry))).toBe(true);
  });

  it('new candidates stay within the per-file enrichment budget, and a provider outage stops the run without touching rows', async () => {
    spies.ai.mockReset().mockImplementation(async () => { throw new AiClientError(AiErrorKind.UNAVAILABLE, 'down'); });
    const rows = Array.from({ length: 260 }, (_, i) => `N-${i},Novel ${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + (i % 25))} Serum ${i} ${10 + i}ml,${allowed},${leaf},100,5,EGP`);
    const res = await uploadAdmitted(rows);
    const service = app.get(IngestionService);
    await service.whenBackgroundWorkSettles();
    const matching = res.matching as { newCandidates: number; aiEnrichmentRequests: number; enrichmentDeferred: number; needsReview: number };
    expect(matching.aiEnrichmentRequests).toBeLessThanOrEqual(200);
    expect(matching.aiEnrichmentRequests + matching.enrichmentDeferred).toBe(matching.newCandidates);
    expect(spies.ai.mock.calls.length).toBeLessThanOrEqual(5 + 4); // the outage threshold, plus calls already in flight
    const items = await prisma.ingestionItem.findMany({ where: { jobId: res.jobId } });
    expect(items).toHaveLength(260);
    expect(items.every(item => item.status === 'review_required')).toBe(true);
  }, 120000);
});
