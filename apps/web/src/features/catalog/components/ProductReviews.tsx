'use client';

import { useState } from 'react';
import { Section, SectionHeader } from '@/components/layout/section';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card-variants';
import { Chip } from '@/components/ui/chip';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { GlassBadge } from '@/components/ui/glass-badge';
import { Icon } from '@/components/ui/icon';
import { useLocale } from '@/lib/i18n/LocaleProvider';
import { formatNumber } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';
import { MOCK_REVIEWS_ITEMS } from '../lib/mock-product-detail';

/** Five stars, filled to the rounded rating. */
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
          className={i <= filled ? 'text-tomato-ink' : 'text-stone/30'}
        />
      ))}
    </span>
  );
}

/** Compact rating line under the title: stars, average and count, linking to the reviews section. */
export function HeroRating({ slug }: { slug: string }) {
  const locale = useLocale();
  const average = 4.8;
  const count = 2413;

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <a
        href={`#reviews-${slug}`}
        className="link-quiet inline-flex min-h-control-s items-center gap-2 self-start text-13.5 text-stone hover:text-cobalt transition-colors"
      >
        <span className="flex items-center gap-1 font-display text-15 font-bold text-ink">
          <Icon name="star" size={16} strokeWidth={1.5} fill="currentColor" className="text-tomato-ink" />
          {formatNumber(average, locale)}
        </span>
        <span className="text-stone">
          ({formatNumber(count, locale)} تقييم)
        </span>
      </a>

      <GlassBadge tone="quiet" dot="bg-ok" className="text-12 font-medium">
        98% يوصون بهذا المنتج
      </GlassBadge>
    </div>
  );
}

/**
 * «تقييمات العملاء»: overall score, recommendation rate, distribution bars,
 * 3 satisfaction metrics, filter tabs, rich review cards with interactive helpful buttons.
 */
