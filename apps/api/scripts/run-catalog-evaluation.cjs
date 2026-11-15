// Local disposable _test database only. Reads owner contracts; never prices or publishes.
const fs = require('node:fs'), path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
require('./local-test-database.cjs').assertLocalTestDatabase(process.env);
process.env.TS_NODE_PROJECT = path.join(root, 'apps/api/tsconfig.json');
Object.assign(process.env, { DOMAIN_EVENTS_POLL_MS: '0', PROCUREMENT_BATCH_INTERVAL_MINUTES: '0', DECISION_SWEEP_MS: '0', RFQ_TICK_MS: '0', RESEARCH_HOST_INTERVAL_MS: '1500' });
// Never inherit paid providers, shared storage, or an intake worker in this lane.
Object.assign(process.env, { NODE_ENV: 'test', TEST_BYPASS_AUTH: 'false', EXA_API_KEY: '', FIRECRAWL_API_KEY: '', GROK_API_KEY: '', OPENROUTER_API_KEY: '', CLOUDINARY_API_KEY: '', CLOUDINARY_API_SECRET: '', CLOUDINARY_CLOUD_NAME: '', INTAKE_WORKER: 'off', FILE_STORAGE_PROVIDER: 'local', MEDIA_STORAGE_PROVIDER: 'local' });
const datasetDirectory = path.resolve(process.argv[2] ?? path.join(__dirname, 'data/catalog-evaluation-20261115'));
const metadataFile = path.resolve(process.argv[3] ?? path.join(datasetDirectory, 'policy-snapshot.json'));
const outputDirectory = path.resolve(process.argv[4] ?? path.join(root, 'output/catalog-evaluation-runtime'));
fs.mkdirSync(outputDirectory, { recursive: true });
process.env.STORAGE_LOCAL_PATH = path.join(outputDirectory, 'storage');
require('ts-node/register/transpile-only');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../src/app.module');
const { PrismaService } = require('../src/platform/database/prisma.service');
const { CatalogSnapshotService, readProductType, productTypeRule } = require('../src/modules/catalog/public');
const { ScopeGate, BrandDetector } = require('../src/modules/intake/public');
const { AdminIntakeService } = require('../src/application/composition/services/intake/admin-intake.service');
const { IntakeRunnerService } = require('../src/application/composition/services/intake/intake-runner.service');
const { CatalogEnrichmentService } = require('../src/application/composition/services/intake/catalog-enrichment.service');
const input = JSON.parse(fs.readFileSync(path.join(datasetDirectory, 'dataset.json')));
const metadata = JSON.parse(fs.readFileSync(metadataFile));
const reportFile = path.join(outputDirectory, 'runtime.json');
for (const key of ['MEDIA_TRUSTED_SOURCE_HOSTS', 'RESEARCH_ALLOWED_HOSTS']) if (metadata.publicResearchConfig?.[key]) process.env[key] = metadata.publicResearchConfig[key];
if (metadata.sourcingMode) process.env.SOURCING_MODE = metadata.sourcingMode;
const { compareEvaluationIdentity } = require('./lib/catalog-evaluation-oracle');
const sourceFiles = ['src/application/composition/services/intake/admin-intake.service.ts', 'src/application/composition/services/intake/catalog-enrichment.service.ts',
  'src/modules/catalog/research/product-fact-extractor.ts', 'src/modules/catalog/research/canonical-research.service.ts', 'src/modules/catalog/research/brand-aliases.ts',
  'src/modules/intake/lib/intake-text.ts', 'src/modules/intake/lib/matching.ts', 'scripts/lib/catalog-evaluation-oracle.ts'];
