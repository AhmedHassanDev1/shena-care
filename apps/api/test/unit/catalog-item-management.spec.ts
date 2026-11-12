import { CatalogItemManagementService } from '../../src/modules/catalog/services/catalog-item-management.service';
import { CatalogService } from '../../src/modules/catalog/services/catalog.service';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { MediaStoragePort } from '../../src/platform/storage/media-storage.port';
import { CatalogIntakeService } from '../../src/modules/catalog/services/catalog-intake.service';
import { CatalogItemsController, ItemQueryDto, VisibilityDto } from '../../src/application/composition/controllers/catalog-items.controller';
import { AuthGuard } from '../../src/modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../src/modules/accounts/guards/roles.guard';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ExecutionContext, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

describe('Catalog item archive', () => {
  const product = { id: 'product-1', archivedAt: null, isPublished: true };
  const prisma = {
    product: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    sku: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn(async (run: (tx: unknown) => Promise<unknown>) => run(prisma)),
  };
  const service = new CatalogItemManagementService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.product.findUnique.mockResolvedValue(product);
    prisma.product.update.mockResolvedValue({ ...product, archivedAt: new Date() });
  });

  it('archives without deleting identity or order history and disables its SKUs', async () => {
    await service.archive('product-1');
    expect(prisma.product.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'product-1' },
      data: expect.objectContaining({ isPublished: false, archivedAt: expect.any(Date) }),
    }));
    expect(prisma.sku.updateMany).toHaveBeenCalledWith({ where: { productId: 'product-1' }, data: { isActive: false } });
  });

  it('restores the record without automatically republishing or reactivating it', async () => {
    prisma.product.findUnique.mockResolvedValue({ ...product, archivedAt: new Date() });
    await service.restore('product-1');
    expect(prisma.product.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'product-1' }, data: { archivedAt: null } }));
    expect(prisma.sku.updateMany).not.toHaveBeenCalled();
  });

  it('rejects mutation of an archived SKU', async () => {
    prisma.sku.findUnique.mockResolvedValue({ product: { archivedAt: new Date() } });
    await expect(service.ensureSkuEditable('sku-1')).rejects.toThrow('Restore the archived product');
  });

  it('rejects an unknown product without writing', async () => {
    prisma.product.findUnique.mockResolvedValue(null);
    await expect(service.archive('missing')).rejects.toThrow('Product not found');
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('activates a SKU only while its product is not archived', async () => {
    prisma.sku.updateMany.mockResolvedValue({ count: 1 });
    prisma.sku.findUniqueOrThrow.mockResolvedValue({ id: 'sku-1', isActive: true });
    await service.setSkuActive('sku-1', true);
    expect(prisma.sku.updateMany).toHaveBeenCalledWith({ where: { id: 'sku-1', product: { archivedAt: null } }, data: { isActive: true } });
  });

  it('does not publish an archived product even when publication races with archiving', async () => {
    prisma.product.updateMany.mockResolvedValue({ count: 0 });
    await expect(new CatalogIntakeService(prisma as never).publishReviewed('product-1', 'admin-1')).rejects.toThrow('Archived product');
    expect(prisma.product.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'product-1', archivedAt: null } }));
  });
});

describe('Catalog item API security', () => {
  it('requires authentication and the Admin role on every item route', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CatalogItemsController)).toEqual([AuthGuard, RolesGuard]);
    expect(Reflect.getMetadata('roles', CatalogItemsController)).toEqual(['ADMIN']);
    const guard = new RolesGuard(new Reflector());
    const context = (roles: string[]) => ({
      getHandler: () => CatalogItemsController.prototype.archive,
      getClass: () => CatalogItemsController,
      switchToHttp: () => ({ getRequest: () => ({ user: { roles } }) }),
    }) as unknown as ExecutionContext;
    expect(() => guard.canActivate(context(['SUPPLIER']))).toThrow();
    expect(guard.canActivate(context(['ADMIN']))).toBe(true);
  });

  it('rejects invalid visibility values and unbounded list requests', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
    await expect(pipe.transform({ isVisible: 'yes' }, { type: 'body', metatype: VisibilityDto })).rejects.toThrow();
    await expect(pipe.transform({ page: 0, limit: 500 }, { type: 'query', metatype: ItemQueryDto })).rejects.toThrow();
  });
});

