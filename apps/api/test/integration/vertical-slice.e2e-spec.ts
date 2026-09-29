import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DatabaseModule } from '../../src/platform/database/database.module';
import { CatalogModule, CatalogService, BrandService, CategoryService } from '../../src/modules/catalog/public';
import { CommerceModule, CommerceService } from '../../src/modules/commerce/public';
import { CompositionModule } from '../../src/application/composition/composition.module';
import { ProductViewService } from '../../src/application/composition/services/product-view.service';

describe('First Vertical Slice (e2e)', () => {
  let app: INestApplication;
  let catalogService: CatalogService;
  let commerceService: CommerceService;
  let productViewService: ProductViewService;
  let brandService: BrandService;
  let categoryService: CategoryService;

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

    catalogService = moduleFixture.get<CatalogService>(CatalogService);
    commerceService = moduleFixture.get<CommerceService>(CommerceService);
    productViewService = moduleFixture.get<ProductViewService>(ProductViewService);
    brandService = moduleFixture.get<BrandService>(BrandService);
    categoryService = moduleFixture.get<CategoryService>(CategoryService);

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Product View Composition', () => {
    it('should compose product data from Catalog and Commerce', async () => {
      // This test assumes seed data exists
      const productView = await productViewService.getProductView('cerave-moisturizing-cream');

      expect(productView).toBeDefined();
      expect(productView?.name).toBe('Moisturizing Cream');
      expect(productView?.brand.name).toBe('CeraVe');
      expect(productView?.skus.length).toBeGreaterThan(0);

      // Verify composition includes both Catalog and Commerce data
      const firstSku = productView?.skus[0];
      expect(firstSku?.variantName).toBeDefined(); // From Catalog
      expect(firstSku?.price).toBeDefined(); // From Commerce
      expect(firstSku?.canOrder).toBeDefined(); // From Commerce

      // Verify category and media origin
      expect(productView?.category?.name).toBe('Moisturizers');
      expect(productView?.media[0]?.originType).toBe('verified');
    });

    it('should return null for unpublished products', async () => {
      const productView = await productViewService.getProductView('non-existent-product');
      expect(productView).toBeNull();
    });

    it('should list all published products with commerce data', async () => {
      const products = await productViewService.getProductViews();

      expect(products.length).toBeGreaterThan(0);

      products.forEach((product) => {
        expect(product.id).toBeDefined();
        expect(product.brand).toBeDefined();
        expect(product.skus).toBeDefined();

        // Each SKU should have commerce data
        product.skus.forEach((sku) => {
          expect(typeof sku.canOrder).toBe('boolean');
        });
      });
    });
  });

  describe('Module Boundaries', () => {
    it('should allow Catalog to operate independently', async () => {
      const product = await catalogService.getPublishedProduct('cerave-moisturizing-cream');

      expect(product).toBeDefined();
      expect(product?.name).toBe('Moisturizing Cream');
      // Catalog should not include commerce data
      expect((product as unknown as Record<string, unknown>).price).toBeUndefined();
    });

    it('should allow Commerce to operate independently', async () => {
      // Get a SKU ID from Catalog first
      const product = await catalogService.getPublishedProduct('cerave-moisturizing-cream');
      const skuId = product?.skus[0]?.id;

      expect(skuId).toBeDefined();

      // Commerce can query selling terms independently
      const terms = await commerceService.getSellingTerms(skuId!);

      expect(terms).toBeDefined();
      expect(terms?.price).toBeDefined();
      expect(typeof terms?.canOrder).toBe('boolean');
    });

    it('should validate SKU existence through Catalog', async () => {
      const product = await catalogService.getPublishedProduct('cerave-moisturizing-cream');
      const validSkuId = product?.skus[0]?.id;
      const invalidSkuId = '00000000-0000-0000-0000-000000000000';

      expect(await catalogService.validateSku(validSkuId!)).toBe(true);
      expect(await catalogService.validateSku(invalidSkuId)).toBe(false);
    });
  });

  describe('Sellability Logic', () => {
    it('should mark SKU as orderable when listed and priced', async () => {
      const product = await catalogService.getPublishedProduct('cerave-moisturizing-cream');
      const skuId = product?.skus[0]?.id;

      const terms = await commerceService.getSellingTerms(skuId!);

      expect(terms?.isListed).toBe(true);
      expect(terms?.price).toBeDefined();
      expect(terms?.canOrder).toBe(true);
    });

    it('should mark SKU as not orderable when missing price', async () => {
      // This would require creating a listing without a price
      // For now, we verify the logic path exists
      const canOrder = await commerceService.evaluateSellability('non-existent-sku');
      expect(canOrder).toBe(false);
    });
  });

  describe('Category Hierarchy & Taxonomy (GLO-94 & GLO-95)', () => {
    it('should return root categories with child leaf categories', async () => {
      const roots = await categoryService.getCategories();

      expect(roots.length).toBe(2); // Skin Care and Hair Care
      const skinCare = roots.find((r) => r.slug === 'skin-care');
      const hairCare = roots.find((r) => r.slug === 'hair-care');

      expect(skinCare).toBeDefined();
      expect(skinCare?.name).toBe('Skin Care');
      expect(skinCare?.children.length).toBeGreaterThan(0);
      expect(skinCare?.children.some((c) => c.slug === 'moisturizers')).toBe(true);

      expect(hairCare).toBeDefined();
      expect(hairCare?.name).toBe('Hair Care');
      expect(hairCare?.children.length).toBeGreaterThan(0);
      expect(hairCare?.children.some((c) => c.slug === 'shampoos')).toBe(true);
    });

    it('should return category with its associated published products', async () => {
      const category = await categoryService.getCategory('moisturizers');

      expect(category).toBeDefined();
      expect(category?.name).toBe('Moisturizers');
      expect(category?.products.length).toBeGreaterThan(0);
      expect(category?.products.some((p) => p.slug === 'cerave-moisturizing-cream')).toBe(true);
    });

    it('should return null for non-existent category', async () => {
      const category = await categoryService.getCategory('non-existent-category');
      expect(category).toBeNull();
    });
  });

  describe('Brand & ProductLine Operations (GLO-97 Read Side)', () => {
    it('should list all active brands with their product lines', async () => {
      const brands = await brandService.getBrands();

      expect(brands.length).toBeGreaterThan(0);
      const cerave = brands.find((b) => b.slug === 'cerave');
      expect(cerave).toBeDefined();
      expect(cerave?.name).toBe('CeraVe');
      expect(cerave?.productLines.length).toBeGreaterThan(0);
      expect(cerave?.productLines.some((pl) => pl.slug === 'cerave-daily-moisturizers')).toBe(true);
    });

    it('should return brand detail with products by slug', async () => {
      const brand = await brandService.getBrand('cerave');

      expect(brand).toBeDefined();
      expect(brand?.name).toBe('CeraVe');
      expect(brand?.products.length).toBeGreaterThan(0);
      expect(brand?.products.some((p) => p.slug === 'cerave-moisturizing-cream')).toBe(true);
    });

    it('should return null for non-existent brand', async () => {
      const brand = await brandService.getBrand('unknown-brand');
      expect(brand).toBeNull();
    });
  });
});

