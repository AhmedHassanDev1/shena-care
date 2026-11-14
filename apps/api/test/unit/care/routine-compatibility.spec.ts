import { CompatibilityRule, CompatibilitySafety, checkRoutine } from '../../../src/modules/care/engine/routine-compatibility';
import type { CareProductFacts } from '../../../src/modules/catalog/public';
import { facts, skuOf } from '../../fixtures/care-facts';

const UNKNOWN: CompatibilitySafety = { pregnant: 'UNKNOWN', breastfeeding: 'UNKNOWN', prescriptionTopical: 'UNKNOWN', oralRetinoid: 'UNKNOWN' };
const NOT_PREGNANT: CompatibilitySafety = { ...UNKNOWN, pregnant: 'NO', breastfeeding: 'NO', oralRetinoid: 'NO' };
const source = { sourceTitle: 'Source', sourceUrl: 'https://example.test/rule' };
const RULES: CompatibilityRule[] = [
  { key: 'retinoids-pregnancy', kind: 'EXCLUDE_CONDITION', subjectType: 'FAMILY', subject: 'retinoids', otherType: null, other: null, condition: 'PREGNANT', noteAr: 'الريتينويدات مش بتتقترح أثناء الحمل.', ...source },
  { key: 'max-one-retinoid', kind: 'MAX_ONE_PER_AREA', subjectType: 'FAMILY', subject: 'retinoids', otherType: null, other: null, condition: null, noteAr: 'ريتينويد واحد بس على نفس المنطقة.', ...source },
  { key: 'bpo-tretinoin', kind: 'SEPARATE_TIMES', subjectType: 'INGREDIENT', subject: 'benzoyl-peroxide', otherType: 'INGREDIENT', other: 'tretinoin', condition: null, noteAr: 'واحد الصبح والتاني بالليل.', ...source },
];

describe('Routine compatibility (shared by the builder, My Routine, AI proposals and the Studio)', () => {
  const cleanser = facts({ name: 'Cleanser', type: 'cleanser', rank: 2, ingredients: [['glycerin', 'vehicles', false]] });
  const moisturizer = facts({ name: 'Moisturizer', type: 'moisturizer', rank: 8, ingredients: [['glycerin', 'vehicles', false]] });
  const sunscreen = facts({ name: 'Sunscreen', type: 'sunscreen', rank: 9, periodEligibility: 'AM', ingredients: [['zinc-oxide', 'mineral-uv-filters', true]] });
  const retinol = facts({ name: 'Retinol Serum', type: 'serum', rank: 6, ingredients: [['retinol', 'retinoids', true]] });
  const retinal = facts({ name: 'Retinal Cream', type: 'serum', rank: 6, ingredients: [['retinal', 'retinoids', true]] });
  const bpo = facts({ name: 'BPO Gel', type: 'treatment', role: 'TREATMENT', rank: 5, ingredients: [['benzoyl-peroxide', 'benzoyl-peroxide', true]] });
  const tretinoin = facts({ name: 'Tretinoin Cream', type: 'treatment', role: 'TREATMENT', rank: 5, ingredients: [['tretinoin', 'retinoids', true]] });
  const unverified = facts({ name: 'Mystery Serum', type: 'serum', rank: 6 });
  const all = [cleanser, moisturizer, sunscreen, retinol, retinal, bpo, tretinoin, unverified];

  const check = (steps: Array<[CareProductFacts, 'AM' | 'PM' | 'AS_NEEDED']>, safety = NOT_PREGNANT, unavailable: CareProductFacts[] = []) => checkRoutine(
    steps.map(([product, slot]) => ({ skuId: skuOf(product), slot })),
    new Map(all.map(product => [skuOf(product), product])),
    new Map(all.map(product => [skuOf(product), !unavailable.includes(product)])),
    RULES, safety);
  const codes = (result: ReturnType<typeof check>) => result.issues.map(issue => `${issue.severity}:${issue.code}`);

  it('passes a simple routine and suggests the application order', () => {
    const result = check([[moisturizer, 'AM'], [sunscreen, 'AM'], [cleanser, 'AM'], [cleanser, 'PM'], [moisturizer, 'PM']]);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.order.AM).toEqual([skuOf(cleanser), skuOf(moisturizer), skuOf(sunscreen)]);
  });

  it('blocks a retinoid for a pregnant customer and asks when pregnancy is unknown', () => {
    const pregnant = check([[retinol, 'PM'], [sunscreen, 'AM']], { ...UNKNOWN, pregnant: 'YES' });
    expect(pregnant.ok).toBe(false);
    expect(pregnant.issues.find(i => i.code === 'SAFETY_CONDITION')).toMatchObject({ severity: 'BLOCK', ruleKey: 'retinoids-pregnancy', skuIds: [skuOf(retinol)], source: { title: 'Source' } });

    const unknown = check([[retinol, 'PM'], [sunscreen, 'AM']], UNKNOWN);
    expect(unknown.ok).toBe(true); // UNKNOWN does not block, and is never read as NO: the customer is asked
    expect(codes(unknown)).toContain('INFO:SAFETY_UNANSWERED');
  });

  it('allows only one product of a family and names both', () => {
    const result = check([[retinol, 'PM'], [retinal, 'PM'], [sunscreen, 'AM']]);
    expect(result.ok).toBe(false);
    expect(result.issues.find(i => i.code === 'MAX_ONE_PER_AREA')!.skuIds).toEqual([skuOf(retinol), skuOf(retinal)]);
  });

  it('warns when two products must be used at different times, and clears once they are separated', () => {
    expect(codes(check([[bpo, 'PM'], [tretinoin, 'PM'], [sunscreen, 'AM']]))).toContain('WARN:SEPARATE_TIMES');
    expect(codes(check([[bpo, 'AM'], [tretinoin, 'PM'], [sunscreen, 'AM']]))).not.toContain('WARN:SEPARATE_TIMES');
  });

  it('advises a morning sunscreen with a sun-sensitising active and flags a sunscreen placed in the evening', () => {
    expect(codes(check([[cleanser, 'PM'], [retinol, 'PM']]))).toContain('WARN:SUNSCREEN_ADVISED');
    expect(codes(check([[sunscreen, 'PM']]))).toContain('INFO:PERIOD_MISMATCH');
  });

  it('says so when ingredients are not verified instead of declaring the routine compatible', () => {
    const result = check([[cleanser, 'AM'], [unverified, 'PM']]);
    expect(result.ok).toBe(true);
    expect(result.issues.find(i => i.code === 'INGREDIENTS_UNVERIFIED')).toMatchObject({ severity: 'INFO', skuIds: [skuOf(unverified)] });
  });

  it('reports duplicate steps, unavailable and unknown products', () => {
    expect(codes(check([[retinol, 'PM'], [unverified, 'PM'], [sunscreen, 'AM']]))).toContain('INFO:DUPLICATE_ROLE');
    expect(codes(check([[cleanser, 'AM']], NOT_PREGNANT, [cleanser]))).toContain('WARN:PRODUCT_UNAVAILABLE');
    const unknown = checkRoutine([{ skuId: '11111111-1111-4111-8111-111111111111', slot: 'AM' }], new Map(), new Map(), RULES, NOT_PREGNANT);
    expect(unknown.ok).toBe(false);
    expect(unknown.issues[0]).toMatchObject({ code: 'PRODUCT_UNKNOWN', severity: 'BLOCK' });
  });
});
