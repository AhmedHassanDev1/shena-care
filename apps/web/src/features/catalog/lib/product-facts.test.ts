import { getMessages } from '@/lib/i18n/messages';
import type { ProductDetail, PublicVariant } from '../api/discovery';
import {
  dedupeGalleryMedia,
  featuredIngredientIndex,
  formatReadableCopy,
  knownSkinTypes,
  productHighlights,
  resolveFullInciList,
  resolveHeroFeatureBadges,
  resolveKeyIngredients,
  resolveRoutinePosition,
  resolveTextDirection,
  resolveUsageGuide,
  splitIngredients,
  splitSteps,
  truncateReadableExcerpt,
} from './product-facts';

describe('productHighlights', () => {
  it('returns nothing when the catalog carries no facts', () => {
    expect(productHighlights({})).toEqual([]);
    expect(productHighlights({ spf: 0, isFragranceFree: false, texture: 'UNKNOWN' })).toEqual([]);
  });

  it('keeps a fixed order and only reviewed facts', () => {
    expect(productHighlights({ isNonComedogenic: true, texture: 'GEL_CREAM', spf: 50, targetArea: 'FACE' }).map((h) => h.kind)).toEqual([
      'spf',
      'texture',
      'area',
      'non-comedogenic',
    ]);
  });
});

describe('knownSkinTypes', () => {
  it('drops values the storefront cannot name and keeps taxonomy order', () => {
    expect(knownSkinTypes(['Sensitive', 'oily', 'mystery', 'oily'])).toEqual(['oily', 'sensitive']);
    expect(knownSkinTypes(undefined)).toEqual([]);
  });
});

describe('splitIngredients', () => {
  it('splits an INCI list', () => {
    expect(splitIngredients('Ingredients: Aqua, Niacinamide, Glycerin, Zinc PCA.')).toEqual(['Aqua', 'Niacinamide', 'Glycerin', 'Zinc PCA']);
    expect(splitIngredients('ماء، جلسرين، نياسيناميد')).toEqual(['ماء', 'جلسرين', 'نياسيناميد']);
  });

  it('leaves prose and short text as written', () => {
    expect(splitIngredients('Aqua, Glycerin')).toBeNull();
    expect(splitIngredients(null)).toBeNull();
  });
});

describe('splitSteps', () => {
  it('uses the author lines and strips list markers', () => {
    expect(splitSteps('1. Cleanse the skin\n2. Apply 2-3 drops\n- Massage gently')).toEqual(['Cleanse the skin', 'Apply 2-3 drops', 'Massage gently']);
  });

  it('splits a short paragraph into sentences', () => {
    expect(splitSteps('Apply to clean skin. Follow with moisturizer.')).toEqual(['Apply to clean skin.', 'Follow with moisturizer.']);
  });

  it('keeps a single instruction whole', () => {
    expect(splitSteps('Apply morning and evening')).toEqual(['Apply morning and evening']);
    expect(splitSteps('  ')).toEqual([]);
  });
});

describe('featuredIngredientIndex', () => {
  const list = ['Aqua', 'Glycerin', 'Sodium Hyaluronate', 'Hydrolyzed Hyaluronic Acid', 'Panthenol'];

  it('finds the ingredient the title names, including salts and derivatives', () => {
    expect(featuredIngredientIndex(list, 'Hyaluronic Acid Facial Serum')).toBe(2);
  });

  it('returns -1 when the title names none or is not Latin text', () => {
    expect(featuredIngredientIndex(list, 'Gentle Foaming Cleanser')).toBe(-1);
    expect(featuredIngredientIndex(list, 'سيروم هيالورونيك')).toBe(-1);
    expect(featuredIngredientIndex([], 'Hyaluronic Acid Serum')).toBe(-1);
  });
});

function baseVariant(overrides: Partial<PublicVariant> = {}): PublicVariant {
  return {
    id: 'sku-1',
    code: 'SKU-1',
    barcode: null,
    variantName: '200 ml',
    size: 200,
    sizeUnit: 'ml',
    price: { amount: 150, currency: 'EGP', compareAtAmount: null },
    isAvailable: true,
    canOrder: true,
    availability: { isAvailable: true, isFresh: true, confirmedAt: null, observedAt: null, validUntil: null },
    media: [],
    content: null,
    promotions: null,
    ...overrides,
  };
}

