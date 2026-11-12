'use client';

import { useState } from 'react';
import Link from 'next/link';
import { A11y, Keyboard, Navigation } from 'swiper/modules';
import { Swiper, SwiperSlide } from 'swiper/react';
import type { Swiper as SwiperType } from 'swiper';
import { Icon } from '@/components/ui/icon';
import { ProductTile } from '@/components/ui/product-tile';
import { formatAmount } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import type {
  ShinaComparison,
  ShinaComparisonProduct,
  ShinaProduct,
  ShinaRoutinePreview,
} from '../lib/shina-types';

interface ShinaProductCarouselProps {
  products: ShinaProduct[];
  onAddToBag: (product: Pick<ShinaProduct, 'skuId' | 'name' | 'canOrder'>) => Promise<void>;
  addingSkuId: string | null;
  addedSkuIds: ReadonlySet<string>;
}

interface CompactProductCardProps {
  product: {
    slug: string;
    skuId: string;
    name: string;
    brand: string;
    imageUrl?: string | null;
    price?: number | null;
    canOrder: boolean;
    stepBadge?: string;
    variantName?: string | null;
  };
  onAddToBag: (product: Pick<ShinaProduct, 'skuId' | 'name' | 'canOrder'>) => Promise<void>;
  isAdding: boolean;
  isAdded: boolean;
  className?: string;
}

function CompactProductCard({
  product,
  onAddToBag,
  isAdding,
  isAdded,
  className,
}: CompactProductCardProps) {
  const m = useMessages();
  const locale = useLocale();

  return (
    <article
      className={cn(
        'flex items-center gap-2.5 rounded-card border border-linen/80 bg-chalk/90 p-2.5 shadow-elevation-1 backdrop-blur-md transition-shadow hover:shadow-elevation-2 sm:gap-3 sm:p-3',
        className,
      )}
    >
      <Link
        href={routes.product(product.slug)}
        className="group relative size-20 shrink-0 overflow-hidden rounded-image bg-sand/20 p-1"
      >
        <ProductTile
          src={product.imageUrl ?? null}
          alt={product.name}
          name={product.name}
          fit="contain"
          className="size-full rounded-none bg-transparent"
        />
        {product.stepBadge ? (
          <span className="pointer-events-none absolute start-1 top-1 max-w-full truncate rounded-pill bg-linen/95 px-1.5 py-0.5 text-11 font-medium text-stone shadow-elevation-1">
            {product.stepBadge}
          </span>
        ) : null}
      </Link>

      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate text-11 font-medium text-stone">{product.brand}</p>
        <Link
          href={routes.product(product.slug)}
          className="line-clamp-2 block font-display text-13 font-bold leading-snug text-ink hover:text-cobalt sm:text-14"
        >
          {product.name}
        </Link>
        {product.variantName ? (
          <p className="truncate text-11 text-stone">{product.variantName}</p>
        ) : null}
        <p className="pt-0.5 font-display text-14 font-bold text-ink">
          {product.canOrder && product.price != null && product.price > 0
            ? formatAmount(product.price, locale)
            : m.shinaUnavailableProduct}
        </p>
      </div>

      <div className="shrink-0 self-center">
        <button
          type="button"
          disabled={!product.canOrder || isAdding}
          aria-busy={isAdding}
          onClick={() => onAddToBag(product)}
          aria-label={fillMessage(m.cardAddLabel, { name: product.name })}
          className={cn(
            'inline-flex min-h-control-s items-center justify-center gap-1 rounded-pill px-3 font-display text-12 font-bold shadow-action transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt disabled:cursor-not-allowed disabled:opacity-55',
            !product.canOrder
              ? 'border border-line bg-sand text-stone'
              : isAdded
                ? 'bg-citron text-ink'
                : 'bg-cobalt text-chalk hover:bg-cobalt-deep',
          )}
        >
          <Icon name={isAdded ? 'check' : 'bag'} size={15} />
          <span>
            {!product.canOrder
              ? m.shinaUnavailableProduct
              : isAdded
                ? m.shinaAddedToBag
                : m.shinaAddToBag}
          </span>
        </button>
      </div>
    </article>
  );
}

