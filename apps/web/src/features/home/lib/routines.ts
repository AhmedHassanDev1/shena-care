import type { Locale } from '@/lib/i18n/messages';

export type CareArea = 'skin' | 'hair';

/** A published care routine as the home page shows it. `href` is where its detail page lives. */
export interface RoutineSummary {
  id: string;
  title: string;
  description: string | null;
  careArea: CareArea;
  stepCount: number;
  href: string;
  /** Editorial artwork for the hero; the care-area default is used when absent. */
  imageSrc: string | null;
}

export const HERO_MAX_SLIDES = 3;
export const RECOMMENDED_MAX = 3;

/** Hero routines first; the recommended list never repeats one of them (matched by id, never by title). */
export function splitRoutines(
  routines: RoutineSummary[],
): { hero: RoutineSummary[]; recommended: RoutineSummary[] } {
  const unique = [...new Map(routines.map((routine) => [routine.id, routine])).values()];
  const hero = unique.slice(0, HERO_MAX_SLIDES);
  const heroIds = new Set(hero.map((routine) => routine.id));
  return { hero, recommended: unique.filter((routine) => !heroIds.has(routine.id)).slice(0, RECOMMENDED_MAX) };
}

export function defaultRoutineArtwork(careArea: CareArea): string {
  return careArea === 'hair' ? '/assets/home/haircare-still-life.webp' : '/assets/home/skincare-still-life.webp';
}

/** "خطوتان" / "3 خطوات" / "12 خطوة" — Arabic number agreement. */
export function formatStepCount(count: number, locale: Locale): string {
  if (locale === 'en') return `${count} ${count === 1 ? 'step' : 'steps'}`;
  if (count === 1) return 'خطوة واحدة';
  if (count === 2) return 'خطوتان';
  return count <= 10 ? `${count} خطوات` : `${count} خطوة`;
}
