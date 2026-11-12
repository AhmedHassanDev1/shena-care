import { featuredIngredientIndex, knownSkinTypes, productHighlights, splitIngredients, splitSteps } from './product-facts';

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
