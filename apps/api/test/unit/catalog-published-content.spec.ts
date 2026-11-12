import { ProductContentService } from '../../src/modules/catalog/research/product-content.service';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { CatalogService } from '../../src/modules/catalog/services/catalog.service';

describe('published content from Catalog Intake', () => {
  const skuId = 'sku-one';
  const sourceUrl = 'https://manufacturer.example/product';
  const appliedAt = new Date('2026-11-09T12:00:00Z');
  const fact = (field: string, value: unknown) => ({ skuId, field, value, status: 'APPLIED', appliedAt,
    createdAt: appliedAt, evidence: [{ sourceUrl, sourceTier: 'OFFICIAL_MANUFACTURER' }] });

  it('returns only applied, source-linked intake content for the public detail', async () => {
    const prisma = { ingestionItem: { findMany: jest.fn().mockResolvedValue([]) }, productFactProposal: { findMany: jest.fn().mockResolvedValue([
      fact('marketing.description', 'A gentle cleanser.'),
      fact('usage.instructions', ['Massage, then rinse.']),
      fact('composition.keyIngredients', [{ name: 'Niacinamide', function: null }]),
    ]) } };
    const catalog = { getSkuIdentity: jest.fn() };
    const content = await new ProductContentService(prisma as unknown as PrismaService, catalog as unknown as CatalogService).getPublishedContent([skuId]);

    expect(prisma.productFactProposal.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'APPLIED' }) }));
    expect(catalog.getSkuIdentity).not.toHaveBeenCalled();
    expect(content.get(skuId)).toMatchObject({ language: 'en', description: 'A gentle cleanser.', usage: 'Massage, then rinse.',
      ingredients: 'Niacinamide', verifiedFacts: expect.arrayContaining([expect.objectContaining({ sourceUrl, sourceType: 'OFFICIAL_MANUFACTURER' })]) });
  });

  it('does not create public content without applied facts', async () => {
    const prisma = { ingestionItem: { findMany: jest.fn().mockResolvedValue([]) }, productFactProposal: { findMany: jest.fn().mockResolvedValue([]) } };
    const content = await new ProductContentService(prisma as unknown as PrismaService, {} as CatalogService).getPublishedContent([skuId]);
    expect(content.has(skuId)).toBe(false);
  });
});
