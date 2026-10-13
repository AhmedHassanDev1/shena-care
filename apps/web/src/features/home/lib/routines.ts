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
  /** Editorial artwork; the card is graphic by design, so this is optional and currently unused by Home. */
  imageSrc: string | null;
  /** When in the day the routine is meant for — only when the source provides it. */
  timeOfDay?: 'am' | 'pm' | 'any';
  /** Display name of the concern the routine targets — only when the source provides it. */
  concern?: string | null;
}

export const SUGGESTED_MAX = 3;

/** The routines Home suggests: unique by id (never by title), at most SUGGESTED_MAX. */
export function selectSuggestedRoutines(routines: RoutineSummary[]): RoutineSummary[] {
  return [...new Map(routines.map((routine) => [routine.id, routine])).values()].slice(0, SUGGESTED_MAX);
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
