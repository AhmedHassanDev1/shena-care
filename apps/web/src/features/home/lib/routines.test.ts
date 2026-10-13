import { clampIndex } from './carousel';
import { canOptimizeImage } from './images';
import { defaultRoutineArtwork, formatStepCount, selectSuggestedRoutines, SUGGESTED_MAX } from './routines';
import type { RoutineSummary } from './routines';

const routine = (id: string, title = `Routine ${id}`): RoutineSummary => ({
  id,
  title,
  description: null,
  careArea: 'skin',
  stepCount: 3,
  href: `/routines/${id}`,
  imageSrc: null,
});

describe('selectSuggestedRoutines', () => {
  it('returns nothing for no routines', () => {
    expect(selectSuggestedRoutines([])).toEqual([]);
  });

  it('caps the list', () => {
    const all = Array.from({ length: 9 }, (_, i) => routine(String(i)));
    expect(selectSuggestedRoutines(all)).toHaveLength(SUGGESTED_MAX);
  });

  it('de-duplicates by id, not by title', () => {
    const picked = selectSuggestedRoutines([routine('1', 'Summer'), routine('1', 'Summer again'), routine('2', 'Summer')]);
    expect(picked.map((r) => r.id)).toEqual(['1', '2']);
  });
});

describe('formatStepCount', () => {
  it.each([
    [1, 'خطوة واحدة'],
    [2, 'خطوتان'],
    [3, '3 خطوات'],
    [10, '10 خطوات'],
    [11, '11 خطوة'],
  ])('Arabic agreement for %i', (count, expected) => {
    expect(formatStepCount(count, 'ar')).toBe(expected);
  });

  it('English singular and plural', () => {
    expect(formatStepCount(1, 'en')).toBe('1 step');
    expect(formatStepCount(4, 'en')).toBe('4 steps');
  });
});

describe('defaultRoutineArtwork', () => {
  it('maps each care area to its own artwork', () => {
    expect(defaultRoutineArtwork('skin')).toContain('skincare');
    expect(defaultRoutineArtwork('hair')).toContain('haircare');
  });
});

describe('clampIndex', () => {
  it('keeps the active slide within bounds', () => {
    expect(clampIndex(-1, 3)).toBe(0);
    expect(clampIndex(5, 3)).toBe(2);
    expect(clampIndex(1, 3)).toBe(1);
    expect(clampIndex(0, 0)).toBe(0);
  });
});

describe('canOptimizeImage', () => {
  it('accepts configured CDNs only and survives malformed URLs', () => {
    expect(canOptimizeImage('https://cdn.shopify.com/x.png')).toBe(true);
    expect(canOptimizeImage('https://res.cloudinary.com/demo/x.png')).toBe(true);
    expect(canOptimizeImage('https://example.com/x.png')).toBe(false);
    expect(canOptimizeImage('not a url')).toBe(false);
  });
});
