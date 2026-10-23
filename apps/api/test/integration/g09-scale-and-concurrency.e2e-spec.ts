// GLO-281 Gate 09 — bounded synthetic load: a 1,000-row mixed supplier file, a 1,000-row known-only file uploaded,
// re-uploaded with changes and replayed, and concurrency packs; every row reconciled, every stage measured.
// Scale with G09_SCALE (default 1 = 1,000 rows); the measured report is written to G09_REPORT when set.
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { writeFileSync } from 'fs';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { FILE_STORAGE_PORT, FileStoragePort } from '../../src/platform/storage/storage.port';
import { AiClient } from '../../src/platform/ai';
import { createActor, Actor } from '../fixtures/actors';

jest.setTimeout(45 * 60 * 1000);

const SCALE = Number(process.env.G09_SCALE ?? 1);
const ROWS = Math.round(1000 * SCALE);
const share = (n: number) => Math.round(n * SCALE);
const MIX = { known: 0, novel: share(150), ambiguous: share(80), invalid: share(70), duplicate: share(50), outOfScope: share(50) };
MIX.known = ROWS - MIX.novel - MIX.ambiguous - MIX.invalid - MIX.duplicate - MIX.outOfScope; // 600 at full scale
const HEADER = 'Code,Item,Brand,Barcode,Cost EGP,On Hand,Updated';
const semantics = { documentKind: 'STOCK_FEED', priceBasis: 'UNIT_PURCHASE_COST', quantityBasis: 'ON_HAND' };
const mapping = { supplierSku: 'Code', name: 'Item', brand: 'Brand', barcode: 'Barcode', price: 'Cost EGP', quantity: 'On Hand', sourceTimestamp: 'Updated', semantics };
/** Distinct alphabetic product words: digits in names would collide in base-name comparison. */
const word = (i: number) => { let s = ''; let n = i + 26 * 26; while (n > 0) { s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); } return s; };
/** Two unrelated 4-letter words: distinct new products must not look like near-duplicates of each other. */
const distinct = (i: number, salt: number) =>
  `${word(((i + salt) * 7919) % 400000 + 17576)} ${word(((i + salt) * 104729) % 400000 + 17576)}`;
const pct = (values: number[], p: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)].toFixed(1));
};

