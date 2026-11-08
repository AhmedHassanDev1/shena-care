'use client';

import { useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Section, SectionHeader } from '@/components/layout/section';
import { AsyncButton, Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card-variants';
import { Chip } from '@/components/ui/chip';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { GlassBadge } from '@/components/ui/glass-badge';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { formatDate, formatNumber, formatPercent } from '@/lib/i18n/format';
import { fillMessage } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';
import { getProductReviews, type ProductReview, type ProductReviewSummary, type ReviewSort } from '../api/discovery';
import { knownSkinTypes } from '../lib/product-facts';
import { skinTypeLabel } from './product-fact-labels';

/** Three cards first; «عرض كل التقييمات» switches to a fuller page (and «اعرض أكتر» pages beyond it). */
const FIRST = 3;
const FULL = 12;
const STARS = [5, 4, 3, 2, 1] as const;
const SORTS: ReviewSort[] = ['recent', 'helpful', 'rating_high', 'rating_low'];

/** Five stars, filled to the rounded rating. Decorative: the number is always written next to it. */
export function RatingStars({ value, size = 16, className }: { value: number; size?: number; className?: string }) {
  const filled = Math.round(value);
  return (
    <span aria-hidden="true" className={cn('inline-flex items-center gap-0.5', className)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Icon key={i} name="star" size={size} strokeWidth={1.5} fill={i <= filled ? 'currentColor' : 'none'} className={i <= filled ? 'text-tomato-ink' : 'text-dune'} />
      ))}
    </span>
  );
}

const useSummary = (slug: string) =>
  useQuery({ queryKey: ['pdp-review-summary', slug], queryFn: () => getProductReviews(slug, { limit: 1 }), staleTime: 60_000, select: (page) => page.summary });

/** Compact rating line under the title: stars, average and count, linking to the reviews section. Silent until there are reviews. */
export function HeroRating({ slug }: { slug: string }) {
  const m = useMessages();
  const locale = useLocale();
  const summary = useSummary(slug).data;
  if (!summary?.count || summary.average === null) return null;
  return (
    <a href="#pdp-reviews" className="link-quiet inline-flex min-h-control-s items-center gap-2 self-start text-13 text-stone">
      <RatingStars value={summary.average} size={15} />
      <span className="font-display text-15 font-bold text-ink">{formatNumber(summary.average, locale)}</span>
      <span className="sr-only">{fillMessage(m.pdpRatingLabel, { avg: formatNumber(summary.average, locale) })}</span>
      <span>({fillMessage(m.pdpRatingCount, { n: formatNumber(summary.count, locale) })})</span>
    </a>
  );
}

