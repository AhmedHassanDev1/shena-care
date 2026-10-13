'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import { indexFromScroll, scrollLeftForIndex, stepForKey, wrapIndex } from './carousel-math';
import { Icon } from './icon';
import { iconButtonVariants } from './icon-button';

export interface CarouselLabels {
  /** Accessible name of the carousel region. */
  region: string;
  previous: string;
  next: string;
  pause: string;
  play: string;
  /** Template with `{n}` and `{total}` placeholders, e.g. "Slide {n} of {total}" (plain strings, so a server component can pass them). */
  slideLabel: string;
  /** Template with an `{n}` placeholder, e.g. "Go to slide {n}". */
  goTo: string;
}

export interface CarouselProps {
  /** One node per slide. Each slide fills the carousel width. */
  slides: React.ReactNode[];
  labels: CarouselLabels;
  /** Autoplay interval in ms; omit or 0 for no autoplay. Autoplay never runs under reduced motion. */
  autoPlayMs?: number;
  className?: string;
  /** Classes for the track (height, rounding). */
  trackClassName?: string;
  /** Classes for the controls row (position it over / under the slides). */
  controlsClassName?: string;
}

/**
 * Scroll-snap carousel. The browser owns touch scrolling and momentum (so swipe feels native); React only
 * reads the position to keep the dots, labels and `inert` state in sync and writes it for buttons, dots,
 * arrow keys and autoplay.
 *
 * - Direction aware: scroll offsets are negative in RTL (carousel-math.ts); arrow keys follow the visual side.
 * - State comes from the scroll position, never from an observer race, so a click always lands.
 * - Slides other than the current one are `inert` (no stray tab stops, hidden from assistive tech).
 * - Autoplay is restrained: off for reduced motion, paused on hover, focus, touch and when off-screen or in a
 *   hidden tab, stopped for good after the first manual navigation, with an explicit pause/play control (WCAG 2.2.2).
 */
