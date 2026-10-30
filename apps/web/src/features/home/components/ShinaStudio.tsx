import Image from 'next/image';
import Link from 'next/link';
import { Section } from '@/components/layout/section';
import { buttonVariants } from '@/components/ui/button-variants';
import { GlassBadge } from '@/components/ui/glass-badge';
import { Icon } from '@/components/ui/icon';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { routes, shellRoutes } from '@/lib/routes';
import { HOME_IMAGES } from '../lib/home-images';
import { sectionNumber } from '../lib/section-number';

/**
 * Custom routine studio (Stitch section 04): a dusk photograph under a night scrim, one line of promise, two actions.
 * The still life is mirrored under RTL so its empty, dark side is the side the text sits on. Shina is advisory and the
 * copy says so.
 */
export function ShinaStudio() {
  const locale = getLocale();
  const m = getMessages(locale);
  const studio = HOME_IMAGES.studio;

  return (
    <Section labelledBy="home-studio-title">
      <div className="relative isolate flex min-h-[400px] flex-col justify-end overflow-hidden rounded-sheet bg-night p-6 text-bone lg:min-h-[460px] lg:justify-center lg:p-14">
        <div aria-hidden="true" className="absolute inset-0 -z-10 rtl:-scale-x-100">
          <Image src={studio.src} alt="" fill sizes="(min-width: 1280px) 1152px, 100vw" className="object-cover" style={{ objectPosition: studio.position }} />
        </div>
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-t from-night via-night/55 to-night/0 lg:ltr:bg-gradient-to-r lg:rtl:bg-gradient-to-l lg:from-night/85 lg:via-night/30 lg:to-night/0" />

        <div className="flex max-w-narrow flex-col items-start gap-4 lg:gap-5">
          <GlassBadge tone="photo" dot="bg-saffron">
            {m.homeStudioChip}
          </GlassBadge>
          <h2 id="home-studio-title" className="m-0 text-display-2 text-bone lg:text-display-1">
            <span aria-hidden="true" className="me-3 text-label tabular-nums text-saffron-light">
              {sectionNumber(4, locale)}
            </span>
            {m.homeStudioTitle}
          </h2>
          <p className="m-0 text-body text-bone/85 lg:text-17 lg:leading-30">{m.homeStudioBody}</p>
          <div className="flex flex-wrap gap-3 pt-1">
            <Link href={routes.routineBuilder} className={buttonVariants({ variant: 'onDark', size: 'l' })}>
              {m.navBuildRoutine}
              <Icon name="arrow-forward" size={20} strokeWidth={2} />
            </Link>
            <Link
              href={shellRoutes.shina}
              className="inline-flex h-control-l items-center justify-center rounded-pill bg-bone/15 px-5.5 text-16 font-semibold text-bone no-underline shadow-hairline-on-dark backdrop-blur-xl transition-colors duration-fast ease-standard hover:bg-bone/25"
            >
              {m.footerAskShina}
            </Link>
          </div>
          <p className="m-0 text-13 leading-20 text-bone/75">{m.homeStudioNote}</p>
        </div>
      </div>
    </Section>
  );
}
