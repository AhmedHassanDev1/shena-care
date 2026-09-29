import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, ConflictException, NotFoundException } from '@nestjs/common';
import { DatabaseModule } from '../../src/platform/database/database.module';
import { CatalogModule } from '../../src/modules/catalog/public';
import { CommerceModule } from '../../src/modules/commerce/public';
import { CompositionModule } from '../../src/application/composition/composition.module';
import { BrandController } from '../../src/application/composition/controllers/brand.controller';
import { PrismaService } from '../../src/platform/database/prisma.service';

describe('Brand & ProductLine Management (e2e)', () => {
  let app: INestApplication;
  let brandController: BrandController;
  let prisma: PrismaService;

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

    brandController = moduleFixture.get<BrandController>(BrandController);
    prisma = moduleFixture.get<PrismaService>(PrismaService);

    await app.init();
  });

  afterAll(async () => {
    // Cleanup any created test entities
    await prisma.productLine.deleteMany({
      where: {
        slug: {
          in: [
            'test-brand-daily-care',
            'test-brand-night-care',
            'updated-line-slug',
          ],
        },
      },
    });
    await prisma.brand.deleteMany({
      where: {
        slug: {
          in: ['test-brand', 'custom-brand-slug', 'updated-brand-slug'],
        },
      },
    });
    await app.close();
  });

  describe('Brand Management APIs', () => {
    let createdBrandId: string;

    it('should create a new brand with auto-generated slug', async () => {
      const created = await brandController.createBrand({
        name: 'Test Brand',
        description: 'A test brand description',
        websiteUrl: 'https://testbrand.example.com',
        countryOfOrigin: 'Germany',
      });

      expect(created).toBeDefined();
      expect(created.id).toBeDefined();
      expect(created.name).toBe('Test Brand');
      expect(created.slug).toBe('test-brand');
      expect(created.countryOfOrigin).toBe('Germany');
      expect(created.isActive).toBe(true);

      createdBrandId = created.id;
    });

    it('should create a brand with a custom slug', async () => {
      const created = await brandController.createBrand({
        name: 'Custom Slug Brand',
        slug: 'custom-brand-slug',
      });

      expect(created.slug).toBe('custom-brand-slug');
    });

    it('should reject brand creation with duplicate name', async () => {
      await expect(
        brandController.createBrand({
          name: 'Test Brand',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject brand creation with duplicate slug', async () => {
      await expect(
        brandController.createBrand({
          name: 'Different Name',
          slug: 'test-brand',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should retrieve the created brand by id or slug', async () => {
      const bySlug = await brandController.getBrand('test-brand');
      expect(bySlug).toBeDefined();
      expect(bySlug.name).toBe('Test Brand');

      const byId = await brandController.getBrand(createdBrandId);
      expect(byId).toBeDefined();
      expect(byId.id).toBe(createdBrandId);
    });

    it('should update brand details and recalculate slug if requested', async () => {
      const updated = await brandController.updateBrand(createdBrandId, {
        description: 'Updated brand description',
        slug: 'updated-brand-slug',
        isActive: false,
      });

      expect(updated.description).toBe('Updated brand description');
      expect(updated.slug).toBe('updated-brand-slug');
      expect(updated.isActive).toBe(false);

      // Verify that getBrands(false) hides inactive by default, but includeInactive=true shows it
      const activeBrands = await brandController.listBrands();
      expect(activeBrands.some((b) => b.id === createdBrandId)).toBe(false);

      const allBrands = await brandController.listBrands('true');
      expect(allBrands.some((b) => b.id === createdBrandId)).toBe(true);
    });

    it('should throw NotFoundException when updating non-existent brand', async () => {
      await expect(
        brandController.updateBrand('00000000-0000-0000-0000-000000000000', {
          name: 'Non Existent',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('ProductLine Management APIs', () => {
    let testBrandId: string;
    let createdLineId: string;

    beforeAll(async () => {
      // Re-activate test brand or find an active brand
      const brand = await prisma.brand.findFirst({ where: { slug: 'cerave' } });
      testBrandId = brand!.id;
    });

    it('should create a product line under a brand', async () => {
      const line = await brandController.createProductLine(testBrandId, {
        name: 'Daily Care',
        slug: 'test-brand-daily-care',
        description: 'Daily care product line',
      });

      expect(line).toBeDefined();
      expect(line.id).toBeDefined();
      expect(line.name).toBe('Daily Care');
      expect(line.slug).toBe('test-brand-daily-care');
      expect(line.brandId).toBe(testBrandId);

      createdLineId = line.id;
    });

    it('should reject creating a product line under non-existent brand', async () => {
      await expect(
        brandController.createProductLine('00000000-0000-0000-0000-000000000000', {
          name: 'Orphan Line',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject product line with duplicate slug', async () => {
      await expect(
        brandController.createProductLine(testBrandId, {
          name: 'Another Line',
          slug: 'test-brand-daily-care',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should list product lines for a given brand', async () => {
      const lines = await brandController.listProductLines(testBrandId);

      expect(lines.length).toBeGreaterThan(0);
      expect(lines.some((l) => l.id === createdLineId)).toBe(true);
    });

    it('should retrieve a single product line by id', async () => {
      const line = await brandController.getProductLine(createdLineId);

      expect(line).toBeDefined();
      expect(line.id).toBe(createdLineId);
      expect(line.name).toBe('Daily Care');
    });

    it('should update a product line', async () => {
      const updated = await brandController.updateProductLine(createdLineId, {
        description: 'New line description',
        slug: 'updated-line-slug',
      });

      expect(updated.description).toBe('New line description');
      expect(updated.slug).toBe('updated-line-slug');
    });

    it('should throw NotFoundException for non-existent product line', async () => {
      await expect(
        brandController.getProductLine('00000000-0000-0000-0000-000000000000'),
      ).rejects.toThrow(NotFoundException);

      await expect(
        brandController.updateProductLine('00000000-0000-0000-0000-000000000000', {
          name: 'None',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
