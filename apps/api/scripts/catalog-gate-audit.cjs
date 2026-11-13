// Review real-run artifacts against persisted owner state. Writes only review exceptions to a local *_test DB.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
require('./local-test-database.cjs').assertLocalTestDatabase(process.env);
Object.assign(process.env, { NODE_ENV: 'test', INTAKE_WORKER: 'off', DOMAIN_EVENTS_POLL_MS: '0', PROCUREMENT_BATCH_INTERVAL_MINUTES: '0', DECISION_SWEEP_MS: '0', RFQ_TICK_MS: '0' });
require('ts-node/register/transpile-only');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../src/app.module');
const { PrismaService } = require('../src/platform/database/prisma.service');
const { CatalogDecisionLogService } = require('../src/modules/catalog/research/catalog-decision-log.service');
const { CatalogPublicationService } = require('../src/application/composition/services/catalog-publication.service');
async function main() {
  const root = path.resolve(__dirname, '../../../output/catalog-gate-real-2026-11-13');
  const run = JSON.parse(fs.readFileSync(path.join(root, '10-sources/results.json'), 'utf8'));
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const report = { jobId: run.jobId, checkedAt: new Date().toISOString(), identityErrors: [], dataErrors: [], skus: [] };
  try {
    const db = app.get(PrismaService);
    const decisions = app.get(CatalogDecisionLogService);
    report.unresolved = await db.intakeRow.findMany({ where: { jobId: run.jobId, outcome: { in: ['PENDING', 'UNRESOLVED'] } }, select: { rawName: true, outcome: true, reasonCode: true, attempts: true, lastError: true, nextAttemptAt: true } });
    const sizes = [236, 236, 454, 236, 30, 30, 200, 40, 236, 250];
    for (const [index, item] of run.products.entries()) {
      if (!item.skuId) continue;
      const sku = await db.sku.findUniqueOrThrow({ where: { id: item.skuId }, include: { product: true } });
      assert.equal(sku.size.toNumber(), sizes[index]);
      assert.equal(sku.sizeUnit, index === 2 ? 'g' : 'ml');
      assert.equal(sku.packCount ?? 1, 1);
      assert.equal(sku.product.isPublished, false);
      const same = await db.sku.count({ where: { productId: sku.productId, size: sku.size, sizeUnit: sku.sizeUnit, variantName: sku.variantName } });
      assert.equal(same, 1, 'Duplicate persisted identity');
      const facts = await db.productFactProposal.findMany({ where: { skuId: sku.id, status: 'APPLIED' } });
      const keys = facts.find(f => f.field === 'composition.keyIngredients');
      const inci = facts.find(f => f.field === 'composition.inci');
      const errors = [];
      // Two observed regressions, held for review; this is an audit, not a new extraction or normalization policy.
      if (keys && /moisturi[sz]ing cream/i.test(sku.product.name) && keys.value.some(x => x.name === 'Niacinamide') && inci && !inci.value.some(x => /niacinamide/i.test(x))) {
        errors.push({ factId: keys.id, reason: 'SOURCE_FORMULA_CONFLICT', summary: 'Official cream page highlights Niacinamide but its INCI does not list it; formula claim requires review' });
      }
      if (keys && keys.value.some(x => /learn more|read more/i.test(x.name))) errors.push({ factId: keys.id, reason: 'NAVIGATION_AS_INGREDIENT', summary: 'Navigation text was applied as a key ingredient' });
      for (const error of errors) {
        const exception = await decisions.open({ subjectType: 'FACT', subjectId: error.factId, skuId: sku.id,
          hold: { reasonCode: `REAL_VALIDATION_${error.reason}`, severity: 'CRITICAL', field: 'composition.keyIngredients', summary: error.summary },
          evidence: { requested: item.requested, keyIngredients: keys.value, inci: inci?.value, sourceEvidence: keys.evidence } });
        report.dataErrors.push({ skuId: sku.id, ...error, exceptionId: exception.id });
      }
      const readiness = await app.get(CatalogPublicationService).readiness(sku.id);
      if (errors.length) assert(readiness.blockers.includes('CRITICAL_EXCEPTION_OPEN'));
      report.skus.push({ skuId: sku.id, requested: item.requested, duplicateCount: same, barcode: sku.barcode, readiness });
    }
    fs.writeFileSync(path.join(root, 'audit.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ identitiesChecked: report.skus.length, identityErrors: report.identityErrors.length, dataErrors: report.dataErrors.map(e => e.reason) }));
  } finally { await app.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
