import { CommerceService } from '../../src/modules/commerce/public';
import { CatalogService } from '../../src/modules/catalog/public';
import { ProductViewService } from '../../src/application/composition/services/product-view.service';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-000000000002';

describe('public product read batching', () => {
  it('keeps the reviewed-media eligibility gate when validating SKUs in bulk', async () => {
    const review = { sourceUrl: 'https://www.cerave.com/product', sourceType: 'OFFICIAL_MANUFACTURER',
      reviewedBy: '00000000-0000-0000-0000-000000000003', reviewedAt: '2026-01-01T00:00:00.000Z',
      skuId: A, barcode: '1234567890123', size: 100, sizeUnit: 'ml', variantName: '100 ml', isTest: false };
    const sku = (id: string) => ({ id, isActive: true, barcode: '1234567890123', size: { toNumber: () => 100 },
      sizeUnit: 'ml', variantName: '100 ml', product: { isPublished: true,
        media: [{ originType: 'verified', generationMetadata: review }] } });
    const prisma = { sku: { findMany: jest.fn().mockResolvedValue([sku(A), sku(B)]) } };
    const catalog = new CatalogService(prisma as never, {} as never);

    const statuses = await catalog.getSkuValidationStatuses([A, B, A]);

    expect(prisma.sku.findMany).toHaveBeenCalledTimes(1);
    expect(statuses.get(A)).toMatchObject({ isActive: true, isProductPublished: true });
    expect(statuses.get(B)).toMatchObject({ isActive: true, isProductPublished: false });
  });

  it('resolves listings, current prices and catalog validation once for a SKU batch', async () => {
    const prisma = {
      listing: { findMany: jest.fn().mockResolvedValue([
        { skuId: A, isListed: true }, { skuId: B, isListed: true },
      ]) },
      sellingPrice: { findMany: jest.fn().mockResolvedValue([
        { skuId: A, amount: { toNumber: () => 100 }, currency: 'EGP', compareAtAmount: null, validFrom: new Date('2026-01-01') },
        { skuId: A, amount: { toNumber: () => 90 }, currency: 'EGP', compareAtAmount: null, validFrom: new Date('2025-01-01') },
      ]) },
    };
    const catalog = { getSkuValidationStatuses: jest.fn().mockResolvedValue(new Map([
      [A, { isActive: true, isProductPublished: true }],
      [B, { isActive: true, isProductPublished: false }],
    ])) };
    const service = new CommerceService(prisma as never, catalog as never);

    const terms = await service.getSellingTermsBatch([A, B, A, 'invalid']);

    expect(prisma.listing.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.sellingPrice.findMany).toHaveBeenCalledTimes(1);
    expect(catalog.getSkuValidationStatuses).toHaveBeenCalledTimes(1);
    expect(terms.get(A)).toMatchObject({ isListed: true, canOrder: true, price: { amount: 100 } });
    expect(terms.get(B)).toMatchObject({ isListed: true, canOrder: false, price: null });
    expect(terms.get('invalid')).toBeNull();
  });

  it('composes a product batch with one commerce call and keeps unavailable SKUs hidden', async () => {
    const commerce = { getSellingTermsBatch: jest.fn().mockResolvedValue(new Map([
      [A, { canOrder: true, price: { amount: 100 } }],
      [B, { canOrder: true, price: { amount: 80 } }],
    ])) };
    const sourcing = { getPublicAvailability: jest.fn(async (id: string) => ({ isAvailable: id === A })) };
    const service = new ProductViewService({} as never, commerce as never, sourcing as never);
    const products = [A, B].map(id => ({ id, name: id, slug: id, description: null, usage: null, warnings: null,
      brand: { id, name: 'Brand', slug: 'brand' }, productLine: null, category: null,
      skus: [{ id, code: id, barcode: null, variantName: 'Size', size: null, sizeUnit: null }],
      media: [{ id, skuId: id, type: 'image', url: 'https://example.com/a.jpg', altText: null, isPrimary: true, sortOrder: 0, originType: 'verified', role: null }],
    }));

    const views = await service.composeProducts(products as never);

    expect(commerce.getSellingTermsBatch).toHaveBeenCalledTimes(1);
    expect(views.map(view => view?.id ?? null)).toEqual([A, null]);
  });
});
