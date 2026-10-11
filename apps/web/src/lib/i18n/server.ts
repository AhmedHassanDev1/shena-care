import { cookies } from 'next/headers';
import { isLocale, LOCALE_COOKIE_NAME, type Locale } from './messages';

export const LOCALE_COOKIE = LOCALE_COOKIE_NAME;

/** Arabic (Egypt) is the primary experience language; English is opt-in via the language switch. */
export const DEFAULT_LOCALE: Locale = 'ar';

export function getLocale(): Locale {
  const value = cookies().get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