describe('Catalog item editing on the current schema', () => {
  it('updates a product name without reading columns from a pending migration', async () => {
    const product = {
      id: 'product-1', brandId: 'brand-1', name: 'Old name', slug: 'brand-old-name',
      description: null, concerns: [], isPublished: false,
      brand: { id: 'brand-1', name: 'Brand', slug: 'brand' },
      productLine: null, category: null, skus: [], media: [],
    };
    const prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue(product),
        findFirst: jest.fn(async (args: { select?: { id?: boolean } }) => {
          if (!args.select?.id) throw new Error('P2022: unmigrated product column');
          return null;
        }),
        update: jest.fn().mockResolvedValue({ ...product, name: 'New name' }),
      },
      brand: {
        findUnique: jest.fn(async (args: { select?: { name?: boolean } }) => {
          if (!args.select?.name) throw new Error('P2022: unmigrated brand column');
          return { name: 'Brand' };
        }),
      },
    };
    const catalog = new CatalogService(prisma as unknown as PrismaService, {} as MediaStoragePort);

    await expect(catalog.updateProduct('product-1', { name: 'New name' })).resolves.toMatchObject({ name: 'New name' });
    expect(prisma.product.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ name: 'New name' }) }));
  });

  it('resolves delivery URLs through MEDIA_STORAGE_PORT and enriches SKU readiness & prices', async () => {
    const skuId = '11111111-1111-4111-8111-111111111111';
    const prisma = {
      product: {
        count: jest
          .fn()
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(0),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'prod-1',
            name: 'Hydrating Cleanser',
            slug: 'hydrating-cleanser',
            description: null,
            isPublished: true,
            archivedAt: null,
            brandId: 'brand-1',
            categoryId: 'cat-1',
            productLineId: null,
            brand: { id: 'brand-1', name: 'CeraVe', slug: 'cerave' },
            category: { id: 'cat-1', name: 'Cleansers', slug: 'cleansers', parentId: null },
            productLine: null,
            media: [{ id: 'm-1', url: 'cloudinary://folder/packshot', altText: 'Packshot', isPrimary: true }],
            skus: [
              {
                id: skuId,
                code: 'CV-236',
                variantName: '236 ml',
                barcode: '3337875597180',
                size: { toNumber: () => 236, valueOf: () => 236 },
                sizeUnit: 'ml',
                packCount: 1,
                isActive: true,
                hasOuterCarton: false,
                identityStatus: 'VERIFIED',
                barcodeStatus: 'VERIFIED',
              },
            ],
          },
        ]),
      },
      mediaAsset: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const mediaPort: MediaStoragePort = {
      upload: jest.fn(),
      publishMedia: jest.fn(),
      delete: jest.fn(),
      getDeliveryUrl: jest.fn((id: string) =>
        id.startsWith('cloudinary://')
          ? 'https://res.cloudinary.com/demo/image/upload/packshot.png'
          : id,
      ),
    };
    const itemsService = new CatalogItemManagementService(prisma as never, mediaPort);
    const commerce = {
      getPricedSkuIds: jest.fn(),
      getListedSkuIds: jest.fn(),
      getSkuCommercialSummaryBatch: jest.fn().mockResolvedValue({
        [skuId]: {
          isListed: true,
          price: { id: 'price-1', amount: 650, compareAtAmount: null, currency: 'EGP' },
        },
      }),
    };
    const controller = new CatalogItemsController(itemsService, commerce as never);

    const response = await controller.list({ page: 1, limit: 20 });
    expect(mediaPort.getDeliveryUrl).toHaveBeenCalledWith('cloudinary://folder/packshot');
    expect(response.items[0].media[0].url).toBe(
      'https://res.cloudinary.com/demo/image/upload/packshot.png',
    );
    expect(response.items[0].readiness.status).toBe('READY');
    expect(response.items[0].skus[0].currentPrice?.amount).toBe(650);
  });
});
