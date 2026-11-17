'use client';

import { useRef, useState, type PointerEvent } from 'react';
import Image from 'next/image';
import { AnimatePresence, motion } from 'motion/react';
import { EASE_STANDARD } from '@/components/motion/reveal';
import { Icon } from '@/components/ui/icon';
import { ProductTile } from '@/components/ui/product-tile';
import { canOptimizeImage } from '@/lib/images';
import { formatNumber } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';
import type { PublicMedia } from '../api/discovery';

export interface ProductGalleryProps {
  images: PublicMedia[];
  index: number;
  onIndexChange: (next: number) => void;
  productName: string;
  liked: boolean;
  onToggleLike: () => void;
  onZoom: () => void;
  onImageError: (url: string) => void;
}

const ZOOM = 1.9;

/**
 * Product photo stage. The photograph is shown exactly as the catalog has it: no ground, no tint, no crop, and in its
 * own proportions (the frame takes the picture's aspect ratio once it has loaded, so it is never squeezed into a
 * square). Photographs cross-fade as the shopper moves between them; a mouse hovering the stage magnifies the spot
 * under the pointer, a finger swipes between photos, and the keyboard gets previous/next buttons. Touch never zooms
 * by hover: the expand button opens the full-size view instead.
 */
export function ProductGallery({ images, index, onIndexChange, productName, liked, onToggleLike, onZoom, onImageError }: ProductGalleryProps) {
  const m = useMessages();
  const locale = useLocale();
  const stageRef = useRef<HTMLDivElement>(null);
  const [zoomAt, setZoomAt] = useState<{ x: number; y: number } | null>(null);
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const count = images.length;
  const safeIndex = count > 0 ? Math.min(index, count - 1) : 0;
  const current = images[safeIndex];
  const ratio = current ? ratios[current.url] ?? 1 : 1;
  const go = (delta: number) => count > 1 && onIndexChange((safeIndex + delta + count) % count);
  const label = (i: number) => fillMessage(m.pdpShowImage, { i: formatNumber(i + 1, locale) });

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || !stageRef.current) return;
    const box = stageRef.current.getBoundingClientRect();
    setZoomAt({ x: ((event.clientX - box.left) / box.width) * 100, y: ((event.clientY - box.top) / box.height) * 100 });
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={stageRef}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setZoomAt(null)}
        style={{ aspectRatio: ratio }}
        className="group relative w-full overflow-hidden"
      >
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            key={current?.id || current?.url || 'empty'}
            className="absolute inset-0 touch-pan-y"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: EASE_STANDARD }}
            drag={count > 1 ? 'x' : false}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.25}
            onDragEnd={(_, info) => {
              if (Math.abs(info.offset.x) < 60) return;
              // Swiping toward the reading end shows the next photo: left in LTR, right in RTL.
              const forward = locale === 'ar' ? info.offset.x > 0 : info.offset.x < 0;
              go(forward ? 1 : -1);
            }}
          >
            {current ? (
              <Image
                src={current.url}
                alt={current.altText || productName}
                fill
                priority
                unoptimized={!canOptimizeImage(current.url)}
                sizes="(min-width: 1024px) 640px, 100vw"
                onLoad={(event) => {
                  const img = event.currentTarget;
                  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                    const next = img.naturalWidth / img.naturalHeight;
                    setRatios((prev) => (prev[current.url] === next ? prev : { ...prev, [current.url]: next }));
                  }
                }}
                onError={() => onImageError(current.url)}
                className="select-none object-contain"
              />
            ) : (
              <ProductTile src={null} alt={productName} name={productName} className="size-full rounded-none bg-transparent" />
            )}
          </motion.div>
        </AnimatePresence>

        {/* Magnifier: a mouse-only copy of the photo scaled around the pointer; never rendered for touch. */}
        {zoomAt && current ? (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 hidden overflow-hidden bg-chalk lg:block">
            <Image
              src={current.url}
              alt=""
              fill
              draggable={false}
              unoptimized={!canOptimizeImage(current.url)}
              sizes="1200px"
              className="select-none object-contain"
              style={{ transform: `scale(${ZOOM})`, transformOrigin: `${zoomAt.x}% ${zoomAt.y}%` }}
            />
          </div>
        ) : null}

        {count > 1 ? (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label={label((safeIndex - 1 + count) % count)}
              className="absolute start-3 top-1/2 z-20 hidden size-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-chalk/90 text-ink shadow-elevation-1 transition-opacity duration-fast hover:bg-chalk focus-visible:opacity-100 lg:flex lg:opacity-0 lg:group-hover:opacity-100"
            >
              <Icon name="chevron-back" size={18} />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label={label((safeIndex + 1) % count)}
              className="absolute end-3 top-1/2 z-20 hidden size-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-chalk/90 text-ink shadow-elevation-1 transition-opacity duration-fast hover:bg-chalk focus-visible:opacity-100 lg:flex lg:opacity-0 lg:group-hover:opacity-100"
            >
              <Icon name="chevron-forward" size={18} />
            </button>
          </>
        ) : null}

        <button
          type="button"
          aria-label={liked ? m.wishlistRemove : m.wishlistAdd}
          aria-pressed={liked}
          onClick={onToggleLike}
          className={cn(
            'absolute end-3 top-3 z-20 flex size-11 cursor-pointer items-center justify-center rounded-full bg-chalk/90 shadow-elevation-1 transition-transform duration-fast active:scale-90',
            liked ? 'text-tomato-ink' : 'text-ink hover:text-tomato-ink',
          )}
        >
          <Icon name="heart" size={20} strokeWidth={2} fill={liked ? 'currentColor' : 'none'} />
        </button>

        {current ? (
          <button
            type="button"
            aria-label={m.pdpZoom}
            onClick={onZoom}
            className="absolute bottom-3 end-3 z-20 flex size-11 cursor-pointer items-center justify-center rounded-full bg-chalk/90 text-ink shadow-elevation-1 transition-transform duration-fast hover:scale-105 active:scale-95"
          >
            <Icon name="expand" size={18} strokeWidth={2} />
          </button>
        ) : null}

        {count > 1 ? (
          <span
            aria-live="polite"
            className="absolute bottom-3 start-3 z-20 rounded-pill bg-ink/80 px-3 py-1 font-display text-13 font-semibold text-chalk tabular-nums"
          >
            {formatNumber(safeIndex + 1, locale)} / {formatNumber(count, locale)}
          </span>
        ) : null}
      </div>

      {count > 1 ? (
        <ul role="tablist" aria-label={m.pdpGalleryLabel} className="m-0 flex list-none gap-2 overflow-x-auto p-0 pb-1 no-scrollbar">
          {images.slice(0, 6).map((img, i) => {
            const active = i === safeIndex;
            return (
              <li key={img.id || img.url} className="shrink-0">
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-label={label(i)}
                  onClick={() => onIndexChange(i)}
                  className="relative block size-16 cursor-pointer overflow-hidden rounded-image lg:size-20"
                >
                  <ProductTile
                    src={img.url}
                    alt=""
                    name={productName}
                    size="thumb"
                    sizes="80px"
                    onImageError={() => onImageError(img.url)}
                    className="size-full rounded-none bg-transparent"
                  />
                  {active ? (
                    <motion.span
                      layoutId="pdp-thumb-ring"
                      aria-hidden="true"
                      className="absolute inset-0 rounded-image shadow-outline-cobalt"
                      transition={{ type: 'spring', visualDuration: 0.3, bounce: 0.1 }}
                    />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