export function ProductReviews({ slug }: { slug: string }) {
  const locale = useLocale();
  const [filter, setFilter] = useState<'all' | 'verified' | 'photos' | 'recent'>('all');
  const [writing, setWriting] = useState(false);
  const [likes, setLikes] = useState<Record<string, { count: number; active: boolean }>>({
    'rev-1': { count: 24, active: false },
    'rev-2': { count: 18, active: false },
    'rev-3': { count: 31, active: false },
  });

  const toggleLike = (id: string) => {
    setLikes((prev) => {
      const current = prev[id] || { count: 0, active: false };
      return {
        ...prev,
        [id]: {
          count: current.active ? current.count - 1 : current.count + 1,
          active: !current.active,
        },
      };
    });
  };

  const distribution = [
    { stars: 5, pct: 84, count: 2026 },
    { stars: 4, pct: 11, count: 265 },
    { stars: 3, pct: 3, count: 72 },
    { stars: 2, pct: 1, count: 24 },
    { stars: 1, pct: 1, count: 26 },
  ];

  const metrics = [
    { label: 'فعالية في تقليل الدهون واللمعان', pct: '98%' },
    { label: 'تحسن ملموس في تضييق المسام', pct: '95%' },
    { label: 'سرعة الامتصاص وملمس خفيف', pct: '91%' },
  ];

  return (
    <Section labelledBy="pdp-reviews" id={`reviews-${slug}`} rhythm="compact">
      <SectionHeader
        title="تقييمات العملاء"
        titleId="pdp-reviews"
        lead="بناءً على 2,413 تقييم معتمد من مشترين حقيقيين"
        aside={
          <Button variant="cobalt" size="s" onClick={() => setWriting(true)}>
            <Icon name="message" size={16} />
            اكتب تقييمك
          </Button>
        }
      />

      <div className="flex flex-col gap-5">
        {/* Rating Breakdown Card */}
        <div className={cn(cardVariants(), 'grid gap-6 p-5 lg:grid-cols-12 lg:items-center lg:gap-8 lg:p-6')}>
          {/* Big Score */}
          <div className="flex flex-col items-center justify-center gap-2 text-center lg:col-span-4 lg:items-start lg:text-start">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-44 font-bold leading-46 text-ink">
                4.8
              </span>
              <span className="text-14 text-stone">من 5</span>
            </div>
            <RatingStars value={4.8} size={20} />
            <span className="text-13 text-stone">
              بناءً على {formatNumber(2413, locale)} تقييم معتمد
            </span>
            <span className="mt-1 flex items-center gap-1.5 rounded-pill bg-ok-tint px-3 py-1 text-12 font-bold text-ok">
              <Icon name="check" size={14} strokeWidth={2.4} />
              98% من العملاء يوصون بهذا المنتج
            </span>
          </div>

          {/* Star Distribution Bars */}
          <div className="flex flex-col gap-1.5 lg:col-span-8">
            {distribution.map((row) => (
              <div key={row.stars} className="flex items-center gap-3 text-13">
                <span className="flex w-12 flex-none items-center gap-1 font-semibold text-ink">
                  {row.stars}
                  <Icon name="star" size={12} strokeWidth={1.5} fill="currentColor" className="text-tomato-ink" />
                </span>
                <div className="relative h-2 flex-1 overflow-hidden rounded-pill bg-sand">
                  <div
                    className="absolute inset-y-0 start-0 rounded-pill bg-cobalt transition-all duration-700 ease-out"
                    style={{ width: `${row.pct}%` }}
                  />
                </div>
                <span className="w-10 flex-none text-end text-stone">
                  {row.pct}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 3 Clinical Satisfaction Badges */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {metrics.map((m, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between rounded-card bg-chalk p-3.5 shadow-outline-hairline"
            >
              <span className="text-13 font-medium text-stone">{m.label}</span>
              <span className="font-display text-18 font-bold text-cobalt">{m.pct}</span>
            </div>
          ))}
        </div>

        {/* Filter Chips */}
        <div className="flex flex-wrap items-center gap-2">
          <Chip selected={filter === 'all'} onClick={() => setFilter('all')}>
            جميع التقييمات ({formatNumber(2413, locale)})
          </Chip>
          <Chip selected={filter === 'verified'} onClick={() => setFilter('verified')}>
            مشترٍ موثق ({formatNumber(1980, locale)})
          </Chip>
          <Chip selected={filter === 'photos'} onClick={() => setFilter('photos')}>
            مع صور ({formatNumber(412, locale)})
          </Chip>
          <Chip selected={filter === 'recent'} onClick={() => setFilter('recent')}>
            أحدث التقييمات
          </Chip>
        </div>

        {/* Review Cards Grid */}
        <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 lg:grid-cols-3 lg:gap-4">
          {MOCK_REVIEWS_ITEMS.map((review) => {
            const likeState = likes[review.id] || { count: review.helpfulCount || 0, active: false };
            return (
              <li
                key={review.id}
                className={cn(
                  cardVariants(),
                  'group flex flex-col justify-between gap-3 p-4.5 transition-all duration-300 hover:-translate-y-1 hover:shadow-elevation-2'
                )}
              >
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="flex size-8 items-center justify-center rounded-pill bg-sand font-display text-14 font-bold text-cobalt">
                        {review.authorName.charAt(0)}
                      </span>
                      <div className="flex flex-col">
                        <span className="text-14 font-bold text-ink">
                          {review.authorName}
                        </span>
                        {review.verified ? (
                          <span className="flex items-center gap-1 text-11.5 font-medium text-ok">
                            <Icon name="check" size={12} strokeWidth={2.4} />
                            مشترٍ موثق
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <RatingStars value={review.rating} size={14} />
                  </div>

                  <span className="self-start rounded-pill bg-chalk px-2.5 py-0.5 text-11.5 text-stone shadow-outline-hairline">
                    نوع البشرة: {review.skinConcern}
                  </span>

                  <p className="m-0 text-13.5 leading-24 text-ink">
                    &ldquo;{review.body}&rdquo;
                  </p>
                </div>

                <div className="flex items-center justify-between border-t border-ink/5 pt-2 text-12 text-stone">
                  <button
                    type="button"
                    onClick={() => toggleLike(review.id)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-12 font-medium transition-all duration-200 active:scale-95',
                      likeState.active
                        ? 'bg-ok-tint text-ok font-bold'
                        : 'text-stone hover:bg-sand/50'
                    )}
                  >
                    <Icon name="thumbs-up" size={14} strokeWidth={likeState.active ? 2.4 : 1.8} />
                    <span>مفيد ({formatNumber(likeState.count, locale)})</span>
                  </button>

                  <span>منذ عدة أيام</span>
                </div>
              </li>
            );
          })}
        </ul>

        {/* View All Button */}
        <div className="flex justify-center pt-2">
          <Button variant="linen" size="m" className="min-w-48 shadow-outline-control">
            عرض المزيد من التقييمات ({formatNumber(2413, locale)})
          </Button>
        </div>
      </div>

      <WriteReviewDialog open={writing} onOpenChange={setWriting} />
    </Section>
  );
}

function WriteReviewDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [stars, setStars] = useState(5);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setTimeout(() => {
      setSubmitted(false);
      onOpenChange(false);
    }, 1500);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel="إغلاق" className="max-w-md p-6">
        <DialogTitle className="m-0 font-display text-22 font-bold text-ink">
          اكتب تقييمك للمنتج
        </DialogTitle>

        {submitted ? (
          <div className="my-6 flex flex-col items-center gap-2 text-center text-ok">
            <span className="flex size-12 items-center justify-center rounded-pill bg-ok-tint text-ok">
              <Icon name="check" size={24} strokeWidth={2.4} />
            </span>
            <span className="text-16 font-bold">شكراً لمشاركتك! تم تسجيل تقييمك.</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-13 font-semibold text-stone">تقييمك الإجمالي:</label>
              <div className="flex items-center gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setStars(n)}
                    className="size-8 text-tomato-ink transition-transform active:scale-90"
                  >
                    <Icon
                      name="star"
                      size={26}
                      strokeWidth={1.5}
                      fill={n <= stars ? 'currentColor' : 'none'}
                    />
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-13 font-semibold text-stone">رأيك وتجربتك:</label>
              <textarea
                required
                rows={3}
                placeholder="اكتب تجربتك مع المنتج، هل لاحظت فرقاً في اللمعان والمسام؟"
                className="w-full resize-none rounded-input bg-chalk p-3 text-14 text-ink shadow-outline-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
              />
            </div>

            <Button type="submit" variant="cobalt" size="m" className="w-full mt-2">
              إرسال التقييم
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
