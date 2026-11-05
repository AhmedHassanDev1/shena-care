/* eslint-disable @typescript-eslint/no-explicit-any -- HTTP response bodies are asserted structurally */
// The MVP freeze is ON for this whole file: Admin catalog lists must work while supplier files are refused.
process.env.SOURCING_MODE = 'BROADCAST_ON_DEMAND';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createHash, randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { StorageService } from '../../src/platform/storage/storage.service';
import { AiClient } from '../../src/platform/ai';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { createActor, Actor } from '../fixtures/actors';

/** EAN-13 with a correct check digit from a 12-digit body. */
const ean13 = (body: string) => {
  const sum = body.split('').reverse().reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return `${body}${(10 - sum % 10) % 10}`;
};

/**
 * Admin Catalog Import over real HTTP and PostgreSQL: identity-safe links, candidates, holds, idempotent retries,
 * incremental additions that never deactivate, row provenance and Admin-only access.
 */
describe('Admin catalog import (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageService;
  let admin: Actor;
  let hub: Actor;
  let customer: Actor;
  let supplierActor: Actor;
  const run = randomUUID().slice(0, 8).replace(/[0-9]/g, c => 'abcdefghij'[Number(c)]);
  const brandName = `Lumera${run}`;
  let existing: { id: string; barcode: string };
  let otherSku: { id: string };

  const api = () => request(app.getHttpServer());
  const csv = (rows: string[][]) => Buffer.from(rows.map(row => row.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n'), 'utf-8');
  const upload = (buffer: Buffer, actor: Actor = admin, name = 'list.csv', type = 'text/csv') =>
    api().post('/admin/catalog-imports').set(actor.auth).attach('file', buffer, { filename: name, contentType: type });
  const rowsOf = async (jobId: string) => (await api().get(`/admin/catalog-imports/${jobId}/rows`).set(admin.auth).expect(200)).body.rows as any[];
  const checksumOf = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
  const byNumber = (rows: any[], rowNumber: number) => rows.find(r => r.rowNumber === rowNumber);

  const catalogFingerprint = async () => ({
    skus: await prisma.sku.count(), products: await prisma.product.count(), brands: await prisma.brand.count(),
    activeSkus: await prisma.sku.count({ where: { isActive: true } }), offers: await prisma.supplierOffer.count(),
    listings: await prisma.listing.count(), prices: await prisma.sellingPrice.count(), published: await prisma.product.count({ where: { isPublished: true } }),
    supplierJobs: await prisma.ingestionJob.count(), candidates: await prisma.ingestionItem.count(),
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useClass(DeterministicAiClient).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    storage = app.get(StorageService);
    admin = await createActor(prisma, 'ADMIN');
    hub = await createActor(prisma, 'HUB_OPERATOR');
    customer = await createActor(prisma, 'CUSTOMER');
    const supplier = await prisma.supplier.create({ data: { name: `Import Supplier ${run}`, slug: `import-supplier-${run}-${randomUUID()}` } });
    supplierActor = await createActor(prisma, 'SUPPLIER', supplier.id);

    const brand = await prisma.brand.create({ data: { name: brandName, slug: `lumera-${run}-${randomUUID().slice(0, 4)}` } });
    const product = await prisma.product.create({ data: { brandId: brand.id, name: `${brandName} Hydra Gel Cleanser`, slug: `hydra-gel-${run}-${randomUUID()}`, isPublished: true } });
    const barcode = ean13(String(Math.floor(100000000000 + Math.random() * 899999999999)));
    const sku = await prisma.sku.create({ data: { productId: product.id, code: `LUM-${run}-${randomUUID()}`, variantName: '200 ml', size: 200, sizeUnit: 'ml', barcode } });
    existing = { id: sku.id, barcode };
    const otherBrand = await prisma.brand.create({ data: { name: `Orvane${run}`, slug: `orvane-${run}-${randomUUID().slice(0, 4)}` } });
    const otherProduct = await prisma.product.create({ data: { brandId: otherBrand.id, name: `Orvane Barrier Cream`, slug: `barrier-${run}-${randomUUID()}`, isPublished: true } });
    otherSku = await prisma.sku.create({ data: { productId: otherProduct.id, code: `ORV-${run}-${randomUUID()}`, variantName: '50 ml', size: 50, sizeUnit: 'ml', barcode: ean13(String(Math.floor(100000000000 + Math.random() * 899999999999))) } });
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  const header = ['Product Name', 'Brand', 'Size', 'Barcode', 'Category', 'URL', 'Price', 'Stock'];
  const firstFile = () => csv([
    header,
    [`${brandName} Hydra Gel Cleanser`, brandName, '200 ml', existing.barcode, 'Cleanser', 'https://example.com/hydra', '120', '40'], // 2: existing SKU
    ['Zenthra Glow Serum 30ml', `Zenthra${run}`, '30 ml', '', 'Serum', 'https://zenthra.example/glow', '300', '10'], // 3: unknown, complete
    ['Zenthra Glow Serum 30ml', `Zenthra${run}`, '30 ml', '', '', '', '299', '5'], // 4: same product again
    [`Kerrin Toner ${run}`, `Kerrin${run}`, '100 ml', '6221234567895', '', '', '', ''], // 5: malformed barcode
    ['', `Zenthra${run}`, '', '', '', '', '', ''], // 6: no name
    [`Plain Moisturiser ${run}`, '', '', '', '', '', '', ''], // 7: no brand, no size
    [`Vexa Mist ${run}`, `Vexa${run}`, 'big bottle', '', '', 'http://insecure.example/x', '', ''], // 8: unreadable size, insecure url
  ]);

  it('is Admin-only: anonymous, customer, hub operator and supplier cannot import or read', async () => {
    const file = firstFile();
    await api().post('/admin/catalog-imports').attach('file', file, 'list.csv').expect(401);
    for (const actor of [customer, hub, supplierActor]) {
      await upload(file, actor).expect(403);
      await api().get('/admin/catalog-imports').set(actor.auth).expect(403);
    }
  });

  it('adds knowledge only: links the verified SKU, queues the unknown product, holds the doubtful, and never touches catalog, offers, prices or supplier tables', async () => {
    const before = await catalogFingerprint();
    const file = firstFile();
    const res = await upload(file).expect(201);
    expect(res.body).toMatchObject({ reused: false, status: 'COMPLETED', totalRows: 7, matching: { status: 'COMPLETED' } });
    // Price and stock columns are recognised as not ours and are never read.
    expect(res.body.columnMap.ignored).toEqual(expect.arrayContaining(['Price', 'Stock']));
    expect(Object.keys(res.body.columnMap.mapped).sort()).toEqual(['barcode', 'brand', 'category', 'name', 'size', 'url']);

    const rows = await rowsOf(res.body.jobId);
    const linked = byNumber(rows, 2);
    expect(linked).toMatchObject({ outcome: 'LINKED_EXISTING', matchedSkuId: existing.id, reasonCode: 'VERIFIED_EXISTING_SKU' });
    expect(byNumber(rows, 3)).toMatchObject({ outcome: 'NEW_CANDIDATE', reasonCode: 'UNKNOWN_PRODUCT', matchedSkuId: null, sourceUrl: 'https://zenthra.example/glow', categoryHint: 'Serum' });
    expect(byNumber(rows, 4)).toMatchObject({ outcome: 'REJECTED', reasonCode: 'DUPLICATE_OF_ROW' });
    expect(byNumber(rows, 4).identity.duplicateOfRowId).toBe(byNumber(rows, 3).id);
    expect(byNumber(rows, 5)).toMatchObject({ outcome: 'HOLD', invalidBarcode: '6221234567895' });
    expect(byNumber(rows, 6)).toMatchObject({ outcome: 'REJECTED', reasonCode: 'MISSING_NAME' });
    expect(byNumber(rows, 7)).toMatchObject({ outcome: 'HOLD', reasonCode: 'MISSING_BRAND' });
    expect(byNumber(rows, 8)).toMatchObject({ outcome: 'HOLD', reasonCode: 'SIZE_UNREADABLE', sourceUrl: null });

    // Row-level provenance: the mapped cells as received, and no price or stock anywhere on the row.
    expect(linked.sourceCells['Product Name']).toBe(`${brandName} Hydra Gel Cleanser`);
    expect(String(linked.sourceCells.Barcode)).toBe(existing.barcode);
    expect(JSON.stringify(rows)).not.toMatch(/"Price"|"Stock"/);

    const job = (await api().get(`/admin/catalog-imports/${res.body.jobId}`).set(admin.auth).expect(200)).body;
    expect(job.totals).toMatchObject({ LINKED_EXISTING: 1, NEW_CANDIDATE: 1, HOLD: 3, REJECTED: 2, PENDING: 0, total: 7 });

    // The original is retained, byte for byte, with the uploader recorded.
    expect(job).toMatchObject({ uploadedBy: admin.id, sourceChecksum: checksumOf(file), status: 'COMPLETED' });
    expect(createHash('sha256').update(await storage.getFileBuffer(job.sourceKey)).digest('hex')).toBe(job.sourceChecksum);

    // Nothing in the catalog, commerce or supplier-ingestion tables moved.
    expect(await catalogFingerprint()).toEqual(before);
  }, 120000);

  it('is idempotent: the same file, retried or raced, resolves to one job and rewrites no decided row', async () => {
    const file = firstFile();
    const first = (await upload(file).expect(201)).body;
    expect(first.reused).toBe(true);
    const settled = await rowsOf(first.jobId);
    const racing = await Promise.all([upload(file), upload(file), upload(file)]);
    for (const response of racing) expect([response.status, response.body.jobId]).toEqual([201, first.jobId]);
    expect(await prisma.adminCatalogImportJob.count({ where: { sourceChecksum: checksumOf(file) } })).toBe(1);
    expect(await rowsOf(first.jobId)).toEqual(settled);
    const rematch = await api().post(`/admin/catalog-imports/${first.jobId}/match`).set(admin.auth).send({}).expect(200);
    expect(rematch.body).toMatchObject({ LINKED_EXISTING: 1, NEW_CANDIDATE: 1, HOLD: 3, REJECTED: 2 });
    expect(await rowsOf(first.jobId)).toEqual(settled);
  }, 120000);

  it('is incremental: a later list adds rows, converges on the earlier candidate, and never deactivates what it does not mention', async () => {
    const before = await catalogFingerprint();
    const first = await prisma.adminCatalogImportJob.findUniqueOrThrow({ where: { sourceChecksum: checksumOf(firstFile()) } });
    const firstRows = await rowsOf(first.id);
    const second = (await upload(csv([
      ['Name', 'Brand', 'Size'],
      ['Zenthra Glow Serum 30ml', `Zenthra${run}`, '30 ml'], // same unknown product as the first file
      [`Orvane Barrier Cream`, `Orvane${run}`, '50 ml'], // an existing SKU found by wording, not by barcode
    ]), admin, 'second.csv').expect(201)).body;
    expect(second).toMatchObject({ reused: false, status: 'COMPLETED', totalRows: 2 });
    const rows = await rowsOf(second.jobId);
    expect(byNumber(rows, 2)).toMatchObject({ outcome: 'REJECTED', reasonCode: 'DUPLICATE_OF_ROW' });
    expect(byNumber(rows, 2).identity.duplicateOfRowId).toBe(byNumber(firstRows, 3).id);
    expect(['LINKED_EXISTING', 'HOLD']).toContain(byNumber(rows, 3).outcome);
    if (byNumber(rows, 3).outcome === 'LINKED_EXISTING') expect(byNumber(rows, 3).matchedSkuId).toBe(otherSku.id);

    // SKUs absent from the second file are exactly as they were, and the first import's decisions are untouched.
    expect((await prisma.sku.findUniqueOrThrow({ where: { id: existing.id } })).isActive).toBe(true);
    expect(await rowsOf(first.id)).toEqual(firstRows);
    expect(await catalogFingerprint()).toEqual(before);
  }, 120000);

  it('refuses unusable files before storing anything', async () => {
    const jobs = await prisma.adminCatalogImportJob.count();
    const noName = await upload(csv([['Brand', 'Size'], ['X', '1 ml']]), admin, 'noname.csv').expect(400);
    expect(noName.body.code).toBe('NAME_COLUMN_NOT_FOUND');
    await api().post('/admin/catalog-imports').set(admin.auth).attach('file', Buffer.from('not a spreadsheet'), { filename: 'notes.txt', contentType: 'text/plain' }).expect(400);
    await api().post('/admin/catalog-imports').set(admin.auth).expect(400);
    expect(await prisma.adminCatalogImportJob.count()).toBe(jobs);
  });

  it('lets an Admin settle held rows only through the canonical identity safeguards, once, with a reason', async () => {
    const job = await prisma.adminCatalogImportJob.findUniqueOrThrow({ where: { sourceChecksum: checksumOf(firstFile()) } });
    const rows = await rowsOf(job.id);
    const unreadable = byNumber(rows, 8);
    const candidate = byNumber(rows, 3);
    const decide = (rowId: string, body: Record<string, unknown>, actor: Actor = admin) => api().post(`/admin/catalog-imports/rows/${rowId}/resolve`).set(actor.auth).send(body);

    await decide(unreadable.id, { action: 'REJECT', note: 'ok' }).expect(400); // a reason is mandatory
    await decide(unreadable.id, { action: 'LINK_SKU', note: 'link it please' }).expect(400); // LINK needs a SKU
    await decide(unreadable.id, { action: 'REJECT', note: 'Vague size, not worth chasing' }, hub).expect(403);

    // Linking to a SKU that is a different product is an identity conflict, whoever asks.
    const wrong = await decide(candidate.id, { action: 'LINK_SKU', skuId: otherSku.id, note: 'trying the wrong one' });
    expect(wrong.status).toBe(409);
    expect((await prisma.adminCatalogImportRow.findUniqueOrThrow({ where: { id: candidate.id } })).outcome).toBe('NEW_CANDIDATE');

    // The Admin created the real SKU in the workbench; linking the candidate to it passes the same identity check.
    const zenthra = await prisma.brand.create({ data: { name: `Zenthra${run}`, slug: `zenthra-${run}-${randomUUID().slice(0, 4)}` } });
    const zenthraProduct = await prisma.product.create({ data: { brandId: zenthra.id, name: 'Zenthra Glow Serum', slug: `zenthra-glow-${run}-${randomUUID()}` } });
    const zenthraSku = await prisma.sku.create({ data: { productId: zenthraProduct.id, code: `ZEN-${run}-${randomUUID()}`, variantName: '30 ml', size: 30, sizeUnit: 'ml' } });
    const linkedByAdmin = await decide(candidate.id, { action: 'LINK_SKU', skuId: zenthraSku.id, note: 'SKU created in the workbench' }).expect(200);
    expect(linkedByAdmin.body).toMatchObject({ outcome: 'LINKED_EXISTING', matchedSkuId: zenthraSku.id, reasonCode: 'ADMIN_LINKED', resolvedBy: admin.id });

    const rejected = await decide(unreadable.id, { action: 'REJECT', note: 'Vague size, not worth chasing' }).expect(200);
    expect(rejected.body).toMatchObject({ outcome: 'REJECTED', reasonCode: 'ADMIN_REJECTED', resolvedBy: admin.id, resolutionNote: 'Vague size, not worth chasing' });
    expect(rejected.body.resolvedAt).toBeTruthy();
    const again = await decide(unreadable.id, { action: 'REJECT', note: 'Second decision attempt' }).expect(409);
    expect(again.body.code).toBe('ROW_NOT_OPEN');

    // A decided row survives a recheck, and the job totals follow.
    await api().post(`/admin/catalog-imports/${job.id}/match`).set(admin.auth).send({ recheck: true }).expect(200);
    expect(byNumber(await rowsOf(job.id), 8)).toMatchObject({ outcome: 'REJECTED', reasonCode: 'ADMIN_REJECTED' });
    expect((await api().get(`/admin/catalog-imports/${job.id}`).set(admin.auth).expect(200)).body.totals.REJECTED).toBe(3);
  }, 120000);

  it('keeps supplier-facing ingestion frozen in the same mode', async () => {
    const frozen = await api().post('/ingestion/jobs/upload').set(admin.auth).attach('file', csv([['a', 'b'], ['1', '2']]), 'stock.csv').field('supplierId', randomUUID());
    expect([frozen.status, frozen.body.code]).toEqual([409, 'SUPPLIER_INGESTION_FROZEN']);
    await api().get('/ingestion/jobs').set(admin.auth).expect(200);
  });
});
