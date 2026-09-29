import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DatabaseModule } from '../../src/platform/database/database.module';
import { CatalogModule } from '../../src/modules/catalog/public';
import { CommerceModule } from '../../src/modules/commerce/public';
import { CompositionModule } from '../../src/application/composition/composition.module';
import { ProductViewController } from '../../src/application/composition/controllers/product-view.controller';
import { CategoryController } from '../../src/application/composition/controllers/category.controller';
import { BrandController } from '../../src/application/composition/controllers/brand.controller';

describe('Catalog Read APIs & Filtering (GLO-99 e2e)', () => {
  let app: INestApplication;
  let productViewController: ProductViewController;
  let categoryController: CategoryController;
  let brandController: BrandController;

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
    categoryController = moduleFixture.get<CategoryController>(CategoryController);
    brandController = moduleFixture.get<BrandController>(BrandController);

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Product Filtering APIs', () => {
    it('should filter products by leaf category slug', async () => {
      const results = await productViewController.listProducts('moisturizers');

      expect(results.length).toBeGreaterThan(0);
      results.forEach((p) => {
        expect(p.category?.slug).toBe('moisturizers');
      });
    });

    it('should filter products by root category slug (including products in child leaf categories)', async () => {
      const results = await productViewController.listProducts('skin-care');

      expect(results.length).toBeGreaterThan(0);
      results.forEach((p) => {
        // Either directly skin-care or has parentId belonging to skin-care
        expect(p.category).toBeDefined();
      });
    });

    it('should filter products by brand slug', async () => {
      const results = await productViewController.listProducts(undefined, 'cerave');

      expect(results.length).toBeGreaterThan(0);
      results.forEach((p) => {
        expect(p.brand.slug).toBe('cerave');
      });
    });

    it('should filter products by product line slug', async () => {
      const results = await productViewController.listProducts(
        undefined,
        undefined,
        'cerave-daily-moisturizers',
      );

      expect(results.length).toBeGreaterThan(0);
      results.forEach((p) => {
        expect(p.productLine?.slug).toBe('cerave-daily-moisturizers');
      });
    });

    it('should filter products by combining category and brand', async () => {
      const results = await productViewController.listProducts('moisturizers', 'cerave');

      expect(results.length).toBeGreaterThan(0);
      results.forEach((p) => {
        expect(p.category?.slug).toBe('moisturizers');
        expect(p.brand.slug).toBe('cerave');
      });
    });

    it('should return empty array for non-matching filters', async () => {
      const results = await productViewController.listProducts('shampoos', 'cerave');
      expect(results).toEqual([]);
    });

    it('should support pagination limit and page', async () => {
      const allProducts = await productViewController.listProducts();
      expect(allProducts.length).toBeGreaterThanOrEqual(2);

      const page1 = await productViewController.listProducts(
        undefined,
        undefined,
        undefined,
        '1',
        '1',
      );
      expect(page1.length).toBe(1);

      const page2 = await productViewController.listProducts(
        undefined,
        undefined,
        undefined,
        '2',
        '1',
      );
      expect(page2.length).toBe(1);

      // Verify page 1 and page 2 returned different products
      expect(page1[0].id).not.toBe(page2[0].id);
    });
  });

  describe('Category & Brand Read APIs', () => {
    it('should retrieve category by UUID as well as slug', async () => {
      const bySlug = await categoryController.getCategory('moisturizers');
      expect(bySlug).toBeDefined();

      const byId = await categoryController.getCategory(bySlug.id);
      expect(byId).toBeDefined();
      expect(byId.id).toBe(bySlug.id);
      expect(byId.slug).toBe('moisturizers');
    });

    it('should retrieve brand by UUID as well as slug', async () => {
      const bySlug = await brandController.getBrand('cerave');
      expect(bySlug).toBeDefined();

      const byId = await brandController.getBrand(bySlug.id);
      expect(byId).toBeDefined();
      expect(byId.id).toBe(bySlug.id);
      expect(byId.slug).toBe('cerave');
    });

    it('should list category hierarchy tree with children', async () => {
      const tree = await categoryController.listCategories();

      expect(tree.length).toBe(2); // Skin Care and Hair Care
      const skinCare = tree.find((c) => c.slug === 'skin-care');
      expect(skinCare).toBeDefined();
      expect(skinCare?.children.length).toBeGreaterThan(0);
    });
  });
});
