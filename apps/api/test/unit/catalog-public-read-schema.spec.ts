import { CatalogService } from '../../src/modules/catalog/services/catalog.service';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { MediaStoragePort } from '../../src/platform/storage/media-storage.port';

describe('Catalog public reads on an older deployed schema', () => {
  it('returns a missing product without selecting unmigrated Product or Brand fields', async () => {
    const prisma = {
      product: {
        findFirst: jest.fn(async (args: { select?: Record<string, unknown> }) => {
          const selectedBrand = args.select?.brand as { select?: Record<string, unknown> } | undefined;
          if (!args.select || args.select.productType || !selectedBrand?.select || selectedBrand.select.profile) {
            throw new Error('P2022: column does not exist');
          }
          return null;
        }),
      },
    };
    const catalog = new CatalogService(prisma as unknown as PrismaService, {} as MediaStoragePort);

    await expect(catalog.getPublishedProduct('missing-product')).resolves.toBeNull();
  });

  it('checks SKU availability without selecting unmigrated Product fields', async () => {
    const prisma = {
      sku: {
        findUnique: jest.fn(async (args: { include?: { product?: { select?: Record<string, unknown> } } }) => {
          if (!args.include?.product?.select || args.include.product.select.productType) {
            throw new Error('P2022: column does not exist');
          }
          return null;
        }),
      },
    };
    const catalog = new CatalogService(prisma as unknown as PrismaService, {} as MediaStoragePort);

    await expect(catalog.getSkuValidationStatus('343f1cb1-0b53-4876-90e8-07e1bf1f8d42')).resolves.toBeNull();
  });
});
