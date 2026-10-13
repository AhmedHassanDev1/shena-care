import { concernAtmosphere, concernGlyph, resolveConcernsView } from './concerns';
import type { Concern } from './concerns';

const concern = (slug: string, isActive = true, careArea: Concern['careArea'] = 'skin'): Concern => ({
  id: `id-${slug}`,
  name: slug,
  slug,
  careArea,
  description: null,
  isActive,
});
const fixtures = [concern('preview-acne')];
const request = (over: Partial<{ isPending: boolean; isError: boolean; data: Concern[] | undefined }>) => ({
  isPending: false,
  isError: false,
  data: undefined,
  ...over,
});

describe('resolveConcernsView', () => {
  it('reports loading while the request is pending', () => {
    expect(resolveConcernsView(request({ isPending: true }), { enabled: true, fixtures })).toEqual({ status: 'loading' });
  });

  it('keeps a failed request an error, even in design preview (never "no concerns", never fixtures)', () => {
    expect(resolveConcernsView(request({ isError: true }), { enabled: true, fixtures })).toEqual({ status: 'error' });
  });

  it('shows real active concerns and drops inactive ones', () => {
    const view = resolveConcernsView(request({ data: [concern('acne'), concern('retired', false)] }), { enabled: true, fixtures });
    expect(view).toEqual({ status: 'ready', concerns: [concern('acne')], isPreview: false });
  });

  it('fills an empty taxonomy with labelled fixtures only in design preview', () => {
    expect(resolveConcernsView(request({ data: [] }), { enabled: true, fixtures })).toEqual({ status: 'ready', concerns: fixtures, isPreview: true });
    expect(resolveConcernsView(request({ data: [] }), { enabled: false, fixtures })).toEqual({ status: 'ready', concerns: [], isPreview: false });
  });
});

describe('concern presentation', () => {
  it('gives every well-known concern its own glyph', () => {
    const slugs = ['acne', 'dryness', 'pigmentation', 'fine-lines', 'dullness', 'hair-loss', 'dandruff'];
    const glyphs = slugs.map((slug) => concernGlyph(concern(slug)));
    expect(new Set(glyphs).size).toBe(slugs.length);
  });

  it('never gives neighbours in the default order the same color', () => {
    const slugs = ['acne', 'dryness', 'pigmentation', 'fine-lines', 'dullness', 'hair-loss', 'dandruff'];
    const colors = slugs.map((slug) => concernAtmosphere(concern(slug)));
    colors.slice(1).forEach((color, index) => expect(color).not.toBe(colors[index]));
  });

  it('falls back by care area for unknown slugs', () => {
    expect(concernGlyph(concern('new-thing', true, 'hair'))).toBe('frizz');
    expect(concernAtmosphere(concern('new-thing', true, 'hair'))).toBe('malachite');
  });
});
