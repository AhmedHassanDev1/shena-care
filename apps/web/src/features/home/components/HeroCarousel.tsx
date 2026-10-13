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

/**
 * One campaign, composed per form factor rather than shrunk:
 * - phones: a 4:5 frame; the picture fills its upper two thirds and fades into the atmosphere behind the copy;
 * - tablet and up: the picture fills the end 64% of a wide frame (face centred in it) and the copy sits on a
 *   scrim from the start side, which also hides the picture's start edge.
 * The scrim is solid behind the text, so contrast never depends on the photograph.
 */
function CampaignSlide({ campaign, priority }: { campaign: Campaign; priority: boolean }) {
  const photo = campaign.art.kind === 'photo' ? campaign.art : null;

  return (
    <article
      data-atmosphere={campaign.atmosphere}
      className="relative isolate flex aspect-[4/5] max-h-[34rem] w-full flex-col justify-end overflow-hidden bg-gradient-to-b from-atm-surface to-atm-wash sm:aspect-auto sm:h-[26rem] sm:justify-center lg:h-[30rem]"
    >
      {photo ? (
        // Phones: the upper two thirds; tablet and up: the end 64%. Either way the face stays clear of the copy.
        <div className="absolute end-0 start-0 top-0 -z-10 h-[66%] sm:bottom-0 sm:start-auto sm:h-auto sm:w-[64%]">
          <Image
            src={photo.src}
            alt=""
            fill
            priority={priority}
            draggable={false}
            sizes="(min-width: 1280px) 1240px, 100vw"
            style={{ '--pos': photo.position } as CSSProperties}
            className="object-cover object-[var(--pos)] rtl:-scale-x-100"
          />
        </div>
      ) : (
        <ConcernConstellation className="absolute end-0 start-0 top-0 -z-10 h-1/2 sm:bottom-0 sm:start-auto sm:h-auto sm:w-1/2" />
      )}

      {/* Scrim: from the bottom on phones, from the start side from tablet up. Decorative. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-t from-atm-wash from-45% via-atm-wash/80 via-55% to-transparent to-75% sm:hidden"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 hidden from-atm-wash from-35% via-atm-wash/80 via-45% to-transparent to-60% ltr:bg-gradient-to-r rtl:bg-gradient-to-l sm:block"
      />

      <div className="flex flex-col items-start gap-2.5 px-5 pb-14 sm:max-w-[26rem] sm:gap-3 sm:px-10 sm:pb-6 lg:max-w-[34rem] lg:gap-4 lg:px-14">
        <p className="inline-flex items-center gap-1.5 rounded-pill bg-card/85 px-3 py-1 text-label text-atm-ink">
          <span aria-hidden="true" className="size-1.5 rounded-pill bg-atm-accent" />
          {campaign.eyebrow}
        </p>
        <h2 className="text-display-l text-foreground lg:text-display-xl">{campaign.title}</h2>
        <p className="line-clamp-2 max-w-[28rem] text-body text-ink-soft lg:line-clamp-none lg:text-body-l">{campaign.body}</p>
        <Link href={campaign.href} draggable={false} className={cn(buttonVariants({ size: 'lg' }), 'mt-1')}>
          {campaign.cta}
          <Icon name="arrow-forward" size={20} />
        </Link>
      </div>
    </article>
  );
}

/**
 * The hero: three distinct editorial campaigns (own picture, atmosphere, headline and a real destination) in
 * a minimal swiper — swipe, trackpad or mouse drag, arrow keys, and a small centered pagination. No arrows and
 * no autoplay: see components/ui/carousel.tsx.
 */
export function HeroCarousel() {
  const m = getMessages(getLocale());
  const campaigns = getCampaigns(m);

  return (
    <Carousel
      labels={{ region: m.heroCarouselLabel, slideLabel: m.heroSlideLabel, goTo: m.heroGoTo }}
      className="overflow-hidden rounded-lg"
      paginationClassName="absolute inset-x-0 bottom-1 sm:bottom-2"
      slides={campaigns.map((campaign, index) => (
        <CampaignSlide key={campaign.id} campaign={campaign} priority={index === 0} />
      ))}
    />
  );
}
