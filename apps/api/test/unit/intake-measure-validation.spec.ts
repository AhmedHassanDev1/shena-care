import { readMeasures } from '../../src/modules/intake/public';

describe('intake physical measure validation', () => {
  it.each([
    ['Cleanser 1,5 L', 1.5, 'l'],
    ['Cleanser .5 L', 0.5, 'l'],
    ['Cleanser ٠٫٥ لتر', 0.5, 'l'],
  ])('reads %s as the complete decimal, never its trailing digits', (text, size, unit) => {
    expect(readMeasures(String(text)).measures).toEqual([{ size, unit, text: expect.any(String) }]);
  });
  it.each(['Cleanser 1,000 ml', 'Cleanser 1.2.5 ml', 'Cleanser -50 ml'])(
    'does not reinterpret ambiguous or invalid quantity %s as a valid size', text => {
      expect(readMeasures(text).measures).toEqual([]);
    },
  );
  it.each(['Hair serum (4 Ampoules * 15 Ml)', 'Hair serum 4 vials x 15 ml', 'سيروم ٤ أمبولات ١٥ مل'])(
    'keeps the stated pack count separate from per-unit volume: %s', text => {
      expect(readMeasures(text)).toMatchObject({ packCount: 4, measures: [{ size: 15, unit: 'ml' }] });
    },
  );
  it('does not reinterpret an ampoule volume as a pack count', () => {
    expect(readMeasures('Hair serum ampoules 15 ml').packCount).toBeNull();
  });
});
