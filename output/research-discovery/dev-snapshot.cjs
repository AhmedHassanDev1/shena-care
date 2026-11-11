const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
require('dotenv').config({ path: process.env.SHINACARE_API_ENV || path.join(__dirname, '../../apps/api/.env'), quiet: true });
const { PrismaClient } = require('@prisma/client');

const rows = JSON.parse(fs.readFileSync(path.join(__dirname, 'dev-before.json'), 'utf8')).products
  .map(item => ({ id: item.id, skuId: item.skuId, size: item.size, sizeUnit: item.sizeUnit }));
const digest = value => value == null ? null : createHash('sha256').update(JSON.stringify(value)).digest('hex');
const prisma = new PrismaClient();
async function main() {
  const candidates = await prisma.sku.findMany({ where: { createdAt: { gte: new Date('2026-11-09T00:00:00Z'), lt: new Date('2026-11-10T00:00:00Z') } },
    select: { id: true, code: true, size: true, sizeUnit: true, barcode: true, identityStatus: true, identityEvidence: true,
      product: { select: { id: true, name: true, slug: true, isPublished: true, usage: true, description: true, warnings: true,
        suitableSkinTypes: true, suitableHairTypes: true, spf: true, texture: true, targetArea: true, brand: { select: { name: true } } } } } });
  const selected = rows.map(row => {
    const matches = candidates.filter(item => item.id === row.skuId);
    if (matches.length !== 1) throw new Error(`${row.id}: expected one existing SKU by verified source URL, found ${matches.length}`);
    const sku = matches[0];
    if (sku.size?.toNumber() !== row.size || sku.sizeUnit !== row.sizeUnit) throw new Error(`${row.id}: SKU size does not match the intake row`);
    return { row, sku };
  });
  if (new Set(selected.map(item => item.sku.id)).size !== 10) throw new Error('Ten distinct SKU IDs required');
  const result = [];
  for (const { row, sku } of selected) {
    const [facts, runs, ingredients, safetyWarnings, usageRules] = await Promise.all([
      prisma.productFactProposal.findMany({ where: { skuId: sku.id }, select: { field: true, status: true, verification: true,
        decidedBy: true, decisionRule: true, confidence: true, value: true, evidence: true, createdAt: true } }),
      prisma.productResearchRun.findMany({ where: { skuId: sku.id }, select: { id: true, status: true, sources: true, startedAt: true,
        fieldCoverage: true }, orderBy: { startedAt: 'desc' }, take: 3 }),
      prisma.productIngredient.count({ where: { skuId: sku.id } }),
      prisma.productSafetyWarning.count({ where: { skuId: sku.id } }),
      prisma.productUsageRule.count({ where: { skuId: sku.id } }),
    ]);
    const product = sku.product;
    result.push({ id: row.id, skuId: sku.id, productId: product.id, code: sku.code, slug: product.slug,
      brand: product.brand.name, name: product.name, size: sku.size.toNumber(), sizeUnit: sku.sizeUnit,
      identityStatus: sku.identityStatus, barcode: sku.barcode, isPublished: product.isPublished,
      completeness: { usage: !!product.usage, description: !!product.description, warnings: !!product.warnings || safetyWarnings > 0,
        inci: ingredients > 0, skinTypes: product.suitableSkinTypes.length > 0, hairTypes: product.suitableHairTypes.length > 0,
        spf: product.spf != null, texture: product.texture != null, targetArea: product.targetArea != null },
      counts: { ingredients, safetyWarnings, usageRules, facts: facts.length, runs: runs.length },
      valueHashes: { usage: digest(product.usage), description: digest(product.description), warnings: digest(product.warnings),
        skinTypes: digest(product.suitableSkinTypes), hairTypes: digest(product.suitableHairTypes), spf: digest(product.spf),
        texture: digest(product.texture), targetArea: digest(product.targetArea) },
      facts: facts.map(fact => ({ field: fact.field, status: fact.status, verification: fact.verification, decidedBy: fact.decidedBy,
        decisionRule: fact.decisionRule, confidence: fact.confidence, valueHash: digest(fact.value),
        sources: Array.isArray(fact.evidence) ? fact.evidence.map(evidence => ({ url: evidence.sourceUrl, tier: evidence.sourceTier,
          observedAt: evidence.observedAt })) : [] })),
      recentRuns: runs.map(run => ({ id: run.id, status: run.status, startedAt: run.startedAt,
        sources: run.sources, fieldCoverage: run.fieldCoverage })) });
  }
  const output = path.join(__dirname, process.argv[2] || 'dev-before.json');
  fs.writeFileSync(output, JSON.stringify({ at: new Date().toISOString(), products: result }, null, 2));
  for (const item of result) console.log(JSON.stringify({ id: item.id, code: item.code, completeness: item.completeness,
    counts: item.counts, pending: item.facts.filter(fact => fact.status === 'PROPOSED' || fact.status === 'CONFLICT').map(fact => fact.field) }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
