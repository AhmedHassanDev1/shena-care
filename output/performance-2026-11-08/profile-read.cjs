const { performance } = require('node:perf_hooks');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../../apps/api/dist/app.module');
const { PrismaService } = require('../../apps/api/dist/platform/database/prisma.service');
const { DiscoveryService } = require('../../apps/api/dist/application/composition/services/discovery.service');
const { ProductDetailService } = require('../../apps/api/dist/application/composition/services/product-detail.service');
const { ProductViewService } = require('../../apps/api/dist/application/composition/services/product-view.service');
const { CatalogService } = require('../../apps/api/dist/modules/catalog/services/catalog.service');
const { CommerceService } = require('../../apps/api/dist/modules/commerce/services/commerce.service');
const { SourcingService } = require('../../apps/api/dist/modules/sourcing/services/sourcing.service');
const { CareService } = require('../../apps/api/dist/modules/care/services/care.service');
const { ProductContentService } = require('../../apps/api/dist/modules/ingestion/services/product-content.service');
const { PromotionService } = require('../../apps/api/dist/modules/commerce/services/promotion.service');

process.env.PRISMA_LOG_QUERIES = 'true';
const writeLog = console.log;
console.log = (...args) => {
  if (!String(args[0]).startsWith('prisma:query')) writeLog(...args);
};

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);
  const spans = [];
  const sql = [];
  let phase = 'setup';
  prisma.$on('query', e => {
    const table = (e.query.match(/\bFROM\s+"?([\w.]+)"?/i) || e.query.match(/\bUPDATE\s+"?([\w.]+)"?/i) || [])[1] || 'other';
    sql.push({ phase, table, ms: e.duration, at: performance.now() });
  });
  const wrap = (type, names) => {
    const instance = app.get(type);
    for (const name of names) {
      const original = instance[name];
      if (typeof original !== 'function') continue;
      instance[name] = async function (...args) {
        const start = performance.now();
        try { return await original.apply(this, args); }
        finally { spans.push({ phase, name: `${type.name}.${name}`, ms: +(performance.now() - start).toFixed(1) }); }
      };
    }
  };
  wrap(CatalogService, ['scanPublishedProducts', 'getPublishedProductsByIds', 'getPublishedProduct', 'getSkuValidationStatuses', 'getReviewedIdentityFacts', 'getReviewedUsageRules']);
  wrap(CommerceService, ['getSellingTermsBatch']);
  wrap(SourcingService, ['getPublicAvailability']);
  wrap(CareService, ['getPublicProductPlacements']);
  wrap(ProductContentService, ['getPublishedContent']);
  wrap(PromotionService, ['getActivePromotions', 'getProductPreview']);
  wrap(ProductViewService, ['getProductView', 'composeProducts']);

  const discovery = app.get(DiscoveryService);
  const detail = app.get(ProductDetailService);
  const run = async (name, fn) => {
    phase = name;
    const from = performance.now();
    const result = await fn();
    const ms = +(performance.now() - from).toFixed(1);
    const queries = sql.filter(s => s.phase === name);
    const methods = spans.filter(s => s.phase === name && s.name !== 'SourcingService.getPublicAvailability');
    const tableSummary = Object.entries(queries.reduce((a, s) => {
      const key = s.table.replaceAll('"', '');
      const item = a[key] ||= { count: 0, dbMs: 0 };
      item.count++;
      item.dbMs += s.ms;
      return a;
    }, {})).map(([table, x]) => ({ table, count: x.count, dbMs: +x.dbMs.toFixed(1) }));
    console.log(JSON.stringify({ name, ms, queryCount: queries.length,
      queryDbMs: +queries.reduce((a, x) => a + x.ms, 0).toFixed(1),
      tables: tableSummary, methods, count: result?.items?.length ?? result?.skus?.length ?? null,
      total: result?.total ?? null, slug: name.startsWith('discovery') ? result?.items?.[0]?.slug : undefined }));
    return result;
  };
  await run('db-ping-1', () => prisma.$queryRawUnsafe('SELECT 1'));
  await run('db-ping-2', () => prisma.$queryRawUnsafe('SELECT 1'));
  const list = await run('discovery-1', () => discovery.discover({ limit: 12 }));
  await run('discovery-2', () => discovery.discover({ limit: 12 }));
  const slug = list.items[0]?.slug;
  if (slug) {
    await run('detail-1', () => detail.getDetail(slug));
    await run('detail-2', () => detail.getDetail(slug));
  }
  await app.close();
}
main().catch(error => { console.error(error); process.exitCode = 1; });
