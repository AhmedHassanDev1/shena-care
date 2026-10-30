import { formatNumber } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/messages';

/** Two-digit section index as the Stitch structure numbers its sections: «٠١» in Arabic, «01» in English. */
export function sectionNumber(n: number, locale: Locale): string {
  return `${formatNumber(0, locale)}${formatNumber(n, locale)}`;
}
