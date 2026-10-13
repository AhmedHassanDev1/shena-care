'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import { indexFromScroll, scrollLeftForIndex, stepForDrag, stepForKey, wrapIndex } from './carousel-math';

export interface CarouselLabels {
  /** Accessible name of the carousel region. */
  region: string;
  /** Template with `{n}` and `{total}` placeholders, e.g. "Slide {n} of {total}" (plain strings, so a server component can pass them). */
  slideLabel: string;
  /** Template with an `{n}` placeholder, e.g. "Go to slide {n}". */
  goTo: string;
}

export interface CarouselProps {
  /** One node per slide. Each slide fills the carousel width. */
  slides: React.ReactNode[];
  labels: CarouselLabels;
  className?: string;
  /** Classes for the track (height, rounding). */
  trackClassName?: string;
  /** Classes for the pagination row (position it over / under the slides). */
  paginationClassName?: string;
}

/** Pointer travel (px) after which a mouse press counts as a drag, so the click on a slide link is swallowed. */
const DRAG_SLOP = 6;

/**
 * Minimal scroll-snap carousel: swipe, trackpad, mouse drag, arrow keys and a small pagination — no arrows,
 * no autoplay, so nothing moves unless the shopper moves it (WCAG 2.2.2 does not apply).
 *
 * - The browser owns touch and trackpad scrolling and momentum (native swipe); React only reads the position
 *   to keep pagination, labels and `inert` in sync, and writes it for pagination, keys and mouse drags.
 * - Mouse drag (desktop): the track follows the pointer with snapping off, then settles one slide on.
 * - Direction aware: scroll offsets are negative in RTL (carousel-math.ts); keys and drags follow the visual side.
 * - Slides other than the current one are `inert` (no stray tab stops, hidden from assistive tech).
 * - Pagination: small dots with an elongated active pill; each button keeps a 44px-tall, 32px-wide target.
 */
