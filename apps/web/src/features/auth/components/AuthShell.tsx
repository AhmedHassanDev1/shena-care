import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { LocaleSwitch } from '@/components/LocaleSwitch';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { routes } from '@/lib/routes';

/** Original geometric studio still life (public/assets/auth). Decorative: every step works without it. */
const STUDIO_ARTWORK = '/assets/auth/beauty-studio.svg';

/**
 * Sign-in frame shared by every step.
 *
 * Desktop (lg+): the studio scene fills the viewport and the form sits on a light card on the LEFT
 * in both reading directions — the scene's arch and plinths stay visible on the right.
 * Mobile: a compact hero whose lower edge is a true elliptical curve (border-radius, not a fade),
 * then the brand and the form on the warm alabaster page surface.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const m = getMessages(getLocale());

  return (
    <div className="relative min-h-dvh lg:flex lg:items-center lg:py-12">
      <div aria-hidden="true" className="fixed inset-0 hidden bg-ambient lg:block">
        <Image
          src={STUDIO_ARTWORK}
          alt=""
          fill
          priority
          unoptimized
          sizes="100vw"
          // Anchored right so narrower desktops crop the empty wall behind the card, not the scene.
          className="object-cover object-right"
        />
      </div>

      {/*
        Hero curve: a 50%-wide elliptical radius on both bottom corners joins into one continuous arc
        across the full width, 28px deep at the centre. The image is clipped to it by overflow-hidden;
        `isolate` keeps the clip on the scaled image in Safari. Height stays within 128–160px.
      */}
      <div
        aria-hidden="true"
        className="relative isolate h-[clamp(8rem,38vw,10rem)] overflow-hidden rounded-b-[50%_1.75rem] bg-ambient lg:hidden"
      >
        <Image
          src={STUDIO_ARTWORK}
          alt=""
          fill
          priority
          unoptimized
          sizes="100vw"
          // Zoomed onto the plinths and products so the hero reads at phone width; wider screens show more scene.
          className="origin-[68%_60%] scale-[1.4] object-cover object-[68%_54%] sm:scale-100"
        />
      </div>

      <LocaleSwitch className="absolute end-3 top-3 z-20 h-10 rounded-full bg-card/90 px-3 shadow-raised hover:bg-card lg:end-6 lg:top-6" />

      <div
        className={
          // Physical lg:ml / lg:mr-auto on purpose: the card stays on the left in RTL and LTR alike.
          'relative mx-auto w-full max-w-[28rem] px-4 pb-10 pt-5 sm:px-6 ' +
          'lg:ml-[max(3rem,6vw)] lg:mr-auto lg:w-[28.5rem] lg:max-w-none lg:rounded-lg ' +
          'lg:bg-card lg:px-10 lg:pb-10 lg:pt-11 lg:shadow-overlay'
        }
      >
        <Link
          href={routes.home}
          aria-label={m.authHome}
          className="mx-auto flex w-fit flex-col items-center gap-2.5 rounded-md px-2 py-1"
        >
          {/* Latin wordmark: lang="en" keeps the tracking that the global Arabic rule resets. */}
          <span lang="en" dir="ltr" className="ps-[0.32em] text-[1.3125rem] font-semibold leading-none tracking-[0.32em] text-foreground">
            SHINACARE
          </span>
          <span className="h-[3px] w-9 rounded-full bg-brand-mark" />
        </Link>

        <div className="mt-7 lg:mt-9">{children}</div>
      </div>
    </div>
  );
}
