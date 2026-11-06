const { PrismaClient } = require('../../node_modules/@prisma/client');

const url = new URL(process.env.DATABASE_URL || '');
if (process.env.DATABASE_URL !== process.env.DIRECT_URL || !['localhost', '127.0.0.1'].includes(url.hostname) || !url.pathname.endsWith('_test')) throw new Error('Expected pinned localhost _test database');

const prisma = new PrismaClient();
async function main() {
  const [job, negativeJob, skus, templates, products, offers, listings] = await Promise.all([
    prisma.adminCatalogImportJob.findFirst({ where: { sourceFileName: 'policy-v14-corrected.csv' }, include: { rows: { orderBy: { rowNumber: 'asc' } } } }),
    prisma.adminCatalogImportJob.findFirst({ where: { sourceFileName: 'negative-gates.csv' }, include: { rows: { orderBy: { rowNumber: 'asc' } } } }),
    prisma.sku.findMany({ where: { code: { startsWith: 'REAL10-' } }, include: { product: { include: { brand: true, category: true } } }, orderBy: { code: 'asc' } }),
    prisma.mediaTemplate.findMany({ select: { id: true, templateKey: true, version: true, isActive: true, categoryIds: true } }),
    prisma.product.count(), prisma.supplierOffer.count(), prisma.listing.count(),
  ]);
  const rows = await Promise.all(skus.map(async sku => {
    const [runs, facts, assets] = await Promise.all([
      prisma.productResearchRun.findMany({ where: { skuId: sku.id }, orderBy: { startedAt: 'desc' }, select: { id: true, status: true, sources: true, rejected: true } }),
      prisma.productFactProposal.findMany({ where: { skuId: sku.id }, select: { id: true, field: true, value: true, status: true, evidence: true } }),
      prisma.mediaAsset.findMany({ where: { skuId: sku.id }, select: { id: true, role: true, parentAssetId: true, processingStatus: true, processingError: true, reviewStatus: true, publishedMediaId: true, templateId: true, qualityReport: true, storageUrl: true, contentHash: true, width: true, height: true, sourceUrl: true } }),
    ]);
    return { code: sku.code, skuId: sku.id, productId: sku.productId, name: sku.product.name, brand: sku.product.brand.name, category: sku.product.category?.name, barcode: sku.barcode, published: sku.product.isPublished, texture: sku.product.texture, targetArea: sku.product.targetArea, hasOuterCarton: sku.hasOuterCarton, runs, facts, assets };
  }));
  const summarizeJob = job => job && ({ id: job.id, status: job.status, totals: job.totals, rows: job.rows.map(row => ({ number: row.rowNumber, outcome: row.outcome, reasonCode: row.reasonCode, matchedSkuId: row.matchedSkuId, policy: row.identity?.policy })) });
  console.log(JSON.stringify({ job: summarizeJob(job), negativeJob: summarizeJob(negativeJob), productCount: products, offerCount: offers, listingCount: listings, templates, skus: rows }, null, 2));
}
main().finally(() => prisma.$disconnect());
