import { cookies } from 'next/headers';
import { isLocale, type Locale } from './messages';

export const LOCALE_COOKIE = 'shena-locale';

export function getLocale(): Locale {
  const value = cookies().get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : 'en';
}
