import { sectionNumber } from './section-number';

describe('sectionNumber', () => {
  it('pads to two digits in the active digit system', () => {
    expect(sectionNumber(1, 'ar')).toBe('٠١');
    expect(sectionNumber(4, 'ar')).toBe('٠٤');
    expect(sectionNumber(2, 'en')).toBe('02');
  });
});
