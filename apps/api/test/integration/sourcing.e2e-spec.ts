import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, NotFoundException, ConflictException } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { CatalogService } from '../../src/modules/catalog/public';
import { SupplierController } from '../../src/application/composition/controllers/supplier.controller';

describe('Sourcing Management (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let catalogService: CatalogService;
  let supplierController: SupplierController;

  let testBrandId: string;
  let testCategoryId: string;
  let testProductId: string;
  let testSkuId: string;
  let supplierId: string;
  let offerId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    catalogService = app.get<CatalogService>(CatalogService);
    supplierController = app.get<SupplierController>(SupplierController);

    // Use seed data
    const product = await catalogService.getPublishedProduct('cerave-moisturizing-cream');
    testSkuId = product?.skus[0]?.id as string;
    
    // Clean only sourcing tables
    await prisma.supplierOffer.deleteMany();
    await prisma.supplier.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Supplier Management', () => {
    it('should create a new supplier', async () => {
      const response = await supplierController.createSupplier({
        name: 'Global Meds',
        slug: 'global-meds',
      });

      expect(response).toMatchObject({
        name: 'Global Meds',
        slug: 'global-meds',
        isActive: true,
      });
      supplierId = response.id;
    });

    it('should fail to create supplier with duplicate name', async () => {
      await expect(
        supplierController.createSupplier({
          name: 'Global Meds',
          slug: 'global-meds-2',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should get suppliers list', async () => {
      const response = await supplierController.getSuppliers();

      expect(Array.isArray(response)).toBe(true);
      expect(response.length).toBeGreaterThanOrEqual(1);
    });

    it('should get supplier by ID', async () => {
      const response = await supplierController.getSupplier(supplierId);

      expect(response.id).toBe(supplierId);
      expect(response.name).toBe('Global Meds');
    });

    it('should update supplier', async () => {
      const response = await supplierController.updateSupplier(supplierId, {
        isActive: false,
      });

      expect(response.isActive).toBe(false);
    });
  });

  describe('Supplier Offer Management', () => {
    it('should create a supplier offer', async () => {
      const response = await supplierController.createOffer({
        supplierId,
        skuId: testSkuId,
        costPrice: 50.0,
        currency: 'EGP',
      });

      expect(response).toMatchObject({
        supplierId,
        skuId: testSkuId,
        costPrice: 50,
        currency: 'EGP',
        isAvailable: true,
      });
      offerId = response.id;
    });

    it('should fail to create offer for non-existent SKU', async () => {
      await expect(
        supplierController.createOffer({
          supplierId,
          skuId: '00000000-0000-0000-0000-000000000000',
          costPrice: 50.0,
          currency: 'EGP',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should get supplier offers by skuId', async () => {
      const response = await supplierController.getOffers(undefined, testSkuId);

      expect(Array.isArray(response)).toBe(true);
      expect(response.length).toBe(1);
      expect(response[0].id).toBe(offerId);
    });

    it('should update supplier offer cost', async () => {
      const response = await supplierController.updateOffer(offerId, {
        costPrice: 55.5,
      });

      expect(response.costPrice).toBe(55.5);
    });

    it('should confirm offer availability', async () => {
      const response = await supplierController.confirmOfferAvailability(offerId, false);

      expect(response.isAvailable).toBe(false);
      expect(response.lastConfirmedAt).toBeNull();
    });

    it('should update confirmedAt on true availability', async () => {
      const response = await supplierController.confirmOfferAvailability(offerId, true);

      expect(response.isAvailable).toBe(true);
      expect(response.lastConfirmedAt).not.toBeNull();
    });
  });
});
