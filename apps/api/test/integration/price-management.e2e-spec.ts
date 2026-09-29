import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { DatabaseModule } from '../../src/platform/database/database.module';
import { CatalogModule } from '../../src/modules/catalog/public';
import { CommerceModule } from '../../src/modules/commerce/public';
import { CompositionModule } from '../../src/application/composition/composition.module';
import { PriceController } from '../../src/application/composition/controllers/price.controller';
import { PrismaService } from '../../src/platform/database/prisma.service';

describe('SellingPrice Commands & Price History (GLO-103 e2e)', () => {
  let app: INestApplication;
  let priceController: PriceController;
  let prisma: PrismaService;

  let testProductId: string;
  let testSkuId: string;

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

    priceController = moduleFixture.get<PriceController>(PriceController);
    prisma = moduleFixture.get<PrismaService>(PrismaService);

    await app.init();

    // Create dedicated product and SKU
    const brand = await prisma.brand.findFirst();
    const product = await prisma.product.create({
      data: {
        brandId: brand!.id,
        name: 'Price Command Test Product',
        slug: 'price-cmd-test-product',
        isPublished: true,
      },
    });
    testProductId = product.id;

    const sku = await prisma.sku.create({
      data: {
        productId: product.id,
        code: 'TEST-PRICE-CMD-SKU',
        variantName: '50ml Jar',
        isActive: true,
      },
    });
    testSkuId = sku.id;
  });

  afterAll(async () => {
    await prisma.sellingPrice.deleteMany({
      where: { skuId: testSkuId },
    });
    await prisma.listing.deleteMany({
      where: { skuId: testSkuId },
    });
    await prisma.sku.deleteMany({
      where: { id: testSkuId },
    });
    await prisma.product.deleteMany({
      where: { id: testProductId },
    });

    await app.close();
  });

  describe('POST /commerce/prices — Create SellingPrice', () => {
    it('should create an active selling price with compareAtAmount and currency', async () => {
      const price = await priceController.createSellingPrice({
        skuId: testSkuId,
        amount: 250,
        currency: 'egp',
        compareAtAmount: 300,
        validFrom: new Date(Date.now() - 10000), // started 10s ago
      });

      expect(price).toBeDefined();
      expect(price.id).toBeDefined();
      expect(price.skuId).toBe(testSkuId);
      expect(price.amount).toBe(250);
      expect(price.currency).toBe('EGP');
      expect(price.compareAtAmount).toBe(300);
      expect(price.isActive).toBe(true);
      expect(price.validUntil).toBeNull();
    });

    it('should reject non-existent SKU with NotFoundException', async () => {
      const nonExistentSkuId = '00000000-0000-0000-0000-000000000099';

      await expect(
        priceController.createSellingPrice({
          skuId: nonExistentSkuId,
          amount: 200,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject compareAtAmount lower than amount with BadRequestException', async () => {
      await expect(
        priceController.createSellingPrice({
          skuId: testSkuId,
          amount: 250,
          compareAtAmount: 200, // lower than amount
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject validUntil earlier than validFrom with BadRequestException', async () => {
      const from = new Date(Date.now() + 10000);
      const until = new Date(Date.now() - 10000);

      await expect(
        priceController.createSellingPrice({
          skuId: testSkuId,
          amount: 250,
          validFrom: from,
          validUntil: until,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should prevent conflicting overlapping active intervals with ConflictException', async () => {
      // An active open-ended price already exists from earlier test
      await expect(
        priceController.createSellingPrice({
          skuId: testSkuId,
          amount: 280,
          validFrom: new Date(),
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should auto-close previous open-ended price when autoClosePrevious is true', async () => {
      const newFrom = new Date();
      const newPrice = await priceController.createSellingPrice({
        skuId: testSkuId,
        amount: 270,
        currency: 'EGP',
        validFrom: newFrom,
        autoClosePrevious: true,
      });

      expect(newPrice).toBeDefined();
      expect(newPrice.amount).toBe(270);
      expect(newPrice.isActive).toBe(true);

      // Verify the previous price now has a validUntil set
      const history = await priceController.getPriceHistory(testSkuId);
      expect(history.length).toBe(2);
      const previousPrice = history.find((p) => p.id !== newPrice.id);
      expect(previousPrice?.validUntil).not.toBeNull();
    });
  });

  describe('GET /commerce/prices/skus/:skuId/current — Current Price Resolution', () => {
    it('should deterministically resolve the currently active price', async () => {
      const current = await priceController.getCurrentPrice(testSkuId);

      expect(current).toBeDefined();
      expect(current.amount).toBe(270);
      expect(current.isActive).toBe(true);
    });

    it('should throw NotFoundException if no active price exists for SKU', async () => {
      const brand = await prisma.brand.findFirst();
      const product = await prisma.product.create({
        data: {
          brandId: brand!.id,
          name: 'No Price Product',
          slug: 'no-price-product',
          isPublished: true,
        },
      });
      const noPriceSku = await prisma.sku.create({
        data: {
          productId: product.id,
          code: 'TEST-NO-PRICE-SKU',
          variantName: 'Sample',
          isActive: true,
        },
      });

      await expect(priceController.getCurrentPrice(noPriceSku.id)).rejects.toThrow(
        NotFoundException,
      );

      // Clean up
      await prisma.sku.delete({ where: { id: noPriceSku.id } });
      await prisma.product.delete({ where: { id: product.id } });
    });
  });

  describe('GET /commerce/prices/skus/:skuId — Price History', () => {
    it('should return chronological price history ordered by validFrom desc', async () => {
      const history = await priceController.getPriceHistory(testSkuId);

      expect(history.length).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < history.length - 1; i++) {
        expect(new Date(history[i].validFrom).getTime()).toBeGreaterThanOrEqual(
          new Date(history[i + 1].validFrom).getTime(),
        );
      }
    });
  });

  describe('PATCH /commerce/prices/:id & :id/deactivate', () => {
    it('should update price amount and compareAtAmount', async () => {
      const current = await priceController.getCurrentPrice(testSkuId);

      const updated = await priceController.updateSellingPrice(current.id, {
        amount: 290,
        compareAtAmount: 350,
      });

      expect(updated.amount).toBe(290);
      expect(updated.compareAtAmount).toBe(350);
    });

    it('should deactivate price via PATCH /commerce/prices/:id/deactivate', async () => {
      const current = await priceController.getCurrentPrice(testSkuId);

      const deactivated = await priceController.deactivateSellingPrice(current.id);
      expect(deactivated.isActive).toBe(false);

      // Verify it is no longer returned by getCurrentPrice
      await expect(priceController.getCurrentPrice(testSkuId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
