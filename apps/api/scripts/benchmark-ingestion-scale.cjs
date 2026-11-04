#!/usr/bin/env node
// GLO-285 upload-to-matching scale benchmark on real services and an isolated local *_test PostgreSQL. Synthetic rows: load evidence, not accuracy or launch inventory.
//
//   DATABASE_URL=... DIRECT_URL=... node scripts/benchmark-ingestion-scale.cjs --profile mixed95 --rows 50000 --format csv --out <dir>
//
// Profiles: mixed90, mixed95, mixed99, all-excluded, all-eligible, ambiguous-heavy, known-fast-lane. One process per run, so peak RSS belongs to that run.
const { assertLocalTestDatabase } = require('./local-test-database.cjs');
assertLocalTestDatabase(process.env);
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const apiRoot = path.join(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(apiRoot, 'tsconfig.json') });
require('reflect-metadata');
const XLSX = require('xlsx');
const { NestFactory } = require('@nestjs/core');

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const profile = arg('profile', 'mixed95');
const rowCount = Number(arg('rows', 50000));
const format = arg('format', 'csv');
const outDir = arg('out');
if (!outDir) throw new Error('--out is required');
fs.mkdirSync(outDir, { recursive: true });

const SHARES = {
  mixed90: { eligible: 0.08, excluded: 0.90, unresolved: 0.02 },
  mixed95: { eligible: 0.04, excluded: 0.95, unresolved: 0.01 },
  mixed99: { eligible: 0.008, excluded: 0.99, unresolved: 0.002 },
  'all-excluded': { eligible: 0, excluded: 1, unresolved: 0 },
  'all-eligible': { eligible: 1, excluded: 0, unresolved: 0 },
  'ambiguous-heavy': { eligible: 0.05, excluded: 0.05, unresolved: 0.90 },
  'known-fast-lane': { eligible: 1, excluded: 0, unresolved: 0 },
};
const shares = SHARES[profile];
if (!shares) throw new Error(`Unknown profile ${profile}`);

// Deterministic so before/after compare identical bytes.
let seed = 285;
const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = list => list[Math.floor(random() * list.length)];
const ALLOWED = ['ScaleBrand Alpha', 'سكيل بيتا'];
const DENIED = ['ScaleDenied One', 'ScaleDenied Two', 'سكيل ممنوع', 'ScaleDenied Three'];
const UNKNOWN = ['Unknown Trading', 'ماركة غير معروفة', 'Skale Alpah', ''];
const CATEGORY_OK = ['ScaleCleansers', 'غسول سكيل'];
const CATEGORY_OTHER = ['ScaleMakeup', 'ScaleVitamins'];
const FORMS = ['Gentle Cleanser', 'Foaming Wash', 'Hydra Gel', 'غسول لطيف', 'كريم مرطب', 'Daily Moisturizer', 'Repair Serum'];
const SIZES = ['100ml', '200 ml', '236ML', '50 جم', '400 مل', '30 ml'];

