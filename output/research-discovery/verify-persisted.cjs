const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../../apps/api/.env'), quiet: true });
const { PrismaClient } = require('@prisma/client');
const rows = JSON.parse(fs.readFileSync(path.join(__dirname, 'enrichment-after.json'), 'utf8')).products;
async function main() {
  const prisma = new PrismaClient();
  try {
    const result = [];
    for (const row of rows) {
      const product = await prisma.product.findUniqueOrThrow({ where: { id: row.productId }, select: {
        id: true, usage: true, description: true, warnings: true, isFragranceFree: true,
        productIngredients: { where: { skuId: row.skuId }, orderBy: { sortOrder: 'asc' }, select: { ingredient: { select: { name: true } } } },
      } });
      const facts = await prisma.productFactProposal.findMany({ where: { skuId: row.skuId, status: 'APPLIED' },
        select: { field: true, value: true, verification: true, evidence: true, appliedAt: true } });
      result.push({ id: row.id, productId: product.id, usage: !!product.usage, description: !!product.description,
        warnings: !!product.warnings, isFragranceFree: product.isFragranceFree,
        ingredients: product.productIngredients.map(link => link.ingredient.name),
        verifiedFacts: facts.map(fact => ({ field: fact.field, verification: fact.verification,
          value: row.id === 'SC-MVP-055' && ['composition.inci', 'composition.fragrance'].includes(fact.field) ? fact.value : undefined,
          sources: (fact.evidence || []).map(item => ({ url: item.sourceUrl, tier: item.sourceTier, observedAt: item.observedAt })) })) });
    }
    fs.writeFileSync(path.join(__dirname, 'enrichment-db-readback.json'), JSON.stringify({ at: new Date().toISOString(), rows: result }, null, 2));
    console.log(JSON.stringify(result.map(row => ({ id: row.id, inciCount: row.ingredients.length, fragranceFree: row.isFragranceFree,
      verified: row.verifiedFacts.length }))));
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
