import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { PostgresSearchProvider } from '../../src/modules/catalog/search/postgres-search.provider';
import { normalizeSearchText } from '../../src/modules/catalog/search/search-text';

// Synthetic published identities test retrieval only in the disposable database;
// storefront sellability is still decided by composition and its owner services.
describe('Arabic/English PostgreSQL search retrieval', () => {
  const db = new PrismaClient();
  const provider = new PostgresSearchProvider(db as unknown as PrismaService);
  const run = randomUUID();
  let brandId: string, lineId: string, categoryId: string;
  const products: string[] = [];
  const ids: Record<string, string> = {};
  const search = (q: string, extra = {}) => provider.search({ q, brand: `cerave-${run}`, snapshotAt: new Date(), ...extra });
  beforeAll(async () => {
    brandId = (await db.brand.create({ data: { name: `CeraVe ${run}`, slug: `cerave-${run}`,
      profile: { aliases: ['سيرافي', { value: 'Reviewed Derma', status: 'VERIFIED' }, { value: 'Invented Derma', status: 'UNVERIFIED' }] } } })).id;
    await db.brandDraft.create({ data: { name: `CeraVe ${run}`, canonicalName: `CeraVe ${run}`, slug: `draft-${run}`, canonicalBrandId: brandId,
      aliases: ['صيدلية الجلد'], status: 'APPROVED' } });
    categoryId = (await db.category.create({ data: { name: 'Cleansers', slug: `cleansers-${run}` } })).id;
    lineId = (await db.productLine.create({ data: { name: 'Hydrating', slug: `hydrating-${run}`, brandId } })).id;
    for (const [key, name, published, active] of [
      ['cleanser', 'Hydrating Cleanser', true, true], ['cream', 'Moisturizing Cream', true, true],
      ['hidden', 'Secret Cleanser', false, true], ['inactive', 'Inactive Cleanser', true, false],
    ] as const) {
      const product = await db.product.create({ data: { name, slug: `${key}-${run}`, brandId, categoryId: key === 'cleanser' ? categoryId : null,
        productLineId: key === 'cleanser' ? lineId : null, isPublished: published } });
      ids[key] = product.id; products.push(product.id);
      await db.sku.create({ data: { productId: product.id, code: `${key}-${run}`, variantName: '236 ml', size: 236, sizeUnit: 'ml', isActive: active } });
    }
  });
  afterAll(async () => {
    await db.sku.deleteMany({ where: { productId: { in: products } } });
    await db.product.deleteMany({ where: { id: { in: products } } });
    if (lineId) await db.productLine.delete({ where: { id: lineId } });
    if (categoryId) await db.category.delete({ where: { id: categoryId } });
    if (brandId) { await db.brandDraft.deleteMany({ where: { canonicalBrandId: brandId } }); await db.brand.delete({ where: { id: brandId } }); }
    await db.$disconnect();
  });
  it.each(['سيرافي غسول', 'غسول ٢٣٦ مل', 'Reviewed Derma cleanser', 'صيدلية الجلد غسول'])(
    'combines reviewed aliases and mixed tokens across identity fields: %s', async q => expect(await search(q)).toEqual([ids.cleanser]),
  );
  it('supports a bounded spelling error and exact line filtering', async () => {
    expect(await search('cleasner', { productLine: `hydrating-${run}` })).toEqual([ids.cleanser]);
  });
  it('ranks the exact SKU code before a product with that text as its name', async () => {
    const code = `cleanser-${run}`;
    await db.product.update({ where: { id: ids.cream }, data: { name: code } });
    try { expect((await search(code)).slice(0, 2)).toEqual([ids.cleanser, ids.cream]); }
    finally { await db.product.update({ where: { id: ids.cream }, data: { name: 'Moisturizing Cream' } }); }
  });
  it('never promotes an unverified alias, unpublished product, inactive SKU or wildcard into a result', async () => {
    for (const q of ['Invented Derma', 'Secret Cleanser', 'Inactive Cleanser', '%', "' OR 1=1 --"]) expect(await search(q)).toEqual([]);
  });
  it('rechecks SKU-specific matches against the visible SKU set without dropping product/brand matches', async () => {
    expect(await search(`cleanser-${run}`, { visibility: { productIds: [ids.cleanser], skuIds: [] } })).toEqual([]);
    expect(await search('Hydrating Cleanser', { visibility: { productIds: [ids.cleanser], skuIds: [] } })).toEqual([ids.cleanser]);
  });
  it.each(['ＣｅｒａＶｅ ٢٣٦ ۲۳۶', 'سِيروم\u200d مُرطّب', 'إ أ آ ٱ ة ى ؤ ئ', 'A\u00ad\u061cB', 'A\u{e0001}\u{1bca0}B'])(
    'keeps PostgreSQL and application normalization aligned: %s', async input => {
      const result = await db.$queryRaw<Array<{ value: string }>>`SELECT catalog.search_normalize(${input}) AS value`;
      expect(result[0].value).toBe(normalizeSearchText(input));
    },
  );
});
