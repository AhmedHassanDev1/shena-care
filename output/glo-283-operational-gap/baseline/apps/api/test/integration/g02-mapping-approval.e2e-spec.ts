// GLO-274 Gate 02 — supplier layout recognition and independently approved mapping semantics, via the real HTTP path.
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { FILE_STORAGE_PORT, FileStoragePort } from '../../src/platform/storage/storage.port';
import { AiClient } from '../../src/platform/ai';
import { createActor, Actor } from '../fixtures/actors';

const HEADER = 'Item Code,Item Description,Net Cost EGP,On Hand,Supplier Discount';
const file = (rows: string[]) => Buffer.from([HEADER, ...rows].join('\n') + '\n');
const mapping = { supplierSku: 'Item Code', name: 'Item Description', price: 'Net Cost EGP', quantity: 'On Hand', discount: 'Supplier Discount' };
const approvedSemantics = { documentKind: 'STOCK_FEED', priceBasis: 'UNIT_PURCHASE_COST', quantityBasis: 'ON_HAND', discountBasis: 'PERCENT' };

describe('GLO-274 Gate 02: mapping approval & schema fingerprint (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storagePort: FileStoragePort;
  let admin: Actor, supplierUserA: Actor, supplierUserB: Actor;
  const supplierA = randomUUID();
  const supplierB = randomUUID();
  const run = randomUUID().slice(0, 8);
  const aiCalls: string[] = [];
  let firstJobId: string, secondJobId: string, proposalId: string;

  const server = () => app.getHttpServer();
  const upload = (actor: Actor, buffer: Buffer, fields: Record<string, string> = {}) => {
    let req = request(server()).post('/ingestion/jobs/upload').set(actor.auth);
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req.attach('file', buffer, { filename: 'stock.csv', contentType: 'text/csv' });
  };
  const items = (jobId: string) => prisma.ingestionItem.findMany({ where: { jobId }, orderBy: { supplierSkuCode: 'asc' } });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    storagePort = app.get(FILE_STORAGE_PORT);
    const ai = app.get(AiClient);
    for (const method of ['enrichProduct', 'generateContent', 'recommendRoutine'] as const) {
      jest.spyOn(ai, method).mockImplementation(async () => { aiCalls.push(method); throw new Error('AI must not be called in Gate 02'); });
    }
    await prisma.supplier.create({ data: { id: supplierA, name: `G02 Supplier A ${run}`, slug: `g02-a-${run}` } });
    await prisma.supplier.create({ data: { id: supplierB, name: `G02 Supplier B ${run}`, slug: `g02-b-${run}` } });
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
    await prisma.ingestionItem.deleteMany({ where: { job: { supplierId: { in: suppliers } } } });
    await prisma.ingestionJob.deleteMany({ where: { supplierId: { in: suppliers } } });
    await prisma.exportProfile.deleteMany({ where: { supplierId: { in: suppliers } } });
    const actors = [admin, supplierUserA, supplierUserB].map(a => a.id);
    await prisma.session.deleteMany({ where: { customerId: { in: actors } } });
    await prisma.customer.deleteMany({ where: { id: { in: actors } } });
    await prisma.supplier.deleteMany({ where: { id: { in: suppliers } } });
    await app.close();
  });

  it('holds a novel layout for mapping and admits no rows', async () => {
    const res = await upload(supplierUserA, file([`A-1-${run},CeraVe Cleanser 236ml,100.00,5,10`]));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'review_required', requiresMapping: true });
    expect(res.body.proposedMapping.price).toBe('Net Cost EGP');
    firstJobId = res.body.jobId;
    expect(await items(firstJobId)).toHaveLength(0);
  });

  it('turns a supplier mapping into a proposal — even when it claims purchase-cost semantics — and imports nothing', async () => {
    const res = await request(server()).post(`/ingestion/jobs/${firstJobId}/mapping`).set(supplierUserA.auth)
      .send({ mapping: { ...mapping, semantics: approvedSemantics } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'review_required', importedItemsCount: 0, awaitingApproval: true });
    proposalId = res.body.profileId;
    const profile = await prisma.exportProfile.findUniqueOrThrow({ where: { id: proposalId } });
    expect(profile.isApproved).toBe(false);
    expect(profile.approvedBy).toBeNull();
    expect((profile.mapping as { proposal: { proposedBy: string } }).proposal.proposedBy).toBe(supplierUserA.id);
    expect(await items(firstJobId)).toHaveLength(0);
  });

  it('does not let a supplier approve mapping semantics or inject proposal metadata', async () => {
    const approve = await request(server()).post(`/ingestion/profiles/${proposalId}/approve`).set(supplierUserA.auth)
      .send({ supplierId: supplierA });
    expect(approve.status).toBe(403);
    const profile = await prisma.exportProfile.findUniqueOrThrow({ where: { id: proposalId } });
    expect(profile.isApproved).toBe(false);
  });

  it('holds a second same-layout file on the open proposal instead of importing it', async () => {
    const res = await upload(supplierUserA, file([`A-2-${run},Bioderma Sensibio H2O 500ml,210.00,0,`]));
    expect(res.body).toMatchObject({ status: 'review_required', awaitingApproval: true, profileId: proposalId });
    secondJobId = res.body.jobId;
    expect(await items(secondJobId)).toHaveLength(0);
  });

  it('rejects an internal approval whose semantics would turn retail or unknown prices into cost', async () => {
    const res = await request(server()).post(`/ingestion/profiles/${proposalId}/approve`).set(admin.auth)
      .send({ supplierId: supplierA, semantics: { priceBasis: 'RETAIL_PRICE' } });
    expect(res.status).toBe(400);
    expect(await items(firstJobId)).toHaveLength(0);
  });

  it('admits every held job exactly once after independent approval, with typed quantity and discount', async () => {
    const res = await request(server()).post(`/ingestion/profiles/${proposalId}/approve`).set(admin.auth)
      .send({ supplierId: supplierA, semantics: approvedSemantics });
    expect(res.status).toBe(201);
    expect(res.body.approvedBy).toBe(admin.id);
    expect(res.body.importedJobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ jobId: firstJobId, importedItemsCount: 1 }),
      expect.objectContaining({ jobId: secondJobId, importedItemsCount: 1 }),
    ]));
    const [first] = await items(firstJobId);
    expect(first).toMatchObject({ reportedQuantity: 5, priceType: 'PURCHASE_COST', currency: 'EGP' });
    expect(first.price.toNumber()).toBe(100);
    const [second] = await items(secondJobId);
    expect(second.reportedQuantity).toBe(0); // explicit zero stays zero, never "unknown"

    const again = await request(server()).post(`/ingestion/profiles/${proposalId}/approve`).set(admin.auth)
      .send({ supplierId: supplierA, semantics: approvedSemantics });
    expect(again.body.importedJobs).toEqual([]);
    expect(await items(firstJobId)).toHaveLength(1);
  });

  it('reuses the approved profile for a new same-layout file with 0 AI calls; same bytes stay a duplicate', async () => {
    const third = file([`A-3-${run},Vichy Mineral 89 50ml,300.00,7,5`, `A-4-${run},Eucerin Sun Fluid 50ml,250.00,,`]);
    const res = await upload(supplierUserA, third);
    expect(res.body).toMatchObject({ status: 'pending', requiresMapping: false, profileId: proposalId, importedItemsCount: 2 });
    const rows = await items(res.body.jobId);
    expect(rows.map(r => r.reportedQuantity)).toEqual([7, null]); // blank on-hand cell → unknown, not zero
    const jobs = await prisma.ingestionJob.findMany({ where: { id: { in: [firstJobId, res.body.jobId] } } });
    expect(new Set(jobs.map(j => j.formatFingerprint)).size).toBe(1);
    expect(new Set(jobs.map(j => j.sourceChecksum)).size).toBe(2);

    const dup = await upload(supplierUserA, third);
    expect(dup.body).toMatchObject({ jobId: res.body.jobId, reused: true });
    // Mapping reuse calls no AI. Since GLO-276, rows proven new are enriched in the slow lane — those are the only calls allowed.
    expect(aiCalls.filter(method => method !== 'enrichProduct')).toEqual([]);
    expect(aiCalls.filter(method => method === 'enrichProduct').length)
      .toBeLessThanOrEqual(res.body.matching.newCandidates + dup.body.matching.newCandidates + 2);
  });

  it('does not reuse the profile when the declared document kind differs', async () => {
    const res = await upload(supplierUserA, file([`A-5-${run},CeraVe Cream 340g,400.00,3,`]), { documentKind: 'SALES_INVOICE' });
    expect(res.body).toMatchObject({ status: 'review_required', requiresMapping: true });
    expect(await items(res.body.jobId)).toHaveLength(0);
  });

  it('holds a changed (reordered) layout for review instead of misrouting columns', async () => {
    const reordered = Buffer.from(`Item Description,Item Code,Net Cost EGP,On Hand,Supplier Discount\nLa Roche Effaclar 200ml,A-6-${run},150.00,4,\n`);
    const res = await upload(supplierUserA, reordered);
    expect(res.body).toMatchObject({ status: 'review_required', requiresMapping: true });
  });

  it('never applies a legacy approval that lacks reviewed semantics', async () => {
    const legacyHeader = 'Legacy Code,Legacy Name,Legacy Price EGP';
    const probe = await upload(supplierUserA, Buffer.from(`${legacyHeader}\nL-0-${run},Probe Cream,10.00\n`));
    await prisma.exportProfile.create({ data: {
      supplierId: supplierA, name: 'legacy self-approved', formatFingerprint: probe.body.formatFingerprint, version: 1,
      isApproved: true, approvedBy: supplierUserA.id, approvedAt: new Date(), sampleHeaders: legacyHeader.split(','),
      mapping: { supplierSku: 'Legacy Code', name: 'Legacy Name', price: 'Legacy Price EGP' },
    } });
    const res = await upload(supplierUserA, Buffer.from(`${legacyHeader}\nL-1-${run},CeraVe Lotion 236ml,90.00\n`));
    expect(res.body).toMatchObject({ status: 'review_required', requiresMapping: true });
    expect(await items(res.body.jobId)).toHaveLength(0);
  });

  it('keeps another supplier from inheriting, reading or approving the profile', async () => {
    const res = await upload(supplierUserB, file([`B-1-${run},CeraVe Cleanser 236ml,90.00,2,`]));
    expect(res.body).toMatchObject({ status: 'review_required', requiresMapping: true });
    expect(res.body.profileId).toBeUndefined();
    expect((await request(server()).get(`/ingestion/profiles/${proposalId}`).set(supplierUserB.auth)).status).toBe(403);
    const listed = await request(server()).get('/ingestion/profiles').set(supplierUserB.auth);
    expect(listed.body.some((p: { id: string }) => p.id === proposalId)).toBe(false);
    expect((await request(server()).post(`/ingestion/profiles/${proposalId}/approve`).set(admin.auth)
      .send({ supplierId: supplierB, semantics: approvedSemantics })).status).toBe(403);
  });

  it('imports invoice quantities as unknown stock and refuses invoice quantity as on-hand stock', async () => {
    const invoiceHeader = 'Inv Code,Inv Item,Inv Unit Cost EGP,Inv Qty Sold';
    const res = await upload(supplierUserA, Buffer.from(`${invoiceHeader}\nI-1-${run},CeraVe Cream 454g,500.00,12\n`), { documentKind: 'SALES_INVOICE' });
    const invoiceMapping = { supplierSku: 'Inv Code', name: 'Inv Item', price: 'Inv Unit Cost EGP', quantity: 'Inv Qty Sold' };
    const asStock = await request(server()).post(`/ingestion/jobs/${res.body.jobId}/mapping`).set(admin.auth)
      .send({ mapping: { ...invoiceMapping, semantics: { documentKind: 'SALES_INVOICE', priceBasis: 'UNIT_PURCHASE_COST', quantityBasis: 'ON_HAND' } } });
    expect(asStock.status).toBe(400);
    const asInvoice = await request(server()).post(`/ingestion/jobs/${res.body.jobId}/mapping`).set(admin.auth)
      .send({ mapping: { ...invoiceMapping, semantics: { documentKind: 'SALES_INVOICE', priceBasis: 'UNIT_PURCHASE_COST', quantityBasis: 'INVOICE_QUANTITY' } } });
    expect(asInvoice.body).toMatchObject({ status: 'pending', importedItemsCount: 1, awaitingApproval: false });
    const [row] = await items(res.body.jobId);
    expect(row.reportedQuantity).toBeNull();
  });
});
