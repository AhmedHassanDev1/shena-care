import type { ConcernGlyphName } from '@/components/ui/concern-glyph';
import type { Atmosphere } from '../data/campaigns';

/** A care concern as the public taxonomy `GET /care/concerns` returns it (active concerns only). */
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
  dullness: 'glow',
  'hair-loss': 'hairfall',
  dandruff: 'flakes',
};

export function concernGlyph(concern: Pick<Concern, 'slug' | 'careArea'>): ConcernGlyphName {
  return BY_SLUG[concern.slug] ?? (concern.careArea === 'hair' ? 'frizz' : 'oily');
}

/**
 * Chip color per concern, chosen so neighbours in the default order never share a hue (the label and glyph,
 * not the color, identify the concern). Unknown slugs follow their care area.
 */
const ATMOSPHERE_BY_SLUG: Record<string, Atmosphere> = {
  acne: 'rose',
  dryness: 'peach',
  pigmentation: 'saffron',
  'fine-lines': 'lilac',
  dullness: 'rose',
  'hair-loss': 'malachite',
  dandruff: 'lilac',
};

export function concernAtmosphere(concern: Pick<Concern, 'slug' | 'careArea'>): Atmosphere {
  return ATMOSPHERE_BY_SLUG[concern.slug] ?? (concern.careArea === 'hair' ? 'malachite' : 'rose');
}

export type ConcernsView =
  | { status: 'loading' }
  /** The request failed: never shown as "no concerns", and never replaced by fixtures. */
  | { status: 'error' }
  | { status: 'ready'; concerns: Concern[]; isPreview: boolean };

/**
 * What the concern section shows for a request state. Real active concerns always win; fixtures fill in only
 * when the real list is EMPTY and design preview is on; a failure stays a failure.
 */
export function resolveConcernsView(
  request: { isPending: boolean; isError: boolean; data: Concern[] | undefined },
  preview: { enabled: boolean; fixtures: Concern[] },
): ConcernsView {
  if (request.isPending) return { status: 'loading' };
  if (request.isError || !request.data) return { status: 'error' };
  const real = request.data.filter((concern) => concern.isActive);
  if (real.length === 0 && preview.enabled) return { status: 'ready', concerns: preview.fixtures, isPreview: true };
  return { status: 'ready', concerns: real, isPreview: false };
}
