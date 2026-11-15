import { RecommendationQuery, UNKNOWN_SAFETY, productActives, recommend } from '../../../src/modules/guidance/recommendation/recommendation-engine';
import { RETINOID_PREGNANCY_RULE, VOCABULARY, facts, offersFor, precaution, relevance, skuOf } from '../../fixtures/care-facts';

const query = (patch: Partial<RecommendationQuery> = {}): RecommendationQuery => ({
  careArea: 'skin', concerns: [], productTypes: [], safety: { ...UNKNOWN_SAFETY }, avoidIngredientIds: [], unresolvedAvoidTerms: [], ...patch,
});

describe('Recommendation engine V1 (GLO-302)', () => {
  const cleanser = facts({ name: 'Gentle Foaming Cleanser', type: 'cleanser', skinTypes: ['oily', 'acne-prone'] });
  const dryCleanser = facts({ name: 'Cream Cleanser', type: 'cleanser', skinTypes: ['dry'] });
  const sunscreen = facts({ name: 'Fluid SPF 50', type: 'sunscreen', spf: 50 });
  const niacinamideSerum = facts({ name: 'Niacinamide Facial Serum', type: 'serum', ingredients: [] });
  const retinolSerum = facts({ name: 'Night Renewal Serum', type: 'serum', ingredients: [['retinol', 'retinoids', true, 0.3], ['glycerin', 'vehicles', false]] });
  const shampoo = facts({ name: 'Moisture Shampoo', type: 'shampoo', area: 'hair', ingredients: [['salicylic-acid', 'hydroxy-acids', true], ['fragrance', 'fragrance', false]] });
  const all = [cleanser, dryCleanser, sunscreen, niacinamideSerum, retinolSerum, shampoo];
  const knowledge = [
    relevance('PRODUCT_TYPE', 'cleanser', 'acne', 'SUPPORTIVE'),
    relevance('PRODUCT_TYPE', 'sunscreen', 'acne', 'SUPPORTIVE'),
    relevance('INGREDIENT_FAMILY', 'retinoids', 'acne', 'PRIMARY'),
    relevance('INGREDIENT_FAMILY', 'niacinamide', 'acne', 'SUPPORTIVE'),
    relevance('INGREDIENT', 'salicylic-acid', 'acne', 'PRIMARY'),
    relevance('INGREDIENT', 'salicylic-acid', 'dandruff', 'PRIMARY', 'hair'),
    relevance('PRODUCT_TYPE', 'shampoo', 'dandruff', 'PRIMARY', 'hair'),
    precaution('INGREDIENT_FAMILY', 'retinoids'),
  ];
  const run = (patch: Partial<RecommendationQuery>, offers = offersFor(all), rules = [RETINOID_PREGNANCY_RULE]) =>
    recommend(query(patch), all, offers, knowledge, rules, VOCABULARY);
  const names = (result: ReturnType<typeof run>) => result.ranked.map(r => all.find(p => p.productId === r.productId)!.name);

  it('returns only products with a real link to the concern, each with reasons that name their basis', () => {
    const result = run({ concerns: ['acne'], safety: { ...UNKNOWN_SAFETY, pregnant: 'NO' } });
    expect(names(result)).toEqual(expect.arrayContaining(['Night Renewal Serum', 'Gentle Foaming Cleanser', 'Fluid SPF 50', 'Niacinamide Facial Serum']));
    expect(names(result)).not.toContain('Moisture Shampoo'); // hair product, and its salicylic acid is only listed
    for (const item of result.ranked) {
      expect(item.reasons.length).toBeGreaterThan(0);
      for (const reason of item.reasons) expect(['VERIFIED', 'EVIDENCE', 'RULE']).toContain(reason.basis);
    }
    const retinol = result.ranked.find(r => r.productId === retinolSerum.productId)!;
    expect(retinol.matchLevel).toBe('STRONG');
    expect(retinol.reasons[0]).toMatchObject({ code: 'ACTIVE_FOR_CONCERN', basis: 'EVIDENCE' });
    expect(retinol.reasons[0].textEn).toContain('0.3%');
    expect(retinol.reasons[0].knowledgeId).toBeDefined();
    expect(retinol.cautions.some(c => c.code === 'INGREDIENT_PRECAUTION')).toBe(true);
  });

  it('never invents a score scale or a product: the result is a subset of the catalog given', () => {
    const result = run({ concerns: ['acne'], safety: { ...UNKNOWN_SAFETY, pregnant: 'NO' } });
    const ids = new Set(all.map(p => p.productId));
    expect(result.ranked.every(r => ids.has(r.productId) && r.skuId === skuOf(all.find(p => p.productId === r.productId)!))).toBe(true);
    expect(new Set(result.ranked.map(r => r.productId)).size).toBe(result.ranked.length); // no duplicate product
  });

  it('holds back a retinoid until pregnancy is answered, and excludes it when the answer is yes', () => {
    const unknown = run({ concerns: ['acne'] });
    expect(names(unknown)).not.toContain('Night Renewal Serum');
    expect(unknown.needsSafetyAnswer).toEqual(['PREGNANT']);
    expect(unknown.excluded.find(e => e.productId === retinolSerum.productId)).toMatchObject({ code: 'SAFETY_UNANSWERED' });

    const pregnant = run({ concerns: ['acne'], safety: { ...UNKNOWN_SAFETY, pregnant: 'YES' } });
    expect(names(pregnant)).not.toContain('Night Renewal Serum');
    expect(pregnant.needsSafetyAnswer).toEqual([]);
    expect(pregnant.excluded.find(e => e.productId === retinolSerum.productId)).toMatchObject({ code: 'SAFETY_CONDITION', ruleKey: 'retinoids-pregnancy' });
    // A product whose ingredient list is not verified is not silently cleared for pregnancy: it carries a caution.
    const serum = pregnant.ranked.find(r => r.productId === niacinamideSerum.productId)!;
    expect(serum.cautions.some(c => c.code === 'UNVERIFIED_INCI_WITH_CONDITION')).toBe(true);
  });

  it('does not hold a hair wash back with the skin-treatment safety rules', () => {
    const acidRule = { ...RETINOID_PREGNANCY_RULE, key: 'oral-isotretinoin-hydroxy-acids', subject: 'hydroxy-acids', condition: 'ORAL_RETINOID' };
    const result = recommend(query({ careArea: 'hair', concerns: ['dandruff'] }), [shampoo], offersFor([shampoo]), knowledge, [acidRule], VOCABULARY);
    expect(result.ranked.map(r => r.productId)).toEqual([shampoo.productId]);
    expect(result.needsSafetyAnswer).toEqual([]);
    // ...while the same rule still holds a leave-on skin product with that acid
    const toner = facts({ name: 'Salicylic Acid Toner', type: 'toner', ingredients: [['salicylic-acid', 'hydroxy-acids', true]] });
    const skin = recommend(query({ concerns: ['acne'] }), [toner], offersFor([toner]), knowledge, [acidRule], VOCABULARY);
    expect(skin.ranked).toHaveLength(0);
    expect(skin.needsSafetyAnswer).toEqual(['ORAL_RETINOID']);
  });

  it('applies a manufacturer contraindication for the customer condition', () => {
    const warned = facts({ name: 'Warned Serum', type: 'serum', warnings: [{ kind: 'CONTRAINDICATION', condition: 'BREASTFEEDING' }] });
    const result = recommend(query({ productTypes: ['serum'], safety: { ...UNKNOWN_SAFETY, breastfeeding: 'YES', pregnant: 'NO' } }),
      [warned], offersFor([warned]), knowledge, [], VOCABULARY);
    expect(result.ranked).toHaveLength(0);
    expect(result.excluded[0]).toMatchObject({ code: 'PRODUCT_WARNING' });
  });

  it.each(['skin', 'hair'] as const)('holds a %s product with a manufacturer contraindication until answered', area => {
    const type = area === 'hair' ? 'shampoo' : 'serum';
    const warned = facts({ name: 'Manufacturer Warned Product', type, area, warnings: [{ kind: 'CONTRAINDICATION', condition: 'BREASTFEEDING' }] });
    const runWarning = (breastfeeding: 'YES' | 'NO' | 'UNKNOWN') => recommend(
      query({ careArea: area, productTypes: [type], safety: { ...UNKNOWN_SAFETY, breastfeeding } }),
      [warned], offersFor([warned]), [], [], VOCABULARY,
    );
    const unanswered = runWarning('UNKNOWN');
    expect(unanswered.ranked).toEqual([]);
    expect(unanswered.needsSafetyAnswer).toEqual(['BREASTFEEDING']);
    expect(unanswered.excluded).toEqual([expect.objectContaining({ code: 'SAFETY_UNANSWERED', condition: 'BREASTFEEDING' })]);
    expect(runWarning('YES').excluded[0].code).toBe('PRODUCT_WARNING');
    expect(runWarning('NO').ranked.map(item => item.productId)).toEqual([warned.productId]);
  });

  it('reads an active named on the product as NAMED and says the ingredient list is not verified', () => {
    const actives = productActives(niacinamideSerum, VOCABULARY);
    expect(actives).toEqual([expect.objectContaining({ slug: 'niacinamide', level: 'NAMED' })]);
    const result = run({ concerns: ['acne'], safety: { ...UNKNOWN_SAFETY, pregnant: 'NO' } });
    const reason = result.ranked.find(r => r.productId === niacinamideSerum.productId)!.reasons.find(r => r.code === 'ACTIVE_FOR_CONCERN')!;
    expect(reason.textEn).toContain('not verified');
  });

  it('reports a family named on the product once, not every member of the family', () => {
    const vitC = facts({ name: 'Vitamin C Glow Serum', type: 'serum' });
    expect(productActives(vitC, VOCABULARY)).toEqual([expect.objectContaining({ slug: 'family:vitamin-c', familySlug: 'vitamin-c', level: 'NAMED' })]);
  });

  it('does not treat a merely listed ingredient as a reason to recommend', () => {
    const result = recommend(query({ careArea: 'hair', concerns: ['acne'] }), [shampoo], offersFor([shampoo]), knowledge, [], VOCABULARY);
    expect(result.ranked).toHaveLength(0);
    // ...but the product type is a sourced link for its own concern
    const dandruff = recommend(query({ careArea: 'hair', concerns: ['dandruff'] }), [shampoo], offersFor([shampoo]), knowledge, [], VOCABULARY);
    expect(dandruff.ranked).toHaveLength(1);
    expect(dandruff.ranked[0].reasons.find(r => r.code === 'ACTIVE_FOR_CONCERN')!.textEn).toContain('amount not stated');
  });

  it('ranks the skin-type match first and flags a mismatch instead of hiding it', () => {
    const result = run({ productTypes: ['cleanser'], skinType: 'oily' });
    expect(names(result)).toEqual(['Gentle Foaming Cleanser', 'Cream Cleanser']);
    expect(result.ranked[0].reasons.some(r => r.code === 'SKIN_TYPE' && r.basis === 'VERIFIED')).toBe(true);
    expect(result.ranked[1].cautions.some(c => c.code === 'SKIN_TYPE_MISMATCH')).toBe(true);
  });

  it('says what is unknown rather than guessing', () => {
    const bare = facts({ name: 'Plain Moisturizer', type: 'moisturizer', usage: null });
    const result = recommend(query({ productTypes: ['moisturizer'], skinType: 'dry', fragranceFree: true, unresolvedAvoidTerms: ['بارابين'] }),
      [bare], offersFor([bare]), knowledge, [], VOCABULARY);
    expect(result.ranked[0].unknowns.map(u => u.code)).toEqual(expect.arrayContaining(['SKIN_TYPE_SUITABILITY', 'FRAGRANCE_STATUS', 'INGREDIENT_LIST', 'USAGE']));
  });

  it('honours fragrance-free and stated sensitivities as hard exclusions', () => {
    const fragrance = run({ careArea: 'hair', productTypes: ['shampoo'], fragranceFree: true });
    expect(fragrance.ranked).toHaveLength(0);
    expect(fragrance.excluded[0]).toMatchObject({ code: 'CONTAINS_FRAGRANCE' });

    const retinolId = retinolSerum.productIngredients![0].ingredientId;
    const avoided = run({ productTypes: ['serum'], avoidIngredientIds: [retinolId], safety: { ...UNKNOWN_SAFETY, pregnant: 'NO' } });
    expect(names(avoided)).toEqual(['Niacinamide Facial Serum']);
    expect(avoided.excluded.find(e => e.productId === retinolSerum.productId)).toMatchObject({ code: 'AVOIDED_INGREDIENT' });
    // the unverified product is kept, with an honest warning about its ingredient list
    expect(avoided.ranked[0].unknowns.some(u => u.code === 'INGREDIENT_LIST')).toBe(true);
  });

  it('leaves availability and price to Commerce', () => {
    const offers = offersFor(all, { 'Gentle Foaming Cleanser': { canOrder: false }, 'Cream Cleanser': { price: { amount: 900, currency: 'EGP', compareAtAmount: null } } });
    const unavailable = run({ productTypes: ['cleanser'] }, offers);
    expect(names(unavailable)).toEqual(['Cream Cleanser']);
    expect(unavailable.ranked[0].price).toEqual({ amount: 900, currency: 'EGP', compareAtAmount: null });
    expect(unavailable.excluded.find(e => e.productId === cleanser.productId)).toMatchObject({ code: 'UNAVAILABLE' });

    const budget = run({ productTypes: ['cleanser'], budgetMax: 500 }, offers);
    expect(budget.ranked).toHaveLength(0);
    expect(budget.excluded.map(e => e.code).sort()).toEqual(['OVER_BUDGET', 'UNAVAILABLE']);
  });

  it('answers a no-match honestly and keeps a mixed answer varied', () => {
    expect(run({ concerns: ['hair-loss'] }).ranked).toEqual([]);
    const mixed = run({ concerns: ['acne'], safety: { ...UNKNOWN_SAFETY, pregnant: 'NO' }, perTypeLimit: 1 });
    const types = mixed.ranked.map(r => r.productType);
    expect(new Set(types).size).toBe(types.length);
    expect(run({ concerns: ['acne'], limit: 2, safety: { ...UNKNOWN_SAFETY, pregnant: 'NO' } }).ranked).toHaveLength(2);
  });

  it('is deterministic', () => {
    const a = run({ concerns: ['acne'], skinType: 'oily', safety: { ...UNKNOWN_SAFETY, pregnant: 'NO' } });
    const b = run({ concerns: ['acne'], skinType: 'oily', safety: { ...UNKNOWN_SAFETY, pregnant: 'NO' } });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });
});
