// GLO-276 Gate 04 — uploaded spreadsheet rows reach canonical SKU matching through the real path (no Prisma-forced matches).
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { FILE_STORAGE_PORT, FileStoragePort } from '../../src/platform/storage/storage.port';
import { AiClient } from '../../src/platform/ai';
import { ProductIdentityService } from '../../src/modules/ingestion/services/product-identity.service';
import { createActor, Actor } from '../fixtures/actors';

const HEADER = 'Code,Item,Brand,Barcode,Cost EGP,On Hand';
const semantics = { documentKind: 'STOCK_FEED', priceBasis: 'UNIT_PURCHASE_COST', quantityBasis: 'ON_HAND' };
const mapping = { supplierSku: 'Code', name: 'Item', brand: 'Brand', barcode: 'Barcode', price: 'Cost EGP', quantity: 'On Hand', semantics };
const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

describe('GLO-276 Gate 04: upload → canonical SKU matching (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storagePort: FileStoragePort;
  let identity: ProductIdentityService;
  let admin: Actor, supplierUserA: Actor, supplierUserB: Actor;
  const supplierA = randomUUID();
  const supplierB = randomUUID();
  const run = randomUUID().slice(0, 8);
  const brandName = `G04 Brand ${run}`;
  const bc200 = `29${digits(11)}`;
  const bc400 = `29${digits(11)}`;
  let brandId: string, productId: string, sku200: string, sku400: string;
  const aiCalls: string[] = [];
  let firstJob: { jobId: string; matching: Record<string, number> };
  const byCode: Record<string, { id: string; matchedSkuId: string | null; status: string; enrichment: unknown }> = {};

  const server = () => app.getHttpServer();
  const csv = (rows: string[]) => Buffer.from([HEADER, ...rows].join('\n') + '\n');
  const upload = (actor: Actor, buffer: Buffer) => request(server()).post('/ingestion/jobs/upload').set(actor.auth)
    .attach('file', buffer, { filename: 'stock.csv', contentType: 'text/csv' });
  const mapJob = (jobId: string) => request(server()).post(`/ingestion/jobs/${jobId}/mapping`).set(admin.auth).send({ mapping });
  const loadItems = async (jobId: string) => {
    for (const item of await prisma.ingestionItem.findMany({ where: { jobId } })) byCode[item.supplierSkuCode] = item;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    storagePort = app.get(FILE_STORAGE_PORT);
    identity = app.get(ProductIdentityService);
    jest.spyOn(app.get(AiClient), 'enrichProduct').mockImplementation(async () => {
      aiCalls.push('enrichProduct');
      throw new Error('AI disabled in Gate 04 tests');
    });

    await prisma.supplier.create({ data: { id: supplierA, name: `G04 Supplier A ${run}`, slug: `g04-a-${run}` } });
    await prisma.supplier.create({ data: { id: supplierB, name: `G04 Supplier B ${run}`, slug: `g04-b-${run}` } });
    brandId = (await prisma.brand.create({ data: { name: brandName, slug: `g04-brand-${run}` } })).id;
    productId = (await prisma.product.create({ data: { brandId, name: 'Hydra Calm Cleanser', slug: `g04-hydra-calm-${run}` } })).id;
    sku200 = (await prisma.sku.create({ data: { productId, code: `G04-200-${run}`, variantName: 'Default', size: 200, sizeUnit: 'ml', barcode: bc200 } })).id;
    sku400 = (await prisma.sku.create({ data: { productId, code: `G04-400-${run}`, variantName: 'Default', size: 400, sizeUnit: 'ml', barcode: bc400 } })).id;
    admin = await createActor(prisma, 'ADMIN');
    supplierUserA = await createActor(prisma, 'SUPPLIER', supplierA);
    supplierUserB = await createActor(prisma, 'SUPPLIER', supplierB);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    const suppliers = [supplierA, supplierB];
    for (const job of await prisma.ingestionJob.findMany({ where: { supplierId: { in: suppliers } } })) {
      if (job.sourceKey) await storagePort.delete(job.sourceKey);
    }
    await prisma.supplierOffer.deleteMany({ where: { supplierId: { in: suppliers } } });
    await prisma.supplierSkuAlias.deleteMany({ where: { supplierId: { in: suppliers } } });
    await prisma.ingestionItem.deleteMany({ where: { job: { supplierId: { in: suppliers } } } });
    await prisma.ingestionJob.deleteMany({ where: { supplierId: { in: suppliers } } });
    await prisma.exportProfile.deleteMany({ where: { supplierId: { in: suppliers } } });
    await prisma.sku.deleteMany({ where: { productId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.brand.deleteMany({ where: { id: brandId } });
    const actors = [admin, supplierUserA, supplierUserB].map(a => a.id);
    await prisma.session.deleteMany({ where: { customerId: { in: actors } } });
    await prisma.customer.deleteMany({ where: { id: { in: actors } } });
    await prisma.supplier.deleteMany({ where: { id: { in: suppliers } } });
    await app.close();
  });

  it('matches uploaded rows by tier and never forces the nearest product', async () => {
    const received = await upload(supplierUserA, csv([
      `A-1,G04 Hydra Calm Cleanser 200ml,${brandName},${bc200},100.00,5`, // verified barcode + stated brand → exact
      `A-2,منظف هيدرا كالم 200 مل,${brandName},${bc400},90.00,3`, // barcode of the 400ml SKU but 200ml label → conflict
      `A-3,Hydra Calm Cleanser 200ml,${brandName},,95.00,4`, // same name + size, no barcode → suggestion only
      `A-4,Hydra Calm Night Serum 30ml,${brandName},,150.00,2`, // approved brand, no such SKU → new candidate
      `A-5,Calm Cleansing Gel 200ml,,${bc200},80.00,1`, // barcode with no brand and a different name → uncorroborated
      `A-6,Hydra Calm Cleanser 200ml Pack of 2,${brandName},,180.00,2`, // manufacturer twin pack ≠ single unit
    ]));
    expect(received.status).toBe(201);
    const mapped = await mapJob(received.body.jobId);
    expect(mapped.status).toBe(201);
    firstJob = { jobId: received.body.jobId, matching: mapped.body.matching };
    expect(mapped.body.matching).toEqual({
      exactMatches: 1, needsReview: 4, newCandidates: 1, linkedToExistingCandidate: 0, rejected: 0, aiEnrichmentRequests: 1,
    });

    await loadItems(firstJob.jobId);
    expect(byCode['A-1'].matchedSkuId).toBe(sku200);
    for (const code of ['A-2', 'A-3', 'A-4', 'A-5', 'A-6']) expect(byCode[code].matchedSkuId).toBeNull();
    const identityOf = (code: string) => (byCode[code].enrichment as { identity: Record<string, unknown> }).identity;
    expect(identityOf('A-2')).toMatchObject({ classification: 'CONFLICT' });
    expect(identityOf('A-3')).toMatchObject({ classification: 'LIKELY_MATCH', suggestedSkuId: sku200 });
    expect(identityOf('A-4')).toMatchObject({ classification: 'NO_MATCH' });
    expect(identityOf('A-5')).toMatchObject({ classification: 'LIKELY_MATCH', suggestedSkuId: sku200 });
    expect(identityOf('A-6')).toMatchObject({ classification: 'LIKELY_MATCH', suggestedSkuId: null });
    expect((byCode['A-1'].enrichment as { source: { rawRow: unknown } }).source.rawRow).toBeDefined(); // provenance kept
  });

  it('commits a supplier offer only for the verified exact match', async () => {
    const diff = await request(server()).get(`/ingestion/jobs/${firstJob.jobId}/diff`).set(supplierUserA.auth);
    expect(diff.body.counters).toMatchObject({ created: 1, skipped: 5 });
    const commit = await request(server()).post(`/ingestion/jobs/${firstJob.jobId}/commit-offers`).set(supplierUserA.auth).send({});
    expect(commit.status).toBe(201);
    const offers = await prisma.supplierOffer.findMany({ where: { supplierId: supplierA } });
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ skuId: sku200, isAvailable: true });
    expect(offers[0].costPrice.toNumber()).toBe(100);
  });

  it('lets a reviewer confirm only a vetted suggestion, and persists the supplier alias', async () => {
    const wrong = await request(server()).patch(`/ingestion/candidates/${byCode['A-6'].id}/approve`).set(admin.auth).send({ matchedSkuId: sku200 });
    expect(wrong.status).toBe(400); // twin pack has no suggestion to confirm
    const conflicted = await request(server()).patch(`/ingestion/candidates/${byCode['A-2'].id}/approve`).set(admin.auth).send({ matchedSkuId: sku400 });
    expect(conflicted.status).toBe(400);
    const confirmed = await request(server()).patch(`/ingestion/candidates/${byCode['A-3'].id}/approve`).set(admin.auth).send({ matchedSkuId: sku200 });
    expect(confirmed.status).toBe(200);
    const alias = await prisma.supplierSkuAlias.findUnique({ where: { supplierId_supplierSkuCode: { supplierId: supplierA, supplierSkuCode: 'A-3' } } });
    expect(alias?.skuId).toBe(sku200);
    await expect(identity.createSupplierSkuAlias(supplierA, 'A-3', sku400)).rejects.toThrow(/different canonical SKU/);
  });

  it('reuses the reviewed alias for a renamed Arabic row on the next upload, with no AI call', async () => {
    const aiBefore = aiCalls.length;
    const next = await upload(supplierUserA, csv([
      `A-3,كلينزر هيدرا كالم ٢٠٠ مل,${brandName},,97.50,7`,
      `A-1,G04 Hydra Calm Cleanser 200ml,${brandName},${bc200},102.00,6`,
    ]));
    expect(next.body).toMatchObject({ status: 'pending', requiresMapping: false });
    expect(next.body.matching).toMatchObject({ exactMatches: 2, needsReview: 0, newCandidates: 0, aiEnrichmentRequests: 0 });
    await loadItems(next.body.jobId);
    expect(byCode['A-3'].matchedSkuId).toBe(sku200);
    expect(aiCalls.length).toBe(aiBefore);
  });

  it('keeps supplier aliases scoped: another supplier using the same code is not matched through it', async () => {
    const res = await upload(supplierUserB, csv([`A-3,Hydra Calm Cleanser 200ml,${brandName},,99.00,2`]));
    await mapJob(res.body.jobId);
    const [row] = await prisma.ingestionItem.findMany({ where: { jobId: res.body.jobId } });
    expect(row.matchedSkuId).toBeNull();
    expect((row.enrichment as { identity: { classification: string } }).identity.classification).toBe('LIKELY_MATCH');
  });

  it('reports a matching outage as retryable and resumes through the match endpoint', async () => {
    const spy = jest.spyOn(identity, 'classifyCandidateMatch').mockRejectedValueOnce(new Error('catalog lookup timed out'));
    const res = await upload(supplierUserA, csv([`A-7,G04 Hydra Calm Cleanser 200ml,${brandName},${bc200},101.00,3`]));
    expect(res.status).toBe(201);
    expect(res.body.matching).toMatchObject({ status: 'FAILED_RETRYABLE' });
    let [row] = await prisma.ingestionItem.findMany({ where: { jobId: res.body.jobId } });
    expect(row).toMatchObject({ status: 'pending', matchedSkuId: null });
    spy.mockRestore();

    expect((await request(server()).post(`/ingestion/jobs/${res.body.jobId}/match`).set(supplierUserB.auth)).status).toBe(404);
    const retry = await request(server()).post(`/ingestion/jobs/${res.body.jobId}/match`).set(supplierUserA.auth);
    expect(retry.body).toMatchObject({ exactMatches: 1 });
    [row] = await prisma.ingestionItem.findMany({ where: { jobId: res.body.jobId } });
    expect(row.matchedSkuId).toBe(sku200);
    const again = await request(server()).post(`/ingestion/jobs/${res.body.jobId}/match`).set(supplierUserA.auth);
    expect(again.body).toMatchObject({ exactMatches: 0, needsReview: 0, newCandidates: 0 });
  });
});
