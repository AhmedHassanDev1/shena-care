import type { ReactNode } from 'react';
import { LocaleSwitch } from '@/components/LocaleSwitch';
import { WordmarkLink } from '@/components/navigation/wordmark-link';
import { ProductArt } from '@/components/ui/product-art';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';

/**
 * Sign-in frame shared by every step, composed per form factor (design-system layout rules).
 *
 * Mobile / tablet: one column — wordmark and language switch, then the form at its mobile width (≤ 400px).
 * Desktop (lg+): the form keeps that width on the start side; the end side is a `sand` panel holding the
 * large arch and product silhouettes — composition, not empty space. The panel is decorative: every
 * step works without it.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const m = getMessages(getLocale());

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-2 lg:gap-6 lg:p-6">
      <div className="flex min-h-dvh flex-col px-4 pb-10 pt-2 sm:px-6 lg:min-h-0 lg:px-12 lg:pb-6 lg:pt-4">
        <header className="flex items-center justify-between gap-4">
          <WordmarkLink label={m.authHome} size="m" />
          <LocaleSwitch />
        </header>

        <div className="mx-auto mt-8 w-full max-w-[25rem] lg:my-auto lg:py-10">{children}</div>
      </div>

      <aside aria-hidden="true" className="relative hidden overflow-hidden rounded-lg bg-sand lg:block">
        <div className="absolute inset-x-[14%] bottom-0 top-[16%] shape-arch-l bg-sand-deep" />
        <div className="absolute inset-x-[14%] bottom-[9%] flex items-end justify-center gap-[5%]">
          <ProductArt shape="jar" tint="henna" size={100} className="h-auto w-[24%]" />
          <ProductArt shape="dropper" tint="malachite" size={140} className="h-auto w-[34%]" />
          <ProductArt shape="pump" tint="saffron" size={120} className="h-auto w-[28%]" />
        </div>
      </aside>
    </div>
  );
}
