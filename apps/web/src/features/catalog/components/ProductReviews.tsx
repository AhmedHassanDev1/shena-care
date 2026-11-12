'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Section } from '@/components/layout/section';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/AuthContext';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { formatNumber } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';
import { useProductReviews } from '../hooks/useProductReviews';
import { knownSkinTypes, resolveTextDirection } from '../lib/product-facts';
import { ProductReviewComposer } from './ProductReviewComposer';

/** Five stars filled up to the rounded rating score. */
export function RatingStars({
  value,
  size = 16,
  className,
}: {
  value: number;
  size?: number;
  className?: string;
}) {
  const filled = Math.round(value);
  return (
    <span aria-hidden="true" className={cn('inline-flex items-center gap-0.5', className)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Icon
          key={i}
          name="star"
          size={size}
          strokeWidth={1.5}
          fill={i <= filled ? 'currentColor' : 'none'}
          className={i <= filled ? 'text-warn' : 'text-stone/30'}
        />
      ))}
    </span>
  );
}

/** Compact rating summary inside the Hero section. */
export function HeroRating({ slug }: { slug: string }) {
  const locale = useLocale();
  const m = useMessages();
  const { data } = useProductReviews(slug);
  const summary = data?.summary;

  if (!summary || summary.count === 0) {
    return (
      <a
        href={`#reviews-${slug}`}
        className="inline-flex items-center gap-1.5 self-start text-13 text-stone hover:text-cobalt transition-colors font-medium"
      >
        <Icon name="star" size={14} className="text-stone/40" />
        <span>{m.pdpHeroNoReviews}</span>
      </a>
    );
  }

  const avg = Number((summary.average ?? 0).toFixed(1));
  const avgFormatted = formatNumber(avg, locale);
  const countFormatted = formatNumber(summary.count, locale);

  return (
    <a
      href={`#reviews-${slug}`}
      aria-label={fillMessage(m.pdpRatingLabel, { avg: avgFormatted })}
      className="inline-flex items-center gap-2 self-start text-14 hover:opacity-85 transition-opacity"
    >
      <RatingStars value={avg} size={16} />
      <span className="font-bold text-ink text-15 tabular-nums">{avgFormatted}</span>
      <span className="text-stone text-14 tabular-nums">({countFormatted})</span>
    </a>
  );
}

/**
 * Stitch Section G — Customer Reviews (`آراء العملاء`).
 * Renders live data from GET /products/:slug/reviews cleanly:
 * - Score card (`avg`, 5 stars, review count)
 * - Single-review interactive carousel with pagination dots
 * - Honest neutral empty state when `count === 0` (never fabricates ratings or quotes).
 */
