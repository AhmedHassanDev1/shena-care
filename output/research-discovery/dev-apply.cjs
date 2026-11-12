const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
require('dotenv').config({ path: process.env.SHINACARE_API_ENV || path.join(__dirname, '../../apps/api/.env'), quiet: true });
require('ts-node/register/transpile-only');

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../../apps/api/src/app.module');
const { PrismaService } = require('../../apps/api/src/platform/database/prisma.service');
const { CanonicalResearchService } = require('../../apps/api/src/modules/catalog/research/canonical-research.service');
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'enrichment-before.json'), 'utf8')).products;
const output = path.join(__dirname, 'enrichment-apply-results.jsonl');
const digest = value => value == null ? null : createHash('sha256').update(JSON.stringify(value)).digest('hex');

function assertDevelopmentTarget() {
  const pool = new URL(process.env.DATABASE_URL || '');
  const direct = new URL(process.env.DIRECT_URL || '');
  if (process.env.NODE_ENV !== 'development' || pool.hostname !== 'aws-0-eu-west-1.pooler.supabase.com'
    || direct.hostname !== pool.hostname || pool.pathname !== '/postgres' || direct.pathname !== '/postgres') {
    throw new Error('Expected the recorded ShinaCare development database; refusing to run');
  }
  if (process.env.SHINACARE_APPLY_DEV_RESEARCH !== 'YES') throw new Error('Explicit apply flag required');
  if (baseline.length !== 10 || new Set(baseline.map(item => item.skuId)).size !== 10) throw new Error('Expected ten distinct baseline SKUs');
}

async function current(prisma, row) {
  const sku = await prisma.sku.findUniqueOrThrow({ where: { id: row.skuId }, select: { id: true, size: true, sizeUnit: true,
    identityEvidence: true, product: { select: { id: true, usage: true, description: true, warnings: true,
      suitableSkinTypes: true, suitableHairTypes: true, spf: true, texture: true, targetArea: true } } } });
  if (sku.product.id !== row.productId || sku.size?.toNumber() !== row.size || sku.sizeUnit !== row.sizeUnit
    || !Array.isArray(sku.identityEvidence?.sourceUrls) || !sku.identityEvidence.sourceUrls.length) {
    throw new Error(`${row.id}: SKU identity changed since baseline`);
  }
  const values = sku.product;
  for (const [key, wasPresent] of Object.entries(row.completeness)) {
    const field = { skinTypes: 'suitableSkinTypes', hairTypes: 'suitableHairTypes' }[key] || key;
    if (wasPresent && Object.hasOwn(row.valueHashes, key) && digest(values[field]) !== row.valueHashes[key]) {
      throw new Error(`${row.id}: existing ${key} changed since baseline`);
    }
  }
  return { sku, url: sku.identityEvidence.sourceUrls[0] };
}

async function main() {
  assertDevelopmentTarget();
  const completed = new Set(fs.existsSync(output) ? fs.readFileSync(output, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line).id) : []);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService);
    const research = app.get(CanonicalResearchService);
    for (const row of baseline) {
      if (completed.has(row.id)) continue;
      const { url } = await current(prisma, row);
      const previousRun = await prisma.productResearchRun.findFirst({ where: { skuId: row.skuId }, orderBy: { startedAt: 'desc' }, select: { requestedBy: true } });
      const actorId = previousRun?.requestedBy;
      const actor = actorId && await prisma.customer.findUnique({ where: { id: actorId }, select: { roles: true } });
      if (!actor?.roles.includes('ADMIN')) throw new Error(`${row.id}: no verified prior Admin actor`);

      const run = await research.startRun(row.skuId, { sourceUrls: [url], useConfiguredProviders: true }, actorId);
      const verified = await research.autoVerify(row.skuId, actorId);
      await current(prisma, row);
      const result = { id: row.id, skuId: row.skuId, runId: run.id, status: run.status,
        sources: run.sources, providers: run.providerStatuses, applied: verified.applied,
        unverified: verified.unverified, rejected: verified.rejected,
        holds: verified.holds.map(hold => ({ field: hold.field, reasonCode: hold.reasonCode, severity: hold.severity })) };
      fs.appendFileSync(output, JSON.stringify(result) + '\n');
      console.log(JSON.stringify({ id: result.id, status: result.status, applied: result.applied,
        unverified: result.unverified, holds: result.holds, sources: result.sources.length }));
      if (result.holds.some(hold => hold.severity === 'CRITICAL')) throw new Error(`${row.id}: critical hold; stopped before the next SKU`);
    }
  } finally {
    await app.close();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
