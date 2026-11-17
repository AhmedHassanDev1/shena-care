/** Local browser acceptance harness. Never run against a shared database. */
import './isolate-providers';
import { assertLocalTestDatabase } from '../scripts/local-test-database.cjs';
assertLocalTestDatabase(process.env);
process.env.TEST_BYPASS_AUTH = 'false';
process.env.SOURCING_MODE = 'OFFER_BASED';
process.env.SUPPLIER_PROVISIONAL_ORDERABLE = 'false';
process.env.SUPPLIER_AVAILABILITY_MAX_AGE_HOURS = '24';

import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/platform/database/prisma.service';
import { AiClient } from '../src/platform/ai';
import { DataRetentionService } from '../src/modules/operations/services/data-retention.service';
import { OutboxService } from '../src/modules/operations/services/outbox.service';
import { ensureFixtureReviewer, reviewedMediaMetadata } from './fixtures/sellable-sku';
import { uniqueGtin } from './fixtures/gtin';

async function main() {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AiClient).useValue({ enrichProduct: async () => ({ suggestions: {} }) })
    .overrideProvider(DataRetentionService).useValue({})
    .overrideProvider(OutboxService).useValue({ enqueue: async () => undefined }).compile();
  const app = module.createNestApplication(); app.useLogger(false);
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.enableCors({ origin: 'http://127.0.0.1:3107', credentials: true });
  const files: Record<string, string> = {
    cleanser: 'cerave-sa-smoothing-cleanser-236ml.webp',
    cream: 'cerave-moisturising-cream-454g.png',
    conditioner: 'capixy-hydrating-conditioner-250ml.png',
  };
  app.getHttpAdapter().get('/search-test-media/:key', (req, res) => {
    const name = files[req.params.key];
    if (!name) return res.status(404).end();
    return res.sendFile(resolve(__dirname, 'fixtures/media', name));
  });
  await app.init();
  const db = app.get(PrismaService), reviewer = await ensureFixtureReviewer(db), run = process.env.SEARCH_BROWSER_RUN_ID || randomUUID();
  const supplier = await db.supplier.upsert({ where: { slug: `search-browser-${run}` }, update: {}, create: { name: `Search browser fixture ${run}`, slug: `search-browser-${run}` } });
  const fixtures = [
    { key: 'cleanser', name: 'CeraVe SA Smoothing Cleanser', brand: 'CeraVe', brandSlug: 'cerave', category: 'cleansers', type: 'cleanser', size: 236, unit: 'ml' },
    { key: 'cream', name: 'CeraVe Moisturising Cream', brand: 'CeraVe', brandSlug: 'cerave', category: 'moisturizers', type: 'moisturizer', size: 454, unit: 'g' },
    { key: 'conditioner', name: 'Capixy Hydrating Conditioner', brand: 'Capixy', brandSlug: 'capixy', category: 'conditioners', type: 'conditioner', size: 250, unit: 'ml' },
  ];
  const productIds: string[] = [];
  for (const [index, item] of fixtures.entries()) {
    const existing = await db.product.findUnique({ where: { slug: `search-browser-${item.key}-${run}` } });
    if (existing) { productIds.push(existing.id); continue; }
    const brand = await db.brand.upsert({ where: { name: item.brand }, update: {}, create: { name: item.brand, slug: item.brandSlug } });
    const parentSlug = item.key === 'conditioner' ? 'hair-care' : 'skin-care';
    const parent = await db.category.upsert({ where: { slug: parentSlug }, update: {}, create: { name: parentSlug, slug: parentSlug } });
    const category = await db.category.upsert({ where: { slug: item.category }, update: { parentId: parent.id }, create: { name: item.category, slug: item.category, parentId: parent.id } });
    const product = await db.product.create({ data: { name: item.name, slug: `search-browser-${item.key}-${run}`, brandId: brand.id, categoryId: category.id,
      productType: item.type, isPublished: true, concerns: item.key === 'cleanser' ? ['acne'] : [] } });
    productIds.push(product.id);
    const sku = await db.sku.create({ data: { productId: product.id, code: `SEARCH-BROWSER-${index}-${run}`, barcode: uniqueGtin(), variantName: `${item.size} ${item.unit}`,
      size: item.size, sizeUnit: item.unit, identityStatus: 'ADMIN_VERIFIED' } });
    await db.productMedia.create({ data: { productId: product.id, type: 'image', url: `http://127.0.0.1:4107/search-test-media/${item.key}`, originType: 'verified', isPrimary: true,
      generationMetadata: reviewedMediaMetadata({ id: sku.id, barcode: sku.barcode!, size: item.size, sizeUnit: item.unit, variantName: sku.variantName }, reviewer.id) } });
    await db.listing.create({ data: { skuId: sku.id } });
    await db.sellingPrice.create({ data: { skuId: sku.id, amount: 200 + index * 100, currency: 'EGP', validFrom: new Date(Date.now() - 60_000) } });
    await db.supplierOffer.create({ data: { supplierId: supplier.id, skuId: sku.id, costPrice: 100, currency: 'EGP', lastConfirmedAt: new Date() } });
    await db.skuRoutineProfile.create({ data: { skuId: sku.id, productId: product.id, ruleVersion: 'browser-fixture', primaryRoleStatus: 'RULE_DERIVED',
      suitability: { skinTypes: { value: item.key === 'cleanser' ? ['OILY'] : ['DRY'], status: 'VERIFIED' } } } });
  }
  await app.listen(4107, '127.0.0.1');
  console.log(JSON.stringify({ ready: true, port: 4107, fixtures: fixtures.map(item => item.name) }));
  async function stop() {
    const skuIds = (await db.sku.findMany({ where: { productId: { in: productIds } }, select: { id: true } })).map(sku => sku.id);
    await db.supplierOffer.deleteMany({ where: { supplierId: supplier.id } });
    await db.listing.deleteMany({ where: { skuId: { in: skuIds } } });
    await db.sellingPrice.deleteMany({ where: { skuId: { in: skuIds } } });
    await db.productMedia.deleteMany({ where: { productId: { in: productIds } } });
    await db.sku.deleteMany({ where: { id: { in: skuIds } } });
    await db.product.deleteMany({ where: { id: { in: productIds } } });
    await db.supplier.delete({ where: { id: supplier.id } });
    await app.close(); process.exit(0);
  }
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
}
void main().catch(error => { console.error(error); process.exit(1); });
