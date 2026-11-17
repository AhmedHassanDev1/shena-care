import { sectionNumber } from './section-number';

describe('sectionNumber', () => {
  it('pads to two digits in Western digits across all languages', () => {
    expect(sectionNumber(1, 'ar')).toBe('01');
    expect(sectionNumber(4, 'ar')).toBe('04');
    expect(sectionNumber(2, 'en')).toBe('02');
  });
});
