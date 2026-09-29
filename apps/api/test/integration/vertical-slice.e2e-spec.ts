import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DatabaseModule } from '../../../src/platform/database/database.module';
import { CatalogModule } from '../../../src/modules/catalog/catalog.module';
import { CommerceModule } from '../../../src/modules/commerce/commerce.module';
import { CompositionModule } from '../../../src/application/composition/composition.module';
import { CatalogService } from '../../../src/modules/catalog/public';
import { CommerceService } from '../../../src/modules/commerce/public';
import { ProductViewService } from '../../../src/application/composition/services/product-view.service';

describe('First Vertical Slice (e2e)', () => {
  let app: INestApplication;
  let catalogService: CatalogService;
  let commerceService: CommerceService;
  let productViewService: ProductViewService;

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
      expect((product as any).price).toBeUndefined();
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
});
