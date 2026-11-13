// Operator validation: real providers, authenticated HTTP, local disposable *_test DB only.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
require('./local-test-database.cjs').assertLocalTestDatabase(process.env);
Object.assign(process.env, { NODE_ENV: 'test', INTAKE_WORKER: 'off', DOMAIN_EVENTS_POLL_MS: '0', PROCUREMENT_BATCH_INTERVAL_MINUTES: '0', DECISION_SWEEP_MS: '0', RFQ_TICK_MS: '0' });
require('ts-node/register/transpile-only');
const { NestFactory } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const request = require('supertest');
const sharp = require('sharp');
const { createHash, randomUUID } = require('node:crypto');
const { AppModule } = require('../src/app.module');
const { PrismaService } = require('../src/platform/database/prisma.service');
const { IntakeRunnerService } = require('../src/application/composition/services/intake/intake-runner.service');
const { ProductMediaService } = require('../src/modules/catalog/services/product-media.service');
const { createActor } = require('../test/fixtures/actors');
const names = [
  'CeraVe Hydrating Facial Cleanser 236ml', 'CeraVe Foaming Facial Cleanser 236ml', 'CeraVe Moisturizing Cream 454g',
  'CeraVe SA Smoothing Cleanser 236ml', 'The Ordinary Niacinamide 10% + Zinc 1% 30ml', 'The Ordinary Hyaluronic Acid 2% + B5 30ml',
  'La Roche-Posay Effaclar Purifying Foaming Gel 200ml', 'La Roche-Posay Cicaplast Baume B5+ 40ml', 'Cetaphil Gentle Skin Cleanser 236ml', 'Bioderma Sensibio H2O 250ml',
];
async function main() {
  const count = Number(process.argv[2]);
  assert([3, 10].includes(count), 'Choose 3 or 10 real products');
  const sources = process.argv.includes('--sources');
  const out = path.resolve(__dirname, '../../../output/catalog-gate-real-2026-11-13', `${count}${sources ? '-sources' : '-names'}`);
  fs.mkdirSync(out, { recursive: true });
  const prior = process.argv.includes('--resume') ? JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8')) : null;
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  await app.init();
  const db = app.get(PrismaService);
  const media = app.get(ProductMediaService);
  const actor = prior ? await (async () => {
    const job = await db.intakeJob.findUniqueOrThrow({ where: { id: prior.jobId } });
    const session = await db.session.create({ data: { customerId: job.submittedBy, token: randomUUID(), expiresAt: new Date(Date.now() + 3600000) } });
    return { id: job.submittedBy, auth: { Authorization: `Bearer ${session.token}` } };
  })() : await createActor(db, 'ADMIN');
  const http = request(app.getHttpServer());
  const result = { requested: count, startedAt: new Date().toISOString(), products: [] };
  if (prior) result.priorRuns = [...(prior.priorRuns ?? []), { durationMs: prior.durationMs, finishedAt: prior.finishedAt, outcomes: prior.products.map(p => ({ requested: p.requested, outcome: p.outcome, reason: p.reason })) }];
  const counts = async () => ({ products: await db.product.count(), skus: await db.sku.count(), facts: await db.productFactProposal.count(), assets: await db.mediaAsset.count() });
  const save = () => fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2));
  try {
    result.before = await counts();
    const body = { names: names.slice(0, count), researchPrices: false };
    const start = Date.now();
    const urls = [
      'https://africa.cerave.com/en/our-products/cleansers/hydrating-cleanser',
      'https://africa.cerave.com/en/our-products/cleansers/foaming-cleanser',
      'https://africa.cerave.com/en/our-products/moisturizers/moisturising-cream',
      'https://africa.cerave.com/en/our-products/cleansers/sa-smoothing-cleanser',
      'https://theordinary.com/en-us/niacinamide-10-zinc-1-serum-100436.html',
      'https://theordinary.com/en-us/hyaluronic-acid-2-b5-serum-with-ceramides-100637.html',
      'https://www.laroche-posay.co.uk/en_GB/effaclar-purifying-cleansing-gel/LRP_103.html',
      'https://www.laroche-posay.co.uk/en_GB/cicaplast-baume-b5-repairing-balm/LRP_035.html',
      'https://www.cetaphil.com/us/cleansers/gentle-skin-cleanser/302990110227.html',
      'https://www.bioderma.co.uk/our-products/sensibio/h2o',
    ];
    const submit = () => sources
      ? http.post('/catalog/intake/names/file').set(actor.auth).field('mapping', JSON.stringify({ name: 0, url: 1 }))
        .attach('file', Buffer.from(`name,url\n${names.slice(0, count).map((name, i) => `${name},${urls[i]}`).join('\n')}\n`), { filename: 'official-products.csv', contentType: 'text/csv' }).expect(201)
      : http.post('/catalog/intake/names').set(actor.auth).send(body).expect(201);
    result.input = sources ? 'OFFICIAL_URL_CSV' : 'NAMES';
    const submitted = prior ? { body: { jobId: prior.jobId } } : await submit();
    result.jobId = submitted.body.jobId;
    save();
    result.attemptsWorked = process.argv.includes('--readback') ? 0 : await app.get(IntakeRunnerService).drain(result.jobId);
    result.durationMs = Date.now() - start;
    const rows = await db.intakeRow.findMany({ where: { jobId: result.jobId }, orderBy: { rowNumber: 'asc' } });
    for (const row of rows) {
      const item = { requested: row.rawName, outcome: row.outcome, reason: row.reasonCode, processingMs: row.processingMs, attempts: row.attempts, lastError: row.lastError, nextAttemptAt: row.nextAttemptAt, skuId: row.matchedSkuId, evidence: row.evidence, readiness: row.readiness };
      if (row.matchedSkuId) {
        const sku = await db.sku.findUniqueOrThrow({ where: { id: row.matchedSkuId }, include: { product: { include: { brand: true } } } });
        item.identity = { name: sku.product.name, brand: sku.product.brand.name, size: sku.size, unit: sku.sizeUnit, barcode: sku.barcode, variant: sku.variantName, status: sku.identityStatus, published: sku.product.isPublished };
        const response = await http.get(`/catalog/workbench/skus/${sku.id}`).set(actor.auth).expect(200);
        assert.equal(response.body.sku.id, sku.id);
        assert.equal(Number(response.body.sku.size), sku.size.toNumber());
        assert.equal(response.body.sku.product.name, sku.product.name);
        assert.equal(response.body.sku.barcode, sku.barcode);
        assert(response.body.facts.every(fact => fact.skuId === sku.id), 'API mixed facts across SKUs');
        item.apiStatus = response.status;
        item.apiIdentityMatchesDb = true;
        item.apiPublicationBlockers = response.body.readiness.blockers;
        item.facts = await db.productFactProposal.findMany({ where: { skuId: sku.id }, select: { field: true, value: true, status: true, evidence: true } });
        item.images = [];
        for (const asset of await media.listForSku(sku.id)) {
          const image = { id: asset.id, role: asset.role, parentAssetId: asset.parentAssetId, processingStatus: asset.processingStatus, processingError: asset.processingError, reviewStatus: asset.reviewStatus, sourceUrl: asset.sourceUrl };
          if (asset.storageUrl) {
            const file = await media.readAssetFile(asset.id);
            const metadata = await sharp(file.buffer).metadata();
            image.width = metadata.width; image.height = metadata.height;
            image.hashMatches = createHash('sha256').update(file.buffer).digest('hex') === asset.contentHash;
            assert(image.hashMatches, 'Stored image hash mismatch');
            const filename = `${sku.id}-${asset.id}.${metadata.format}`;
            const target = path.join(out, filename);
            if (fs.existsSync(target)) assert.equal(createHash('sha256').update(fs.readFileSync(target)).digest('hex'), asset.contentHash);
            else fs.writeFileSync(target, file.buffer);
            image.file = filename;
          }
          item.images.push(image);
        }
      }
      result.products.push(item); save();
    }
    result.after = await counts();
    const replay = await submit();
    result.replaySameJob = replay.body.jobId === result.jobId;
    result.afterReplay = await counts();
    assert(result.replaySameJob); assert.deepEqual(result.afterReplay, result.after);
    result.distinctSkuIds = new Set(result.products.map(p => p.skuId).filter(Boolean)).size;
    result.fullyValidatedSkus = result.products.filter(p => p.apiIdentityMatchesDb && p.images?.some(image => image.role === 'PRIMARY_PACKSHOT' && image.reviewStatus === 'APPROVED' && image.hashMatches)
      && !p.apiPublicationBlockers.some(blocker => ['CRITICAL_EXCEPTION_OPEN', 'FACT_CONFLICT_UNRESOLVED', 'CRITICAL_FACT_NOT_REVIEWED'].includes(blocker))).length;
    result.gatePassed = result.fullyValidatedSkus === count;
    result.unauthenticatedStatus = (await http.get('/catalog/workbench/skus/00000000-0000-4000-8000-000000000000').expect(401)).status;
    result.finishedAt = new Date().toISOString(); save();
    if (!result.gatePassed) process.exitCode = 1;
    console.log(JSON.stringify({ count, durationMs: result.durationMs, distinctSkus: result.distinctSkuIds, outcomes: result.products.map(p => ({ name: p.requested, outcome: p.outcome, reason: p.reason, images: p.images?.length ?? 0 })), replaySameJob: result.replaySameJob }));
  } finally { save(); await app.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
