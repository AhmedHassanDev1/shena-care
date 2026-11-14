import { CONCERN_CHIPS, findConcern } from '@/features/home/lib/concern-chips';
import type { Concern } from '@/features/catalog/api/discovery';

/**
 * The registered editorial photo for a concern (public/assets/concerns, the homepage concern chips), when one of the
 * homepage chips stands for it. Otherwise null, and the tile shows the concern's lead catalog packshot instead:
 * a concern never gets a drawn or generated picture.
 */
export function concernPhoto(concern: { slug: string; name: string; careArea: 'skin' | 'hair' }): string | null {
  const asTaxonomy = [{ ...concern, id: concern.slug, description: null, isActive: true }] as unknown as Concern[];
  return CONCERN_CHIPS.find((chip) => findConcern(chip, asTaxonomy))?.image ?? null;
}
