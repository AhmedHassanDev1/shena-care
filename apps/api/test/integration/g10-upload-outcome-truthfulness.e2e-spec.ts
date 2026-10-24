// Real-UI ingestion test findings: rows rejected at intake must stay visible to the supplier, a repeat upload of a
// processed file is a repeat (not a new mapping request), and snapshot deactivation candidates are named products.
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { FILE_STORAGE_PORT, FileStoragePort } from '../../src/platform/storage/storage.port';
import { AiClient } from '../../src/platform/ai';
import { createActor, Actor } from '../fixtures/actors';

const HEADER = 'Code,Item,Brand,Barcode,Cost EGP,On Hand';
const semantics = { documentKind: 'STOCK_FEED', priceBasis: 'UNIT_PURCHASE_COST', quantityBasis: 'ON_HAND' };
const mapping = { supplierSku: 'Code', name: 'Item', brand: 'Brand', barcode: 'Barcode', price: 'Cost EGP', quantity: 'On Hand', semantics };
const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

describe('G10: upload outcome truthfulness (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storagePort: FileStoragePort;
  let admin: Actor, supplierUser: Actor;
  const supplierId = randomUUID();
  const run = randomUUID().slice(0, 8);
  const brandName = `G10 Brand ${run}`;
  const bc200 = `29${digits(11)}`;
  const bc400 = `29${digits(11)}`;
  let brandId: string, productId: string, sku200: string, sku400: string;
  let firstJobId: string;

  const server = () => app.getHttpServer();
  const csv = (rows: string[]) => Buffer.from([HEADER, ...rows].join('\n') + '\n');
  const upload = (buffer: Buffer, mode = 'PARTIAL_UPDATE') => request(server()).post('/ingestion/jobs/upload').set(supplierUser.auth)
    .field('mode', mode).attach('file', buffer, { filename: 'stock.csv', contentType: 'text/csv' });

  const firstFile = () => csv([
    `B-1,G10 Hydra Calm Cleanser 200ml,${brandName},${bc200},100.00,5`, // exact match
    `B-1,G10 Hydra Calm Cleanser 200ml,${brandName},${bc200},100.00,5`, // identical repeat of the same supplier code
    `B-2,Premium Basmati Rice 5kg,Tamara,,50.00,10`, // not a skincare/haircare product
    `B-3,G10 Hydra Calm Cleanser 400ml,${brandName},,abc,3`, // unusable price
    `B-4,G10 Hydra Calm Night Serum 30ml,${brandName},,150.00,2`, // no such SKU: new candidate
  ]);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    storagePort = app.get(FILE_STORAGE_PORT);
    jest.spyOn(app.get(AiClient), 'enrichProduct').mockRejectedValue(new Error('AI disabled in G10 tests'));

    await prisma.supplier.create({ data: { id: supplierId, name: `G10 Supplier ${run}`, slug: `g10-${run}` } });
    brandId = (await prisma.brand.create({ data: { name: brandName, slug: `g10-brand-${run}` } })).id;
    productId = (await prisma.product.create({ data: { brandId, name: 'G10 Hydra Calm Cleanser', slug: `g10-hydra-calm-${run}` } })).id;
    sku200 = (await prisma.sku.create({ data: { productId, code: `G10-200-${run}`, variantName: 'Default', size: 200, sizeUnit: 'ml', barcode: bc200 } })).id;
    sku400 = (await prisma.sku.create({ data: { productId, code: `G10-400-${run}`, variantName: 'Default', size: 400, sizeUnit: 'ml', barcode: bc400 } })).id;
    admin = await createActor(prisma, 'ADMIN');
    supplierUser = await createActor(prisma, 'SUPPLIER', supplierId);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    for (const job of await prisma.ingestionJob.findMany({ where: { supplierId } })) {
      if (job.sourceKey) await storagePort.delete(job.sourceKey);
    }
    await prisma.supplierOffer.deleteMany({ where: { supplierId } });
    await prisma.supplierSkuAlias.deleteMany({ where: { supplierId } });
    await prisma.ingestionItem.deleteMany({ where: { job: { supplierId } } });
    await prisma.ingestionJob.deleteMany({ where: { supplierId } });
    await prisma.exportProfile.deleteMany({ where: { supplierId } });
    await prisma.sku.deleteMany({ where: { productId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.brand.deleteMany({ where: { id: brandId } });
    const actors = [admin, supplierUser].map(a => a.id);
    await prisma.session.deleteMany({ where: { customerId: { in: actors } } });
    await prisma.customer.deleteMany({ where: { id: { in: actors } } });
    await prisma.supplier.deleteMany({ where: { id: supplierId } });
    await app.close();
  });

  it('reports every file row that was not admitted instead of showing "0 errors"', async () => {
    const received = await upload(firstFile());
    expect(received.status).toBe(201);
    firstJobId = received.body.jobId;
    const mapped = await request(server()).post(`/ingestion/jobs/${firstJobId}/mapping`).set(admin.auth).send({ mapping });
    expect(mapped.status).toBe(201);

    const diff = await request(server()).get(`/ingestion/jobs/${firstJobId}/diff`).set(supplierUser.auth);
    expect(diff.status).toBe(200);
    expect(diff.body.counters.error).toBe(0);
    expect(diff.body.sourceRows).toMatchObject({ total: 5, admitted: 2, invalid: 1, duplicate: 1, outOfScope: 1 });
    expect(diff.body.sourceRows.notAdmitted).toEqual([
      expect.objectContaining({ sourceRow: 3, supplierSku: 'B-1', outcome: 'DUPLICATE' }),
      expect.objectContaining({ sourceRow: 4, supplierSku: 'B-2', outcome: 'OUT_OF_SCOPE' }),
      expect.objectContaining({ sourceRow: 5, supplierSku: 'B-3', outcome: 'INVALID', reason: expect.stringContaining('abc') }),
    ]);
    // None of the not-admitted rows may be sellable: only the verified exact match can become an offer.
    expect(await prisma.supplierOffer.count({ where: { supplierId } })).toBe(0);
  });

  it('an all-invalid file is reported as rejected rows, with no items and no offers', async () => {
    const received = await upload(csv([`,${brandName},,${bc200},0,x`, `B-9,,Nothing,,-4,1`]));
    expect(received.status).toBe(201);
    const job = received.body;
    expect(job.requiresMapping).toBe(false);
    const diff = await request(server()).get(`/ingestion/jobs/${job.jobId}/diff`).set(supplierUser.auth);
    expect(diff.body.rows).toEqual([]);
    expect(diff.body.sourceRows).toMatchObject({ total: 2, admitted: 0, invalid: 2 });
    expect(await prisma.supplierOffer.count({ where: { supplierId } })).toBe(0);
  });

  it('a repeat upload of a processed file reuses the job and does not ask for a mapping again', async () => {
    const commit = await request(server()).post(`/ingestion/jobs/${firstJobId}/commit-offers`).set(supplierUser.auth)
      .send({ autoApplyLowRisk: true });
    expect(commit.status).toBe(201);
    const job = await prisma.ingestionJob.findUniqueOrThrow({ where: { id: firstJobId } });
    expect(job.status).toBe('review_required'); // the unmatched candidate keeps the job open

    const again = await upload(firstFile());
    expect(again.status).toBe(201);
    expect(again.body).toMatchObject({ jobId: firstJobId, reused: true, requiresMapping: false });
    expect(await prisma.ingestionJob.count({ where: { supplierId, sourceChecksum: job.sourceChecksum } })).toBe(1);
    expect(await prisma.supplierOffer.count({ where: { supplierId } })).toBe(1);
  });

  it('names the products a full snapshot would deactivate', async () => {
    await prisma.supplierOffer.create({ data: { supplierId, skuId: sku400, costPrice: 180, currency: 'EGP', isAvailable: true } });
    const received = await upload(csv([`B-1,G10 Hydra Calm Cleanser 200ml,${brandName},${bc200},101.00,5`]), 'FULL_SNAPSHOT');
    expect(received.status).toBe(201);
    const diff = await request(server()).get(`/ingestion/jobs/${received.body.jobId}/diff`).set(supplierUser.auth);
    expect(diff.body.requiresDeactivationApproval).toBe(true);
    expect(diff.body.deactivationCandidates).toEqual([
      expect.objectContaining({ skuId: sku400, skuCode: `G10-400-${run}`, productName: 'G10 Hydra Calm Cleanser', currentCost: 180 }),
    ]);
    expect(sku200).toBeDefined();
  });
});
