import { formatEgp, formatPackSize } from './format';

describe('formatEgp', () => {
  it('formats Egyptian pounds consistently with Latin digits', () => {
    expect(formatEgp(450, 'EGP', 'ar')).toBe('450 ج.م');
    expect(formatEgp(99.5, 'EGP', 'ar')).toBe('99.5 ج.م');
    expect(formatEgp(1490, 'EGP', 'ar')).toBe('1,490 ج.م');
    expect(formatEgp(450, 'EGP', 'en')).toBe('EGP 450');
  });

  it('refuses to label an amount in a currency it does not know', () => {
    expect(formatEgp(450, 'SAR', 'ar')).toBeNull();
    expect(formatEgp(Number.NaN, 'EGP', 'ar')).toBeNull();
  });
});

describe('formatPackSize', () => {
  it('translates known units and passes unknown ones through', () => {
    expect(formatPackSize(500, 'ml', 'ar')).toBe('500 مل');
    expect(formatPackSize(500, 'ml', 'en')).toBe('500 ml');
    expect(formatPackSize(30, 'pcs', 'ar')).toBe('30 pcs');
  });

  it('returns null without a usable size', () => {
    expect(formatPackSize(null, 'ml', 'ar')).toBeNull();
    expect(formatPackSize(0, 'ml', 'ar')).toBeNull();
  });
});
