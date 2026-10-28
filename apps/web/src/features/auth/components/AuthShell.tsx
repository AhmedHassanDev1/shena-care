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

      <PageContainer className="pb-10 pt-4 lg:pt-12">
        <section className="mx-auto flex max-w-[480px] flex-col gap-5 px-0 pt-6 lg:px-1">{children}</section>
      </PageContainer>
    </div>
  );
}
