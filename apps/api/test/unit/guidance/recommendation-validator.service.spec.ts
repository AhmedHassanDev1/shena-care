import { Test, TestingModule } from '@nestjs/testing';
import { RecommendationValidatorService } from '../../src/modules/guidance/services/recommendation-validator.service';
import { CatalogService } from '../../src/modules/catalog/public';
import { CommerceService } from '../../src/modules/commerce/public';
import { RoutineProposal, RoutineStepProposal } from '../../src/platform/ai';

describe('RecommendationValidatorService', () => {
  let service: RecommendationValidatorService;
  let catalogService: jest.Mocked<CatalogService>;
  let commerceService: jest.Mocked<CommerceService>;

  beforeEach(async () => {
    const mockCatalogService = {
      getPublishedProducts: jest.fn(),
    };

    const mockCommerceService = {
      evaluateSellability: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecommendationValidatorService,
        { provide: CatalogService, useValue: mockCatalogService },
        { provide: CommerceService, useValue: mockCommerceService },
      ],
    }).compile();

    service = module.get<RecommendationValidatorService>(RecommendationValidatorService);
    catalogService = module.get(CatalogService);
    commerceService = module.get(CommerceService);
  });

  describe('validateProposal', () => {
    it('should pass validation for proposal with no product queries', async () => {
      const proposal: RoutineProposal = {
        title: 'Simple Routine',
        careArea: 'skin',
        steps: [
          {
            title: 'Cleanse',
            timing: 'am',
            isOptional: false,
            productQuery: null,
          },
        ],
      };

      const result = await service.validateProposal(proposal);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject proposal with no steps', async () => {
      const proposal: RoutineProposal = {
        title: 'Empty Routine',
        careArea: 'skin',
        steps: [],
      };

      const result = await service.validateProposal(proposal);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Proposal contains no steps');
    });

    it('should pass validation when product query resolves to sellable SKU', async () => {
      catalogService.getPublishedProducts.mockResolvedValue([
        {
          id: 'prod-1',
          name: 'CeraVe Foaming Cleanser',
          slug: 'cerave-foaming-cleanser',
          description: 'Gentle cleanser',
          usage: null,
          warnings: null,
          isPublished: true,
          brand: { id: 'brand-1', name: 'CeraVe', slug: 'cerave' },
          skus: [
            {
              id: 'sku-1',
              code: 'CER-FOAM-236',
              variantName: '236ml',
              size: 236,
              sizeUnit: 'ml',
              barcode: null,
              isActive: true,
            },
          ],
          media: [],
        },
      ]);

      commerceService.evaluateSellability.mockResolvedValue({
        skuId: 'sku-1',
        isSellable: true,
        reason: 'SELLABLE',
        message: 'Product is sellable',
        terms: {
          skuId: 'sku-1',
          isListed: true,
          price: { amount: 12.99, currency: 'USD', compareAtAmount: null },
          canOrder: true,
        },
      });

      const proposal: RoutineProposal = {
        title: 'Morning Routine',
        careArea: 'skin',
        steps: [
          {
            title: 'Cleanse',
            timing: 'am',
            isOptional: false,
            productQuery: 'CeraVe Foaming Cleanser',
          },
        ],
      };

      const result = await service.validateProposal(proposal);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.stepResults).toHaveLength(1);
      expect(result.stepResults[0].isValid).toBe(true);
      expect(result.stepResults[0].productResolution?.resolved).toBe(true);
      expect(result.stepResults[0].availabilityCheck?.isSellable).toBe(true);
    });

    it('should reject when product query does not match any catalog product', async () => {
      catalogService.getPublishedProducts.mockResolvedValue([]);

      const proposal: RoutineProposal = {
        title: 'Morning Routine',
        careArea: 'skin',
        steps: [
          {
            title: 'Cleanse',
            timing: 'am',
            isOptional: false,
            productQuery: 'Unknown Mysterious Serum',
          },
        ],
      };

      const result = await service.validateProposal(proposal);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('No catalog product found matching');
      expect(result.stepResults[0].isValid).toBe(false);
    });

    it('should reject when matched product has no active SKUs', async () => {
      catalogService.getPublishedProducts.mockResolvedValue([
        {
          id: 'prod-1',
          name: 'Discontinued Cream',
          slug: 'discontinued-cream',
          description: 'No longer available',
          usage: null,
          warnings: null,
          isPublished: true,
          brand: { id: 'brand-1', name: 'OldBrand', slug: 'oldbrand' },
          skus: [
            {
              id: 'sku-1',
              code: 'OLD-001',
              variantName: '50ml',
              size: 50,
              sizeUnit: 'ml',
              barcode: null,
              isActive: false, // Inactive SKU
            },
          ],
          media: [],
        },
      ]);

      const proposal: RoutineProposal = {
        title: 'Routine',
        careArea: 'skin',
        steps: [
          {
            title: 'Apply',
            timing: 'pm',
            isOptional: false,
            productQuery: 'Discontinued Cream',
          },
        ],
      };

      const result = await service.validateProposal(proposal);

      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('has no active SKUs');
    });

    it('should reject when SKU is not sellable due to no listing', async () => {
      catalogService.getPublishedProducts.mockResolvedValue([
        {
          id: 'prod-1',
          name: 'Test Product',
          slug: 'test-product',
          description: 'Test',
          usage: null,
          warnings: null,
          isPublished: true,
          brand: { id: 'brand-1', name: 'TestBrand', slug: 'testbrand' },
          skus: [
            {
              id: 'sku-1',
              code: 'TEST-001',
              variantName: 'Standard',
              size: 100,
              sizeUnit: 'ml',
              barcode: null,
              isActive: true,
            },
          ],
          media: [],
        },
      ]);

      commerceService.evaluateSellability.mockResolvedValue({
        skuId: 'sku-1',
        isSellable: false,
        reason: 'LISTING_NOT_FOUND',
        message: 'No listing record found for SKU',
        terms: null,
      });

      const proposal: RoutineProposal = {
        title: 'Routine',
        careArea: 'skin',
        steps: [
          {
            title: 'Apply',
            timing: 'pm',
            isOptional: false,
            productQuery: 'Test Product',
          },
        ],
      };

      const result = await service.validateProposal(proposal);

      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('Product not sellable');
      expect(result.stepResults[0].availabilityCheck?.isSellable).toBe(false);
    });

    it('should reject when SKU is not sellable due to no active price', async () => {
      catalogService.getPublishedProducts.mockResolvedValue([
        {
          id: 'prod-1',
          name: 'No Price Product',
          slug: 'no-price-product',
          description: 'Test',
          usage: null,
          warnings: null,
          isPublished: true,
          brand: { id: 'brand-1', name: 'TestBrand', slug: 'testbrand' },
          skus: [
            {
              id: 'sku-1',
              code: 'NOPRICE-001',
              variantName: 'Standard',
              size: 100,
              sizeUnit: 'ml',
              barcode: null,
              isActive: true,
            },
          ],
          media: [],
        },
      ]);

      commerceService.evaluateSellability.mockResolvedValue({
        skuId: 'sku-1',
        isSellable: false,
        reason: 'PRICE_NOT_FOUND',
        message: 'No selling price found for SKU',
        terms: {
          skuId: 'sku-1',
          isListed: true,
          price: null,
          canOrder: false,
        },
      });

      const proposal: RoutineProposal = {
        title: 'Routine',
        careArea: 'skin',
        steps: [
          {
            title: 'Apply',
            timing: 'pm',
            isOptional: false,
            productQuery: 'No Price Product',
          },
        ],
      };

      const result = await service.validateProposal(proposal);

      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('Product not sellable');
    });

    it('should validate all steps and collect all errors', async () => {
      catalogService.getPublishedProducts.mockResolvedValue([]);

      const proposal: RoutineProposal = {
        title: 'Multi-Step Routine',
        careArea: 'skin',
        steps: [
          {
            title: 'Step 1',
            timing: 'am',
            isOptional: false,
            productQuery: 'Unknown Product A',
          },
          {
            title: 'Step 2',
            timing: 'pm',
            isOptional: false,
            productQuery: 'Unknown Product B',
          },
        ],
      };

      const result = await service.validateProposal(proposal);

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.stepResults).toHaveLength(2);
      expect(result.stepResults[0].isValid).toBe(false);
      expect(result.stepResults[1].isValid).toBe(false);
    });

    it('should handle partial name matches for product queries', async () => {
      catalogService.getPublishedProducts.mockResolvedValue([
        {
          id: 'prod-1',
          name: 'La Roche-Posay Toleriane Hydrating Gentle Cleanser',
          slug: 'lrp-toleriane-cleanser',
          description: 'Gentle cleanser',
          usage: null,
          warnings: null,
          isPublished: true,
          brand: { id: 'brand-1', name: 'La Roche-Posay', slug: 'la-roche-posay' },
          skus: [
            {
              id: 'sku-1',
              code: 'LRP-TOL-CLN',
              variantName: '200ml',
              size: 200,
              sizeUnit: 'ml',
              barcode: null,
              isActive: true,
            },
          ],
          media: [],
        },
      ]);

      commerceService.evaluateSellability.mockResolvedValue({
        skuId: 'sku-1',
        isSellable: true,
        reason: 'SELLABLE',
        message: 'Product is sellable',
        terms: {
          skuId: 'sku-1',
          isListed: true,
          price: { amount: 15.99, currency: 'USD', compareAtAmount: null },
          canOrder: true,
        },
      });

      const proposal: RoutineProposal = {
        title: 'Routine',
        careArea: 'skin',
        steps: [
          {
            title: 'Cleanse',
            timing: 'am',
            isOptional: false,
            productQuery: 'Toleriane Cleanser', // Partial match
          },
        ],
      };

      const result = await service.validateProposal(proposal);

      expect(result.isValid).toBe(true);
      expect(result.stepResults[0].productResolution?.resolved).toBe(true);
      expect(result.stepResults[0].productResolution?.productId).toBe('prod-1');
    });
  });
});
