import { indexFromScroll, scrollLeftForIndex, stepForKey, wrapIndex } from './carousel-math';

describe('carousel math', () => {
  it('reads the slide index from LTR and RTL scroll offsets', () => {
    expect(indexFromScroll(0, 400, 4)).toBe(0);
    expect(indexFromScroll(410, 400, 4)).toBe(1);
    expect(indexFromScroll(-820, 400, 4)).toBe(2); // RTL scrolls into negative offsets
    expect(indexFromScroll(-5000, 400, 4)).toBe(3); // clamped
  });

  it('computes the scroll target for the container direction', () => {
    expect(scrollLeftForIndex(2, 400, false)).toBe(800);
    expect(scrollLeftForIndex(2, 400, true)).toBe(-800);
    expect(scrollLeftForIndex(0, 400, true)).toBe(0);
  });

  it('wraps previous/next', () => {
    expect(wrapIndex(4, 4)).toBe(0);
    expect(wrapIndex(-1, 4)).toBe(3);
    expect(wrapIndex(1, 0)).toBe(0);
  });

  it('maps arrow keys to visual direction', () => {
    expect(stepForKey('ArrowLeft', true)).toBe(1);
    expect(stepForKey('ArrowRight', true)).toBe(-1);
    expect(stepForKey('ArrowLeft', false)).toBe(-1);
    expect(stepForKey('ArrowRight', false)).toBe(1);
    expect(stepForKey('Enter', true)).toBe(0);
  });
});