export function Carousel({ slides, labels, className, trackClassName, paginationClassName }: CarouselProps) {
  const count = slides.length;
  const trackRef = React.useRef<HTMLUListElement>(null);
  const slideRefs = React.useRef<Array<HTMLLIElement | null>>([]);
  const drag = React.useRef<{ x: number; scroll: number; moved: boolean } | null>(null);
  const swallowClick = React.useRef(false);
  // Slide a programmatic smooth scroll is heading to: until it arrives, scroll events (which still report the
  // slide being left) must not pull the pagination back. Cleared on arrival, at the deadline, or by user input.
  const pending = React.useRef<{ index: number; timer: number } | null>(null);
  const [active, setActive] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);
  const [reducedMotion, setReducedMotion] = React.useState(false);

  const isRtl = () => (trackRef.current ? getComputedStyle(trackRef.current).direction === 'rtl' : false);

  const clearPending = React.useCallback(() => {
    if (pending.current) window.clearTimeout(pending.current.timer);
    pending.current = null;
  }, []);

  const goTo = React.useCallback(
    (index: number) => {
      const track = trackRef.current;
      if (!track || count === 0) return;
      const target = wrapIndex(index, count);
      // Wrapping last → first (or back) would sweep through every slide; jump instead.
      const wrapped = target !== index;
      const smooth = !reducedMotion && !wrapped;
      const left = () => scrollLeftForIndex(target, track.clientWidth, isRtl());
      clearPending();
      if (smooth) {
        // Browsers may drop a smooth scroll (e.g. while the page itself is scrolling). If it has not arrived
        // by the deadline, jump there, so the slide shown and the pagination can never disagree.
        const settle = () => {
          if (indexFromScroll(track.scrollLeft, track.clientWidth, count) !== target) track.scrollTo({ left: left(), behavior: 'auto' });
          clearPending();
        };
        pending.current = { index: target, timer: window.setTimeout(settle, 900) };
      }
      track.scrollTo({ left: left(), behavior: smooth ? 'smooth' : 'auto' });
      setActive(target);
    },
    [count, reducedMotion, clearPending],
  );

  // Follow the scroll position (touch swipes, trackpads, keyboard scrolling and our own scrollTo all pass here).
  const onScroll = () => {
    const track = trackRef.current;
    if (!track || drag.current) return;
    const index = indexFromScroll(track.scrollLeft, track.clientWidth, count);
    if (pending.current) {
      if (index !== pending.current.index) return;
      clearPending();
    }
    setActive(index);
  };

  // Keep the current slide aligned when the viewport (or the locale direction) changes.
  React.useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const index = indexFromScroll(track.scrollLeft, track.clientWidth, count);
      track.scrollTo({ left: scrollLeftForIndex(index, track.clientWidth, isRtl()), behavior: 'auto' });
    });
    observer.observe(track);
    return () => observer.disconnect();
  }, [count]);

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

  // Mouse drag only: touch and pen keep the browser's native swipe.
  const onPointerDown = (event: React.PointerEvent<HTMLUListElement>) => {
    const track = trackRef.current;
    clearPending();
    if (event.pointerType !== 'mouse' || event.button !== 0 || !track || count < 2) return;
    drag.current = { x: event.clientX, scroll: track.scrollLeft, moved: false };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLUListElement>) => {
    const track = trackRef.current;
    const state = drag.current;
    if (!track || !state) return;
    const dx = event.clientX - state.x;
    if (!state.moved) {
      if (Math.abs(dx) < DRAG_SLOP) return;
      state.moved = true;
      track.setPointerCapture(event.pointerId);
      setDragging(true);
    }
    track.scrollLeft = state.scroll - dx;
  };

  const endDrag = (event: React.PointerEvent<HTMLUListElement>) => {
    const track = trackRef.current;
    const state = drag.current;
    drag.current = null;
    if (!track || !state?.moved) return;
    swallowClick.current = true;
    setDragging(false);
    if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
    const from = indexFromScroll(state.scroll, track.clientWidth, count);
    const step = stepForDrag(event.clientX - state.x, track.clientWidth, isRtl());
    // Clamp rather than wrap: a drag past the last slide settles back instead of jumping to the first.
    goTo(Math.min(Math.max(from + step, 0), count - 1));
  };

  if (count === 0) return null;
  const multiple = count > 1;

  return (
    <section
      aria-roledescription="carousel"
      aria-label={labels.region}
      // Focusable so arrow keys work from the region itself; slides' own links stay in the tab order.
      tabIndex={0}
      onKeyDown={onKeyDown}
      // A drag must not also follow the slide link it started on.
      onClickCapture={(event) => {
        if (!swallowClick.current) return;
        swallowClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      // Native image/link dragging would hijack the mouse drag.
      onDragStart={(event) => event.preventDefault()}
      className={cn('relative rounded-[inherit] outline-none focus-visible:shadow-[var(--focus-ring)]', className)}
    >
      <ul
        ref={trackRef}
        onScroll={onScroll}
        onWheel={clearPending}
        onTouchStart={clearPending}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        // A press that leaves the track before moving never becomes a drag (no capture, so no pointerup here).
        onPointerLeave={() => {
          if (drag.current && !drag.current.moved) drag.current = null;
        }}
        aria-live="polite"
        className={cn(
          'flex overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          // Snapping is suspended while the mouse drags the track, so it follows the pointer 1:1.
          dragging ? 'cursor-grabbing select-none' : 'snap-x snap-mandatory',
          multiple && !dragging && '[@media(pointer:fine)]:cursor-grab',
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
        <div className={cn('flex justify-center', paginationClassName)}>
          {slides.map((_, index) => (
            <button
              key={index}
              type="button"
              onClick={() => goTo(index)}
              aria-label={labels.goTo.replace('{n}', String(index + 1))}
              aria-current={index === active ? 'true' : undefined}
              className="group grid h-control-m w-8 place-items-center rounded-pill outline-none focus-visible:shadow-[var(--focus-ring)]"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'h-1.5 rounded-pill transition-[width,background-color] duration-settle ease-out',
                  index === active ? 'w-5 bg-primary' : 'w-1.5 bg-foreground/35 group-hover:bg-foreground/70',
                )}
              />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
