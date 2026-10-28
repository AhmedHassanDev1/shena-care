import type { ReactNode } from 'react';
import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { routes } from '@/lib/routes';
import { Wordmark } from '@/components/ui/wordmark';
import { AuthBackLink } from './AuthBackLink';

/**
 * Neutral authentication shell container providing focused navigation, responsive header,
 * and form containment for phone sign-in and OTP verification flows.
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
