import type { Concern } from '@/features/catalog/api/discovery';
import type { IconName } from '@/components/ui/icon';
import type { Messages } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';

/**
 * The six customer concerns the homepage leads with. These are CONCERNS (what the customer wants to fix), never product
 * categories. Each chip resolves against the public concern taxonomy (GET /care/concerns): when a concern with a matching
 * slug or name exists the chip opens the concern filter (`?concern=`); until the taxonomy defines it, the chip opens the
 * catalog search for its label, which is a supported route and never a dead end.
 */
export interface ConcernChip {
  id: string;
  icon: IconName;
  image: string;
  label: keyof Messages;
  desc: keyof Messages;
  area: Concern['careArea'];
  /** Lower-case fragments matched against a taxonomy concern's slug and name. */
  match: readonly string[];
}

export const CONCERN_CHIPS: readonly ConcernChip[] = [
  { id: 'acne', icon: 'acne', image: '/assets/concerns/acne.webp', label: 'homeConcernAcne', desc: 'homeConcernAcneDesc', area: 'skin', match: ['acne', 'breakout', 'pimple', 'حب'] },
  { id: 'pigmentation', icon: 'pigmentation', image: '/assets/concerns/pigmentation.webp', label: 'homeConcernPigmentation', desc: 'homeConcernPigmentationDesc', area: 'skin', match: ['pigment', 'dark-spot', 'dark spot', 'discolo', 'تصبغ', 'بقع'] },
  { id: 'dryness', icon: 'dryness', image: '/assets/concerns/dryness.webp', label: 'homeConcernDryness', desc: 'homeConcernDrynessDesc', area: 'skin', match: ['dryness', 'dry-skin', 'dry skin', 'dehydrat', 'جفاف'] },
  { id: 'sensitivity', icon: 'sparkles', image: '/assets/concerns/sensitivity.webp', label: 'homeConcernSensitivity', desc: 'homeConcernSensitivityDesc', area: 'skin', match: ['sensitiv', 'redness', 'irritat', 'حساسية', 'احمرار'] },
  { id: 'hair-loss', icon: 'hair-loss', image: '/assets/concerns/hair-loss.webp', label: 'homeConcernHairLoss', desc: 'homeConcernHairLossDesc', area: 'hair', match: ['hair-loss', 'hair loss', 'hair-fall', 'hair fall', 'shedding', 'thinning', 'تساقط'] },
  { id: 'dandruff', icon: 'sparkles', image: '/assets/concerns/dandruff.webp', label: 'homeConcernDandruff', desc: 'homeConcernDandruffDesc', area: 'hair', match: ['dandruff', 'scalp', 'flak', 'قشرة', 'فروة'] },
] as const;

/** The taxonomy concern a chip stands for, if the catalog defines one (same care area, slug or name contains a fragment). */
export function findConcern(chip: ConcernChip, concerns: readonly Concern[]): Concern | undefined {
  return concerns.find((c) => {
    if (c.careArea !== chip.area) return false;
    const haystack = `${c.slug} ${c.name}`.toLowerCase();
    return chip.match.some((fragment) => haystack.includes(fragment));
  });
}

export function concernHref(chip: ConcernChip, label: string, concerns: readonly Concern[]): { href: string; filtered: boolean } {
  const concern = findConcern(chip, concerns);
  return concern ? { href: routes.productsByConcern(concern.slug), filtered: true } : { href: routes.productsSearch(label), filtered: false };
}