function baseProduct(variant: PublicVariant, overrides: Partial<ProductDetail> = {}): ProductDetail {
  return {
    id: 'prod-1',
    name: 'Test Product',
    slug: 'test-product',
    description: null,
    usage: null,
    warnings: null,
    brand: { id: 'b-1', name: 'Shaan', slug: 'shaan' },
    productLine: null,
    category: null,
    skus: [variant],
    media: [],
    selectedSkuId: variant.id,
    selectedVariant: variant,
    evaluatedAt: '2026-11-11T00:00:00Z',
    ...overrides,
  };
}

describe('resolveRoutinePosition', () => {
  const m = getMessages('ar');

  it('places a sunscreen into step 04 Protect and explains its order', () => {
    const v = baseVariant({
      routineProfile: {
        primaryRole: 'SUNSCREEN',
        primaryRoleStatus: 'VERIFIED',
        secondaryRoles: [],
        routineDomain: 'SKIN',
        stepOrder: 4,
        routinePeriod: 'AM',
        routinePeriodStatus: 'VERIFIED',
        periodEligibility: 'AM_ONLY',
        cadenceUnit: 'DAY',
        cadenceMin: 1,
        cadenceMax: 1,
        cadenceStatus: 'VERIFIED',
        rinseMode: 'LEAVE_ON',
        rinseModeStatus: 'VERIFIED',
        contactMinutes: null,
        targetArea: 'FACE',
        targetAreaStatus: 'VERIFIED',
        activeIngredients: [],
        featuredIngredients: [],
        prerequisites: [],
        sequencingRules: [],
        cautions: [],
      },
    });
    const res = resolveRoutinePosition(baseProduct(v), v, m);
    expect(res.confirmed).toBe(true);
    expect(res.steps).toHaveLength(4);
    expect(res.steps.find((s) => s.isCurrent)?.number).toBe('04');
    expect(res.steps.find((s) => s.isCurrent)?.label).toBe(m.pdpRoutineStepProtect);
    expect(res.summaryLine).toContain(m.pdpRoutineStepMoisturize);
  });

  it('switches to Hair domain pipeline for shampoo / conditioner', () => {
    const v = baseVariant({
      routineProfile: {
        primaryRole: 'CONDITIONER',
        primaryRoleStatus: 'VERIFIED',
        secondaryRoles: [],
        routineDomain: 'HAIR',
        stepOrder: 2,
        routinePeriod: 'UNKNOWN',
        routinePeriodStatus: 'UNKNOWN',
        periodEligibility: null,
        cadenceUnit: 'UNKNOWN',
        cadenceMin: null,
        cadenceMax: null,
        cadenceStatus: 'UNKNOWN',
        rinseMode: 'RINSE_OFF',
        rinseModeStatus: 'VERIFIED',
        contactMinutes: null,
        targetArea: 'HAIR',
        targetAreaStatus: 'VERIFIED',
        activeIngredients: [],
        featuredIngredients: [],
        prerequisites: [],
        sequencingRules: [],
        cautions: [],
      },
    });
    const res = resolveRoutinePosition(baseProduct(v), v, m);
    expect(res.confirmed).toBe(true);
    expect(res.steps.find((s) => s.isCurrent)?.label).toBe(m.pdpRoutineStepCondition);
    expect(res.steps[0].label).toBe(m.pdpRoutineStepWash);
  });

  it('does not guess a routine step when primaryRoleStatus is UNKNOWN', () => {
    const v = baseVariant({
      routineProfile: {
        primaryRole: null,
        primaryRoleStatus: 'UNKNOWN',
        secondaryRoles: [],
        routineDomain: 'SKIN',
        stepOrder: null,
        routinePeriod: 'UNKNOWN',
        routinePeriodStatus: 'UNKNOWN',
        periodEligibility: null,
        cadenceUnit: 'UNKNOWN',
        cadenceMin: null,
        cadenceMax: null,
        cadenceStatus: 'UNKNOWN',
        rinseMode: 'UNKNOWN',
        rinseModeStatus: 'UNKNOWN',
        contactMinutes: null,
        targetArea: null,
        targetAreaStatus: 'UNKNOWN',
        activeIngredients: [],
        featuredIngredients: [],
        prerequisites: [],
        sequencingRules: [],
        cautions: [],
      },
    });
    const res = resolveRoutinePosition(baseProduct(v), v, m);
    expect(res.confirmed).toBe(false);
    expect(res.steps).toEqual([]);
  });
});

