import type { CSSProperties } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button-variants';
import { Carousel } from '@/components/ui/carousel';
import { Icon } from '@/components/ui/icon';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { cn } from '@/lib/utils';
import { getCampaigns } from '../data/campaigns';
import type { Campaign } from '../data/campaigns';
import { ConcernConstellation } from './ConcernConstellation';

/** Time between automatic slide changes. Autoplay stops on hover, focus, touch, off-screen, reduced motion, and after any manual use. */
const AUTOPLAY_MS = 7000;

function CampaignSlide({ campaign, priority }: { campaign: Campaign; priority: boolean }) {
  return (
    <article
      data-atmosphere={campaign.atmosphere}
      className="relative isolate grid h-full overflow-hidden bg-gradient-to-br from-atm-wash to-atm-surface lg:min-h-[31rem] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
    >
      {/* Depth: two soft atmosphere orbs behind the media. Decorative. */}
      <span aria-hidden="true" className="pointer-events-none absolute -top-20 end-[-4rem] -z-10 size-72 rounded-pill bg-atm-accent/25 blur-3xl" />
      <span aria-hidden="true" className="pointer-events-none absolute bottom-[-5rem] start-[-3rem] -z-10 size-64 rounded-pill bg-atm-accent/15 blur-3xl" />

      {/* Text first in the DOM (reading order, start side); media is shown first on phones. */}
      <div className="relative flex flex-col justify-center gap-3 px-5 pb-[4.5rem] pt-1 lg:gap-4 lg:px-12 lg:pb-24 lg:pt-12">
        <p className="inline-flex items-center gap-2 text-label text-atm-ink">
          <span aria-hidden="true" className="size-2 rounded-pill bg-atm-accent" />
          {campaign.eyebrow}
        </p>
        <h2 className="text-display-m text-foreground lg:text-display-l">{campaign.title}</h2>
        <p className="max-w-[32rem] text-body text-ink-soft lg:text-body-l">{campaign.body}</p>
        <Link href={campaign.href} className={cn(buttonVariants({ size: 'lg' }), 'mt-1 w-full sm:w-fit')}>
          {campaign.cta}
          <Icon name="arrow-forward" size={20} />
        </Link>
      </div>

      <div
        className="relative order-first m-3 aspect-[16/11] overflow-hidden shape-arch bg-atm-surface sm:aspect-[16/9] lg:order-none lg:m-6 lg:aspect-auto lg:shape-arch-l"
        style={
          campaign.art.kind === 'photo'
            ? ({ '--pos-m': campaign.art.mobilePosition, '--pos-d': campaign.art.desktopPosition } as CSSProperties)
            : undefined
        }
      >
        {campaign.art.kind === 'photo' ? (
          <Image
            src={campaign.art.src}
            alt=""
            fill
            priority={priority}
            sizes="(min-width: 1280px) 700px, (min-width: 1024px) 55vw, 100vw"
            // Photographs are composed with the subject on the right: flipped in RTL so it sits on the end side, away from the copy.
            className="object-cover object-[var(--pos-m)] rtl:-scale-x-100 lg:object-[var(--pos-d)]"
          />
        ) : (
          <ConcernConstellation />
        )}
      </div>
    </article>
  );
}

/**
 * The hero: four distinct editorial campaigns (own photograph or artwork, atmosphere, headline and a real
 * destination) in a working scroll-snap carousel — see components/ui/carousel.tsx for the interaction model.
 */
export function HeroCarousel() {
  const m = getMessages(getLocale());
  const campaigns = getCampaigns(m);

  return (
    <Carousel
      autoPlayMs={AUTOPLAY_MS}
      labels={{
        region: m.heroCarouselLabel,
        previous: m.heroPrevious,
        next: m.heroNext,
        pause: m.heroPause,
        play: m.heroPlay,
        slideLabel: m.heroSlideLabel,
        goTo: m.heroGoTo,
      }}
      className="overflow-hidden rounded-lg border border-border"
      controlsClassName="absolute bottom-4 start-5 lg:bottom-8 lg:start-12"
      slides={campaigns.map((campaign, index) => (
        <CampaignSlide key={campaign.id} campaign={campaign} priority={index === 0} />
      ))}
    />
  );
}
