import { currencyLabel, formatAmount, formatDate, formatEgp, formatNumber, formatPackSize, formatTime } from './format';

const ARABIC_INDIC = /[٠-٩]/;
const WESTERN = /[0-9]/;

describe('formatEgp', () => {
  it('shows Arabic-Indic digits, the Arabic thousands separator and «ج.م» after the amount in Arabic', () => {
    expect(formatEgp(3320, 'EGP', 'ar')).toBe('٣٬٣٢٠ ج.م');
    expect(formatEgp(450, 'EGP', 'ar')).toBe('٤٥٠ ج.م');
    expect(formatEgp(99.5, 'EGP', 'ar')).toBe('٩٩٫٥ ج.م');
  });

  it('keeps Western digits and "EGP 1,050" in English', () => {
    expect(formatEgp(1050, 'EGP', 'en')).toBe('EGP 1,050');
    expect(formatEgp(450, 'EGP', 'en')).toBe('EGP 450');
  });

  it('refuses to label an amount in a currency it does not know', () => {
    expect(formatEgp(450, 'SAR', 'ar')).toBeNull();
    expect(formatEgp(Number.NaN, 'EGP', 'ar')).toBeNull();
  });

  it('never mixes numeral systems inside one price', () => {
    const ar = formatEgp(1234567.25, 'EGP', 'ar')!;
    expect(ar).toMatch(ARABIC_INDIC);
    expect(ar).not.toMatch(WESTERN);
    const en = formatEgp(1234567.25, 'EGP', 'en')!;
    expect(en).not.toMatch(ARABIC_INDIC);
  });
});

describe('formatAmount / currencyLabel', () => {
  it('splits amount and currency for layouts that style them apart', () => {
    expect(formatAmount(750, 'ar')).toBe('٧٥٠');
    expect(currencyLabel('ar')).toBe('ج.م');
    expect(formatAmount(750, 'en')).toBe('750');
    expect(currencyLabel('en')).toBe('EGP');
  });
});

describe('formatPackSize', () => {
  it('translates known units and localises the digits', () => {
    expect(formatPackSize(500, 'ml', 'ar')).toBe('٥٠٠ مل');
    expect(formatPackSize(500, 'ml', 'en')).toBe('500 ml');
    expect(formatPackSize(30, 'pcs', 'ar')).toBe('٣٠ pcs');
  });

  it('returns null without a usable size', () => {
    expect(formatPackSize(null, 'ml', 'ar')).toBeNull();
    expect(formatPackSize(0, 'ml', 'ar')).toBeNull();
  });
});

describe('formatNumber', () => {
  it('uses the digits of the interface language', () => {
    expect(formatNumber(6, 'ar')).toBe('٦');
    expect(formatNumber(1250, 'ar')).toBe('١٬٢٥٠');
    expect(formatNumber(1250, 'en')).toBe('1,250');
  });
});

describe('formatDate / formatTime', () => {
  it('reads «١٨ أكتوبر ٢٠٢٦» and «٩:١٢ ص» in Arabic (Cairo time)', () => {
    expect(formatDate('2026-10-18T10:00:00Z', 'ar')).toBe('١٨ أكتوبر ٢٠٢٦');
    expect(formatTime('2026-10-18T06:12:00Z', 'ar')).toBe('٩:١٢ ص');
  });

  it('keeps Western digits in English', () => {
    expect(formatDate('2026-10-18T10:00:00Z', 'en')).toBe('Oct 18, 2026');
    expect(formatTime('2026-10-18T06:12:00Z', 'en')).not.toMatch(ARABIC_INDIC);
  });
});