/** «آراء وتقييمات العملاء»: rating summary, star-filter chips, sort select, three review cards, view all, write a review. */
export function ProductReviews({ slug }: { slug: string }) {
  const m = useMessages();
  const locale = useLocale();
  const [sort, setSort] = useState<ReviewSort>('recent');
  const [rating, setRating] = useState<number | undefined>();
  const [expanded, setExpanded] = useState(false);
  const [writing, setWriting] = useState(false);
  const limit = expanded ? FULL : FIRST;
  const query = useInfiniteQuery({
    queryKey: ['pdp-reviews', slug, sort, rating ?? null, limit],
    queryFn: ({ pageParam }) => getProductReviews(slug, { page: pageParam, limit, sort, rating }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.pageInfo.hasNextPage ? last.pageInfo.page + 1 : undefined),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const summary = query.data?.pages[0]?.summary;
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const sortLabel: Record<ReviewSort, string> = { recent: m.pdpSortRecent, helpful: m.pdpSortHelpful, rating_high: m.pdpSortHigh, rating_low: m.pdpSortLow };
  const filteredTotal = rating && summary ? summary.distribution[String(rating) as '1'] : summary?.count ?? 0;
  const change = (apply: () => void) => {
    apply();
    setExpanded(false);
  };

  return (
    <Section labelledBy="pdp-reviews" id="reviews" rhythm="compact">
      <SectionHeader
        title={m.pdpReviewsTitle}
        titleId="pdp-reviews"
        aside={
          <Button variant="cobalt" size="s" onClick={() => setWriting(true)}>
            <Icon name="message" size={16} />
            {m.pdpWriteReview}
          </Button>
        }
      />
      {query.isPending ? (
        <ReviewsSkeleton />
      ) : query.isError && !query.data ? (
        <div role="alert" className={cn(cardVariants(), 'flex flex-wrap items-center gap-3 p-4 text-15 text-ink')}>
          <Icon name="alert" size={18} className="text-tomato-ink" />
          <span>{m.pdpReviewsError}</span>
          <Button variant="ink" size="s" onClick={() => query.refetch()}>
            {m.tryAgain}
          </Button>
        </div>
      ) : !summary?.count ? (
        <div className={cn(cardVariants(), 'flex items-center gap-3 p-4 text-15 text-stone')}>
          <Icon name="message" size={20} className="text-cobalt" />
          {m.pdpReviewsEmpty}
        </div>
      ) : (
        <div className="flex flex-col gap-3 lg:gap-4" aria-busy={query.isFetching || undefined}>
          <Summary summary={summary} rating={rating} onRating={(n) => change(() => setRating(n))} />

          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label={m.pdpFilterAll} className="-mx-4 flex min-w-0 flex-1 gap-2 overflow-x-auto px-4 pb-1 scrollbar-none lg:mx-0 lg:px-0">
              <Chip selected={!rating} onClick={() => change(() => setRating(undefined))}>
                {m.pdpFilterAll}
              </Chip>
              {STARS.map((n) => {
                const count = summary.distribution[String(n) as '1'];
                return (
                  <Chip
                    key={n}
                    selected={rating === n}
                    disabled={!count}
                    aria-label={fillMessage(m.pdpFilterStars, { n: formatNumber(n, locale), count: formatNumber(count, locale) })}
                    className={cn(!count && 'opacity-50')}
                    onClick={() => change(() => setRating(rating === n ? undefined : n))}
                  >
                    <span className="inline-flex items-center gap-1">
                      {formatNumber(n, locale)}
                      <Icon name="star" size={13} strokeWidth={1.5} fill="currentColor" />
                    </span>
                  </Chip>
                );
              })}
            </div>
            <label className="relative ms-auto flex flex-none items-center">
              <span className="sr-only">{m.pdpSortLabel}</span>
              <select
                value={sort}
                onChange={(event) => change(() => setSort(event.target.value as ReviewSort))}
                className="h-control-s appearance-none rounded-pill bg-linen ps-4 pe-9 font-display text-15 font-medium text-ink shadow-outline-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
              >
                {SORTS.map((key) => (
                  <option key={key} value={key}>
                    {sortLabel[key]}
                  </option>
                ))}
              </select>
              <Icon name="chevron-down" size={16} strokeWidth={2} className="pointer-events-none absolute end-3 text-stone" />
            </label>
          </div>

          {items.length ? (
            <ul className={cn('m-0 grid list-none gap-2.5 p-0 transition-opacity duration-fast md:grid-cols-2 lg:grid-cols-3 lg:gap-3', query.isPlaceholderData && 'opacity-50')}>
              {items.map((review) => (
                <ReviewCard key={review.id} review={review} />
              ))}
            </ul>
          ) : (
            <p className="m-0 flex flex-wrap items-center gap-3 text-15 text-stone">
              {m.pdpReviewsFilteredEmpty}
              <Button variant="linen" size="s" onClick={() => change(() => setRating(undefined))}>
                {m.pdpFilterAll}
              </Button>
            </p>
          )}

          {items.length ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p role="status" className="m-0 text-13 text-stone">
                {query.isPlaceholderData ? m.pdpReviewsLoadingMore : fillMessage(m.pdpReviewsShowing, { shown: formatNumber(items.length, locale), total: formatNumber(filteredTotal, locale) })}
              </p>
              {!expanded && filteredTotal > FIRST ? (
                <Button variant="ghost" size="m" onClick={() => setExpanded(true)}>
                  {m.pdpReviewsViewAll}
                </Button>
              ) : query.hasNextPage ? (
                <AsyncButton
                  state={query.isFetchingNextPage ? 'pending' : query.isFetchNextPageError ? 'error' : 'idle'}
                  variant="ghost"
                  size="m"
                  pendingLabel={m.pdpReviewsLoadingMore}
                  retryLabel={m.tryAgain}
                  onClick={() => query.fetchNextPage()}
                >
                  {m.pdpReviewsMore}
                </AsyncButton>
              ) : null}
            </div>
          ) : null}
          {query.isFetchNextPageError ? (
            <p role="alert" className="m-0 text-13.5 text-tomato-ink">
              {m.pdpReviewsError}
            </p>
          ) : null}
        </div>
      )}
      <WriteReviewDialog open={writing} onOpenChange={setWriting} />
    </Section>
  );
}

function Summary({ summary, rating, onRating }: { summary: ProductReviewSummary; rating?: number; onRating: (n: number | undefined) => void }) {
  const m = useMessages();
  const locale = useLocale();
  const average = summary.average ?? 0;
  return (
    <div className={cn(cardVariants(), 'grid gap-4 p-4 lg:grid-cols-3 lg:items-center lg:gap-8 lg:p-5')}>
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-3">
          <p className="m-0 flex items-baseline gap-1.5">
            <span className="font-display text-40 font-bold leading-45 text-ink">{formatNumber(average, locale)}</span>
            <span className="text-14 text-stone">{m.pdpRatingOutOf}</span>
          </p>
          <div className="flex flex-col gap-0.5">
            <RatingStars value={average} size={18} />
            <span className="text-13 text-stone">{fillMessage(m.pdpRatingCount, { n: formatNumber(summary.count, locale) })}</span>
          </div>
        </div>
        <div className="flex flex-col gap-1 text-13.5 text-ink">
          {summary.recommendPercent !== null ? (
            <p className="m-0 flex items-center gap-2">
              <Icon name="check" size={15} className="text-ok" />
              {fillMessage(m.pdpRecommend, { p: formatPercent(summary.recommendPercent, locale) })}
            </p>
          ) : null}
          {summary.verifiedCount ? (
            <p className="m-0 flex items-center gap-2 text-stone">
              <Icon name="shield" size={15} className="text-ok" />
              {fillMessage(m.pdpVerifiedCount, { n: formatNumber(summary.verifiedCount, locale) })}
            </p>
          ) : null}
        </div>
      </div>

      <ul className="m-0 flex list-none flex-col gap-0.5 p-0 lg:col-span-2">
        {STARS.map((n) => {
          const count = summary.distribution[String(n) as '1'];
          const share = summary.count ? Math.round((count / summary.count) * 100) : 0;
          const active = rating === n;
          return (
            <li key={n}>
              <button
                type="button"
                aria-pressed={active}
                disabled={!count}
                aria-label={fillMessage(m.pdpFilterStars, { n: formatNumber(n, locale), count: formatNumber(count, locale) })}
                onClick={() => onRating(active ? undefined : n)}
                className={cn(
                  'flex min-h-9 w-full items-center gap-3 rounded-pill px-2 text-13 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt disabled:cursor-default',
                  active ? 'bg-sand' : 'enabled:hover:bg-sand/50'
                )}
              >
                <span className="flex w-9 flex-none items-center gap-1 font-semibold tabular-nums text-ink">
                  {formatNumber(n, locale)}
                  <Icon name="star" size={12} strokeWidth={1.5} fill="currentColor" className="text-tomato-ink" />
                </span>
                <span className="relative h-2 flex-1 overflow-hidden rounded-pill bg-sand">
                  <span className="absolute inset-y-0 start-0 rounded-pill bg-cobalt" style={{ width: `${share}%` }} />
                </span>
                <span className="w-7 flex-none text-end tabular-nums text-stone">{formatNumber(count, locale)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ReviewCard({ review }: { review: ProductReview }) {
  const m = useMessages();
  const locale = useLocale();
  const skin = knownSkinTypes(review.skinType ? [review.skinType] : [])[0];
  return (
    <li className={cn(cardVariants(), 'flex flex-col gap-2 p-4')}>
      <div className="flex items-center justify-between gap-3">
        <RatingStars value={review.rating} size={15} />
        <span className="sr-only">{fillMessage(m.pdpRatingLabel, { avg: formatNumber(review.rating, locale) })}</span>
        <time dateTime={review.createdAt} className="text-12.5 text-stone">
          {formatDate(review.createdAt, locale)}
        </time>
      </div>
      {review.title ? (
        <h3 dir="auto" className="m-0 font-display text-16 font-bold leading-22 text-ink text-match-parent">
          {review.title}
        </h3>
      ) : null}
      <p dir="auto" className="m-0 flex-1 text-14 leading-24 text-ink text-match-parent">
        {review.body}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 shadow-hairline-top pt-2.5 text-13 text-stone">
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-pill bg-sand font-display text-13 font-bold text-ink">
            {review.authorName.trim().charAt(0)}
          </span>
          <span dir="auto" className="font-semibold text-ink">
            {review.authorName}
          </span>
        </span>
        {skin ? <span>{fillMessage(m.pdpSuitableSkin, { type: skinTypeLabel(m, skin) })}</span> : null}
        {review.isVerifiedPurchase ? <GlassBadge dot="bg-ok">{m.pdpVerifiedPurchase}</GlassBadge> : null}
        {review.helpfulCount ? <span className="ms-auto">{fillMessage(m.pdpHelpful, { n: formatNumber(review.helpfulCount, locale) })}</span> : null}
      </div>
    </li>
  );
}

/**
 * «اكتب تقييم»: the form is real (star radios, text) so the flow can be tested, but there is no public submit endpoint
 * yet, so «ابعت التقييم» stays disabled and says why instead of pretending to send.
 */
function WriteReviewDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages();
  const locale = useLocale();
  const [stars, setStars] = useState(0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={m.pdpCloseZoom} className="max-w-md p-5">
        <DialogTitle className="m-0 font-display text-22 font-bold leading-28 text-ink">{m.pdpWriteReview}</DialogTitle>
        <div className="mt-4 flex flex-col gap-4">
          <div role="radiogroup" aria-label={m.pdpYourRating} className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={stars === n}
                aria-label={fillMessage(m.pdpRateStar, { n: formatNumber(n, locale) })}
                onClick={() => setStars(n)}
                className="flex size-control-s items-center justify-center rounded-pill text-tomato-ink transition-colors duration-fast hover:bg-sand/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
              >
                <Icon name="star" size={26} strokeWidth={1.5} fill={n <= stars ? 'currentColor' : 'none'} className={n <= stars ? '' : 'text-dune'} />
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1.5 text-14 font-semibold text-ink">
            {m.pdpYourReview}
            <textarea
              rows={4}
              className="w-full resize-none rounded-input bg-chalk p-3 text-15 font-normal leading-24 text-ink shadow-outline-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
            />
          </label>
          <p className="m-0 flex items-start gap-2 text-13 leading-20 text-stone">
            <Icon name="alert" size={15} className="mt-0.5 flex-none" />
            {m.pdpReviewSoon}
          </p>
          <Button variant="cobalt" size="m" disabled className="w-full">
            {m.pdpSendReview}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReviewsSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <Skeleton className="h-44 w-full rounded-card" />
      <div className="grid gap-2.5 md:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-36 w-full rounded-card" />
        <Skeleton className="h-36 w-full rounded-card" />
        <Skeleton className="hidden h-36 w-full rounded-card lg:block" />
      </div>
    </div>
  );
}