export function ShinaProductCarousel({
  products,
  onAddToBag,
  addingSkuId,
  addedSkuIds,
}: ShinaProductCarouselProps) {
  const m = useMessages();
  const [swiper, setSwiper] = useState<SwiperType | null>(null);

  if (products.length === 0) return null;

  if (products.length <= 4) {
    return (
      <div className="grid w-full min-w-0 grid-cols-1 gap-2.5 md:grid-cols-2">
        {products.map((product) => (
          <CompactProductCard
            key={`${product.slug}-${product.skuId}`}
            product={product}
            onAddToBag={onAddToBag}
            isAdding={addingSkuId === product.skuId}
            isAdded={addedSkuIds.has(product.skuId)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="relative w-full min-w-0">
      <div className="mb-2 hidden items-center justify-end gap-1.5 sm:flex">
        <button
          type="button"
          onClick={() => swiper?.slidePrev()}
          aria-label={m.pdpCarouselPrev}
          className="inline-flex size-9 items-center justify-center rounded-full border border-line bg-chalk text-ink shadow-elevation-1 transition-colors hover:border-cobalt hover:text-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
        >
          <Icon name="chevron-back" size={16} />
        </button>
        <button
          type="button"
          onClick={() => swiper?.slideNext()}
          aria-label={m.pdpCarouselNext}
          className="inline-flex size-9 items-center justify-center rounded-full border border-line bg-chalk text-ink shadow-elevation-1 transition-colors hover:border-cobalt hover:text-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
        >
          <Icon name="chevron-forward" size={16} />
        </button>
      </div>

      <Swiper
        modules={[Navigation, A11y, Keyboard]}
        onSwiper={setSwiper}
        spaceBetween={10}
        slidesPerView={1.15}
        keyboard={{ enabled: true }}
        breakpoints={{
          640: { slidesPerView: 2, slidesPerGroup: 2 },
        }}
        className="w-full"
      >
        {products.map((product) => (
          <SwiperSlide key={`${product.slug}-${product.skuId}`} className="h-auto">
            <CompactProductCard
              product={product}
              onAddToBag={onAddToBag}
              isAdding={addingSkuId === product.skuId}
              isAdded={addedSkuIds.has(product.skuId)}
              className="h-full"
            />
          </SwiperSlide>
        ))}
      </Swiper>
    </div>
  );
}

interface ShinaComparisonCardProps {
  comparison: ShinaComparison;
  onAddToBag: (product: Pick<ShinaComparisonProduct, 'skuId' | 'name' | 'canOrder'>) => Promise<void>;
  addingSkuId: string | null;
  addedSkuIds: ReadonlySet<string>;
}

export function ShinaComparisonCard({
  comparison,
  onAddToBag,
  addingSkuId,
  addedSkuIds,
}: ShinaComparisonCardProps) {
  const locale = useLocale();
  const [showDiffs, setShowDiffs] = useState(false);

  const hasSpecs = comparison.products.some((p) => p.specs && p.specs.length > 0);

  return (
    <section
      aria-label={comparison.title}
      className="w-full min-w-0 rounded-card border border-linen/80 bg-linen/75 p-3 shadow-elevation-1 backdrop-blur-md sm:p-3.5"
    >
      <div className="mb-2.5 flex items-center justify-between gap-2 border-b border-line/50 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-cobalt/10 text-cobalt">
            <Icon name="swap" size={14} />
          </span>
          <h3 className="truncate font-display text-13 font-bold leading-snug text-ink sm:text-14">
            {comparison.title}
          </h3>
        </div>

        {hasSpecs ? (
          <button
            type="button"
            onClick={() => setShowDiffs((v) => !v)}
            className="inline-flex min-h-control-s shrink-0 items-center gap-1 rounded-pill px-2.5 text-12 font-bold text-cobalt transition-colors hover:bg-cobalt/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
          >
            <Icon name="chevron-down" size={14} className={cn('transition-transform duration-fast', showDiffs && 'rotate-180')} />
            <span>
              {locale === 'ar'
                ? showDiffs
                  ? 'إخفاء الفروقات'
                  : 'عرض الفروقات'
                : showDiffs
                  ? 'Hide differences'
                  : 'View differences'}
            </span>
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
        {comparison.products.map((item) => (
          <CompactProductCard
            key={`${item.slug}-${item.skuId}`}
            product={item}
            onAddToBag={onAddToBag}
            isAdding={addingSkuId === item.skuId}
            isAdded={addedSkuIds.has(item.skuId)}
          />
        ))}
      </div>

      {hasSpecs && showDiffs ? (
        <div className="mt-3 grid grid-cols-1 gap-2.5 border-t border-line/50 pt-2.5 md:grid-cols-2">
          {comparison.products.map((item) => (
            <div
              key={`specs-${item.slug}-${item.skuId}`}
              className="rounded-card border border-line/60 bg-chalk/80 p-2.5 text-12"
            >
              <p className="font-display font-bold text-ink">{item.name}</p>
              <dl className="mt-2 space-y-1.5">
                {item.specs.map((spec) => (
                  <div
                    key={`${item.slug}-${spec.label}`}
                    className="flex items-baseline justify-between gap-2 border-b border-line/40 pb-1 text-11"
                  >
                    <dt className="text-stone">{spec.label}</dt>
                    <dd className="font-medium text-ink text-end">{spec.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

interface ShinaRoutineCardProps {
  routine: ShinaRoutinePreview;
  onAddToBag: (product: Pick<ShinaProduct, 'skuId' | 'name' | 'canOrder'>) => Promise<void>;
  onAddManyToBag: (products: ShinaProduct[]) => Promise<void>;
  addingSkuId: string | null;
  addedSkuIds: ReadonlySet<string>;
  isBatchAdding?: boolean;
}

export function ShinaRoutineCard({
  routine,
  onAddToBag,
  onAddManyToBag,
  addingSkuId,
  addedSkuIds,
  isBatchAdding = false,
}: ShinaRoutineCardProps) {
  const m = useMessages();
  const locale = useLocale();

  const orderableProducts = routine.steps
    .map((step) => step.product)
    .filter((product): product is ShinaProduct => Boolean(product && product.canOrder));

  return (
    <section
      aria-label={routine.title}
      className="w-full min-w-0 rounded-card border border-linen/80 bg-linen/80 p-3.5 shadow-elevation-1 backdrop-blur-md sm:p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line/60 pb-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-citron text-ink">
            <Icon name="routine" size={18} />
          </span>
          <div className="min-w-0">
            <h3 className="font-display text-14 font-bold text-ink">{routine.title}</h3>
            {routine.description ? (
              <p className="text-12 text-stone leading-snug">{routine.description}</p>
            ) : null}
          </div>
        </div>

        <span className="rounded-pill border border-line bg-chalk px-2.5 py-0.5 text-11 font-medium text-stone">
          {routine.source === 'ai-guidance' ? m.shinaSourceAi : m.shinaSourceCatalog}
        </span>
      </div>

      <ol className="mt-3 space-y-2">
        {routine.steps.map((step, index) => {
          const prod = step.product;
          const isAdding = prod ? addingSkuId === prod.skuId : false;
          const isAdded = prod ? addedSkuIds.has(prod.skuId) : false;

          return (
            <li
              key={`${step.order}-${step.title}-${index}`}
              className="flex flex-col gap-2 rounded-card border border-line/50 bg-chalk p-2.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-start gap-2.5">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-cobalt text-11 font-bold text-chalk">
                  {step.order || index + 1}
                </span>

                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 text-11 font-medium text-stone">
                      <Icon name={step.timing === 'pm' ? 'evening' : 'routine'} size={13} />
                      <span>{step.roleLabel ?? step.timing.toUpperCase()}</span>
                    </span>
                  </div>
                  <p className="font-display text-13 font-bold text-ink leading-snug">{step.title}</p>
                  {step.instructions ? (
                    <p className="text-12 text-stone leading-snug">{step.instructions}</p>
                  ) : null}
                </div>
              </div>

              {prod ? (
                <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line/40 pt-2 sm:border-t-0 sm:pt-0">
                  <Link
                    href={routes.product(prod.slug)}
                    className="flex items-center gap-2 text-12 font-bold text-cobalt hover:underline"
                  >
                    <ProductTile
                      src={prod.imageUrl ?? null}
                      alt={prod.name}
                      name={prod.name}
                      size="thumb"
                      fit="cover"
                      className="size-9 rounded-image"
                    />
                    <span>
                      {prod.canOrder && prod.price > 0
                        ? formatAmount(prod.price, locale)
                        : m.shinaUnavailableProduct}
                    </span>
                  </Link>

                  <button
                    type="button"
                    disabled={!prod.canOrder || isAdding}
                    aria-busy={isAdding}
                    onClick={() => onAddToBag(prod)}
                    aria-label={fillMessage(m.cardAddLabel, { name: prod.name })}
                    className={cn(
                      'inline-flex min-h-control-s items-center gap-1 rounded-pill px-3 font-display text-12 font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt disabled:cursor-not-allowed disabled:opacity-55',
                      isAdded ? 'bg-citron text-ink' : 'bg-ink text-chalk hover:bg-cobalt',
                    )}
                  >
                    <Icon name={isAdded ? 'check' : 'plus'} size={14} />
                    <span>{isAdded ? m.shinaAddedToBag : m.shinaAddToBag}</span>
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {routine.notes && routine.notes.length > 0 ? (
        <ul className="mt-3 space-y-1 rounded-16 border border-line/60 bg-chalk/70 p-2.5 text-12 text-stone">
          {routine.notes.map((note) => (
            <li key={note} className="flex items-start gap-1.5">
              <Icon name="shield" size={14} className="mt-0.5 shrink-0 text-cobalt" />
              <span>{note}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line/60 pt-3">
        {orderableProducts.length > 0 ? (
          <button
            type="button"
            disabled={isBatchAdding}
            aria-busy={isBatchAdding}
            onClick={() => onAddManyToBag(orderableProducts)}
            className="inline-flex min-h-control-s items-center gap-1.5 rounded-pill bg-cobalt px-3.5 font-display text-12 font-bold text-chalk transition-colors hover:bg-cobalt-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt disabled:opacity-55"
          >
            <Icon name="bag" size={15} />
            <span>{fillMessage(m.shinaAddRoutineAvailable, { count: orderableProducts.length })}</span>
          </button>
        ) : null}

        <Link
          href={routes.routineBuilder}
          className="inline-flex min-h-control-s items-center gap-1.5 rounded-pill border border-line bg-chalk px-3.5 font-display text-12 font-bold text-ink transition-colors hover:border-cobalt hover:text-cobalt"
        >
          <Icon name="routine" size={15} />
          <span>{m.shinaOpenRoutineBuilder}</span>
        </Link>
      </div>
    </section>
  );
}
