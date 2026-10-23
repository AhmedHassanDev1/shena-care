// GLO-275 / GLO-281 — OUT_OF_SCOPE golden set. A row is skipped only when its product TYPE is confidently outside the
// skincare/haircare pilot; the brand (known, unknown or missing) never decides a skip. Labels are written from the
// product's meaning, independently of the rule's keyword lists.
import { RowNormalizationService } from '../../src/modules/ingestion/services/row-normalization.service';

const svc = new RowNormalizationService();
const BRANDS = ['', 'Unknown Beauty', 'علامة غير معروفة', 'CeraVe'];
const skipped = (name: string, brand: string) => svc.classifyScope(name, brand).category === 'excluded';

/** In scope (skincare/haircare): must NEVER be skipped, whatever the brand. Several contain words that also name
 *  excluded goods (perfume, bag, razor, lipstick, mascara, hair dryer, …). */
const IN_SCOPE = [
  'Perfume Free Face Wash 150ml', 'Fragrance and Perfume-Free Gentle Facial Wash 200ml',
  'Eye Bag Reducing Gel 15ml', 'Under Eye Bags Dark Circle Patches 60 pcs',
  'After Razor Burn Soothing Gel 100ml', 'Razor Bump Relief Lotion 50ml',
  'Lipstick and Mascara Makeup Remover Wipes 25 pcs', 'Waterproof Mascara Makeup Remover 100ml',
  'Mascara Eyelash Growth Serum 5ml', 'Heat Protectant Spray For Hair Dryer and Straightener 150ml',
  'Hair Straightener Heat Protection Mist 200ml', 'Foundation Repair Barrier Wash 250ml',
  'غسول وجه خالي من العطر 200 مل', 'مزيل مكياج للروج والكحل 150 مل', 'جل للعين ضد الهالات والشنطة 15 مل',
  'Hydrating Facial Foam 150ml', 'Niacinamide Essence 100ml', 'Pore Refining Face Mist 100ml',
  'Anti Dandruff Hair Gel Wash 250ml', 'Baby Face Wash Perfume Free 200ml',
];

/** Out of scope: appliances, electronics, clothing, food and makeup/fragrance — skipped with a reason, any brand. */
const OUT_OF_SCOPE = [
  'Philips Hair Dryer 2200W', 'Babyliss Hair Straightener Ceramic', 'Samsung Smartphone 128GB', 'Fast Phone Charger 20W',
  'Matte Lipstick Ruby Red', 'Waterproof Mascara Black 10ml', 'Eau de Parfum 100ml Oud', 'Basmati Rice 5kg',
  'Cotton Socks 3 Pack', 'Nail Polish Gel Finish Red', 'سشوار 2000 وات', 'روج مات احمر', 'عطر رجالي 100 مل',
  'Liquid Foundation Medium Beige', 'Electric Razor Rechargeable',
];

describe('GLO-281 scope golden set: no false skips, brand never decides', () => {
  for (const name of IN_SCOPE) {
    it(`never skips in-scope product "${name}" (any brand)`, () => {
      for (const brand of BRANDS) expect({ name, brand, skipped: skipped(name, brand) }).toEqual({ name, brand, skipped: false });
    });
  }

  for (const name of OUT_OF_SCOPE) {
    it(`skips out-of-scope goods "${name}" for every brand, including a known one`, () => {
      const results = BRANDS.map(brand => skipped(name, brand));
      // Typing a brand must not change the verdict either way; if it does not skip it must be held, never admitted.
      expect(new Set(results).size).toBe(1);
      for (const brand of BRANDS) expect(svc.classifyScope(name, brand).isEligible).toBe(false);
    });
  }

  it('a skincare/haircare name with an unknown or missing brand is held for review, not skipped', () => {
    for (const name of ['Vitamin C Brightening Serum 30ml', 'Daily Repair Shampoo 400ml', 'كريم مرطب للبشرة الجافة 50 جم']) {
      for (const brand of ['', 'Unknown Beauty']) {
        const scope = svc.classifyScope(name, brand);
        expect(scope.category).not.toBe('excluded');
        expect(scope.isEligible).toBe(true);
      }
    }
  });

  it('an unrecognised product type from an unknown brand is held for review (never a skip)', () => {
    for (const name of ['Mystery Item 250ml', 'قطعة غير مطابقة']) {
      const scope = svc.classifyScope(name, 'Unknown Beauty');
      expect(scope.category).toBe('unknown');
      expect(scope.isEligible).toBe(false);
    }
  });

  it('the Gate 09 synthetic out-of-scope rows are skipped for their product type, not their brand', () => {
    const scope = svc.classifyScope('G09 baa Hair Dryer 1200W', 'G09 Brand 0235a9ec');
    expect(scope).toMatchObject({ category: 'excluded', matchedRules: ['excluded_type:hair dryer'] });
  });
});
