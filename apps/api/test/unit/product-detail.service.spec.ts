import { ProductDetailService } from '../../src/application/composition/services/product-detail.service';

describe('ProductDetailService', () => {
  const productId = '11111111-1111-1111-1111-111111111111';
  const skuId = '22222222-2222-2222-2222-222222222222';

  it('projects verified keyIngredients, routineProfile, safetyWarnings, and benefits without promoting unverified items', async () => {
    const views = {
      getProductView: jest.fn().mockResolvedValue({
        id: productId,
        name: 'Moisture Cream',
        slug: 'moisture-cream',
        description: null,
        usage: null,
        warnings: null,
        brand: { id: 'b1', name: 'Shaan', slug: 'shaan' },
        productLine: null,
        category: { id: 'c1', name: 'Moisturizers', slug: 'moisturizers', parentId: 'skin-care' },
        skus: [
          {
            id: skuId,
            code: 'SKU-1',
            barcode: '123456',
            variantName: '120 g',
            size: 120,
            sizeUnit: 'g',
            price: { amount: 130, currency: 'EGP', compareAtAmount: null },
            isAvailable: true,
            canOrder: true,
            availability: { isAvailable: true, isFresh: true, state: 'CONFIRMED', confirmedAt: null, observedAt: null, validUntil: null },
          },
        ],
        media: [{ id: 'm1', skuId, type: 'image', url: 'https://example.com/1.webp', altText: null, isPrimary: true, sortOrder: 0, originType: 'derived', role: 'PRIMARY_PACKSHOT' }],
      }),
    };
    const catalog = {
      getReviewedIdentityFacts: jest.fn().mockResolvedValue([]),
      getReviewedUsageRules: jest.fn().mockResolvedValue([
        { skuId, targetArea: 'FACE', routinePeriod: 'BOTH', rinseMode: 'LEAVE_ON', frequencyUnit: 'DAY', usesMin: 2, usesMax: 2, contactMinutes: null, contactIsMaximum: false, condition: null, evidenceText: 'Use twice daily', sourceUrl: 'https://example.com', reviewedAt: new Date('2026-01-01') },
      ]),
      getProductDetailCatalogFacts: jest.fn().mockResolvedValue({
        productIngredients: [
          { skuId: null, name: 'Aqua', nameAr: null, inciName: 'AQUA', primaryFunction: 'unclassified', isActiveIngredient: false, isKeyActive: true, concentration: null, concentrationStatus: 'UNKNOWN', descriptionEn: null, descriptionAr: null, visualUrl: null },
          { skuId: null, name: 'Niacinamide', nameAr: 'نياسيناميد', inciName: 'NIACINAMIDE', primaryFunction: 'Skin Restoring', isActiveIngredient: true, isKeyActive: true, concentration: '5%', concentrationStatus: 'STATED', descriptionEn: 'Supports skin barrier', descriptionAr: 'يدعم حاجز البشرة', visualUrl: 'https://example.com/nia.webp' },
        ],
        safetyWarnings: [
          { id: 'w1', skuId: null, kind: 'PRECAUTION', condition: null, descriptionEn: 'Avoid eye area', descriptionAr: 'تجنب ملامسة العينين' },
        ],
        keyIngredientsClaim: [{ name: 'Niacinamide', function: 'Barrier care' }, { name: 'Allantoin', function: null }],
      }),
    };
    const care = { getPublicProductPlacements: jest.fn().mockResolvedValue([]) };
    const content = {
      getPublishedContent: jest.fn().mockResolvedValue(
        new Map([
          [
            skuId,
            {
              language: 'en',
              name: null,
              description: 'Rich cream description',
              ingredients: 'AQUA\nNIACINAMIDE',
              keyIngredients: [{ name: 'Niacinamide', function: 'Barrier care' }],
              benefits: ['Supports skin barrier'],
              usage: 'Apply morning and evening.',
              warnings: null,
              verifiedFacts: [],
            },
          ],
        ]),
      ),
    };
    const promotions = { getActivePromotions: jest.fn().mockResolvedValue([]), getProductPreview: jest.fn().mockResolvedValue(null) };
    const intake = {
      routineProfiles: jest.fn().mockResolvedValue([
        {
          skuId,
          primaryRole: 'MOISTURIZER',
          primaryRoleStatus: 'RULE_DERIVED',
          secondaryRoles: [],
          routineDomain: 'SKIN',
          stepOrder: 8,
          routinePeriod: 'BOTH',
          routinePeriodStatus: 'VERIFIED',
          periodEligibility: null,
          cadenceUnit: 'DAY',
          cadenceMin: 2,
          cadenceMax: 2,
          cadenceStatus: 'VERIFIED',
          rinseMode: 'LEAVE_ON',
          rinseModeStatus: 'VERIFIED',
          contactMinutes: null,
          targetArea: 'FACE',
          targetAreaStatus: 'VERIFIED',
          activeIngredients: [{ inci: 'NIACINAMIDE', family: 'NIACINAMIDE', function: 'Skin Restoring', status: 'VERIFIED', concentration: '5%' }],
          featuredIngredients: [
            { concept: 'Allantoin', status: 'VERIFIED', function: null },
            { concept: 'Retinol', status: 'UNKNOWN', basis: 'NO_VERIFIED_INCI' },
          ],
          prerequisites: [{ role: 'SERUM', relation: 'AFTER', status: 'RULE_DERIVED', basis: 'THIN_BEFORE_THICK' }],
          sequencingRules: [],
          cautions: [
            { kind: 'PATCH_TEST', text: 'Patch test', status: 'VERIFIED' },
            { kind: 'SUN_SENSITIVITY_GUIDANCE', text: 'Unverified general rule', status: 'RULE_DERIVED' },
          ],
        },
      ]),
    };

    const service = new ProductDetailService(views as never, catalog as never, care as never, content as never, promotions as never, intake as never);
    const detail = await service.getDetail('moisture-cream');

    expect(detail).not.toBeNull();
    expect(detail!.description).toBe('Rich cream description');
    expect(detail!.warnings).toBe('تجنب ملامسة العينين');
    expect(detail!.benefits).toEqual(['Supports skin barrier']);
    expect(detail!.routineProfile?.primaryRole).toBe('MOISTURIZER');
    expect(detail!.routineProfile?.featuredIngredients).toEqual([{ concept: 'Allantoin', status: 'VERIFIED', function: null }]);
    expect(detail!.routineProfile?.cautions).toEqual([{ kind: 'PATCH_TEST', text: 'Patch test', status: 'VERIFIED' }]);
    // Aqua is an excipient (`isActiveIngredient: false`, `primaryFunction: 'unclassified'`), so it stays in inciIngredients only, never in keyIngredients
    expect(detail!.inciIngredients.map(i => i.name)).toEqual(['Aqua', 'Niacinamide']);
    expect(detail!.keyIngredients.map(k => k.name)).toEqual(['Niacinamide', 'Allantoin']);
    expect(detail!.keyIngredients[0].descriptionAr).toBe('يدعم حاجز البشرة');
    expect(detail!.keyIngredients[0].visualUrl).toBe('https://example.com/nia.webp');
  });
});
