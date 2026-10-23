// GLO-277 Gate 05 — known-SKU supplier offer fast lane: freshness, idempotency, holds and snapshot safety, via HTTP.
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { FILE_STORAGE_PORT, FileStoragePort } from '../../src/platform/storage/storage.port';
import { AiClient } from '../../src/platform/ai';
import { createActor, Actor } from '../fixtures/actors';

const HEADER = 'Code,Item,Brand,Barcode,Cost EGP,On Hand,Updated';
const semantics = { documentKind: 'STOCK_FEED', priceBasis: 'UNIT_PURCHASE_COST', quantityBasis: 'ON_HAND' };
const mapping = { supplierSku: 'Code', name: 'Item', brand: 'Brand', barcode: 'Barcode', price: 'Cost EGP', quantity: 'On Hand', sourceTimestamp: 'Updated', semantics };
const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

describe('GLO-277 Gate 05: supplier offer fast lane (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storagePort: FileStoragePort;
  let admin: Actor, supplier1: Actor, supplier2: Actor;
  const s1 = randomUUID();
  const s2 = randomUUID();
  const run = randomUUID().slice(0, 8);
  const brand = `G05 Brand ${run}`;
  const bcA = `29${digits(11)}`;
  const bcB = `29${digits(11)}`;
  let brandId: string, productId: string, skuA: string, skuB: string, sellingPriceId: string;
  const aiCalls: string[] = [];

  const server = () => app.getHttpServer();
  const rowA = (cost: string, qty: string, updated: string, code = 'S-A') => `${code},G05 Barrier Cream 50ml,${brand},${bcA},${cost},${qty},${updated}`;
  const rowB = (cost: string, qty: string, updated: string) => `S-B,G05 Barrier Cream 100ml,${brand},${bcB},${cost},${qty},${updated}`;
  const upload = async (actor: Actor, rows: string[]) => {
    const res = await request(server()).post('/ingestion/jobs/upload').set(actor.auth)
      .attach('file', Buffer.from([HEADER, ...rows].join('\n') + '\n'), { filename: 'stock.csv', contentType: 'text/csv' });
    if (res.body.requiresMapping) {
      const mapped = await request(server()).post(`/ingestion/jobs/${res.body.jobId}/mapping`).set(admin.auth).send({ mapping });
      return { ...res.body, ...mapped.body };
    }
    return res.body;
  };
  const commit = (actor: Actor, jobId: string) =>
    request(server()).post(`/ingestion/jobs/${jobId}/commit-offers`).set(actor.auth).send({});
  const offer = (supplierId: string, skuId: string) =>
    prisma.supplierOffer.findUnique({ where: { supplierId_skuId: { supplierId, skuId } } });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    storagePort = app.get(FILE_STORAGE_PORT);
    for (const method of ['enrichProduct', 'generateContent', 'recommendRoutine'] as const) {
      jest.spyOn(app.get(AiClient), method).mockImplementation(async () => { aiCalls.push(method); throw new Error('AI disabled'); });
    }
    await prisma.supplier.create({ data: { id: s1, name: `G05 Supplier 1 ${run}`, slug: `g05-s1-${run}` } });
    await prisma.supplier.create({ data: { id: s2, name: `G05 Supplier 2 ${run}`, slug: `g05-s2-${run}` } });
    brandId = (await prisma.brand.create({ data: { name: brand, slug: `g05-brand-${run}` } })).id;
    productId = (await prisma.product.create({ data: { brandId, name: 'G05 Barrier Cream', slug: `g05-barrier-${run}` } })).id;
    skuA = (await prisma.sku.create({ data: { productId, code: `G05-50-${run}`, variantName: 'Default', size: 50, sizeUnit: 'ml', barcode: bcA } })).id;
    skuB = (await prisma.sku.create({ data: { productId, code: `G05-100-${run}`, variantName: 'Default', size: 100, sizeUnit: 'ml', barcode: bcB } })).id;
    sellingPriceId = (await prisma.sellingPrice.create({ data: { skuId: skuB, amount: 200, currency: 'EGP', validFrom: new Date('2026-01-01') } })).id;
    admin = await createActor(prisma, 'ADMIN');
    supplier1 = await createActor(prisma, 'SUPPLIER', s1);
    supplier2 = await createActor(prisma, 'SUPPLIER', s2);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    const suppliers = [s1, s2];
    for (const job of await prisma.ingestionJob.findMany({ where: { supplierId: { in: suppliers } } })) {
      if (job.sourceKey) await storagePort.delete(job.sourceKey);
    }
    await prisma.supplierOffer.deleteMany({ where: { supplierId: { in: suppliers } } });
    await prisma.supplierSkuAlias.deleteMany({ where: { supplierId: { in: suppliers } } });
    await prisma.ingestionItem.deleteMany({ where: { job: { supplierId: { in: suppliers } } } });
    await prisma.ingestionJob.deleteMany({ where: { supplierId: { in: suppliers } } });
    await prisma.exportProfile.deleteMany({ where: { supplierId: { in: suppliers } } });
    await prisma.sellingPrice.deleteMany({ where: { id: sellingPriceId } });
    await prisma.sku.deleteMany({ where: { productId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.brand.deleteMany({ where: { id: brandId } });
    const actors = [admin, supplier1, supplier2].map(a => a.id);
    await prisma.session.deleteMany({ where: { customerId: { in: actors } } });
    await prisma.customer.deleteMany({ where: { id: { in: actors } } });
    await prisma.supplier.deleteMany({ where: { id: { in: suppliers } } });
    await app.close();
  });

  it('commits known-SKU cost and stock from an uploaded file with zero AI calls; explicit zero stock = unavailable', async () => {
    const job = await upload(supplier1, [rowA('100.00', '5', '2026-10-20 09:00'), rowB('150.00', '0', '2026-10-20 09:00')]);
    expect(job.matching).toMatchObject({ exactMatches: 2, aiEnrichmentRequests: 0 });
    const res = await commit(supplier1, job.jobId);
    expect(res.body).toMatchObject({ committedCount: 2, status: 'published' });
    expect((await offer(s1, skuA))).toMatchObject({ isAvailable: true });
    expect((await offer(s1, skuA))!.costPrice.toNumber()).toBe(100);
    expect((await offer(s1, skuB))).toMatchObject({ isAvailable: false });
    expect(aiCalls).toEqual([]);
  });

  it('replays and simultaneous double-commits apply a file exactly once', async () => {
    const job = await upload(supplier1, [rowA('110.00', '6', '2026-10-21 09:00')]);
    const [first, second] = await Promise.all([commit(supplier1, job.jobId), commit(supplier1, job.jobId)]);
    expect([first.body.committedCount, second.body.committedCount].sort()).toEqual([0, 1]);
    expect([first.body.status, second.body.status]).toContain('ALREADY_PUBLISHED');
    const before = await offer(s1, skuA);
    const replay = await commit(supplier1, job.jobId);
    expect(replay.body.status).toBe('ALREADY_PUBLISHED');
    const after = await offer(s1, skuA);
    expect(after!.costPrice.toNumber()).toBe(110);
    expect(after!.updatedAt).toEqual(before!.updatedAt);
  });

  it('refuses an older export uploaded later, by source time rather than upload time', async () => {
    const job = await upload(supplier1, [rowA('90.00', '9', '2026-10-19 12:01')]);
    const diff = await request(server()).get(`/ingestion/jobs/${job.jobId}/diff`).set(supplier1.auth);
    expect(diff.body.rows[0]).toMatchObject({ action: 'SKIP', reasons: ['source_time_older_than_last_accepted_offer'] });
    await commit(supplier1, job.jobId);
    expect((await offer(s1, skuA))!.costPrice.toNumber()).toBe(110);
  });

  it('holds a row with no source time once the accepted offer came from a dated export', async () => {
    const job = await upload(supplier1, [rowA('120.00', '4', '')]);
    const res = await commit(supplier1, job.jobId);
    expect(res.body.heldForReviewCount).toBe(1);
    expect(res.body.itemOutcomes[0].reason).toContain('no_source_time_while_last_accepted_offer_had_one');
    expect((await offer(s1, skuA))!.costPrice.toNumber()).toBe(110);
  });

  it('holds a cost above the approved selling price (FINANCIAL_HOLD) and never touches the selling price', async () => {
    const job = await upload(supplier1, [rowB('250.00', '3', '2026-10-22 08:00')]);
    const res = await commit(supplier1, job.jobId);
    expect(res.body.heldForReviewCount).toBe(1);
    expect(res.body.itemOutcomes[0].reason).toMatch(/financial_hold/);
    expect((await offer(s1, skuB))!.costPrice.toNumber()).toBe(150);
    const price = await prisma.sellingPrice.findUniqueOrThrow({ where: { id: sellingPriceId } });
    expect(price.amount.toNumber()).toBe(200);
  });

  it('holds the same supplier code twice with conflicting values instead of letting the first row win', async () => {
    const job = await upload(supplier1, [rowA('111.00', '2', '2026-10-22 09:00'), rowA('112.00', '3', '2026-10-22 09:00')]);
    const [item] = await prisma.ingestionItem.findMany({ where: { jobId: job.jobId } });
    expect(item).toMatchObject({ status: 'review_required', matchedSkuId: null });
    const outcomes = (await prisma.ingestionJob.findUniqueOrThrow({ where: { id: job.jobId } })).rowOutcomes as Array<{ reason?: string }>;
    expect(outcomes.map(o => o.reason)).toContain('duplicate_supplier_sku_with_conflicting_values');
    await commit(supplier1, job.jobId);
    expect((await offer(s1, skuA))!.costPrice.toNumber()).toBe(110);
  });

  it('keeps each supplier offer separate and tenant-scoped', async () => {
    const job = await upload(supplier2, [rowA('95.00', '8', '2026-10-22 09:00')]);
    expect((await commit(supplier2, job.jobId)).body.committedCount).toBe(1);
    expect((await offer(s2, skuA))!.costPrice.toNumber()).toBe(95);
    expect((await offer(s1, skuA))!.costPrice.toNumber()).toBe(110);
    const s1Job = await prisma.ingestionJob.findFirstOrThrow({ where: { supplierId: s1 } });
    expect((await commit(supplier2, s1Job.id)).status).toBe(403);
    expect((await request(server()).get(`/ingestion/jobs/${s1Job.id}/diff`).set(supplier2.auth)).status).toBe(403);
  });

  it('never deactivates omitted offers when an admin publishes a FULL_SNAPSHOT job', async () => {
    const snapshot = await prisma.ingestionJob.create({ data: { supplierId: s1, mode: 'FULL_SNAPSHOT', status: 'approved', items: { create: [{
      supplierSkuCode: 'S-OTHER', name: 'G05 Other Cream', brand, price: 50, priceType: 'PURCHASE_COST', currency: 'EGP', status: 'rejected',
    }] } } });
    const published = await request(server()).post(`/ingestion/jobs/${snapshot.id}/publish`).set(admin.auth);
    expect(published.status).toBe(201);
    expect((await offer(s1, skuA))!.isAvailable).toBe(true);
    const deactivate = await request(server()).post(`/ingestion/jobs/${snapshot.id}/approve-deactivations`).set(admin.auth).send({});
    expect(deactivate.status).toBe(400);
    expect((await offer(s1, skuA))!.isAvailable).toBe(true);
  });
});