describe(`GLO-281 Gate 09: ${ROWS}-row scale, reconciliation and concurrency (e2e)`, () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storagePort: FileStoragePort;
  let admin: Actor, supMixed: Actor, supKnown: Actor, supC: Actor, supD: Actor;
  const run = randomUUID().slice(0, 8);
  const brand = `G09 Brand ${run}`;
  const [sMixed, sKnown, sC, sD] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const suppliers = [sMixed, sKnown, sC, sD];
  let brandId: string;
  const known: Array<{ productId: string; skuId: string; name: string; barcode: string }> = [];
  const aiCalls: string[] = [];
  const report: Record<string, unknown> = { rows: ROWS, scale: SCALE, startedAt: new Date().toISOString() };

  // Measurement: every Prisma operation (incl. raw and transactional) is counted and timed per stage.
  let stage = 'setup';
  const ops: Record<string, { count: number; ms: number[] }> = {};
  let peakRss = 0;
  const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 200);
  const measure = async <T>(name: string, rows: number, fn: () => Promise<T>): Promise<T> => {
    stage = name;
    const started = Date.now();
    try { return await fn(); } finally {
      const elapsed = Date.now() - started;
      const o = ops[name] ?? { count: 0, ms: [] };
      report[`stage:${name}`] = { rows, wallMs: elapsed, dbOps: o.count, dbOpsPerRow: rows ? Number((o.count / rows).toFixed(2)) : null,
        dbOpP50Ms: pct(o.ms, 50), dbOpP95Ms: pct(o.ms, 95), msPerRow: rows ? Number((elapsed / rows).toFixed(1)) : null };
      stage = 'idle';
    }
  };

  const server = () => app.getHttpServer();
  const csv = (rows: string[]) => Buffer.from([HEADER, ...rows].join('\n') + '\n');
  const upload = (actor: Actor, buffer: Buffer, name = 'stock.csv') => request(server()).post('/ingestion/jobs/upload')
    .set(actor.auth).attach('file', buffer, { filename: name, contentType: 'text/csv' });
  const mapJob = (jobId: string) => request(server()).post(`/ingestion/jobs/${jobId}/mapping`).set(admin.auth).send({ mapping });
  const commit = (actor: Actor, jobId: string) => request(server()).post(`/ingestion/jobs/${jobId}/commit-offers`).set(actor.auth).send({});
  const knownRow = (k: number, code: string, cost: number, qty: number | string, updated: string) =>
    `${code},${known[k].name} 50ml,${brand},${known[k].barcode},${cost.toFixed(2)},${qty},${updated}`;
  const settleEnrichment = async () => {
    // Each stubbed AI call ends in exactly one recorded failure; teardown waits until all of them have landed.
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline && await prisma.ingestionItem.count({
      where: { job: { supplierId: { in: suppliers } }, enrichmentError: { contains: 'AI disabled in Gate 09' } } }) < aiCalls.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    storagePort = app.get(FILE_STORAGE_PORT);
    prisma.$use(async (params, next) => {
      const started = process.hrtime.bigint();
      try { return await next(params); } finally {
        const o = (ops[stage] ??= { count: 0, ms: [] });
        o.count++;
        o.ms.push(Number(process.hrtime.bigint() - started) / 1e6);
      }
    });
    for (const method of ['enrichProduct', 'generateContent', 'recommendRoutine'] as const) {
      jest.spyOn(app.get(AiClient), method).mockImplementation(async () => { aiCalls.push(method); throw new Error('AI disabled in Gate 09 (stub)'); });
    }
    await measure('fixtures', 1000, async () => {
      for (const [i, id] of suppliers.entries()) {
        await prisma.supplier.create({ data: { id, name: `G09 Supplier ${i} ${run}`, slug: `g09-s${i}-${run}` } });
      }
      brandId = (await prisma.brand.create({ data: { name: brand, slug: `g09-brand-${run}` } })).id;
      for (let i = 0; i < Math.max(ROWS, 1); i++) {
        known.push({ productId: randomUUID(), skuId: randomUUID(), name: `G09 ${word(i)} Cream`, barcode: `29${run.replace(/\D/g, '').padEnd(4, '7').slice(0, 4)}${String(i).padStart(7, '0')}` });
      }
      await prisma.product.createMany({ data: known.map((k, i) => ({ id: k.productId, brandId, name: k.name, slug: `g09-${run}-${i}` })) });
      await prisma.sku.createMany({ data: known.map((k, i) => ({ id: k.skuId, productId: k.productId, code: `G09-${run}-${i}`,
        variantName: '50 ml', size: 50, sizeUnit: 'ml', barcode: k.barcode })) });
    });
    admin = await createActor(prisma, 'ADMIN');
    supMixed = await createActor(prisma, 'SUPPLIER', sMixed);
    supKnown = await createActor(prisma, 'SUPPLIER', sKnown);
    supC = await createActor(prisma, 'SUPPLIER', sC);
    supD = await createActor(prisma, 'SUPPLIER', sD);
  });

  afterAll(async () => {
    clearInterval(sampler);
    report.peakRssMb = Math.round(peakRss / 1048576);
    report.aiCalls = aiCalls.length;
    report.finishedAt = new Date().toISOString();
    if (process.env.G09_REPORT) writeFileSync(process.env.G09_REPORT, JSON.stringify(report, null, 1));
    console.log('[g09-report]', JSON.stringify(report));
    jest.restoreAllMocks();
    if (!prisma) return;
    await settleEnrichment();
    for (const job of await prisma.ingestionJob.findMany({ where: { supplierId: { in: suppliers } } })) {
      if (job.sourceKey) await storagePort.delete(job.sourceKey);
    }
    await prisma.supplierOffer.deleteMany({ where: { supplierId: { in: suppliers } } });
    await prisma.supplierSkuAlias.deleteMany({ where: { supplierId: { in: suppliers } } });
    await prisma.ingestionItem.deleteMany({ where: { job: { supplierId: { in: suppliers } } } });
    await prisma.ingestionJob.deleteMany({ where: { supplierId: { in: suppliers } } });
    await prisma.exportProfile.deleteMany({ where: { supplierId: { in: suppliers } } });
    await prisma.sku.deleteMany({ where: { id: { in: known.map(k => k.skuId) } } });
    await prisma.product.deleteMany({ where: { id: { in: known.map(k => k.productId) } } });
    await prisma.brand.deleteMany({ where: { id: brandId } });
    const actors = [admin, supMixed, supKnown, supC, supD].filter(Boolean).map(a => a.id);
    await prisma.session.deleteMany({ where: { customerId: { in: actors } } });
    await prisma.customer.deleteMany({ where: { id: { in: actors } } });
    await prisma.supplier.deleteMany({ where: { id: { in: suppliers } } });
    await app.close();
  });

  it(`mixed ${ROWS}-row file: every row is accounted for in exactly one outcome, only verified rows reach offers`, async () => {
    const rows: string[] = [];
    let k = 0;
    for (let i = 0; i < MIX.known; i++, k++) rows.push(knownRow(k, `K-${i}`, 100 + (i % 50), 5, '2026-10-22 09:00'));
    for (let i = 0; i < MIX.novel; i++) rows.push(`N-${i},${distinct(i, 1)} Serum 30ml,${brand},,150.00,3,2026-10-22 09:00`);
    for (let i = 0; i < MIX.ambiguous; i++) rows.push(`A-${i},${known[i].name} 50ml,${brand},,95.00,4,2026-10-22 09:00`);
    for (let i = 0; i < MIX.invalid; i++) rows.push(`I-${i},G09 Broken ${word(i)} Gel 50ml,${brand},,${i % 2 ? '0' : 'n/a'},2,2026-10-22 09:00`);
    for (let i = 0; i < MIX.duplicate; i++) rows.push(knownRow(i, `K-${i}`, 100 + (i % 50), 5, '2026-10-22 09:00'));
    for (let i = 0; i < MIX.outOfScope; i++) rows.push(`O-${i},G09 ${word(i)} Hair Dryer 1200W,${brand},,300.00,2,2026-10-22 09:00`);
    expect(rows).toHaveLength(ROWS);

    const received = await measure('mixed:upload', ROWS, () => upload(supMixed, csv(rows), 'mixed.csv'));
    expect(received.status).toBe(201);
    expect(received.body).toMatchObject({ requiresMapping: true, totalRows: ROWS });
    const mapped = await measure('mixed:map+admit+match', ROWS, () => mapJob(received.body.jobId));
    expect(mapped.status).toBe(201);
    const job = await prisma.ingestionJob.findUniqueOrThrow({ where: { id: received.body.jobId } });
    const outcomes = (job.rowOutcomes as Array<{ outcome: string }>).reduce<Record<string, number>>((acc, o) => ({ ...acc, [o.outcome]: (acc[o.outcome] ?? 0) + 1 }), {});
    report.mixedRowOutcomes = outcomes;
    report.mixedMatching = mapped.body.matching;
    expect(outcomes).toEqual({ IMPORTED: MIX.known + MIX.novel + MIX.ambiguous, INVALID: MIX.invalid, DUPLICATE: MIX.duplicate, OUT_OF_SCOPE: MIX.outOfScope });
    expect(Object.values(outcomes).reduce((a, b) => a + b, 0)).toBe(ROWS);
    expect(mapped.body.matching).toEqual({ exactMatches: MIX.known, needsReview: MIX.ambiguous, newCandidates: MIX.novel,
      linkedToExistingCandidate: 0, rejected: 0, aiEnrichmentRequests: MIX.novel });

    const committed = await measure('mixed:commit', MIX.known, () => commit(supMixed, job.id));
    report.mixedCommit = { status: committed.status, ...(committed.status === 201 ? {
      committed: committed.body.committedCount, held: committed.body.heldForReviewCount, skipped: committed.body.skippedCount,
      errors: committed.body.errorCount, unchanged: committed.body.unchangedCount } : { error: committed.body }) };
    expect(committed.status).toBe(201);
    expect(committed.body.committedCount).toBe(MIX.known);
    expect(await prisma.supplierOffer.count({ where: { supplierId: sMixed } })).toBe(MIX.known);
    expect(await prisma.supplierOffer.count({ where: { supplierId: sMixed, lastConfirmedAt: { not: null } } })).toBe(0);
  });

  it(`known-only ${ROWS} rows: first file, changed re-upload on the approved layout with zero AI calls, identical replay`, async () => {
    const aiBefore = aiCalls.length;
    const first = known.map((_, i) => knownRow(i, `B-${i}`, 200, 10, '2026-10-21 09:00'));
    const up1 = await measure('known1:upload', ROWS, () => upload(supKnown, csv(first), 'known.csv'));
    const map1 = await measure('known1:map+admit+match', ROWS, () => mapJob(up1.body.jobId));
    expect(map1.body.matching).toMatchObject({ exactMatches: ROWS, aiEnrichmentRequests: 0 });
    const c1 = await measure('known1:commit', ROWS, () => commit(supKnown, up1.body.jobId));
    report.known1Commit = { status: c1.status, committed: c1.body.committedCount, error: c1.status === 201 ? undefined : c1.body };
    expect(c1.status).toBe(201);
    expect(c1.body.committedCount).toBe(ROWS);

    const jumps = share(20), zeroed = share(20), repriced = share(500);
    const second = known.map((_, i) => i < repriced ? knownRow(i, `B-${i}`, 220, 10, '2026-10-22 09:00')
      : i < repriced + jumps ? knownRow(i, `B-${i}`, 300, 10, '2026-10-22 09:00')
        : i < repriced + jumps + zeroed ? knownRow(i, `B-${i}`, 200, 0, '2026-10-22 09:00')
          : knownRow(i, `B-${i}`, 200, 10, '2026-10-22 09:00'));
    const bytes = csv(second);
    const up2 = await measure('known2:upload+admit+match (approved layout)', ROWS, () => upload(supKnown, bytes, 'known.csv'));
    expect(up2.status).toBe(201);
    expect(up2.body).toMatchObject({ requiresMapping: false, importedItemsCount: ROWS });
    expect(up2.body.matching).toMatchObject({ exactMatches: ROWS, aiEnrichmentRequests: 0 });

    // Concurrency: the same job committed twice at once applies exactly once.
    const [a, b] = await measure('known2:commit (2 concurrent)', ROWS, () => Promise.all([commit(supKnown, up2.body.jobId), commit(supKnown, up2.body.jobId)]));
    report.known2Commit = [a, b].map(r => ({ status: r.status, result: r.status === 201 ? r.body.status : r.body,
      committed: r.body.committedCount, held: r.body.heldForReviewCount, unchanged: r.body.unchangedCount }));
    expect([a.status, b.status]).toEqual([201, 201]);
    // Exactly once: one commit applies the changes, the other (serialized behind the supplier lock) applies nothing.
    expect([a.body.committedCount, b.body.committedCount].sort((x: number, y: number) => x - y)).toEqual([0, repriced + zeroed]);
    expect(Math.max(a.body.heldForReviewCount, b.body.heldForReviewCount)).toBe(jumps);
    const offers = await prisma.supplierOffer.findMany({ where: { supplierId: sKnown } });
    expect(offers).toHaveLength(ROWS);
    const bySku = new Map(offers.map(o => [o.skuId, o]));
    expect(bySku.get(known[0].skuId)!.costPrice.toNumber()).toBe(220);
    expect(bySku.get(known[repriced].skuId)!.costPrice.toNumber()).toBe(200); // held jump keeps the accepted cost
    expect(bySku.get(known[repriced + jumps].skuId)!.isAvailable).toBe(false);
    expect(offers.filter(o => o.lastConfirmedAt !== null)).toHaveLength(0);

    // Identical bytes again: the receipt resolves to the same job; nothing is re-applied.
    const replay = await measure('known2:replay identical bytes', ROWS, () => upload(supKnown, bytes, 'known-copy.csv'));
    expect(replay.body).toMatchObject({ jobId: up2.body.jobId, reused: true });
    const again = await commit(supKnown, up2.body.jobId);
    expect(again.status).toBe(201);
    expect(again.body.committedCount).toBe(0);
    expect(await prisma.ingestionJob.count({ where: { supplierId: sKnown } })).toBe(2);
    expect(aiCalls.length - aiBefore).toBe(0);
  });

  it('concurrency: the same file uploaded 3× at once is one receipt; two suppliers racing on one new product create one candidate', async () => {
    const third = known.slice(0, share(100)).map((_, i) => knownRow(i, `B-${i}`, 221, 9, '2026-10-23 09:00'));
    const triple = await measure('race:same file ×3', share(100) * 3, () => Promise.all([0, 1, 2].map(() => upload(supKnown, csv(third), 'known.csv'))));
    expect(triple.map(r => r.status)).toEqual([201, 201, 201]);
    expect(new Set(triple.map(r => r.body.jobId)).size).toBe(1);
    expect(await prisma.ingestionJob.count({ where: { supplierId: sKnown } })).toBe(3);

    // Approve the same layout for C and D first (one mapping each), then race the same new product.
    for (const actor of [supC, supD]) {
      const seed = await upload(actor, csv([`SEED-${run},G09 Seed ${word(1)} Toner 100ml,${brand},,50.00,1,2026-10-22 09:00`]));
      await mapJob(seed.body.jobId);
    }
    const product = `${distinct(5000, 3)} Serum 30ml`;
    const race = await measure('race:two suppliers one new product', 2, () => Promise.all([
      upload(supC, csv([`C-RACE,${product},${brand},,120.00,5,2026-10-22 10:00`]), 'c.csv'),
      upload(supD, csv([`D-RACE,${product},${brand},,118.00,6,2026-10-22 10:00`]), 'd.csv'),
    ]));
    const matching = race.map(r => r.body.matching);
    report.raceMatching = matching;
    expect(matching.reduce((n, m) => n + m.newCandidates, 0)).toBe(1);
    expect(matching.reduce((n, m) => n + m.linkedToExistingCandidate, 0)).toBe(1);
    const items = await prisma.ingestionItem.findMany({ where: { job: { supplierId: { in: [sC, sD] } }, supplierSkuCode: { in: ['C-RACE', 'D-RACE'] } } });
    const primaries = items.filter(i => !(i.enrichment as { identity?: { existingCandidateId?: string } }).identity?.existingCandidateId);
    expect(primaries).toHaveLength(1);
    expect(await prisma.supplierOffer.count({ where: { supplierId: { in: [sC, sD] } } })).toBe(0);
  });
});