const HEADER = ['Supplier SKU', 'Product Name', 'Brand', 'Category', 'Barcode', 'Purchase Price', 'Quantity', 'Currency'];
function buildRows() {
  const rows = [];
  for (let i = 0; i < rowCount; i++) {
    const roll = random();
    const kind = roll < shares.excluded ? 'excluded' : roll < shares.excluded + shares.eligible ? 'eligible' : 'unresolved';
    const n = String(i).padStart(6, '0');
    const name = `${pick(FORMS)} ${n} ${pick(SIZES)}`;
    if (kind === 'eligible') rows.push([`E-${n}`, name, pick(ALLOWED), pick(CATEGORY_OK), '', 50 + (i % 400), i % 7 === 0 ? '' : i % 90, 'EGP']);
    else if (kind === 'excluded') rows.push([`X-${n}`, name, pick(DENIED), pick(CATEGORY_OTHER), '', 40 + (i % 300), i % 90, 'EGP']);
    else rows.push([`U-${n}`, name, pick(UNKNOWN), i % 2 ? 'Unmapped Category' : pick(CATEGORY_OK), '', 45 + (i % 300), i % 90, 'EGP']);
  }
  return rows;
}
function toFile(rows) {
  if (format === 'xlsx') {
    const sheet = XLSX.utils.aoa_to_sheet([HEADER, ...rows]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'SupplierData');
    return { buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', originalname: `scale-${profile}.xlsx` };
  }
  const cell = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const text = [HEADER, ...rows].map(r => r.map(cell).join(',')).join('\n');
  return { buffer: Buffer.from(text, 'utf8'), mimetype: 'text/csv', originalname: `scale-${profile}.csv` };
}
const MAPPING = { supplierSku: 'Supplier SKU', name: 'Product Name', brand: 'Brand', category: 'Category', barcode: 'Barcode', price: 'Purchase Price', quantity: 'Quantity', currencyColumn: 'Currency',
  semantics: { documentKind: 'PRICE_LIST', priceBasis: 'UNIT_PURCHASE_COST', quantityBasis: 'ON_HAND' } };

async function ensureFixtures(app, prisma) {
  const { IngestionEligibilityService } = require(path.join(apiRoot, 'src/modules/ingestion/services/ingestion-eligibility.service.ts'));
  const service = app.get(IngestionEligibilityService);
  const marker = randomUUID().slice(0, 8);
  const brandRow = async name => prisma.brand.upsert({ where: { name }, update: {}, create: { name, slug: `scale-${createHash('md5').update(name).digest('hex').slice(0, 10)}` } });
  const allow = await brandRow('ScaleBrand Alpha');
  const denied = await Promise.all(DENIED.map(brandRow));
  const parent = await prisma.category.findFirst({ where: { name: 'ScaleRoot' } }) ?? await prisma.category.create({ data: { name: 'ScaleRoot', slug: 'scale-root' } });
  const leaf = await prisma.category.findFirst({ where: { name: 'ScaleCleansers' } }) ?? await prisma.category.create({ data: { name: 'ScaleCleansers', slug: 'scale-cleansers', parentId: parent.id } });
  const other = [];
  for (const name of CATEGORY_OTHER) other.push(await prisma.category.findFirst({ where: { name } }) ?? await prisma.category.create({ data: { name, slug: name.toLowerCase(), parentId: parent.id } }));
  const admin = await prisma.customer.create({ data: { name: 'Scale Admin', email: `scale-${marker}@fixtures.test`, roles: ['ADMIN'] } });
  const current = await service.current();
  const supplier = await prisma.supplier.create({ data: { name: `Scale ${marker}`, slug: `scale-${marker}` } });
  const preview = await service.preview({ expectedVersion: current?.version ?? 0, reason: 'GLO-285 scale benchmark fixture',
    brands: [{ id: allow.id, effect: 'ALLOW', aliases: ['سكيل بيتا'] }, ...denied.map(b => ({ id: b.id, effect: 'DENY', aliases: [] }))],
    categories: [{ id: leaf.id, effect: 'ALLOW', aliases: ['غسول سكيل'] }, ...other.map(c => ({ id: c.id, effect: 'DENY', aliases: [] }))],
    mappings: [] }, admin.id);
  await service.approve(preview.id, admin.id);
  return { supplier, admin, allow, leaf };
}

async function seedKnownCatalog(prisma, brandId, categoryId, rows, supplierId, normalizer) {
  // Fast-lane run: every row resolves through a verified supplier alias of an existing SKU.
  const size = rows.length;
  for (let offset = 0; offset < size; offset += 2000) {
    const chunk = rows.slice(offset, offset + 2000);
    const products = chunk.map(row => ({ id: randomUUID(), name: row[1], slug: `scale-known-${row[0]}-${offset}`, brandId, categoryId, isPublished: false }));
    await prisma.product.createMany({ data: products });
    const skus = chunk.map((row, i) => {
      const { size, unit } = normalizer.extractSizeAndPack(row[1]);
      return { id: randomUUID(), productId: products[i].id, code: `SK-${row[0]}-${supplierId.slice(0, 6)}`, variantName: 'Default', size, sizeUnit: unit, isActive: true };
    });
    await prisma.sku.createMany({ data: skus });
    await prisma.supplierSkuAlias.createMany({ data: chunk.map((row, i) => ({ supplierId, supplierSkuCode: row[0], skuId: skus[i].id })) });
  }
}

(async () => {
  const { AppModule } = require(path.join(apiRoot, 'src/app.module.ts'));
  const { PrismaService } = require(path.join(apiRoot, 'src/platform/database/prisma.service.ts'));
  const { IngestionService } = require(path.join(apiRoot, 'src/modules/ingestion/services/ingestion.service.ts'));
  const { ProductIdentityService } = require(path.join(apiRoot, 'src/modules/ingestion/services/product-identity.service.ts'));
  const { RowNormalizationService } = require(path.join(apiRoot, 'src/modules/ingestion/services/row-normalization.service.ts'));
  const { ProductResearchService } = require(path.join(apiRoot, 'src/modules/ingestion/services/product-research.service.ts'));
  const { ExportProfileService } = require(path.join(apiRoot, 'src/modules/ingestion/services/export-profile.service.ts'));
  const { FormatFingerprintService } = require(path.join(apiRoot, 'src/modules/ingestion/services/format-fingerprint.service.ts'));
  const { SpreadsheetParserService } = require(path.join(apiRoot, 'src/modules/ingestion/services/spreadsheet-parser.service.ts'));
  const { AiClient } = require(path.join(apiRoot, 'src/platform/ai'));

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);
  const fixtures = await ensureFixtures(app, prisma);
  const rows = buildRows();
  const file = toFile(rows);
  const kindCounts = { E: 0, X: 0, U: 0 };
  for (const row of rows) kindCounts[row[0][0]]++;
  if (profile === 'known-fast-lane') await seedKnownCatalog(prisma, fixtures.allow.id, fixtures.leaf.id, rows, fixtures.supplier.id, app.get(RowNormalizationService));

  const parser = app.get(SpreadsheetParserService);
  const small = parser.parseSpreadsheet(headerOnlyFile(), file.originalname);
  const fingerprint = app.get(FormatFingerprintService).computeFingerprint(small.headers, small.sheets);
  await app.get(ExportProfileService).saveProfile({ supplierId: fixtures.supplier.id, formatFingerprint: fingerprint, sampleHeaders: small.headers,
    mapping: MAPPING, name: 'scale', isApproved: true, approvedBy: fixtures.admin.id });

  const counters = { sql: 0, sqlByOperation: {}, classify: 0, prepareBatch: 0, normalize: 0, fingerprint: 0, ai: 0, aiInFlight: 0, aiMaxInFlight: 0, research: 0 };
  prisma.$use(async (params, next) => {
    counters.sql++;
    const key = `${params.model ?? 'raw'}.${params.action}`;
    counters.sqlByOperation[key] = (counters.sqlByOperation[key] ?? 0) + 1;
    return next(params);
  });
  const wrap = (target, method, counter) => {
    const original = target[method].bind(target);
    target[method] = (...args) => { counters[counter]++; return original(...args); };
  };
  const identity = app.get(ProductIdentityService);
  wrap(identity, 'classifyCandidateMatch', 'classify');
  wrap(identity, 'prepareBatch', 'prepareBatch');
  wrap(identity, 'rowFingerprint', 'fingerprint');
  wrap(app.get(RowNormalizationService), 'normalizeRow', 'normalize');
  wrap(app.get(ProductResearchService), 'researchProductCandidate', 'research');
  const ai = app.get(AiClient);
  const enrich = ai.enrichProduct.bind(ai);
  ai.enrichProduct = async (...args) => {
    counters.ai++; counters.aiInFlight++;
    counters.aiMaxInFlight = Math.max(counters.aiMaxInFlight, counters.aiInFlight);
    try { return await enrich(...args); } finally { counters.aiInFlight--; }
  };

  const before = {
    products: await prisma.product.count(), skus: await prisma.sku.count(), offers: await prisma.supplierOffer.count(), media: await prisma.productMedia.count(),
  };
  let peakRss = 0; let peakHeap = 0;
  const sample = () => { const m = process.memoryUsage(); peakRss = Math.max(peakRss, m.rss); peakHeap = Math.max(peakHeap, m.heapUsed); };
  const sampler = setInterval(sample, 50);
  const baselineRss = process.memoryUsage().rss;
  const started = performance.now();
  let outcome = {};
  const service = app.get(IngestionService);
  let result;
  try {
    result = await service.uploadSupplierSpreadsheet(fixtures.supplier.id, { ...file, fieldname: 'file', encoding: '7bit', size: file.buffer.length }, 'PARTIAL_UPDATE', { uploadedBy: fixtures.admin.id });
    if (service.whenBackgroundWorkSettles) await service.whenBackgroundWorkSettles();
    outcome = { ok: true, jobId: result.jobId, status: result.status, requiresMapping: result.requiresMapping, totalRows: result.totalRows, importedItemsCount: result.importedItemsCount, matching: result.matching };
  } catch (error) {
    outcome = { ok: false, error: `${error.name}: ${error.message}`.slice(0, 500) };
  }
  const elapsedMs = performance.now() - started;
  // Fast-lane runs also measure the offer commit, which is what a known-SKU file exists to do.
  let commit = null;
  if (profile === 'known-fast-lane' && result?.jobId) {
    const { OfferBatchCommitService } = require(path.join(apiRoot, 'src/modules/ingestion/services/offer-batch-commit.service.ts'));
    const sqlBefore = counters.sql;
    const commitStarted = performance.now();
    try {
      const committed = await app.get(OfferBatchCommitService).commitJobOffers(result.jobId);
      commit = { ok: true, elapsedMs: Math.round(performance.now() - commitStarted), committed: committed.committedCount, held: committed.heldForReviewCount, skipped: committed.skippedCount, sql: counters.sql - sqlBefore };
    } catch (error) {
      commit = { ok: false, elapsedMs: Math.round(performance.now() - commitStarted), error: `${error.name}: ${error.message}`.slice(0, 300), sql: counters.sql - sqlBefore };
    }
  }
  // Fire-and-forget enrichment settles after the request; wait so counters include it.
  for (let i = 0; i < 600 && counters.aiInFlight > 0; i++) await new Promise(r => setTimeout(r, 100));
  clearInterval(sampler);
  sample();

  const after = {
    products: await prisma.product.count(), skus: await prisma.sku.count(), offers: await prisma.supplierOffer.count(), media: await prisma.productMedia.count(),
  };
  let stored = null;
  if (result?.jobId) {
    const [{ bytes }] = await prisma.$queryRawUnsafe(`SELECT coalesce(pg_column_size(row_outcomes), 0)::int AS bytes FROM ingestion.ingestion_jobs WHERE id = '${result.jobId}'`);
    const groups = await prisma.$queryRawUnsafe(`SELECT status::text, count(*)::int AS n FROM ingestion.ingestion_items WHERE job_id = '${result.jobId}' GROUP BY 1 ORDER BY 1`);
    const job = await prisma.ingestionJob.findUnique({ where: { id: result.jobId }, select: { status: true, rowOutcomes: true, sourceMetadata: true } });
    const list = Array.isArray(job.rowOutcomes) ? job.rowOutcomes : [];
    const accounted = {};
    for (const entry of list) accounted[entry.outcome] = (accounted[entry.outcome] ?? 0) + (Number.isInteger(entry.count) ? entry.count : 1);
    stored = { rowOutcomesCompressedBytes: bytes, rowOutcomeEntries: list.length, accounted, itemsByStatus: groups, jobStatus: job.status };
  }
  const summary = {
    profile, format, rows: rowCount, fileBytes: file.buffer.length, fixtureKinds: { eligible: kindCounts.E, excluded: kindCounts.X, unresolved: kindCounts.U },
    outcome, elapsedMs: Math.round(elapsedMs), rowsPerSecond: Math.round(rowCount / (elapsedMs / 1000)),
    peakRssMb: Math.round(peakRss / 1048576), baselineRssMb: Math.round(baselineRss / 1048576), peakHeapMb: Math.round(peakHeap / 1048576),
    counters, commit, writes: { products: after.products - before.products, skus: after.skus - before.skus, offers: after.offers - before.offers, media: after.media - before.media },
    stored, node: process.version, at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(outDir, `${profile}-${format}-${rowCount}.json`), JSON.stringify(summary, null, 2));
  const { sqlByOperation, ...countersBrief } = counters;
  console.log(JSON.stringify({ ...summary, counters: countersBrief }));
  await app.close();
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });

// The mapping fingerprint only needs the header; approving it must not depend on the file under test being parseable.
function headerOnlyFile() {
  if (format === 'xlsx') {
    const sheet = XLSX.utils.aoa_to_sheet([HEADER, HEADER.map(() => 'x')]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'SupplierData');
    return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  }
  return Buffer.from(`${HEADER.join(',')}\n${HEADER.map(() => 'x').join(',')}\n`, 'utf8');
}
