'use client';

import { useRouter } from 'next/navigation';
import { Languages } from 'lucide-react';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { LOCALE_COOKIE_NAME } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';

/** Toggles between Arabic and English. The label is always written in the language it switches to. */
export function LocaleSwitch({ className }: { className?: string }) {
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
        'inline-flex h-11 items-center gap-1.5 rounded-md px-2.5 text-support font-medium text-foreground',
        'transition-colors duration-fast ease-standard hover:bg-secondary',
        className
      )}
    >
      <Languages aria-hidden="true" className="size-[18px] text-muted-foreground" />
      {/* Visible text stays part of the accessible name (WCAG 2.5.3). */}
      <span className="sr-only">{m.switchLanguage}: </span>
      <span lang={next}>{next === 'ar' ? m.arabic : m.english}</span>
    </button>
  );
}