const codeSnapshot = () => ({ head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceDiff: execFileSync('git', ['diff', 'HEAD', '--', 'apps/api/src', 'apps/api/scripts'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim(),
  files: Object.fromEntries(sourceFiles.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', file))).digest('hex')])) });
const codeBefore = codeSnapshot();
if (codeBefore.sourceDiff) throw new Error('Commit evaluation code before measuring a fixed-code run');
(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    require('./local-test-database.cjs').assertLocalTestDatabase(process.env);
    const db = app.get(PrismaService);
    const actorId = '1456b753-88ef-4e4e-b686-8c8b74efc8dc';
    if (!await db.customer.findUnique({ where: { id: actorId } })) {
      if (await db.product.count() || await db.customer.count() || await db.brand.count()) throw new Error('Initial evaluation seed requires an empty isolated database');
      await db.customer.create({ data: { id: actorId, name: 'Isolated evaluation operator', email: 'astra-evaluation@example.invalid', roles: ['ADMIN'] } });
      await db.brand.createMany({ data: metadata.brands.map(({ id, name, slug, websiteUrl, profile, isActive }) => ({ id, name, slug, websiteUrl, ...(profile && { profile }), isActive })) });
      for (const [index, draft] of (metadata.approvedBrandDrafts ?? []).entries()) {
        const brand = metadata.brands.find(b => b.id === draft.canonicalBrandId);
        if (!brand) throw new Error('Approved draft references an absent public brand');
        await db.brandDraft.create({ data: { name: brand.name, canonicalName: brand.name, slug: `${brand.slug}-evaluation-${index}`,
          aliases: draft.aliases, status: 'APPROVED', canonicalBrandId: brand.id } });
      }
      for (const c of metadata.categories) await db.category.create({ data: { ...c, parentId: null } });
      for (const c of metadata.categories.filter(c => c.parentId)) await db.category.update({ where: { id: c.id }, data: { parentId: c.parentId } });
      await db.ingestionEligibilityPolicy.create({ data: { version: metadata.policy.version, baseVersion: metadata.policy.version - 1, status: 'APPROVED',
        document: metadata.policy.document, impact: {}, actorId, reason: 'Isolated evaluation copy of read-only approved policy snapshot', approvedAt: metadata.policy.approvedAt ? new Date(metadata.policy.approvedAt) : null } });
    }
    const snapshot = await app.get(CatalogSnapshotService).identitySnapshot();
    const scope = new ScopeGate(snapshot), detector = new BrandDetector(snapshot.brands);
    const scopeReport = input.rows.map(row => {
      const type = productTypeRule(readProductType(row.expected.name).types[0]?.key);
      const category = type?.leaves.map(leaf => snapshot.categories.find(c => c.name.toLowerCase() === leaf && c.isLeaf && c.isActive)).find(Boolean);
      return { id: row.id, categoryId: category?.id ?? null, ...scope.decide({ name: row.inputName, catalogBrands: detector.detect(row.inputName), categoryId: category?.id, hardIdentifier: false }) };
    });
    fs.writeFileSync(path.join(outputDirectory, 'scope.json'), JSON.stringify({ policyVersion: snapshot.policyVersion, rows: scopeReport }, null, 2));
    if (scopeReport.some(r => r.decision !== 'CONTINUE')) throw new Error('Evaluation dataset contains a policy exclusion; inspect scope.json');
    const buffer = fs.readFileSync(path.join(datasetDirectory, 'input.csv'));
    const job = await app.get(AdminIntakeService).submit({ actorId, file: { buffer, originalname: 'evaluation-100.csv', mimetype: 'text/csv', size: buffer.length }, researchPrices: false });
    const fingerprint = require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(datasetDirectory, 'input.csv'))).digest('hex');
    const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile)) : { startedAt: new Date().toISOString(), code: codeBefore, inputSha256: fingerprint, jobId: job.jobId, database: new URL(process.env.DATABASE_URL).pathname,
      lane: 'NAMES_AND_MANUFACTURER_URLS_REAL_OWNER_PIPELINE_NO_PAID_DISCOVERY_NO_PRICE_RESEARCH_NO_PUBLICATION', rows: [], observations: [] };
    if (report.jobId !== job.jobId || report.inputSha256 !== fingerprint || report.database !== new URL(process.env.DATABASE_URL).pathname) throw new Error('Refusing to combine different evaluation runs');
    if (JSON.stringify(report.code) !== JSON.stringify(codeBefore)) throw new Error('Refusing to resume an evaluation with different source code');
    const runner = app.get(IntakeRunnerService), enrichment = app.get(CatalogEnrichmentService);
    let worked;
    do {
      worked = await runner.drain(job.jobId, 1);
      const settled = await db.intakeRow.findMany({ where: { jobId: job.jobId, OR: [{ outcome: { not: 'PENDING' } }, { attempts: { gt: 0 }, leaseUntil: null }] }, orderBy: { rowNumber: 'asc' } });
      for (const row of settled) {
        if (report.rows.some(r => r.rowId === row.id && r.outcome === row.outcome && r.attempts === row.attempts)) continue;
        const oracle = input.rows[row.rowNumber - 2];
        const sku = row.matchedSkuId ? await db.sku.findUnique({ where: { id: row.matchedSkuId }, include: { product: { include: { brand: true } } } }) : null;
        const result = { rowId: row.id, rowNumber: row.rowNumber, input: row.rawName, expectedId: oracle?.id, stage: row.stage, attempts: row.attempts, processingMs: row.processingMs,
          outcome: row.outcome, reasonCode: row.reasonCode, skuId: row.matchedSkuId, evidence: row.evidence, cost: row.cost,
          identityMatchesOracle: sku && oracle ? compareEvaluationIdentity(oracle.expected, { name: sku.product.name, brand: sku.product.brand.name, size: sku.size?.toNumber() ?? null, sizeUnit: sku.sizeUnit, packCount: sku.packCount }).correct : null,
          actual: sku ? { name: sku.product.name, brand: sku.product.brand.name, size: sku.size?.toNumber(), sizeUnit: sku.sizeUnit, packCount: sku.packCount, barcode: sku.barcode, identityStatus: sku.identityStatus } : null,
          readiness: sku ? await enrichment.readiness(sku.id) : null };
        report.observations.push({ rowId: row.id, attempts: row.attempts, outcome: row.outcome, cost: row.cost, observedAt: new Date().toISOString() });
        report.rows = report.rows.filter(r => r.rowId !== row.id); report.rows.push(result);
        console.log(JSON.stringify({ row: row.rowNumber, outcome: row.outcome, reason: row.reasonCode, identityMatchesOracle: result.identityMatchesOracle }));
      }
      report.updatedAt = new Date().toISOString();
      report.publishedProducts = await db.product.count({ where: { isPublished: true } });
      report.sellingPrices = await db.sellingPrice.count();
      if (report.publishedProducts || report.sellingPrices) throw new Error('Evaluation unexpectedly published or priced products');
      fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    } while (worked);
    report.job = await db.intakeJob.findUnique({ where: { id: job.jobId } });
    report.allRows = await db.intakeRow.findMany({ where: { jobId: job.jobId }, select: { id: true, rowNumber: true, stage: true, outcome: true, reasonCode: true, attempts: true, nextAttemptAt: true } });
    report.complete = report.job.status === 'COMPLETED' && report.allRows.every(row => row.outcome !== 'PENDING');
    if (report.complete) report.finishedAt = new Date().toISOString();
    else { delete report.finishedAt; report.incompleteAt = new Date().toISOString(); }
    report.codeAfter = codeSnapshot();
    report.codeChangedDuringRun = JSON.stringify(codeBefore) !== JSON.stringify(report.codeAfter);
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    if (report.codeChangedDuringRun) throw new Error('Source changed during evaluation; evidence preserved but this is not a fixed-code run');
    if (!report.complete) {
      console.log(JSON.stringify({ stage: 'INCOMPLETE_RETRY_SCHEDULED', pending: report.allRows.filter(row => row.outcome === 'PENDING').length }));
      process.exitCode = 2;
      return;
    }
    console.log(JSON.stringify({ stage: 'drained', rows: report.rows.length, published: report.publishedProducts, prices: report.sellingPrices }));
  } finally { await app.close(); }
})().catch(error => { console.error(String(error.message).slice(-1200)); process.exitCode = 1; });
