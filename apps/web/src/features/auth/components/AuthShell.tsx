import type { ReactNode } from 'react';
import { LocaleSwitch } from '@/components/LocaleSwitch';
import { WordmarkLink } from '@/components/navigation/wordmark-link';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { AuthBand, AuthPanel } from './AuthVisual';

/**
 * Sign-in frame shared by every step, composed per form factor.
 *
 * Phones / tablets: a compact photographic band (brand + language over Home's campaign portrait), then the form at
 * its mobile width — the form is the first thing the eye lands on.
 * Desktop (lg+): the form on a calm light panel at the start side; the end side is an editorial panel with the
 * campaign portrait and the three reasons to sign up. The visuals are decorative: every step works without them.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const m = getMessages(getLocale());

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-6 lg:p-6">
      <div className="flex min-h-dvh flex-col lg:min-h-0">
        <div className="relative lg:hidden">
          <AuthBand />
          <header className="absolute inset-x-0 top-0 flex items-center justify-between gap-4 px-4 pt-2 sm:px-6">
            <WordmarkLink label={m.authHome} size="m" />
            {/* Sits over the photograph: a light pill keeps it legible. */}
            <LocaleSwitch className="bg-card/85 hover:bg-card" />
          </header>
        </div>

        <header className="hidden items-center justify-between gap-4 px-12 pt-4 lg:flex">
          <WordmarkLink label={m.authHome} size="m" />
          <LocaleSwitch />
        </header>

        <div className="mx-auto w-full max-w-[25rem] flex-1 px-4 pb-10 pt-7 sm:px-0 lg:my-auto lg:flex-none lg:px-0 lg:py-10">{children}</div>
      </div>

      <AuthPanel title={m.authVisualBenefitsLabel} benefits={[m.ctaBenefit1, m.ctaBenefit2, m.ctaBenefit3]} />
    </div>
  );
}
