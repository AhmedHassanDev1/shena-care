'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button-variants';
import { Icon } from '@/components/ui/icon';
import { iconButtonVariants } from '@/components/ui/icon-button';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';
import { clampIndex } from '../lib/carousel';

export interface HeroSlide {
  id: string;
  badge: string | null;
  title: string;
  description: string | null;
  ctaLabel: string;
  href: string;
  imageSrc: string;
}

/**
 * Featured routines as one full-bleed scene per slide: the artwork fills the rounded container and the
 * copy sits on a small solid surface, so text never depends on the picture's tones.
 * Manual navigation only (scroll-snap swipe, buttons, arrow keys); no autoplay.
 */
export function FeaturedRoutineHero({ slides }: { slides: HeroSlide[] }) {
  const m = useMessages();
  const trackRef = useRef<HTMLUListElement>(null);
  const slideRefs = useRef<Array<HTMLLIElement | null>>([]);
  const [active, setActive] = useState(0);
  const count = slides.length;
  const multiple = count > 1;

  // The snapped slide is the one mostly in view; this follows touch swipes as well as button presses.
  useEffect(() => {
    const track = trackRef.current;
    if (!track || !multiple) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.index));
        }
      },
      { root: track, threshold: 0.6 },
    );
    slideRefs.current.forEach((slide) => slide && observer.observe(slide));
    return () => observer.disconnect();
  }, [multiple, count]);

  const goTo = useCallback(
    (index: number) => {
      const target = clampIndex(index, count);
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      slideRefs.current[target]?.scrollIntoView({
        behavior: reduced ? 'auto' : 'smooth',
        block: 'nearest',
        inline: 'start',
      });
      setActive(target);
    },
    [count],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!multiple || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    // In RTL the next slide lies to the left.
    const forward = (event.key === 'ArrowLeft') === rtl;
    event.preventDefault();
    goTo(active + (forward ? 1 : -1));
  };

  if (count === 0) return null;

  return (
    <section
      aria-roledescription={multiple ? 'carousel' : undefined}
      aria-label={m.heroCarouselLabel}
      onKeyDown={onKeyDown}
      className="relative"
    >
      <ul
        ref={trackRef}
        className="flex h-[22rem] snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-md bg-sand [-ms-overflow-style:none] [scrollbar-width:none] lg:h-[26rem] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((slide, index) => (
          <li
            key={slide.id}
            ref={(element) => {
              slideRefs.current[index] = element;
            }}
            data-index={index}
            role={multiple ? 'group' : undefined}
            aria-roledescription={multiple ? 'slide' : undefined}
            aria-label={multiple ? fillMessage(m.heroSlideLabel, { n: index + 1, total: count }) : undefined}
            // Off-screen slides must not be reachable by keyboard or read out as if visible.
            {...(index === active ? {} : ({ inert: '' } as object))}
            className="relative h-full min-w-full snap-start"
          >
            <Image
              src={slide.imageSrc}
              alt=""
              fill
              priority={index === 0}
              // Neighbouring slides are small and one swipe away: load them up front so a swipe never lands on a blank scene.
              loading={index === 0 ? undefined : 'eager'}
              sizes="(min-width: 1280px) 1216px, 100vw"
              // Artwork keeps its empty wall on the reading-start side: mirrored in RTL, never behind the copy.
              className="object-cover object-right rtl:-scale-x-100"
            />

            <div className="absolute inset-x-3 bottom-3 rounded-md bg-card p-4 md:inset-x-auto md:bottom-4 md:start-4 md:w-[24rem] lg:inset-x-auto lg:bottom-auto lg:start-8 lg:top-1/2 lg:w-[26rem] lg:-translate-y-1/2 lg:p-6">
              {slide.badge ? (
                <Badge>{slide.badge}</Badge>
              ) : null}
              <h2 className={cn('text-title text-foreground lg:text-display-m', slide.badge && 'mt-2')}>{slide.title}</h2>
              {slide.description ? (
                <p className="mt-1.5 line-clamp-2 text-body-s text-muted-foreground">{slide.description}</p>
              ) : null}
              <Link href={slide.href} className={cn(buttonVariants(), 'mt-3 lg:mt-4')}>
                {slide.ctaLabel}
                <Icon name="arrow-forward" size={20} />
              </Link>
            </div>
          </li>
        ))}
      </ul>

      {multiple ? (
        <div className="absolute end-3 top-3 flex items-center rounded-pill bg-card lg:bottom-4 lg:end-4 lg:top-auto">
          <button
            type="button"
            onClick={() => goTo(active - 1)}
            disabled={active === 0}
            aria-label={m.heroPrevious}
            className={cn(iconButtonVariants(), 'hidden lg:grid')}
          >
            <Icon name="chevron-back" size={20} />
          </button>
          <div className="flex items-center px-1">
            {slides.map((slide, index) => (
              <button
                key={slide.id}
                type="button"
                onClick={() => goTo(index)}
                aria-label={fillMessage(m.heroGoTo, { n: index + 1 })}
                aria-current={index === active ? 'true' : undefined}
                className="group flex h-control-m w-7 items-center justify-center rounded-pill"
              >
                <span
                  className={cn(
                    'h-2 rounded-pill transition-all duration-settle ease-out',
                    index === active ? 'w-5 bg-primary' : 'w-2 bg-input group-hover:bg-primary',
                  )}
                />
              </button>
            ))}
          </div>
          <span aria-hidden="true" className="px-2 text-caption tabular-nums text-foreground" dir="ltr">
            {active + 1} / {count}
          </span>
          <button
            type="button"
            onClick={() => goTo(active + 1)}
            disabled={active === count - 1}
            aria-label={m.heroNext}
            className={cn(iconButtonVariants(), 'hidden lg:grid')}
          >
            <Icon name="chevron-forward" size={20} />
          </button>
          <p aria-live="polite" className="sr-only">
            {fillMessage(m.heroSlideLabel, { n: active + 1, total: count })}
          </p>
        </div>
      ) : null}
    </section>
  );
}
