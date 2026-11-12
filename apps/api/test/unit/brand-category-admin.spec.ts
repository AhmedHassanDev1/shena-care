import { BadRequestException, ConflictException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BrandService } from '../../src/modules/catalog/services/brand.service';
import { CategoryService } from '../../src/modules/catalog/services/category.service';
import { BrandController } from '../../src/application/composition/controllers/brand.controller';
import { CategoryController } from '../../src/application/composition/controllers/category.controller';
import { RolesGuard } from '../../src/modules/accounts/guards/roles.guard';

describe('Brand and Category admin operations', () => {
  it('stores deduplicated brand aliases in profile and enforces dependency checks before delete', async () => {
    const prisma = {
      brand: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue({
          id: 'brand-1',
          name: 'La Roche-Posay',
          slug: 'la-roche-posay',
          description: null,
          logoUrl: null,
          websiteUrl: null,
          countryOfOrigin: 'France',
          isActive: true,
          profile: { aliases: ['لاروش بوزيه', 'LRP'] },
          productLines: [],
        }),
        delete: jest.fn(),
      },
      product: { count: jest.fn().mockResolvedValue(2), groupBy: jest.fn().mockResolvedValue([]) },
      productLine: { count: jest.fn().mockResolvedValue(1) },
    };

    const service = new BrandService(prisma as never);
    prisma.brand.findUnique.mockResolvedValue(null);
    const created = await service.createBrand({
      name: 'La Roche-Posay',
      aliases: ['لاروش بوزيه', 'LRP', 'lrp'],
    });
    expect(created.aliases).toEqual(['لاروش بوزيه', 'LRP']);

    prisma.brand.findUnique.mockResolvedValue({ id: 'brand-1', name: 'La Roche-Posay' });
    await expect(service.deleteBrand('brand-1')).rejects.toThrow(ConflictException);
    expect(prisma.brand.delete).not.toHaveBeenCalled();
  });

  it('enforces two-level category depth and blocks deleting non-empty categories', async () => {
    const prisma = {
      category: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        delete: jest.fn(),
      },
      product: { count: jest.fn(), groupBy: jest.fn().mockResolvedValue([]) },
    };
    const service = new CategoryService(prisma as never);

    prisma.category.findUnique.mockResolvedValue({ id: 'sub-1', parentId: 'root-1' });
    await expect(
      service.createCategory({ name: 'Level Three', parentId: 'sub-1' }),
    ).rejects.toThrow(BadRequestException);

    prisma.category.findUnique.mockResolvedValue({ id: 'cat-1', name: 'Cleansers' });
    prisma.category.count.mockResolvedValue(0);
    prisma.product.count.mockResolvedValue(5);
    await expect(service.deleteCategory('cat-1')).rejects.toThrow(ConflictException);
    expect(prisma.category.delete).not.toHaveBeenCalled();
  });

  it('restricts Brand and Category destructive routes to ADMIN', () => {
    const guard = new RolesGuard(new Reflector());
    const makeCtx = (cls: unknown, handler: unknown, roles: string[]) =>
      ({
        getHandler: () => handler,
        getClass: () => cls,
        switchToHttp: () => ({ getRequest: () => ({ user: { roles } }) }),
      }) as unknown as ExecutionContext;

    expect(() =>
      guard.canActivate(makeCtx(BrandController, BrandController.prototype.deleteBrand, ['HUB_OPERATOR'])),
    ).toThrow();
    expect(
      guard.canActivate(makeCtx(BrandController, BrandController.prototype.deleteBrand, ['ADMIN'])),
    ).toBe(true);

    expect(() =>
      guard.canActivate(makeCtx(CategoryController, CategoryController.prototype.createCategory, ['HUB_OPERATOR'])),
    ).toThrow();
    expect(
      guard.canActivate(makeCtx(CategoryController, CategoryController.prototype.deleteCategory, ['ADMIN'])),
    ).toBe(true);
  });
});
