import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { HOME_IMAGES } from '@/features/home/lib/home-images';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { routes } from '@/lib/routes';
import { Wordmark } from '@/components/ui/wordmark';
import { AuthBackLink } from './AuthBackLink';

/**
 * Sign-in and code-entry shell. On desktop the form owns the reading-start half on the chalk ground and a registered
 * campaign photograph (no text, no overlay) holds the other half at full height; on phones there is only the form, so
 * the keyboard and the one field stay the whole screen. The photo is decorative (`alt=""`): nothing on it carries
 * information the form does not.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const m = getMessages(getLocale());
  const photo = HOME_IMAGES.routineSkin;

  return (
    <div className="min-h-dvh bg-chalk lg:grid lg:grid-cols-2">
      <div className="flex min-h-dvh flex-col">
        <header className="max-lg:shadow-hairline-bottom">
          <div className="flex h-header-m items-center justify-between pe-4 ps-2 lg:hidden">
            <AuthBackLink variant="phone" />
            <Link href={routes.home} aria-label={m.shellHome} className="inline-flex min-h-control-s items-center text-ink no-underline">
              <Wordmark />
            </Link>
          </div>
          <PageContainer className="hidden items-center gap-6 py-5 lg:flex lg:px-10">
            <Link href={routes.home} aria-label={m.shellHome} className="inline-flex min-h-control-s items-center text-ink no-underline">
              <Wordmark withLatin />
            </Link>
            <span className="ms-auto">
              <AuthBackLink variant="desktop" />
            </span>
          </PageContainer>
        </header>

        <main className="flex flex-1 flex-col justify-center px-4 pb-12 pt-8 lg:px-10 lg:pb-16 lg:pt-0">
          <section className="mx-auto flex w-full max-w-[440px] flex-col gap-6">{children}</section>
        </main>
      </div>

      <div aria-hidden="true" className="relative hidden p-4 lg:sticky lg:top-0 lg:block lg:h-dvh">
        <div className="relative size-full overflow-hidden rounded-image bg-sand">
          <Image
            src={photo.src}
            alt=""
            fill
            sizes="(min-width: 1024px) 50vw, 0px"
            className="object-cover"
            style={{ objectPosition: photo.position }}
          />
        </div>
      </div>
    </div>
  );
}
