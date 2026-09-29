import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseModule } from '../../src/platform/database/database.module';
import { CatalogModule } from '../../src/modules/catalog/public';
import { CommerceModule } from '../../src/modules/commerce/public';
import { CompositionModule } from '../../src/application/composition/composition.module';
import { ProductViewController } from '../../src/application/composition/controllers/product-view.controller';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { MediaType, MediaOriginType } from '@prisma/client';

describe('Product, SKU & Media Management (e2e)', () => {
  let app: INestApplication;
  let productViewController: ProductViewController;
  let prisma: PrismaService;

  let ceraveBrandId: string;
  let ceraveProductLineId: string;
  let lrpBrandId: string;
  let lrpProductLineId: string;
  let moisturizersCategoryId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [DatabaseModule, CatalogModule, CommerceModule, CompositionModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    productViewController = moduleFixture.get<ProductViewController>(ProductViewController);
    prisma = moduleFixture.get<PrismaService>(PrismaService);

    await app.init();

    // Fetch existing seeded dependencies
    const cerave = await prisma.brand.findFirst({ where: { slug: 'cerave' } });
    ceraveBrandId = cerave!.id;

    const ceraveLine = await prisma.productLine.findFirst({
      where: { brandId: ceraveBrandId },
    });
    ceraveProductLineId = ceraveLine!.id;

    const lrp = await prisma.brand.findFirst({ where: { slug: 'la-roche-posay' } });
    lrpBrandId = lrp!.id;

    const lrpLine = await prisma.productLine.findFirst({
      where: { brandId: lrpBrandId },
    });
    lrpProductLineId = lrpLine!.id;

    const category = await prisma.category.findFirst({ where: { slug: 'moisturizers' } });
    moisturizersCategoryId = category!.id;
  });

  afterAll(async () => {
    // Cleanup any created test product, skus, media
    const testProducts = await prisma.product.findMany({
      where: {
        slug: {
          in: ['cerave-hydrating-lotion', 'custom-product-slug', 'updated-lotion-slug'],
        },
      },
    });

    for (const p of testProducts) {
      await prisma.productMedia.deleteMany({ where: { productId: p.id } });
      await prisma.sku.deleteMany({ where: { productId: p.id } });
      await prisma.product.delete({ where: { id: p.id } });
    }

    await app.close();
  });

  describe('Product Management APIs', () => {
    let createdProductId: string;

    it('should create a new product linked to brand, product line, and category', async () => {
      const product = await productViewController.createProduct({
        name: 'Hydrating Lotion',
        brandId: ceraveBrandId,
        productLineId: ceraveProductLineId,
        categoryId: moisturizersCategoryId,
        description: 'Lightweight lotion with hyaluronic acid',
        usage: 'Apply daily in the morning',
        warnings: 'Avoid contact with eyes',
        isPublished: true,
      });

      expect(product).toBeDefined();
      expect(product.id).toBeDefined();
      expect(product.name).toBe('Hydrating Lotion');
      expect(product.slug).toBe('cerave-hydrating-lotion');
      expect(product.brand.id).toBe(ceraveBrandId);
      expect(product.productLine?.id).toBe(ceraveProductLineId);
      expect(product.category?.id).toBe(moisturizersCategoryId);

      createdProductId = product.id;
    });

    it('should reject creating product when brand does not exist', async () => {
      await expect(
        productViewController.createProduct({
          name: 'Invalid Brand Product',
          brandId: '00000000-0000-0000-0000-000000000000',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject product creation when productLine does not belong to the brand', async () => {
      // Trying to attach LRP's product line to CeraVe brand
      await expect(
        productViewController.createProduct({
          name: 'Mismatched Line Product',
          brandId: ceraveBrandId,
          productLineId: lrpProductLineId,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject product creation when category does not exist', async () => {
      await expect(
        productViewController.createProduct({
          name: 'Invalid Category Product',
          brandId: ceraveBrandId,
          categoryId: '00000000-0000-0000-0000-000000000000',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject product creation with duplicate slug', async () => {
      await expect(
        productViewController.createProduct({
          name: 'Hydrating Lotion Duplicate',
          brandId: ceraveBrandId,
          slug: 'cerave-hydrating-lotion',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should update product details and maintain data integrity', async () => {
      const updated = await productViewController.updateProduct(createdProductId, {
        description: 'Updated lotion description',
        slug: 'updated-lotion-slug',
        isPublished: false,
      });

      expect(updated.description).toBe('Updated lotion description');
      expect(updated.slug).toBe('updated-lotion-slug');
      expect(updated.isPublished).toBe(false);
    });

    it('should throw NotFoundException when updating non-existent product', async () => {
      await expect(
        productViewController.updateProduct('00000000-0000-0000-0000-000000000000', {
          name: 'Non Existent',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('SKU Management APIs', () => {
    let productId: string;
    let createdSkuId: string;

    beforeAll(async () => {
      const p = await prisma.product.findFirst({ where: { slug: 'updated-lotion-slug' } });
      productId = p!.id;
    });

    it('should create a SKU for a product with valid code and barcode', async () => {
      const sku = await productViewController.createSku(productId, {
        code: 'TEST-SKU-236',
        variantName: '236ml Bottle',
        size: 236,
        sizeUnit: 'ml',
        barcode: '9999000111222',
        isActive: true,
      });

      expect(sku).toBeDefined();
      expect(sku.id).toBeDefined();
      expect(sku.code).toBe('TEST-SKU-236');
      expect(sku.variantName).toBe('236ml Bottle');
      expect(sku.size).toBe(236);
      expect(sku.barcode).toBe('9999000111222');

      createdSkuId = sku.id;
    });

    it('should reject SKU creation with duplicate code', async () => {
      await expect(
        productViewController.createSku(productId, {
          code: 'TEST-SKU-236',
          variantName: 'Duplicate Code Variant',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject SKU creation with duplicate barcode', async () => {
      await expect(
        productViewController.createSku(productId, {
          code: 'ANOTHER-CODE-999',
          variantName: 'Duplicate Barcode Variant',
          barcode: '9999000111222',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should list SKUs belonging to a product', async () => {
      const skus = await productViewController.listProductSkus(productId);

      expect(skus.length).toBeGreaterThan(0);
      expect(skus.some((s) => s.id === createdSkuId)).toBe(true);
    });

    it('should update SKU variant name and size', async () => {
      const updated = await productViewController.updateSku(createdSkuId, {
        variantName: '236ml Pump Bottle',
        size: 250,
      });

      expect(updated.variantName).toBe('236ml Pump Bottle');
      expect(updated.size).toBe(250);
    });

    it('should throw NotFoundException for non-existent SKU update', async () => {
      await expect(
        productViewController.updateSku('00000000-0000-0000-0000-000000000000', {
          variantName: 'None',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('ProductMedia Management APIs', () => {
    let productId: string;
    let firstMediaId: string;
    let secondMediaId: string;

    beforeAll(async () => {
      const p = await prisma.product.findFirst({ where: { slug: 'updated-lotion-slug' } });
      productId = p!.id;
    });

    it('should add primary media with verified origin to a product', async () => {
      const media = await productViewController.addProductMedia(productId, {
        type: MediaType.image,
        url: 'https://example.com/lotion-front.jpg',
        altText: 'Front bottle shot',
        sortOrder: 1,
        isPrimary: true,
        originType: MediaOriginType.verified,
      });

      expect(media).toBeDefined();
      expect(media.id).toBeDefined();
      expect(media.type).toBe('image');
      expect(media.isPrimary).toBe(true);
      expect(media.originType).toBe('verified');

      firstMediaId = media.id;
    });

    it('should add second media and reset primary status when second is marked primary', async () => {
      const media2 = await productViewController.addProductMedia(productId, {
        type: MediaType.image,
        url: 'https://example.com/lotion-back.jpg',
        altText: 'Back label shot',
        sortOrder: 2,
        isPrimary: true,
        originType: MediaOriginType.verified,
      });

      expect(media2.isPrimary).toBe(true);
      secondMediaId = media2.id;

      // Verify that the first media is no longer primary
      const allMedia = await productViewController.listProductMedia(productId);
      const first = allMedia.find((m) => m.id === firstMediaId);
      const second = allMedia.find((m) => m.id === secondMediaId);

      expect(first?.isPrimary).toBe(false);
      expect(second?.isPrimary).toBe(true);
    });

    it('should update media metadata and sort order', async () => {
      const updated = await productViewController.updateMedia(firstMediaId, {
        altText: 'Updated front bottle shot',
        sortOrder: 0,
      });

      expect(updated.altText).toBe('Updated front bottle shot');
      expect(updated.sortOrder).toBe(0);
    });

    it('should delete a media item and return no content', async () => {
      await productViewController.deleteMedia(secondMediaId);

      const allMedia = await productViewController.listProductMedia(productId);
      expect(allMedia.some((m) => m.id === secondMediaId)).toBe(false);
    });

    it('should throw NotFoundException when deleting non-existent media', async () => {
      await expect(
        productViewController.deleteMedia('00000000-0000-0000-0000-000000000000'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