export function ProductReviews({ slug, skuId }: { slug: string; skuId?: string }) {
  const locale = useLocale();
  const m = useMessages();
  const queryClient = useQueryClient();
  const { isAuthenticated, openAuthModal } = useAuth();
  const { data, isPending, isError } = useProductReviews(slug, {
    sort: 'recent',
    limit: 10,
  });

  const [activeIndex, setActiveIndex] = useState(0);
  const [composerOpen, setComposerOpen] = useState(false);

  const items = data?.items ?? [];
  const summary = data?.summary;
  const hasSummaryReviews = Boolean(summary && summary.count > 0);
  const hasDisplayReviews = items.length > 0;
  const safeIndex = items.length > 0 ? Math.min(activeIndex, items.length - 1) : 0;
  const currentReview = items[safeIndex];

  const handleOpenReviewComposer = () => {
    if (!isAuthenticated) {
      openAuthModal({
        title: m.pdpReviewSignInTitle,
        description: m.pdpReviewSignInDesc,
        mode: 'login',
        intent: 'review',
        onAuthenticated: async () => {
          await queryClient.invalidateQueries({ queryKey: ['product-reviews', slug] });
          setComposerOpen(true);
        },
      });
      return;
    }
    setComposerOpen(true);
  };

  const handlePrev = () => {
    if (items.length <= 1) return;
    setActiveIndex((prev) => (prev - 1 + items.length) % items.length);
  };

  const handleNext = () => {
    if (items.length <= 1) return;
    setActiveIndex((prev) => (prev + 1) % items.length);
  };

  const skinTypeLabel = (raw: string | null): string | null => {
    if (!raw) return null;
    const known = knownSkinTypes([raw])[0];
    if (!known) return raw;
    const cap = `${known[0].toUpperCase()}${known.slice(1)}`;
    const key = `skinType${cap}` as keyof typeof m;
    return fillMessage(m.pdpSuitableSkin, { type: (m[key] as string) || known });
  };

  const authorInitial = (name: string) => {
    const trimmed = name.trim();
    return trimmed ? trimmed[0].toUpperCase() : '•';
  };

  return (
    <Section id={`reviews-${slug}`} labelledBy={`pdp-reviews-title-${slug}`} rhythm="compact" className="py-2 lg:py-3">
      <div aria-busy={isPending} className="mx-auto flex w-full max-w-[1140px] flex-col gap-3.5 border-t border-line pt-4 lg:pt-5">
        {/* Section Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-ink">
            <Icon name="star" size={18} className="text-cobalt shrink-0" />
            <h2
              id={`pdp-reviews-title-${slug}`}
              className="m-0 font-display text-19 sm:text-20 font-bold text-ink"
            >
              {m.pdpReviewsSectionTitle}
            </h2>
          </div>

          <Button
            type="button"
            variant="light"
            size="s"
            className="rounded-pill gap-1.5"
            onClick={handleOpenReviewComposer}
          >
            <Icon name="star" size={14} className="text-cobalt shrink-0" />
            <span>{m.pdpWriteReview}</span>
          </Button>
        </div>

        {isPending ? (
          <div className="flex items-center gap-3 py-2">
            <Skeleton className="h-5 w-48 rounded-pill" />
          </div>
        ) : isError ? (
          <p className="m-0 py-1 text-14 font-medium text-stone">
            {m.pdpReviewsError}
          </p>
        ) : !hasDisplayReviews || !currentReview ? (
          <div className="flex items-center gap-2.5 py-1 text-14 text-stone">
            <Icon name="star" size={16} className="text-cobalt shrink-0" />
            <p className="m-0 font-medium">{m.pdpReviewsEmpty}</p>
          </div>
        ) : (
          <>
            {!hasSummaryReviews ? (
              <p className="m-0 text-13 font-medium text-stone">{m.pdpReviewOnlyTestNote}</p>
            ) : null}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
              {/* Overall Score Card */}
              {hasSummaryReviews && summary ? (
              <div className="lg:col-span-3 rounded-24 border border-line bg-linen p-5 md:p-6 flex items-center justify-around lg:flex-col lg:justify-center text-center shadow-elevation-1">
                <span className="font-display text-40 font-bold leading-none text-ink tabular-nums lg:mb-1.5">
                  {formatNumber(Number((summary.average ?? 0).toFixed(1)), locale)}
                </span>
                <div className="flex flex-col items-center gap-1">
                  <div
                    aria-label={fillMessage(m.pdpRatingLabel, {
                      avg: formatNumber(Number((summary.average ?? 0).toFixed(1)), locale),
                    })}
                  >
                    <RatingStars value={summary.average ?? 0} size={18} />
                  </div>
                  <span className="text-13 sm:text-14 font-medium text-stone tabular-nums">
                    ({fillMessage(m.pdpRatingCount, { n: formatNumber(summary.count, locale) })})
                  </span>
                </div>
              </div>
              ) : null}

              {/* Single-Review Carousel Card (single Prev/Next button pair responsive across mobile & desktop) */}
              <div
                className={cn(
                  'rounded-24 border border-line bg-linen p-4 md:p-5 flex flex-wrap lg:flex-nowrap items-center justify-between gap-2.5 lg:gap-4 shadow-elevation-1',
                  hasSummaryReviews ? 'lg:col-span-9' : 'lg:col-span-12',
                )}
              >
                {/* Prev Button (mobile top-start, desktop start) */}
                <button
                  type="button"
                  onClick={handlePrev}
                  disabled={items.length <= 1}
                  aria-label={m.pdpReviewPrev}
                  className="order-1 flex size-10 lg:size-9 shrink-0 items-center justify-center rounded-full bg-chalk text-ink shadow-elevation-1 transition hover:bg-sand active:scale-95 disabled:opacity-40 cursor-pointer"
                >
                  <Icon name="chevron-back" size={18} />
                </button>

                {/* Next Button (mobile adjacent to Prev, desktop end) */}
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={items.length <= 1}
                  aria-label={m.pdpReviewNext}
                  className="order-1 lg:order-3 flex size-10 lg:size-9 shrink-0 items-center justify-center rounded-full bg-chalk text-ink shadow-elevation-1 transition hover:bg-sand active:scale-95 disabled:opacity-40 cursor-pointer"
                >
                  <Icon name="chevron-forward" size={18} />
                </button>

                {/* Mobile Stars */}
                <div className="order-2 ms-auto lg:hidden">
                  <RatingStars value={currentReview.rating} size={16} />
                </div>

                {/* Active Review Content */}
                <div className="order-3 basis-full lg:basis-auto lg:flex-1 lg:order-2 flex flex-col items-start gap-2.5 text-start min-w-0">
                  <div className="hidden lg:flex items-center gap-2">
                    <RatingStars value={currentReview.rating} size={16} />
                  </div>

                  {currentReview.title ? (
                    <p
                      dir={resolveTextDirection(currentReview.title)}
                      className="m-0 text-start text-15 font-bold leading-22 text-ink"
                    >
                      &ldquo;{currentReview.title}&rdquo;
                    </p>
                  ) : null}

                  {currentReview.body ? (
                    <p
                      dir={resolveTextDirection(currentReview.body)}
                      className="m-0 text-start text-14 sm:text-15 font-bold leading-22 text-ink"
                    >
                      &ldquo;{currentReview.body}&rdquo;
                    </p>
                  ) : null}

                  {/* Reviewer Meta Row */}
                  <div className="flex flex-wrap items-center gap-2.5 pt-1 border-t border-line w-full lg:border-t-0 lg:pt-0">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-sand text-13 font-bold text-ink">
                      {authorInitial(currentReview.authorName)}
                    </div>
                    <span className="text-14 font-bold text-ink">{currentReview.authorName}</span>
                    {skinTypeLabel(currentReview.skinType) ? (
                      <span className="rounded-pill bg-sand px-3 py-1 text-12 font-medium text-ink">
                        {skinTypeLabel(currentReview.skinType)}
                      </span>
                    ) : null}
                    {currentReview.isTest ? (
                      <span className="inline-flex items-center gap-1 rounded-pill border border-warn/40 bg-sand px-2.5 py-0.5 text-11 font-semibold text-ink">
                        {m.pdpReviewTestBadge}
                      </span>
                    ) : currentReview.isVerifiedPurchase ? (
                      <span className="inline-flex items-center gap-1 rounded-pill bg-ok-tint px-2.5 py-0.5 text-11 font-semibold text-ok">
                        <Icon name="check" size={12} strokeWidth={2.4} />
                        {m.pdpVerifiedPurchase}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            {/* Pagination Dots */}
            {items.length > 1 ? (
              <div className="flex items-center justify-center gap-1.5">
                {items.map((item, idx) => {
                  const isActive = idx === safeIndex;
                  return (
                    <button
                      key={item.id || idx}
                      type="button"
                      onClick={() => setActiveIndex(idx)}
                      aria-label={fillMessage(m.pdpReviewSlide, {
                        i: formatNumber(idx + 1, locale),
                        n: formatNumber(items.length, locale),
                      })}
                      aria-current={isActive ? 'true' : undefined}
                      className={cn(
                        'rounded-full transition-all cursor-pointer',
                        isActive ? 'size-2.5 bg-cobalt' : 'size-2 bg-line-2 hover:bg-stone/60'
                      )}
                    />
                  );
                })}
              </div>
            ) : null}
          </>
        )}
      </div>

      <ProductReviewComposer
        slug={slug}
        skuId={skuId}
        open={composerOpen}
        onOpenChange={setComposerOpen}
        onSubmitted={() => setActiveIndex(0)}
      />
    </Section>
  );
}
