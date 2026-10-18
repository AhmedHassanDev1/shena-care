'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { LOCALE_COOKIE_NAME } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';

/**
 * Arabic ⇄ English. Not drawn on the V18 boards; it sits in the footer's legal row so the English storefront stays
 * reachable without adding chrome. The label is always written in the language it switches to.
 */
export function LocaleSwitch({ tone = 'onLight', className }: { tone?: 'onLight' | 'onNight'; className?: string }) {
  const locale = useLocale();
  const m = useMessages();
  const router = useRouter();
  const next = locale === 'ar' ? 'en' : 'ar';

  const switchLocale = () => {
    document.cookie = `${LOCALE_COOKIE_NAME}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    document.documentElement.lang = next;
    document.documentElement.dir = next === 'ar' ? 'rtl' : 'ltr';
    router.refresh();
  };

  return (
    <button
      type="button"
      onClick={switchLocale}
      className={cn(
        'inline-flex min-h-control-s items-center bg-transparent px-0 font-text text-12 font-semibold underline underline-offset-4',
        tone === 'onNight' ? 'text-bone hover:text-saffron' : 'text-night hover:text-blue',
        className
      )}
    >
      {/* Visible text stays part of the accessible name (WCAG 2.5.3). */}
      <span className="sr-only">{m.switchLanguage}: </span>
      <span lang={next}>{next === 'ar' ? m.arabic : m.english}</span>
    </button>
  );
}