describe('resolveUsageGuide', () => {
  const m = getMessages('en');

  it('uses verified AM usage rule and ignores unknown fields without inventing indicators', () => {
    const v = baseVariant({
      usageRules: [
        {
          skuId: 'sku-1',
          routinePeriod: 'AM',
          rinseMode: 'LEAVE_ON',
          frequencyUnit: 'DAY',
          usesMin: 1,
          usesMax: 2,
          contactMinutes: null,
          evidenceText: 'Apply evenly before sun exposure.',
          condition: null,
          sourceUrl: 'https://example.com',
          reviewedAt: '2026-11-11T00:00:00Z',
        },
      ],
    });
    const guide = resolveUsageGuide(baseProduct(v), v, 'en', m);
    expect(guide.showMorning).toBe(true);
    expect(guide.showEvening).toBe(false);
    expect(guide.frequencyChips).toEqual(['1–2x daily', 'Leave-on']);
    expect(guide.instructionsText).toBe('Apply evenly before sun exposure.');
    expect(guide.warningsText).toBeNull();
    expect(guide.textureMedia).toBeNull();
  });

  it('omits both morning and evening pills when timing is UNKNOWN', () => {
    const v = baseVariant();
    const guide = resolveUsageGuide(baseProduct(v), v, 'en', m);
    expect(guide.showMorning).toBe(false);
    expect(guide.showEvening).toBe(false);
  });

  it('uses singular daily label for once daily, general daily for DAY with null counts, and deduplicates repeated instructions', () => {
    const mAr = getMessages('ar');
    const onceVariant = baseVariant({
      usageRules: [
        {
          skuId: 'sku-1',
          routinePeriod: 'PM',
          rinseMode: 'LEAVE_ON',
          frequencyUnit: 'DAY',
          usesMin: 1,
          usesMax: 1,
          contactMinutes: null,
          evidenceText: 'Apply nightly. Apply nightly.',
          condition: null,
          sourceUrl: 'https://example.com',
          reviewedAt: '2026-11-11T00:00:00Z',
        },
      ],
    });
    const onceGuideEn = resolveUsageGuide(baseProduct(onceVariant), onceVariant, 'en', m);
    const onceGuideAr = resolveUsageGuide(baseProduct(onceVariant), onceVariant, 'ar', mAr);
    expect(onceGuideEn.frequencyChips).toEqual(['Once daily', 'Leave-on']);
    expect(onceGuideAr.frequencyChips).toEqual(['مرة يومياً', 'يُترك على البشرة']);
    expect(onceGuideEn.instructionsText).toBe('Apply nightly.');

    const generalDailyVariant = baseVariant({
      usageRules: [
        {
          skuId: 'sku-1',
          routinePeriod: 'BOTH',
          rinseMode: 'RINSE_OFF',
          frequencyUnit: 'DAY',
          usesMin: null,
          usesMax: null,
          contactMinutes: null,
          evidenceText: 'Wash gently.',
          condition: null,
          sourceUrl: 'https://example.com',
          reviewedAt: '2026-11-11T00:00:00Z',
        },
      ],
    });
    expect(resolveUsageGuide(baseProduct(generalDailyVariant), generalDailyVariant, 'ar', mAr).frequencyChips).toEqual([
      'يومياً',
      'يُشطف بالماء',
    ]);
  });
});

