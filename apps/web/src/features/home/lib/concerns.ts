import type { ConcernGlyphName } from '@/components/ui/concern-glyph';

/** A care concern as `GET /care/concerns` returns it. */
export interface Concern {
  id: string;
  name: string;
  slug: string;
  careArea: 'skin' | 'hair';
  description: string | null;
  isActive: boolean;
}

/** One abstract design-system glyph per well-known concern slug; unknown slugs fall back to their care area. */
const BY_SLUG: Record<string, ConcernGlyphName> = {
  acne: 'acne',
  dryness: 'dry',
  pigmentation: 'pigment',
  'fine-lines': 'sensitive',
  dullness: 'pigment',
  'hair-loss': 'hairfall',
  dandruff: 'acne',
};

export function concernGlyph(concern: Pick<Concern, 'slug' | 'careArea'>): ConcernGlyphName {
  return BY_SLUG[concern.slug] ?? (concern.careArea === 'hair' ? 'frizz' : 'oily');
}
