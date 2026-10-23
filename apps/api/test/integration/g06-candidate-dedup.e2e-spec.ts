// GLO-278 Gate 06 — one candidate per new product across suppliers; uncertain identity goes to review, never duplicated.
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

type Identity = { classification: string; existingCandidateId: string | null; previouslyRejectedCandidateId: string | null;
  possibleDuplicateCandidateIds: string[]; conflicts: string[] };

describe('GLO-278 Gate 06: new product candidates & cross-supplier dedup (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storagePort: FileStoragePort;
  let admin: Actor;
  const suppliers: Record<'A' | 'B' | 'C', { id: string; actor?: Actor }> = { A: { id: randomUUID() }, B: { id: randomUUID() }, C: { id: randomUUID() } };
  const run = randomUUID().slice(0, 8);
  const brand = `G06 Brand ${run}`;
  const bcNew = `29${digits(11)}`;
  const bcInactive = `29${digits(11)}`;
  let brandId: string, productId: string;
  const aiCalls: string[] = [];
  const serumIds: string[] = [];

  const server = () => app.getHttpServer();
  const upload = async (who: 'A' | 'B' | 'C', rows: string[]) => {
    const res = await request(server()).post('/ingestion/jobs/upload').set(suppliers[who].actor!.auth)
      .attach('file', Buffer.from([HEADER, ...rows].join('\n') + '\n'), { filename: `${who}-${randomUUID()}.csv`, contentType: 'text/csv' });
    const body = res.body.requiresMapping
      ? { ...res.body, ...(await request(server()).post(`/ingestion/jobs/${res.body.jobId}/mapping`).set(admin.auth).send({ mapping })).body }
      : res.body;
    const items = await prisma.ingestionItem.findMany({ where: { jobId: body.jobId }, orderBy: { supplierSkuCode: 'asc' } });
    return { ...body, items, identity: (i = 0) => (items[i].enrichment as { identity: Identity }).identity };
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    storagePort = app.get(FILE_STORAGE_PORT);
    jest.spyOn(app.get(AiClient), 'enrichProduct').mockImplementation(async (input) => {
      aiCalls.push(String(input.rawTitle));
      throw new Error('AI disabled in Gate 06 tests');
    });
    for (const [key, s] of Object.entries(suppliers)) {
      await prisma.supplier.create({ data: { id: s.id, name: `G06 Supplier ${key} ${run}`, slug: `g06-${key.toLowerCase()}-${run}` } });
      s.actor = await createActor(prisma, 'SUPPLIER', s.id);
    }
    admin = await createActor(prisma, 'ADMIN');
    brandId = (await prisma.brand.create({ data: { name: brand, slug: `g06-brand-${run}` } })).id;
    productId = (await prisma.product.create({ data: { brandId, name: 'Calm Lotion', slug: `g06-calm-lotion-${run}` } })).id;
    await prisma.sku.create({ data: { productId, code: `G06-200-${run}`, variantName: 'Default', size: 200, sizeUnit: 'ml', barcode: `29${digits(11)}` } });
    await prisma.sku.create({ data: { productId, code: `G06-100-${run}`, variantName: 'Default', size: 100, sizeUnit: 'ml', barcode: bcInactive, isActive: false } });
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    const ids = Object.values(suppliers).map(s => s.id);
    for (const job of await prisma.ingestionJob.findMany({ where: { supplierId: { in: ids } } })) {
      if (job.sourceKey) await storagePort.delete(job.sourceKey);
    }
    await prisma.supplierOffer.deleteMany({ where: { supplierId: { in: ids } } });
    await prisma.supplierSkuAlias.deleteMany({ where: { supplierId: { in: ids } } });
    await prisma.ingestionItem.deleteMany({ where: { job: { supplierId: { in: ids } } } });
    await prisma.ingestionJob.deleteMany({ where: { supplierId: { in: ids } } });
    await prisma.exportProfile.deleteMany({ where: { supplierId: { in: ids } } });
    await prisma.sku.deleteMany({ where: { productId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.brand.deleteMany({ where: { id: brandId } });
    const actors = [admin.id, ...Object.values(suppliers).map(s => s.actor!.id)];
    await prisma.session.deleteMany({ where: { customerId: { in: actors } } });
    await prisma.customer.deleteMany({ where: { id: { in: actors } } });
    await prisma.supplier.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  it('creates exactly one candidate for a new product and links the same product from other suppliers', async () => {
    const a = await upload('A', [`A-1,G06 Night Serum 30ml,${brand},${bcNew},300.00,5`]);
    expect(a.matching).toMatchObject({ newCandidates: 1, linkedToExistingCandidate: 0 });
    expect(a.identity()).toMatchObject({ classification: 'NO_MATCH', existingCandidateId: null });
    serumIds.push(a.items[0].id);

    const b = await upload('B', [`B-9,G06 Night Serum 30ml,${brand},,290.00,3`]); // same wording, no barcode
    expect(b.matching).toMatchObject({ newCandidates: 0, linkedToExistingCandidate: 1 });
    expect(b.identity().existingCandidateId).toBe(a.items[0].id);

    const c = await upload('C', [`C-7,سيروم ليلي ٣٠ مل,${brand},${bcNew},310.00,2`]); // Arabic title, same barcode
    expect(c.matching).toMatchObject({ linkedToExistingCandidate: 1 });
    expect(c.identity().existingCandidateId).toBe(a.items[0].id);
    expect(aiCalls.filter(t => t.includes('Night Serum') || t.includes('سيروم'))).toHaveLength(1);
    // Supplier provenance kept per row: three rows, three suppliers, one primary candidate.
    const rows = await prisma.ingestionItem.findMany({ where: { id: { in: [a.items[0].id, b.items[0].id, c.items[0].id] } }, include: { job: true } });
    expect(new Set(rows.map(r => r.job.supplierId)).size).toBe(3);
  });

  it('holds a differently-worded row of the same brand and size for review instead of making a second candidate', async () => {
    const c = await upload('C', [`C-8,سيروم ليلي مركز ٣٠ مل,${brand},,305.00,1`]);
    expect(c.matching).toMatchObject({ newCandidates: 0, needsReview: 1, aiEnrichmentRequests: 0 });
    expect(c.identity().possibleDuplicateCandidateIds).toContain(serumIds[0]);
  });

  it('does not treat a clearly different same-script product of the brand and size as a duplicate (GLO-281)', async () => {
    const a = await upload('A', [`A-7,G06 Vitamin Glow Serum 30ml,${brand},,280.00,2`]);
    expect(a.identity().possibleDuplicateCandidateIds).not.toContain(serumIds[0]);
  });

  it('never treats an inactive catalog SKU, a different size or missing net content as a new product', async () => {
    const res = await upload('A', [
      `A-2,G06 Calm Lotion 100ml,${brand},${bcInactive},120.00,4`, // inactive SKU's barcode
      `A-3,Calm Lotion 400ml,${brand},,180.00,4`, // existing product, different size
      `A-4,G06 Hydrating Toner,${brand},,90.00,4`, // no net content stated
    ]);
    expect(res.matching).toMatchObject({ newCandidates: 0, needsReview: 3, aiEnrichmentRequests: 0 });
    expect(res.identity(0)).toMatchObject({ classification: 'CONFLICT', conflicts: ['canonical_sku_inactive'] });
    expect(res.identity(1).classification).toBe('LIKELY_MATCH');
    expect(res.identity(2).conflicts).toContain('missing_net_content');
  });

  it('does not resurrect a rejected product as a fresh candidate on the next upload', async () => {
    const first = await upload('A', [`A-5,G06 Eye Gel 15ml,${brand},,140.00,4`]);
    expect(first.matching.newCandidates).toBe(1);
    expect((await request(server()).patch(`/ingestion/candidates/${first.items[0].id}/reject`).set(admin.auth)
      .send({ reason: 'Not part of launch range' })).status).toBe(200);
    const again = await upload('B', [`B-5,G06 Eye Gel 15ml,${brand},,135.00,2`]);
    expect(again.matching).toMatchObject({ newCandidates: 0, needsReview: 1, aiEnrichmentRequests: 0 });
    expect(again.identity().previouslyRejectedCandidateId).toBe(first.items[0].id);
  });

  it('converges two suppliers racing on the same new product onto a single candidate', async () => {
    const before = aiCalls.length;
    const [a, b] = await Promise.all([
      upload('A', [`A-6,G06 Lip Balm 10ml,${brand},,60.00,9`]),
      upload('B', [`B-6,G06 Lip Balm 10ml,${brand},,58.00,7`]),
    ]);
    const ids = [a.items[0].id, b.items[0].id];
    const rows = await prisma.ingestionItem.findMany({ where: { id: { in: ids } } });
    const primaries = rows.filter(r => !(r.enrichment as { identity: Identity }).identity.existingCandidateId);
    expect(primaries).toHaveLength(1);
    const linked = rows.find(r => r.id !== primaries[0].id)!;
    expect((linked.enrichment as { identity: Identity }).identity.existingCandidateId).toBe(primaries[0].id);
    expect(aiCalls.length - before).toBe(1);
  });
});
