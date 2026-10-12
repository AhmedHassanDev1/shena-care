import { CircleDot, Droplet, Hourglass, Leaf, Sparkles, Sun, Wind } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** A care concern as `GET /care/concerns` returns it. */
export interface Concern {
  id: string;
  name: string;
  slug: string;
  careArea: 'skin' | 'hair';
  description: string | null;
  isActive: boolean;
}

/** One distinct icon per well-known concern slug; unknown slugs fall back to their care area. */
const BY_SLUG: Record<string, LucideIcon> = {
  acne: CircleDot,
  dryness: Droplet,
  pigmentation: Sun,
  'fine-lines': Hourglass,
  dullness: Sparkles,
  'hair-loss': Wind,
  dandruff: Leaf,
};

export function concernIcon(concern: Pick<Concern, 'slug' | 'careArea'>): LucideIcon {
  return BY_SLUG[concern.slug] ?? (concern.careArea === 'hair' ? Wind : Droplet);
}
