import { clampIndex } from './carousel';
import { canOptimizeImage } from './images';
import { defaultRoutineArtwork, formatStepCount, HERO_MAX_SLIDES, RECOMMENDED_MAX, splitRoutines } from './routines';
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

describe('splitRoutines', () => {
  it('returns nothing for no routines', () => {
    expect(splitRoutines([])).toEqual({ hero: [], recommended: [] });
  });

  it('never repeats a hero routine in the recommended list', () => {
    const all = Array.from({ length: 9 }, (_, i) => routine(String(i)));
    const { hero, recommended } = splitRoutines(all);
    expect(hero).toHaveLength(HERO_MAX_SLIDES);
    expect(recommended).toHaveLength(RECOMMENDED_MAX);
    const heroIds = new Set(hero.map((r) => r.id));
    expect(recommended.some((r) => heroIds.has(r.id))).toBe(false);
  });

  it('de-duplicates by id, not by title', () => {
    const { hero } = splitRoutines([routine('1', 'Summer'), routine('1', 'Summer again'), routine('2', 'Summer')]);
    expect(hero.map((r) => r.id)).toEqual(['1', '2']);
  });

  it('puts everything in the hero when there are few routines', () => {
    const { hero, recommended } = splitRoutines([routine('1'), routine('2')]);
    expect(hero).toHaveLength(2);
    expect(recommended).toEqual([]);
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
