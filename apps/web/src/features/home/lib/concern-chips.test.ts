import { CONCERN_CHIPS, concernHref, findConcern } from './concern-chips';

const concern = (slug: string, name: string, careArea: 'skin' | 'hair') => ({ id: slug, slug, name, careArea, description: null, isActive: true });
const chip = (id: string) => CONCERN_CHIPS.find((c) => c.id === id)!;

describe('homepage concern chips', () => {
  it('are the six customer concerns, not product categories', () => {
    expect(CONCERN_CHIPS.map((c) => c.id)).toEqual(['acne', 'dryness', 'pigmentation', 'hair-loss', 'wrinkles', 'frizz']);
    for (const c of CONCERN_CHIPS) expect(c.match.every((fragment) => !['cleansers', 'serums', 'shampoos', 'moisturizers', 'sunscreens'].includes(fragment))).toBe(true);
  });

  it('open the concern filter when the taxonomy defines the concern', () => {
    const taxonomy = [concern('acne-prone', 'Acne', 'skin'), concern('frizz-control', 'Frizz', 'hair')];
    expect(concernHref(chip('acne'), 'حب الشباب', taxonomy)).toEqual({ href: '/products?concern=acne-prone', filtered: true });
    expect(concernHref(chip('frizz'), 'الهيشان', taxonomy)).toEqual({ href: '/products?concern=frizz-control', filtered: true });
  });

  it('fall back to the catalog search for the label until the taxonomy defines the concern', () => {
    const result = concernHref(chip('wrinkles'), 'التجاعيد', []);
    expect(result.filtered).toBe(false);
    expect(result.href).toBe(`/products?q=${encodeURIComponent('التجاعيد')}`);
  });

  it('never match a concern of the other care area', () => {
    // «Dry hair» is a hair concern; it must not satisfy the skin concern «الجفاف».
    expect(findConcern(chip('dryness'), [concern('dry-hair', 'Dry hair', 'hair')])).toBeUndefined();
    expect(findConcern(chip('dryness'), [concern('dryness', 'Dryness', 'skin')])?.slug).toBe('dryness');
  });
});
