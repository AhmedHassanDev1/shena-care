import type { ReactNode } from 'react';
import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { routes } from '@/lib/routes';
import { Wordmark } from '@/components/ui/wordmark';
import { AuthBackLink } from './AuthBackLink';

/**
 * Sign-in frame (AuthEntryD / AuthOtpD / AuthMobile, Authentication Addendum §Screens): its own page in Focus Mode —
 * back plus one primary action, no floating nav.
 *  - desktop: wordmark + SHINACARE and the contextual back link; the form (max 480) at the reading start and the
 *    Sahel-blue editorial panel in its neutral fallback (shutter-light field, headline, benefits, no photograph —
 *    the licensed SAHEL image does not exist yet);
 *  - phone: 56-tall header with the contextual back control at the start and the wordmark at the end, then the form.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const m = getMessages(getLocale());
  const [line1, line2] = m.authPanelTitle.split('|');

  return (
    <div className="min-h-dvh bg-bone">
      <header className="bg-bone max-lg:shadow-hairline-bottom">
        <div className="flex h-header-m items-center justify-between pe-4 ps-2 lg:hidden">
          <AuthBackLink variant="phone" />
          <Link href={routes.home} aria-label={m.shellHome} className="inline-flex min-h-control-s items-center text-night no-underline">
            <Wordmark />
          </Link>
        </div>
        <PageContainer className="hidden items-center gap-6 py-3.5 lg:flex">
          <Link href={routes.home} aria-label={m.shellHome} className="inline-flex min-h-control-s items-center text-night no-underline">
            <Wordmark withLatin />
          </Link>
          <span className="ms-auto">
            <AuthBackLink variant="desktop" />
          </span>
        </PageContainer>
      </header>

      <PageContainer className="pb-10 lg:grid lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)] lg:items-start lg:gap-20 lg:pt-2">
        <section className="flex flex-col gap-5 px-0 pt-6 lg:px-1 lg:pt-16">{children}</section>

        <aside
          aria-label={m.authPanelLabel}
          className="field-sahel shutter-light warm hidden min-h-auth-panel-h flex-col justify-between rounded-sheet shadow-elevation-3 lg:flex"
        >
          <div className="px-13 pt-14">
            <span className="flex items-center gap-3 text-12 font-semibold leading-17">
              <span>{m.authPanelEyebrow}</span>
              <span aria-hidden="true" className="h-[1.5px] w-18 bg-bone/55" />
            </span>
          </div>
          <div className="flex flex-col gap-5.5 px-13 pb-14">
            <p className="m-0 text-display-hero">
              {line1}
              <br />
              {line2}
            </p>
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0 pt-5.5 text-15 leading-24 shadow-hairline-on-blue">
              {[m.authPanelBenefit1, m.authPanelBenefit2, m.authPanelBenefit3].map((benefit) => (
                <li key={benefit} className="flex items-center gap-2.5">
                  <span aria-hidden="true" className="h-[1.5px] w-4.5 bg-saffron" />
                  {benefit}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </PageContainer>
    </div>
  );
}