describe('editorial formatting and gallery media helpers', () => {
  it('resolves natural block direction based on Arabic vs Latin script presence', () => {
    expect(resolveTextDirection('غسول لطيف للبشرة الدهنية')).toBe('rtl');
    expect(resolveTextDirection('Gentle daily cream with Niacinamide')).toBe('ltr');
    expect(resolveTextDirection('120')).toBeUndefined();
    expect(resolveTextDirection(null)).toBeUndefined();
  });

  it('restores spacing on mashed copy and removes adjacent duplicate sentences', () => {
    const blocks = formatReadableCopy(
      'Gentle barrier cream.Gentle barrier cream.Benefits:Deep Hydration:Locks in moisture.Skin softness.How to Use:Apply daily.'
    );
    expect(blocks[0]).toContain('Gentle barrier cream.');
    expect(blocks.join(' ')).not.toMatch(/Gentle barrier cream\.\s*Gentle barrier cream/);
    expect(blocks.some((b) => b.startsWith('Benefits:'))).toBe(true);
    expect(blocks.some((b) => b.startsWith('How to Use:'))).toBe(true);
  });

  it('truncates long descriptions at word boundaries without chopping mid-word', () => {
    const paragraphs = ['Hydrating daily facial cream formulated for sensitive skin barriers with panthenol and glycerin.'];
    const shortRes = truncateReadableExcerpt(paragraphs, 220);
    expect(shortRes.isLong).toBe(false);

    const longRes = truncateReadableExcerpt(paragraphs, 52);
    expect(longRes.isLong).toBe(true);
    expect(longRes.preview.endsWith('…')).toBe(true);
    expect(longRes.preview).not.toContain('barri…');
  });

  it('orders primary media first and deduplicates repeated gallery URLs', () => {
    const unique = dedupeGalleryMedia([
      {
        id: '2',
        skuId: 'sku-1',
        type: 'IMAGE',
        url: '/img/b.png',
        altText: null,
        isPrimary: false,
        sortOrder: 2,
        originType: 'LOCAL',
        role: 'SECONDARY',
      },
      {
        id: '1',
        skuId: 'sku-1',
        type: 'IMAGE',
        url: '/img/a.png',
        altText: null,
        isPrimary: false,
        sortOrder: 1,
        originType: 'LOCAL',
        role: 'SECONDARY',
      },
      {
        id: '3',
        skuId: 'sku-1',
        type: 'IMAGE',
        url: '/img/a.png',
        altText: null,
        isPrimary: true,
        sortOrder: 0,
        originType: 'LOCAL',
        role: 'PRIMARY_PACKSHOT',
      },
    ]);
    expect(unique.map((mItem) => mItem.id)).toEqual(['3', '2']);
  });
});

describe('resolveHeroFeatureBadges, resolveKeyIngredients, resolveFullInciList', () => {
  const m = getMessages('en');

  it('caps hero feature badges to 3 and merges suitable skin type', () => {
    const v = baseVariant();
    const p = baseProduct(v, {
      texture: 'GEL',
      isFragranceFree: true,
      suitableSkinTypes: ['oily', 'sensitive'],
    });
    expect(resolveHeroFeatureBadges(p, m)).toHaveLength(3);
  });

  it('deduplicates active ingredients and orders INCI by position', () => {
    const v = baseVariant({
      keyIngredients: [
        { name: 'Panthenol', function: 'Soothing' },
        { name: 'panthenol', function: 'Dup' },
      ],
      inciIngredients: [
        {
          skuId: 'sku-1',
          name: 'Glycerin',
          nameAr: null,
          inciName: 'Glycerin',
          primaryFunction: 'Humectant',
          descriptionEn: null,
          descriptionAr: null,
          visualUrl: null,
          position: 2,
          concentration: null,
          concentrationStatus: 'UNKNOWN',
          isKeyActive: false,
          isActiveIngredient: false,
          isFragrance: false,
          isEssentialOil: false,
          isAlcoholDenat: false,
        },
        {
          skuId: 'sku-1',
          name: 'Aqua',
          nameAr: null,
          inciName: 'Aqua',
          primaryFunction: 'Solvent',
          descriptionEn: null,
          descriptionAr: null,
          visualUrl: null,
          position: 1,
          concentration: null,
          concentrationStatus: 'UNKNOWN',
          isKeyActive: false,
          isActiveIngredient: false,
          isFragrance: false,
          isEssentialOil: false,
          isAlcoholDenat: false,
        },
      ],
    });
    const p = baseProduct(v);
    expect(resolveKeyIngredients(p, v)).toHaveLength(1);
    expect(resolveFullInciList(p, v, 'en')).toEqual(['Aqua', 'Glycerin']);
  });
});
