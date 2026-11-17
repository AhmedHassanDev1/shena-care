import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { PostgresSearchProvider } from '../../src/modules/catalog/search/postgres-search.provider';

describe('Smart search evidence, constraints and relevance (PostgreSQL)', () => {
  const db = new PrismaClient();
  const provider = new PostgresSearchProvider(db as unknown as PrismaService);
  const run = randomUUID();
  const ids: Record<string, string> = {};
  const skus: Record<string, string> = {};
  let brandId: string;
  let ingredientId: string;
  const search = (q: string, extra = {}) => provider.search({ q, brand: `smart-${run}`, snapshotAt: new Date(), ...extra });

  beforeAll(async () => {
    brandId = (await db.brand.create({ data: { name: `Search ${run}`, slug: `smart-${run}`, profile: { aliases: ['ستارفيل', 'starville'] } } })).id;
    ingredientId = (await db.ingredient.create({ data: { name: `Niacinamide ${run}`, nameAr: 'نياسيناميد', inciName: 'Niacinamide', slug: `niacinamide-${run}`, aliases: ['نياكيناميد'], primaryFunction: 'Skin Restoring', isActiveIngredient: true } })).id;
    for (const [key, name, type] of [
      ['oily', 'Foaming Wash', 'cleanser'], ['dry', 'Gentle Wash', 'cleanser'],
      ['unknown', 'Oily Skin Wash', 'cleanser'], ['serum', 'Barrier Drops', 'serum'],
      ['weak', 'Niacinamide inspired cream', 'moisturizer'], ['shampoo', 'Scalp Wash', 'shampoo'],
      ['sun', 'Sun Fluid', 'sunscreen'], ['exact', 'Cleanser', 'cleanser'],
    ]) {
      const product = await db.product.create({ data: { brandId, name, slug: `${key}-${run}`, productType: type, isPublished: true,
        concerns: key === 'oily' ? ['acne'] : [], suitableSkinTypes: key === 'unknown' ? ['OILY'] : [], spf: key === 'sun' ? 50 : null } });
      ids[key] = product.id;
      const sku = await db.sku.create({ data: { productId: product.id, code: `${key}-${run}`, variantName: '50 ml' } });
      skus[key] = sku.id;
      if (['oily', 'dry', 'shampoo'].includes(key)) await db.skuRoutineProfile.create({ data: {
        skuId: sku.id, productId: product.id, ruleVersion: 'test-evidence', primaryRoleStatus: 'RULE_DERIVED',
        suitability: { skinTypes: { status: 'VERIFIED', value: [key === 'oily' ? 'oily' : 'DRY'] },
          concerns: key === 'shampoo' ? [{ concern: 'dandruff_scalp', status: 'MANUFACTURER_CLAIM', source: 'https://manufacturer.example/label' }] : [] },
      } });
    }
    await db.productIngredient.create({ data: { productId: ids.serum, skuId: skus.serum, ingredientId, isKeyActive: true } });
  });

  afterAll(async () => {
    await db.sku.deleteMany({ where: { id: { in: Object.values(skus) } } });
    await db.product.deleteMany({ where: { id: { in: Object.values(ids) } } });
    if (ingredientId) await db.ingredient.delete({ where: { id: ingredientId } });
    if (brandId) await db.brand.delete({ where: { id: brandId } });
    await db.$disconnect();
  });

  it.each(['غسول للبشرة الدهنية', 'cleanser for oily skin', 'ستارفيل غسول للبشره الدهنيه'])(
    'requires verified suitability and product type for %s', async q => expect(await search(q)).toEqual([ids.oily]),
  );
  it.each(['غسول للحبوب', 'cleanser for acne'])(
    'combines explicit concern relationships with product type: %s', async q => expect(await search(q)).toEqual([ids.oily]),
  );
  it.each(['سيرم نياكيناميد', 'serum niacinamide'])(
    'matches the recorded ingredient relationship: %s', async q => expect(await search(q)).toEqual([ids.serum]),
  );
  it.each(['serum niacniamide', 'سيرم نياكناميد'])(
    'resolves an ingredient typo before enforcing its recorded relationship: %s', async q => expect(await search(q)).toEqual([ids.serum]),
  );
  it('never uses an ingredient from a hidden sibling SKU', async () => {
    expect(await search('niacinamide', { visibility: { productIds: [ids.serum], skuIds: [skus.oily] } })).toEqual([]);
  });
  it('never uses suitability evidence from a hidden sibling SKU', async () => {
    expect(await search('غسول للبشرة الدهنية', { visibility: { productIds: [ids.oily], skuIds: [skus.dry] } })).toEqual([]);
  });
  it('does not claim suitability or ingredient intent from names alone', async () => {
    expect(await search('مرطب نياكيناميد')).toEqual([]);
    expect(await search('غسول للبشرة الحساسة')).toEqual([]);
    expect(await search('niacinamide')).toContain(ids.serum);
    expect(await search('niacinamide')).not.toContain(ids.weak);
  });
  it('supports a verified scalp concern, exact SPF and Arabic digits', async () => {
    expect(await search('شامبو للقشرة')).toEqual([ids.shampoo]);
    expect(await search('starville SPF ٥٠')).toEqual([ids.sun]);
    expect(await search('starville SPF 30')).toEqual([]);
  });
  it('ranks exact identity ahead of type-only matches and bounds suggestions', async () => {
    expect((await search('cleanser'))[0]).toBe(ids.exact);
    expect(await provider.suggest({ q: 'cleanser', brand: `smart-${run}`, snapshotAt: new Date() }, 1)).toEqual([ids.exact]);
    const next = await provider.suggest({ q: 'cleanser', brand: `smart-${run}`, snapshotAt: new Date() }, 1, 1);
    expect(next).toHaveLength(1);
    expect(next).not.toContain(ids.exact);
    expect(await search('cleanser')).toEqual(await search('cleanser'));
  });
  it.each(['', '   ', '%', '_', "' OR 1=1 --", 'غسول للقشرة 999', '\u0000'])(
    'handles empty, unrelated and hostile queries safely: %s', async q => expect(await search(q)).toEqual([]),
  );
});