export function Carousel({ slides, labels, autoPlayMs = 0, className, trackClassName, controlsClassName }: CarouselProps) {
  const count = slides.length;
  const trackRef = React.useRef<HTMLUListElement>(null);
  const slideRefs = React.useRef<Array<HTMLLIElement | null>>([]);
  const [active, setActive] = React.useState(0);
  const [autoplay, setAutoplay] = React.useState(autoPlayMs > 0);
  const [reducedMotion, setReducedMotion] = React.useState(false);
  const [hovering, setHovering] = React.useState(false);
  const [focusWithin, setFocusWithin] = React.useState(false);
  const [touching, setTouching] = React.useState(false);
  const [visible, setVisible] = React.useState(true);
  const [tabHidden, setTabHidden] = React.useState(false);

  const isRtl = () => (trackRef.current ? getComputedStyle(trackRef.current).direction === 'rtl' : false);

  const goTo = React.useCallback(
    (index: number, { manual = true }: { manual?: boolean } = {}) => {
      const track = trackRef.current;
      if (!track || count === 0) return;
      const target = wrapIndex(index, count);
      // Wrapping last → first (or back) would sweep through every slide; jump instead.
      const wrapped = target !== index;
      if (manual) setAutoplay(false);
      track.scrollTo({
        left: scrollLeftForIndex(target, track.clientWidth, isRtl()),
        behavior: reducedMotion || wrapped ? 'auto' : 'smooth',
      });
      setActive(target);
    },
    [count, reducedMotion],
  );

  // Follow the scroll position (touch swipes, wheel, keyboard scrolling and our own scrollTo all pass here).
  // setState bails out when the index is unchanged, so reading it on every scroll event is cheap.
  const onScroll = () => {
    const track = trackRef.current;
    if (track) setActive(indexFromScroll(track.scrollLeft, track.clientWidth, count));
  };

  // Keep the current slide aligned when the viewport (or the locale direction) changes.
  React.useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      track.scrollTo({ left: scrollLeftForIndex(active, track.clientWidth, isRtl()), behavior: 'auto' });
    });
    observer.observe(track);
    return () => observer.disconnect();
    // `active` is read at resize time only; re-subscribing on every slide would be wasted work.
  }, []);

  // Only the current slide is interactive and exposed to assistive technology.
  React.useEffect(() => {
    slideRefs.current.forEach((slide, index) => {
      if (slide) (slide as HTMLElement & { inert: boolean }).inert = index !== active;
    });
  }, [active]);

  React.useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  React.useEffect(() => {
    const onVisibility = () => setTabHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const rootRef = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.4 });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const running = autoplay && autoPlayMs > 0 && !reducedMotion && !hovering && !focusWithin && !touching && visible && !tabHidden && count > 1;

  React.useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => goTo(active + 1, { manual: false }), autoPlayMs);
    return () => window.clearTimeout(timer);
  }, [running, active, autoPlayMs, goTo]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const step = stepForKey(event.key, isRtl());
    if (step !== 0) {
      event.preventDefault();
      goTo(active + step);
    } else if (event.key === 'Home' && event.target === event.currentTarget) {
      event.preventDefault();
      goTo(0);
    } else if (event.key === 'End' && event.target === event.currentTarget) {
      event.preventDefault();
      goTo(count - 1);
    }
  };

  if (count === 0) return null;
  const multiple = count > 1;

  return (
    <section
      ref={rootRef}
      aria-roledescription="carousel"
      aria-label={labels.region}
      // Focusable so arrow keys work from the region itself; slides' own links stay in the tab order.
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocus={() => setFocusWithin(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocusWithin(false);
      }}
      onTouchStart={() => {
        setTouching(true);
        setAutoplay(false);
      }}
      onTouchEnd={() => setTouching(false)}
      className={cn('relative rounded-[inherit] outline-none focus-visible:shadow-[var(--focus-ring)]', className)}
    >
      <ul
        ref={trackRef}
        onScroll={onScroll}
        // Under autoplay the track announces nothing; once stopped, slide changes are polite.
        aria-live={running ? 'off' : 'polite'}
        className={cn(
          'flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          trackClassName,
        )}
      >
        {slides.map((slide, index) => (
          <li
            key={index}
            ref={(element) => {
              slideRefs.current[index] = element;
            }}
            role="group"
            aria-roledescription="slide"
            aria-label={labels.slideLabel.replace('{n}', String(index + 1)).replace('{total}', String(count))}
            className="w-full min-w-0 shrink-0 grow-0 basis-full snap-start [scroll-snap-stop:always]"
          >
            {slide}
          </li>
        ))}
      </ul>

      {multiple ? (
        <div className={cn('flex items-center gap-1', controlsClassName)}>
          {autoPlayMs > 0 ? (
            <button
              type="button"
              aria-pressed={!autoplay}
              aria-label={autoplay ? labels.pause : labels.play}
              onClick={() => setAutoplay((value) => !value)}
              className={cn(iconButtonVariants({ variant: 'outline', size: 's' }), 'bg-card')}
            >
              <Icon name={autoplay ? 'pause' : 'play'} size={18} />
            </button>
          ) : null}
          <button type="button" aria-label={labels.previous} onClick={() => goTo(active - 1)} className={cn(iconButtonVariants({ variant: 'outline', size: 's' }), 'bg-card')}>
            <Icon name="chevron-back" size={18} />
          </button>
          <div className="flex items-center px-1">
            {slides.map((_, index) => (
              <button
                key={index}
                type="button"
                onClick={() => goTo(index)}
                aria-label={labels.goTo.replace('{n}', String(index + 1))}
                aria-current={index === active ? 'true' : undefined}
                className="group grid h-control-m w-8 place-items-center rounded-pill"
              >
                <span
                  className={cn(
                    'h-2 rounded-pill transition-all duration-settle ease-out',
                    index === active ? 'w-6 bg-primary' : 'w-2 bg-input group-hover:bg-foreground',
                  )}
                />
              </button>
            ))}
          </div>
          <button type="button" aria-label={labels.next} onClick={() => goTo(active + 1)} className={cn(iconButtonVariants({ variant: 'outline', size: 's' }), 'bg-card')}>
            <Icon name="chevron-forward" size={18} />
          </button>
        </div>
      ) : null}
    </section>
  );
}
