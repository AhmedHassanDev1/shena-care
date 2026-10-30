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
  label: keyof Messages;
  area: Concern['careArea'];
  /** Lower-case fragments matched against a taxonomy concern's slug and name. */
  match: readonly string[];
}

export const CONCERN_CHIPS: readonly ConcernChip[] = [
  { id: 'acne', icon: 'acne', label: 'homeConcernAcne', area: 'skin', match: ['acne', 'breakout', 'pimple', 'حب'] },
  { id: 'dryness', icon: 'dryness', label: 'homeConcernDryness', area: 'skin', match: ['dryness', 'dry-skin', 'dry skin', 'dehydrat', 'جفاف'] },
  { id: 'pigmentation', icon: 'pigmentation', label: 'homeConcernPigmentation', area: 'skin', match: ['pigment', 'dark-spot', 'dark spot', 'discolo', 'تصبغ'] },
  { id: 'hair-loss', icon: 'hair-loss', label: 'homeConcernHairLoss', area: 'hair', match: ['hair-loss', 'hair loss', 'hair-fall', 'hair fall', 'shedding', 'thinning', 'تساقط'] },
  { id: 'wrinkles', icon: 'wrinkles', label: 'homeConcernWrinkles', area: 'skin', match: ['wrinkle', 'fine-line', 'fine line', 'aging', 'ageing', 'تجاعيد'] },
  { id: 'frizz', icon: 'frizz', label: 'homeConcernFrizz', area: 'hair', match: ['frizz', 'هيشان'] },
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
