import { cookies } from 'next/headers';
import { isLocale, type Locale } from './messages';

export const LOCALE_COOKIE = 'shena-locale';

/** Arabic (Egypt) is the primary experience language; English is opt-in via the language switch. */
export const DEFAULT_LOCALE: Locale = 'ar';

export function getLocale(): Locale {
  const value = cookies().get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
