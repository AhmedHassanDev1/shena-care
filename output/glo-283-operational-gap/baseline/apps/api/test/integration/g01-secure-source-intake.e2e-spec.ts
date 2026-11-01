// GLO-273 Gate 01 — secure source intake & file custody, exercised through the real HTTP upload path.
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { createHash, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { StorageService } from '../../src/platform/storage/storage.service';
import { FILE_STORAGE_PORT, FileStoragePort } from '../../src/platform/storage/storage.port';
import { ExportProfileService } from '../../src/modules/ingestion/services/export-profile.service';
import { createActor, Actor } from '../fixtures/actors';

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const csv = (tag: string) => Buffer.from(`Supplier SKU,Product Name,Buy Cost,Qty\n${tag}-1,CeraVe Cleanser 236ml,100.00,5\n`);

describe('GLO-273 Gate 01: secure source intake & file custody (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageService;
  let storagePort: FileStoragePort;
  let admin: Actor, supplierUserA: Actor, supplierUserB: Actor, unlinkedSupplier: Actor, customer: Actor;
  const supplierA = randomUUID();
  const supplierB = randomUUID();
  const run = randomUUID().slice(0, 8);

  const upload = (auth: Record<string, string> | undefined, file: Buffer, name: string, mime = 'text/csv', fields: Record<string, string> = {}) => {
    let req = request(app.getHttpServer()).post('/ingestion/jobs/upload');
    if (auth) req = req.set(auth);
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req.attach('file', file, { filename: name, contentType: mime });
  };

  /** Business tables that a bare file receipt must never touch. */
  const businessCounts = async () => ({
    offers: await prisma.supplierOffer.count(),
    skus: await prisma.sku.count(),
    products: await prisma.product.count(),
    sellingPrices: await prisma.sellingPrice.count(),
    aliases: await prisma.supplierSkuAlias.count(),
  });
  const jobCount = () => prisma.ingestionJob.count({ where: { supplierId: { in: [supplierA, supplierB] } } });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    storage = app.get(StorageService);
    storagePort = app.get(FILE_STORAGE_PORT);

    await prisma.supplier.create({ data: { id: supplierA, name: `G01 Supplier A ${run}`, slug: `g01-a-${run}` } });
    await prisma.supplier.create({ data: { id: supplierB, name: `G01 Supplier B ${run}`, slug: `g01-b-${run}` } });
    admin = await createActor(prisma, 'ADMIN');
    supplierUserA = await createActor(prisma, 'SUPPLIER', supplierA);
    supplierUserB = await createActor(prisma, 'SUPPLIER', supplierB);
    unlinkedSupplier = await createActor(prisma, 'SUPPLIER');
    customer = await createActor(prisma, 'CUSTOMER');
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    const jobs = await prisma.ingestionJob.findMany({ where: { supplierId: { in: [supplierA, supplierB] } } });
    for (const job of jobs) if (job.sourceKey) await storagePort.delete(job.sourceKey);
    await prisma.ingestionItem.deleteMany({ where: { job: { supplierId: { in: [supplierA, supplierB] } } } });
    await prisma.ingestionJob.deleteMany({ where: { supplierId: { in: [supplierA, supplierB] } } });
    await prisma.exportProfile.deleteMany({ where: { supplierId: { in: [supplierA, supplierB] } } });
    const actors = [admin, supplierUserA, supplierUserB, unlinkedSupplier, customer].map(a => a.id);
    await prisma.session.deleteMany({ where: { customerId: { in: actors } } });
    await prisma.customer.deleteMany({ where: { id: { in: actors } } });
    await prisma.supplier.deleteMany({ where: { id: { in: [supplierA, supplierB] } } });
    await app.close();
  });

  describe('authentication and tenant scope', () => {
    it('denies anonymous, customer, unlinked-supplier and forged-supplier uploads with no side effects', async () => {
      const before = await jobCount();
      expect((await upload(undefined, csv(`anon-${run}`), 'p.csv', 'text/csv', { supplierId: supplierA })).status).toBe(401);
      expect((await upload(customer.auth, csv(`cust-${run}`), 'p.csv', 'text/csv', { supplierId: supplierA })).status).toBe(403);
      expect((await upload(unlinkedSupplier.auth, csv(`unl-${run}`), 'p.csv')).status).toBe(403);
      expect((await upload(supplierUserB.auth, csv(`forge-${run}`), 'p.csv', 'text/csv', { supplierId: supplierA })).status).toBe(403);
      expect(await jobCount()).toBe(before);
    });

    it('scopes a supplier upload from the session, records custody metadata and mutates no business data', async () => {
      const before = await businessCounts();
      const file = csv(`ok-${run}`);
      const res = await upload(supplierUserA.auth, file, '../../etc/pa<ss>wd.csv', 'text/csv', { documentKind: 'PRICE_LIST' });
      expect(res.status).toBe(201);
      expect(res.body.requiresMapping).toBe(true);

      const job = await prisma.ingestionJob.findUniqueOrThrow({ where: { id: res.body.jobId }, include: { items: true } });
      expect(job.supplierId).toBe(supplierA);
      expect(job.uploadedBy).toBe(supplierUserA.id);
      expect(job.sourceChecksum).toBe(sha256(file));
      expect(job.sourceFileName).toBe('pa_ss_wd.csv');
      expect(job.sourceMimeType).toBe('text/csv');
      expect(job.sourceSizeBytes).toBe(file.length);
      expect(job.sourceMetadata).toMatchObject({ declaredDocumentKind: 'PRICE_LIST', workbookCreatedAt: null });
      expect(Date.parse((job.sourceMetadata as { receivedAt: string }).receivedAt)).not.toBeNaN();
      expect(job.items).toHaveLength(0);
      expect(job.sourceKey).toMatch(new RegExp(`^private/${supplierA}/ingestion/[0-9a-f-]{36}\\.csv$`));
      expect(sha256(await storage.getFileBuffer(job.sourceKey!))).toBe(job.sourceChecksum);
      expect(await businessCounts()).toEqual(before);
    });

    it('keeps another tenant away from the receipt, its results and the original bytes', async () => {
      const res = await upload(supplierUserA.auth, csv(`tenant-${run}`), 'p.csv');
      const job = await prisma.ingestionJob.findUniqueOrThrow({ where: { id: res.body.jobId } });
      const server = app.getHttpServer();
      expect((await request(server).get(`/ingestion/jobs/${job.id}`).set(supplierUserB.auth)).status).toBe(404);
      expect((await request(server).get(`/ingestion/jobs/${job.id}/diff`).set(supplierUserB.auth)).status).toBe(403);
      const listed = await request(server).get('/ingestion/jobs').set(supplierUserB.auth);
      expect(listed.body.some((j: { id: string }) => j.id === job.id)).toBe(false);
      expect((await request(server).get(`/storage/${job.sourceKey}`)).status).toBe(401);
      expect((await request(server).get(`/storage/${job.sourceKey}`).set(supplierUserB.auth)).status).toBe(403);
      expect((await request(server).get(`/storage/${job.sourceKey}`).set(supplierUserA.auth)).status).toBe(200);
    });
  });

  describe('file safety', () => {
    it('rejects spoofed, corrupt, empty and executable files without creating receipts', async () => {
      const before = await jobCount();
      const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const cases: Array<[Buffer, string, string]> = [
        [csv(`exe-${run}`), 'prices.exe', 'text/csv'],
        [csv(`mime-${run}`), 'prices.csv', xlsxMime],
        [Buffer.from('not a zip archive'), 'prices.xlsx', xlsxMime],
        [Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]), 'truncated.xlsx', xlsxMime],
        [Buffer.from('MZ\x90\x00 disguised'), 'prices.csv', 'text/csv'],
        [Buffer.from([0x61, 0x00, 0x62]), 'nulls.csv', 'text/csv'],
        [Buffer.alloc(0), 'empty.csv', 'text/csv'],
      ];
      for (const [buffer, name, mime] of cases) {
        const res = await upload(supplierUserA.auth, buffer, name, mime);
        expect({ name, status: res.status }).toEqual({ name, status: 400 });
      }
      const oversize = await upload(supplierUserA.auth, Buffer.alloc(5 * 1024 * 1024 + 1, 0x61), 'huge.csv');
      expect([400, 413]).toContain(oversize.status);
      expect(await jobCount()).toBe(before);
    });
  });

  describe('duplicates, retries and concurrency', () => {
    it('returns the same receipt for repeated and simultaneous identical uploads', async () => {
      const file = csv(`dup-${run}`);
      const first = await upload(supplierUserA.auth, file, 'dup.csv');
      expect(first.status).toBe(201);
      const repeat = await upload(supplierUserA.auth, file, 'dup-renamed.csv');
      expect(repeat.body).toMatchObject({ jobId: first.body.jobId, reused: true });

      const parallelFile = csv(`par-${run}`);
      const parallel = await Promise.all(Array.from({ length: 6 }, () => upload(supplierUserA.auth, parallelFile, 'par.csv')));
      expect(parallel.every(r => r.status === 201)).toBe(true);
      expect(new Set(parallel.map(r => r.body.jobId)).size).toBe(1);
      expect(await prisma.ingestionJob.count({ where: { supplierId: supplierA, sourceChecksum: sha256(parallelFile) } })).toBe(1);
    });

    it('isolates identical bytes submitted for a different supplier', async () => {
      const file = csv(`shared-${run}`);
      const a = await upload(supplierUserA.auth, file, 'shared.csv');
      const b = await upload(supplierUserB.auth, file, 'shared.csv');
      expect(a.body.jobId).not.toBe(b.body.jobId);
      expect(b.body.reused).toBeUndefined();
    });

    it('enforces one receipt per supplier original in the database itself', async () => {
      const existing = await prisma.ingestionJob.findFirstOrThrow({ where: { supplierId: supplierA, sourceChecksum: { not: null } } });
      await expect(prisma.ingestionJob.create({ data: { supplierId: supplierA, sourceChecksum: existing.sourceChecksum } }))
        .rejects.toMatchObject({ code: 'P2002' } as Partial<Prisma.PrismaClientKnownRequestError>);
    });

    it('restores a missing retained original on retry without changing provenance', async () => {
      const file = csv(`restore-${run}`);
      const first = await upload(supplierUserA.auth, file, 'restore.csv');
      await storagePort.delete(first.body.sourceKey);
      const retry = await upload(supplierUserA.auth, file, 'restore.csv');
      expect(retry.body).toMatchObject({ jobId: first.body.jobId, sourceKey: first.body.sourceKey, reused: true });
      expect(sha256(await storage.getFileBuffer(first.body.sourceKey))).toBe(sha256(file));
    });

    it('refuses to reuse or remap a retained original whose bytes no longer match its checksum', async () => {
      const file = csv(`tamper-${run}`);
      const first = await upload(supplierUserA.auth, file, 'tamper.csv');
      const tampered = Buffer.from('Supplier SKU,Product Name,Buy Cost,Qty\nX-1,Tampered,1.00,999\n');
      await storagePort.put(first.body.sourceKey, tampered);

      const retry = await upload(supplierUserA.auth, file, 'tamper.csv');
      expect(retry.status).toBe(409);
      const remap = await request(app.getHttpServer()).post(`/ingestion/jobs/${first.body.jobId}/mapping`).set(admin.auth)
        .send({ mapping: { supplierSku: 'Supplier SKU', name: 'Product Name', price: 'Buy Cost', currency: 'EGP' } });
      expect(remap.status).toBe(409);
      expect(sha256(await storage.getFileBuffer(first.body.sourceKey))).toBe(sha256(tampered)); // evidence kept, not overwritten
      expect(await prisma.ingestionItem.count({ where: { jobId: first.body.jobId } })).toBe(0);
    });
  });

  describe('storage and database failures', () => {
    it('reports a storage outage as a failure, leaves no receipt, and succeeds on retry', async () => {
      const file = csv(`outage-${run}`);
      jest.spyOn(storage, 'uploadFile').mockRejectedValueOnce(new Error('storage backend unavailable'));
      const failed = await upload(supplierUserA.auth, file, 'outage.csv');
      expect(failed.status).toBe(500);
      expect(await prisma.ingestionJob.count({ where: { supplierId: supplierA, sourceChecksum: sha256(file) } })).toBe(0);

      const retry = await upload(supplierUserA.auth, file, 'outage.csv');
      expect(retry.status).toBe(201);
      expect(retry.body.reused).toBeUndefined();
    });

    it('removes the stored original when the receipt cannot be recorded', async () => {
      const file = csv(`dbfail-${run}`);
      const stored: string[] = [];
      const realUpload = storage.uploadFile.bind(storage);
      jest.spyOn(storage, 'uploadFile').mockImplementationOnce(async (...args) => {
        const url = await realUpload(...args);
        stored.push(new URL(url).pathname.slice('/storage/'.length));
        return url;
      });
      jest.spyOn(app.get(ExportProfileService), 'findApprovedProfile').mockRejectedValueOnce(new Error('database write failed'));

      const res = await upload(supplierUserA.auth, file, 'dbfail.csv');
      expect(res.status).toBe(500);
      expect(stored).toHaveLength(1);
      expect(await storagePort.exists(stored[0])).toBe(false);
      expect(await prisma.ingestionJob.count({ where: { supplierId: supplierA, sourceChecksum: sha256(file) } })).toBe(0);
    });
  });
});
