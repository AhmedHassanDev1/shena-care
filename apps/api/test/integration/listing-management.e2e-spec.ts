import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, NotFoundException } from '@nestjs/common';
import { DatabaseModule } from '../../src/platform/database/database.module';
import { CatalogModule } from '../../src/modules/catalog/public';
import { CommerceModule } from '../../src/modules/commerce/public';
import { CompositionModule } from '../../src/application/composition/composition.module';
import { ListingController } from '../../src/application/composition/controllers/listing.controller';
import { PrismaService } from '../../src/platform/database/prisma.service';

describe('Listing Management APIs (GLO-102 e2e)', () => {
  let app: INestApplication;
  let listingController: ListingController;
  let prisma: PrismaService;

  let testProductId: string;
  let testSkuId1: string;
  let testSkuId2: string;

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

    listingController = moduleFixture.get<ListingController>(ListingController);
    prisma = moduleFixture.get<PrismaService>(PrismaService);

    await app.init();

    // Setup dedicated catalog product and SKUs for listing tests
    const brand = await prisma.brand.findFirst();
    const product = await prisma.product.create({
      data: {
        brandId: brand!.id,
        name: 'Listing Management Test Product',
        slug: 'listing-mgmt-test-product',
        isPublished: true,
      },
    });
    testProductId = product.id;

    const sku1 = await prisma.sku.create({
      data: {
        productId: product.id,
        code: 'TEST-LISTING-SKU-01',
        variantName: '50ml',
        isActive: true,
      },
    });
    testSkuId1 = sku1.id;

    const sku2 = await prisma.sku.create({
      data: {
        productId: product.id,
        code: 'TEST-LISTING-SKU-02',
        variantName: '100ml',
        isActive: true,
      },
    });
    testSkuId2 = sku2.id;
  });

  afterAll(async () => {
    // Cleanup
    await prisma.sellingPrice.deleteMany({
      where: { skuId: { in: [testSkuId1, testSkuId2] } },
    });
    await prisma.listing.deleteMany({
      where: { skuId: { in: [testSkuId1, testSkuId2] } },
    });
    await prisma.sku.deleteMany({
      where: { id: { in: [testSkuId1, testSkuId2] } },
    });
    await prisma.product.deleteMany({
      where: { id: testProductId },
    });

    await app.close();
  });

  describe('POST /commerce/listings — Create Listing', () => {
    it('should create a listing for an existing Catalog SKU', async () => {
      const result = await listingController.createListing({
        skuId: testSkuId1,
        isListed: true,
      });

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.skuId).toBe(testSkuId1);
      expect(result.isListed).toBe(true);
      expect(result.listedAt).toBeInstanceOf(Date);
      expect(result.unlistedAt).toBeNull();
    });

    it('should reject creating listing for non-existent Catalog SKU with NotFoundException', async () => {
      const nonExistentSkuId = '00000000-0000-0000-0000-000000000099';

      await expect(
        listingController.createListing({ skuId: nonExistentSkuId }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should be idempotent when creating listing for already listed SKU', async () => {
      const result = await listingController.createListing({
        skuId: testSkuId1,
        isListed: true,
      });

      expect(result.skuId).toBe(testSkuId1);
      expect(result.isListed).toBe(true);
    });
  });

  describe('GET /commerce/listings/:skuId — Get Single Listing', () => {
    it('should return the listing for a valid SKU', async () => {
      const listing = await listingController.getListing(testSkuId1);

      expect(listing).toBeDefined();
      expect(listing.skuId).toBe(testSkuId1);
      expect(listing.isListed).toBe(true);
      expect(listing.listedAt).toBeInstanceOf(Date);
    });

    it('should throw NotFoundException for SKU without a listing', async () => {
      await expect(listingController.getListing(testSkuId2)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('PATCH /commerce/listings/:skuId/unlist & /list — Commands', () => {
    it('should unlist a previously listed SKU', async () => {
      const unlisted = await listingController.unlistSku(testSkuId1);

      expect(unlisted.isListed).toBe(false);
      expect(unlisted.unlistedAt).toBeInstanceOf(Date);
    });

    it('should be idempotent when unlisting an already unlisted SKU', async () => {
      const unlistedAgain = await listingController.unlistSku(testSkuId1);

      expect(unlistedAgain.isListed).toBe(false);
    });

    it('should reactivate a listing via list command', async () => {
      const listed = await listingController.listSku(testSkuId1);

      expect(listed.isListed).toBe(true);
      expect(listed.listedAt).toBeInstanceOf(Date);
      expect(listed.unlistedAt).toBeNull();
    });

    it('should be idempotent when listing an already listed SKU', async () => {
      const listedAgain = await listingController.listSku(testSkuId1);

      expect(listedAgain.isListed).toBe(true);
    });

    it('should toggle listing state via PATCH /commerce/listings/:skuId body', async () => {
      // Toggle to false
      const unlisted = await listingController.updateListingStatus(testSkuId1, {
        isListed: false,
      });
      expect(unlisted.isListed).toBe(false);

      // Toggle to true
      const relisted = await listingController.updateListingStatus(testSkuId1, {
        isListed: true,
      });
      expect(relisted.isListed).toBe(true);
    });
  });

  describe('GET /commerce/listings — Query & Filter', () => {
    beforeAll(async () => {
      // Create listing for SKU2 as unlisted
      await listingController.createListing({
        skuId: testSkuId2,
        isListed: false,
      });
    });

    it('should list all listings with pagination', async () => {
      const result = await listingController.getListings({ page: 1, limit: 10 });

      expect(result).toBeDefined();
      expect(result.items.length).toBeGreaterThanOrEqual(2);
      expect(result.total).toBeGreaterThanOrEqual(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    });

    it('should filter listings by isListed=true', async () => {
      const result = await listingController.getListings({ isListed: true });

      expect(result.items.every((i) => i.isListed === true)).toBe(true);
      expect(result.items.some((i) => i.skuId === testSkuId1)).toBe(true);
      expect(result.items.some((i) => i.skuId === testSkuId2)).toBe(false);
    });

    it('should filter listings by isListed=false', async () => {
      const result = await listingController.getListings({ isListed: false });

      expect(result.items.every((i) => i.isListed === false)).toBe(true);
      expect(result.items.some((i) => i.skuId === testSkuId2)).toBe(true);
      expect(result.items.some((i) => i.skuId === testSkuId1)).toBe(false);
    });
  });
});
