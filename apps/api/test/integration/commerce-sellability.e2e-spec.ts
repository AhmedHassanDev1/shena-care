import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DatabaseModule } from '../../src/platform/database/database.module';
import { CatalogModule, CatalogService } from '../../src/modules/catalog/public';
import { CommerceModule, CommerceService } from '../../src/modules/commerce/public';
import { PrismaService } from '../../src/platform/database/prisma.service';

describe('Commerce Sellability Evaluation (GLO-101 e2e)', () => {
  let app: INestApplication;
  let commerceService: CommerceService;
  let catalogService: CatalogService;
  let prisma: PrismaService;

  // Track created test IDs for thorough cleanup
  const createdProductIds: string[] = [];
  const createdSkuIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [DatabaseModule, CatalogModule, CommerceModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    commerceService = moduleFixture.get<CommerceService>(CommerceService);
    catalogService = moduleFixture.get<CatalogService>(CatalogService);
    prisma = moduleFixture.get<PrismaService>(PrismaService);

    await app.init();
  });

  afterAll(async () => {
    // Clean up created test data
    if (createdSkuIds.length > 0) {
      await prisma.sellingPrice.deleteMany({
        where: { skuId: { in: createdSkuIds } },
      });
      await prisma.listing.deleteMany({
        where: { skuId: { in: createdSkuIds } },
      });
      await prisma.sku.deleteMany({
        where: { id: { in: createdSkuIds } },
      });
    }

    if (createdProductIds.length > 0) {
      await prisma.productMedia.deleteMany({
        where: { productId: { in: createdProductIds } },
      });
      await prisma.product.deleteMany({
        where: { id: { in: createdProductIds } },
      });
    }

    await app.close();
  });

  describe('Positive Path: Active & Sellable SKU', () => {
    it('should evaluate seeded active SKU as SELLABLE with active price and listed state', async () => {
      const product = await catalogService.getPublishedProduct('cerave-moisturizing-cream');
      expect(product).toBeDefined();
      const skuId = product!.skus[0].id;

      const evaluation = await commerceService.evaluateSellability(skuId);

      expect(evaluation.skuId).toBe(skuId);
      expect(evaluation.isSellable).toBe(true);
      expect(evaluation.reason).toBe('SELLABLE');
      expect(evaluation.message).toContain('commercially sellable');
      expect(evaluation.terms).toBeDefined();
      expect(evaluation.terms?.isListed).toBe(true);
      expect(evaluation.terms?.canOrder).toBe(true);
      expect(evaluation.terms?.price).toBeDefined();
      expect(evaluation.terms?.price?.amount).toBe(15.99);
      expect(evaluation.terms?.price?.currency).toBe('USD');

      const isSellable = await commerceService.isSellable(skuId);
      expect(isSellable).toBe(true);
    });
  });

  describe('Validation Path: Invalid UUID Format', () => {
    it('should return INVALID_SKU_ID when skuId is not a valid UUID', async () => {
      const evaluation = await commerceService.evaluateSellability('not-a-valid-uuid');

      expect(evaluation.isSellable).toBe(false);
      expect(evaluation.reason).toBe('INVALID_SKU_ID');
      expect(evaluation.terms).toBeNull();

      const isSellable = await commerceService.isSellable('not-a-valid-uuid');
      expect(isSellable).toBe(false);
    });
  });

  describe('Catalog Boundary: SKU Existence & State', () => {
    it('should return SKU_NOT_FOUND when SKU does not exist in Catalog', async () => {
      const nonExistentSkuId = '00000000-0000-0000-0000-000000000099';

      const evaluation = await commerceService.evaluateSellability(nonExistentSkuId);

      expect(evaluation.isSellable).toBe(false);
      expect(evaluation.reason).toBe('SKU_NOT_FOUND');
      expect(evaluation.message).toContain('does not exist in Catalog');
      expect(evaluation.terms).toBeNull();
    });

    it('should return SKU_INACTIVE when SKU is marked inactive in Catalog', async () => {
      const brand = await prisma.brand.findFirst();
      const category = await prisma.category.findFirst({ where: { parentId: { not: null } } });

      const product = await prisma.product.create({
        data: {
          brandId: brand!.id,
          categoryId: category!.id,
          name: 'Inactive SKU Test Product',
          slug: 'inactive-sku-test-product',
          isPublished: true,
        },
      });
      createdProductIds.push(product.id);

      const inactiveSku = await prisma.sku.create({
        data: {
          productId: product.id,
          code: 'TEST-INACTIVE-SKU-01',
          variantName: 'Inactive Size',
          isActive: false,
        },
      });
      createdSkuIds.push(inactiveSku.id);

      // Create listing and active price in Commerce
      await commerceService.createListing(inactiveSku.id);
      await commerceService.createSellingPrice(inactiveSku.id, 150, 'EGP');

      const evaluation = await commerceService.evaluateSellability(inactiveSku.id);

      expect(evaluation.isSellable).toBe(false);
      expect(evaluation.reason).toBe('SKU_INACTIVE');
      expect(evaluation.message).toContain('inactive in Catalog');

      // getSellingTerms should also disallow ordering
      const terms = await commerceService.getSellingTerms(inactiveSku.id);
      expect(terms?.canOrder).toBe(false);
    });

    it('should return SKU_INACTIVE when parent Product is not published', async () => {
      const brand = await prisma.brand.findFirst();
      const category = await prisma.category.findFirst({ where: { parentId: { not: null } } });

      const unpublishedProduct = await prisma.product.create({
        data: {
          brandId: brand!.id,
          categoryId: category!.id,
          name: 'Unpublished Product Test',
          slug: 'unpublished-product-test',
          isPublished: false,
        },
      });
      createdProductIds.push(unpublishedProduct.id);

      const activeSku = await prisma.sku.create({
        data: {
          productId: unpublishedProduct.id,
          code: 'TEST-UNPUB-SKU-01',
          variantName: 'Standard',
          isActive: true,
        },
      });
      createdSkuIds.push(activeSku.id);

      await commerceService.createListing(activeSku.id);
      await commerceService.createSellingPrice(activeSku.id, 200, 'EGP');

      const evaluation = await commerceService.evaluateSellability(activeSku.id);

      expect(evaluation.isSellable).toBe(false);
      expect(evaluation.reason).toBe('SKU_INACTIVE');
      expect(evaluation.message).toContain('not published');
    });
  });

  describe('Commerce Listing State', () => {
    it('should return LISTING_NOT_FOUND when SKU has no listing record', async () => {
      const brand = await prisma.brand.findFirst();
      const product = await prisma.product.create({
        data: {
          brandId: brand!.id,
          name: 'No Listing Test Product',
          slug: 'no-listing-test-product',
          isPublished: true,
        },
      });
      createdProductIds.push(product.id);

      const sku = await prisma.sku.create({
        data: {
          productId: product.id,
          code: 'TEST-NO-LISTING-SKU',
          variantName: '50ml',
          isActive: true,
        },
      });
      createdSkuIds.push(sku.id);

      const evaluation = await commerceService.evaluateSellability(sku.id);

      expect(evaluation.isSellable).toBe(false);
      expect(evaluation.reason).toBe('LISTING_NOT_FOUND');
      expect(evaluation.terms).toBeNull();
    });

    it('should return NOT_LISTED when SKU listing has isListed = false', async () => {
      const brand = await prisma.brand.findFirst();
      const product = await prisma.product.create({
        data: {
          brandId: brand!.id,
          name: 'Unlisted Test Product',
          slug: 'unlisted-test-product',
          isPublished: true,
        },
      });
      createdProductIds.push(product.id);

      const sku = await prisma.sku.create({
        data: {
          productId: product.id,
          code: 'TEST-UNLISTED-SKU',
          variantName: '100ml',
          isActive: true,
        },
      });
      createdSkuIds.push(sku.id);

      // Create unlisted listing + valid price
      await prisma.listing.create({
        data: {
          skuId: sku.id,
          isListed: false,
          unlistedAt: new Date(),
        },
      });
      await commerceService.createSellingPrice(sku.id, 350, 'EGP');

      const evaluation = await commerceService.evaluateSellability(sku.id);

      expect(evaluation.isSellable).toBe(false);
      expect(evaluation.reason).toBe('NOT_LISTED');
      expect(evaluation.terms).toBeDefined();
      expect(evaluation.terms?.isListed).toBe(false);
      expect(evaluation.terms?.canOrder).toBe(false);
      expect(evaluation.terms?.price?.amount).toBe(350);

      // getSellingTerms backward compatibility
      const terms = await commerceService.getSellingTerms(sku.id);
      expect(terms?.isListed).toBe(false);
      expect(terms?.canOrder).toBe(false);
    });
  });

  describe('Commerce SellingPrice Rules', () => {
    let priceTestSkuId: string;

    beforeAll(async () => {
      const brand = await prisma.brand.findFirst();
      const product = await prisma.product.create({
        data: {
          brandId: brand!.id,
          name: 'Price Rules Test Product',
          slug: 'price-rules-test-product',
          isPublished: true,
        },
      });
      createdProductIds.push(product.id);

      const sku = await prisma.sku.create({
        data: {
          productId: product.id,
          code: 'TEST-PRICE-RULES-SKU',
          variantName: 'Default',
          isActive: true,
        },
      });
      createdSkuIds.push(sku.id);
      priceTestSkuId = sku.id;

      // Create active listing
      await commerceService.createListing(sku.id);
    });

    it('should return PRICE_NOT_FOUND when no selling prices exist for SKU', async () => {
      const evaluation = await commerceService.evaluateSellability(priceTestSkuId);

      expect(evaluation.isSellable).toBe(false);
      expect(evaluation.reason).toBe('PRICE_NOT_FOUND');
      expect(evaluation.terms?.price).toBeNull();
      expect(evaluation.terms?.canOrder).toBe(false);
    });

    it('should return PRICE_EXPIRED when price validUntil is in the past', async () => {
      const pastFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
      const pastUntil = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);  // 2 days ago

      const expiredPrice = await prisma.sellingPrice.create({
        data: {
          skuId: priceTestSkuId,
          amount: 250,
          currency: 'EGP',
          validFrom: pastFrom,
          validUntil: pastUntil,
          isActive: true,
        },
      });

      const evaluation = await commerceService.evaluateSellability(priceTestSkuId);

      expect(evaluation.isSellable).toBe(false);
      expect(evaluation.reason).toBe('PRICE_EXPIRED');
      expect(evaluation.message).toContain('expired');

      // Clean up the expired price for next test
      await prisma.sellingPrice.delete({ where: { id: expiredPrice.id } });
    });

    it('should return PRICE_EXPIRED when price validFrom is in the future', async () => {
      const futureFrom = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // 5 days from now

      const futurePrice = await prisma.sellingPrice.create({
        data: {
          skuId: priceTestSkuId,
          amount: 300,
          currency: 'EGP',
          validFrom: futureFrom,
          isActive: true,
        },
      });

      const evaluation = await commerceService.evaluateSellability(priceTestSkuId);

      expect(evaluation.isSellable).toBe(false);
      expect(evaluation.reason).toBe('PRICE_EXPIRED');

      // Clean up
      await prisma.sellingPrice.delete({ where: { id: futurePrice.id } });
    });

    it('should return PRICE_INACTIVE when selling price isActive = false', async () => {
      const inactivePrice = await prisma.sellingPrice.create({
        data: {
          skuId: priceTestSkuId,
          amount: 320,
          currency: 'EGP',
          validFrom: new Date(Date.now() - 10000),
          isActive: false,
        },
      });

      const evaluation = await commerceService.evaluateSellability(priceTestSkuId);

      expect(evaluation.isSellable).toBe(false);
      expect(evaluation.reason).toBe('PRICE_INACTIVE');
      expect(evaluation.message).toContain('inactive');

      // Clean up
      await prisma.sellingPrice.delete({ where: { id: inactivePrice.id } });
    });

    it('should resolve current active price when historical expired price also exists', async () => {
      // Create old expired price
      await prisma.sellingPrice.create({
        data: {
          skuId: priceTestSkuId,
          amount: 200,
          currency: 'EGP',
          validFrom: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
          validUntil: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          isActive: true,
        },
      });

      // Create new currently active price
      await prisma.sellingPrice.create({
        data: {
          skuId: priceTestSkuId,
          amount: 275,
          currency: 'EGP',
          compareAtAmount: 320,
          validFrom: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
          validUntil: null,
          isActive: true,
        },
      });

      const evaluation = await commerceService.evaluateSellability(priceTestSkuId);

      expect(evaluation.isSellable).toBe(true);
      expect(evaluation.reason).toBe('SELLABLE');
      expect(evaluation.terms?.price?.amount).toBe(275);
      expect(evaluation.terms?.price?.compareAtAmount).toBe(320);
      expect(evaluation.terms?.canOrder).toBe(true);
    });
  });
});
