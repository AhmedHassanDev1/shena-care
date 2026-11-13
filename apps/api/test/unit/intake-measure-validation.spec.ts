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
});
