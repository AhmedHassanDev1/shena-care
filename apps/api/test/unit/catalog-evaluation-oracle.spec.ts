import { compareEvaluationIdentity } from '../../scripts/lib/catalog-evaluation-oracle';

describe('manufacturer evaluation oracle', () => {
  const expected = { name: 'StarVille Femme Intimate Cleansing Foam Refresh 150 ml', brand: 'StarVille', sourceBrand: 'StarVille', size: 150, sizeUnit: 'ml', packCount: null };
  const actual = { name: 'Femme Intimate Cleansing Foam Refresh', brand: 'StarVille', size: 150, sizeUnit: 'ml', packCount: null };
  it('does not count the right brand and size with a different named variant as correct', () => {
    expect(compareEvaluationIdentity(expected, { ...actual, name: 'Femme Intimate Cleansing Foam Hydrate' })).toEqual({ brand: true, name: false, size: true, pack: true, correct: false });
  });
  it('accepts only formatting differences after removing the stated brand and measurement', () => {
    expect(compareEvaluationIdentity(expected, { ...actual, name: 'Femme Intimate Cleansing-Foam REFRESH' }).correct).toBe(true);
  });
  it('does not conceal a missing pack count or a wrong physical size', () => {
    expect(compareEvaluationIdentity({ ...expected, packCount: 4 }, actual).correct).toBe(false);
    expect(compareEvaluationIdentity(expected, { ...actual, size: 200 }).correct).toBe(false);
  });
  it('keeps strength, formulation and unrecognized identity words in the comparison', () => {
    expect(compareEvaluationIdentity({ ...expected, name: 'StarVille Niacinamide 10% + Zinc 1% Serum 150 ml' }, { ...actual, name: 'Niacinamide 5% + Zinc 1% Serum' }).correct).toBe(false);
  });
  it('compares a multipack name without dropping the separate pack-count check', () => {
    const source = { name: 'Eva Hair Serum (4 Ampoules * 15 Ml)', brand: 'Eva Cosmetics', sourceBrand: 'Eva', size: 15, sizeUnit: 'ml', packCount: 4 };
    expect(compareEvaluationIdentity(source, { name: 'Hair Serum', brand: 'Eva Cosmetics', size: 15, sizeUnit: 'ml', packCount: 4 }).correct).toBe(true);
    expect(compareEvaluationIdentity(source, { name: 'Hair Serum', brand: 'Eva Cosmetics', size: 15, sizeUnit: 'ml', packCount: null }).correct).toBe(false);
  });
});
