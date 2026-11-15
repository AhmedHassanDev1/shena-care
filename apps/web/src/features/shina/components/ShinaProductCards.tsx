'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
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
import type { CompatibilityResult } from '@/features/care/api/care-intelligence';
import { RoutineCompatibilityPanel } from '@/features/care/components/RoutineCompatibilityPanel';
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
    /** Why the engine recommended it (from the consultation); shown under the name. */
    rationale?: string;
  };
  onAddToBag: (product: Pick<ShinaProduct, 'skuId' | 'name' | 'canOrder'>) => Promise<void>;
  isAdding: boolean;
  isAdded: boolean;
  className?: string;
}

export function CompactProductCard({
  product,
  onAddToBag,
  isAdding,
  isAdded,
  className,
}: CompactProductCardProps) {
  const m = useMessages();
  const locale = useLocale();

  return (
    <motion.article
      whileHover={{ y: -2 }}
      transition={{ duration: 0.15 }}
      className={cn(
        'group relative flex flex-col justify-between rounded-card border border-line/50 bg-chalk/45 p-2 shadow-elevation-1 backdrop-blur-xl transition-colors duration-fast hover:border-cobalt/40 hover:bg-chalk/75 hover:shadow-elevation-2',
        className,
      )}
    >
      <div>
        {/* 1. Petite Product Image */}
        <Link
          href={routes.product(product.slug)}
          className="relative block aspect-square w-full overflow-hidden rounded-image border border-line/30 bg-sand/15 p-1.5 transition-transform duration-fast group-hover:scale-102"
        >
          <ProductTile
            src={product.imageUrl ?? null}
            alt={product.name}
            name={product.name}
            fit="contain"
            className="size-full rounded-none bg-transparent"
          />
          {product.stepBadge ? (
            <span className="pointer-events-none absolute start-1 top-1 max-w-[85%] truncate rounded-pill bg-linen/95 px-1.5 py-0.5 font-text text-11 font-medium text-stone shadow-elevation-1">
              {product.stepBadge}
            </span>
          ) : null}
        </Link>

        {/* 2. Brand & Name */}
        <div className="mt-1.5 min-w-0">
          <p className="truncate font-text text-11 font-semibold uppercase tracking-wider text-stone">
            {product.brand}
          </p>
          <Link
            href={routes.product(product.slug)}
            title={product.name}
            className="mt-0.5 line-clamp-1 block font-display text-12 font-bold leading-snug text-ink transition-colors hover:text-cobalt"
          >
            {product.name}
          </Link>
        </div>
      </div>

      {/* 3. Price & Compact Action Row */}
      <div className="mt-2 flex items-center justify-between gap-1 border-t border-line/30 pt-1.5">
        <span className="font-display text-12 font-black text-ink sm:text-13">
          {product.canOrder && product.price != null && product.price > 0
            ? formatAmount(product.price, locale)
            : m.shinaUnavailableProduct}
        </span>

        <button
          type="button"
          disabled={!product.canOrder || isAdding}
          aria-busy={isAdding}
          onClick={() => onAddToBag(product)}
          aria-label={fillMessage(m.cardAddLabel, { name: product.name })}
          title={isAdded ? m.shinaAddedToBag : m.shinaAddToBag}
          className={cn(
            'inline-flex size-7 shrink-0 items-center justify-center rounded-full shadow-action transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt active:scale-90 disabled:cursor-not-allowed disabled:opacity-40',
            !product.canOrder
              ? 'bg-sand/60 text-stone'
              : isAdded
                ? 'bg-citron text-ink'
                : 'bg-cobalt text-chalk hover:bg-cobalt-deep',
          )}
        >
          <Icon name={isAdded ? 'check' : 'bag'} size={13} />
        </button>
      </div>
    </motion.article>
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

  // Single product: display a petite compact vertical card
  if (products.length === 1) {
    const p = products[0];
    return (
      <div className="w-[140px] sm:w-[155px]">
        <CompactProductCard
          product={p}
          onAddToBag={onAddToBag}
          isAdding={addingSkuId === p.skuId}
          isAdded={addedSkuIds.has(p.skuId)}
          className="w-full"
        />
      </div>
    );
  }

  // Two products: clean dual compact cards
  if (products.length === 2) {
    return (
      <div className="flex flex-wrap gap-2.5">
        {products.map((product) => (
          <div key={`${product.slug}-${product.skuId}`} className="w-[135px] sm:w-[150px]">
            <CompactProductCard
              product={product}
              onAddToBag={onAddToBag}
              isAdding={addingSkuId === product.skuId}
              isAdded={addedSkuIds.has(product.skuId)}
              className="h-full"
            />
          </div>
        ))}
      </div>
    );
  }

  // 3+ products: swipeable carousel with desktop navigation
  return (
    <div className="relative w-full min-w-0">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-text text-11 font-medium text-stone">
          {products.length} منتجات موصى بها
        </span>
        <div className="hidden items-center gap-1 sm:flex">
          <button
            type="button"
            onClick={() => swiper?.slidePrev()}
            aria-label={m.pdpCarouselPrev}
            className="inline-flex size-7 items-center justify-center rounded-full border border-line bg-chalk/60 text-ink shadow-elevation-1 backdrop-blur-md transition-colors hover:border-cobalt hover:text-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
          >
            <Icon name="chevron-back" size={13} />
          </button>
          <button
            type="button"
            onClick={() => swiper?.slideNext()}
            aria-label={m.pdpCarouselNext}
            className="inline-flex size-7 items-center justify-center rounded-full border border-line bg-chalk/60 text-ink shadow-elevation-1 backdrop-blur-md transition-colors hover:border-cobalt hover:text-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
          >
            <Icon name="chevron-forward" size={13} />
          </button>
        </div>
      </div>

      <Swiper
        modules={[Navigation, A11y, Keyboard]}
        onSwiper={setSwiper}
        spaceBetween={8}
        slidesPerView="auto"
        keyboard={{ enabled: true }}
        className="w-full !overflow-visible"
      >
        {products.map((product) => (
          <SwiperSlide key={`${product.slug}-${product.skuId}`} className="h-auto !w-[135px] sm:!w-[150px]">
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
  const prefersReduced = Boolean(useReducedMotion());
  const [showDiffs, setShowDiffs] = useState(false);

  const hasSpecs = comparison.products.some((p) => p.specs && p.specs.length > 0);

  return (
    <section
      aria-label={comparison.title}
      className="w-full min-w-0 rounded-card border border-line/40 bg-chalk/40 p-2.5 shadow-elevation-1 backdrop-blur-xl transition-shadow hover:shadow-elevation-2 sm:p-3"
    >
      {/* Comparison Header */}
      <div className="mb-2 flex items-center justify-between gap-2 border-b border-line/30 pb-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-cobalt/10 text-cobalt">
            <Icon name="swap" size={13} />
          </span>
          <h3 className="truncate font-display text-13 font-bold text-ink sm:text-14">
            {comparison.title}
          </h3>
        </div>

        {hasSpecs ? (
          <button
            type="button"
            onClick={() => setShowDiffs((v) => !v)}
            className="inline-flex min-h-6 shrink-0 items-center gap-1 rounded-pill bg-linen/60 px-2.5 font-display text-11 font-bold text-cobalt transition-colors hover:bg-sand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
          >
            <Icon
              name="chevron-down"
              size={12}
              className={cn('transition-transform duration-fast', showDiffs && 'rotate-180')}
            />
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

      {/* Side-by-side Product Cards */}
      <div className="flex flex-wrap items-stretch gap-2.5">
        {comparison.products.map((item) => (
          <div key={`${item.slug}-${item.skuId}`} className="w-[130px] sm:w-[150px]">
            <CompactProductCard
              product={item}
              onAddToBag={onAddToBag}
              isAdding={addingSkuId === item.skuId}
              isAdded={addedSkuIds.has(item.skuId)}
              className="h-full"
            />
          </div>
        ))}
      </div>

      {/* Expandable Differences Matrix */}
      <AnimatePresence>
        {hasSpecs && showDiffs ? (
          <motion.div
            initial={prefersReduced ? undefined : { opacity: 0, height: 0 }}
            animate={prefersReduced ? undefined : { opacity: 1, height: 'auto' }}
            exit={prefersReduced ? undefined : { opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="mt-2.5 grid grid-cols-1 gap-2 border-t border-line/30 pt-2 sm:grid-cols-2">
              {comparison.products.map((item) => (
                <div
                  key={`specs-${item.slug}-${item.skuId}`}
                  className="rounded-card border border-line/30 bg-linen/50 p-2 text-11 shadow-elevation-1 backdrop-blur-md"
                >
                  <p className="font-display text-12 font-bold text-ink">{item.name}</p>
                  <dl className="mt-1.5 space-y-1.5">
                    {item.specs.map((spec) => (
                      <div
                        key={`${item.slug}-${spec.label}`}
                        className="flex items-baseline justify-between gap-2 border-b border-line/20 pb-1 font-text text-11"
                      >
                        <dt className="shrink-0 text-stone">{spec.label}</dt>
                        <dd className="font-semibold text-ink text-end">{spec.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}

type SaveStep = { title: string; timing: 'AM' | 'PM' | 'AS_NEEDED'; skuId: string; reason?: string };

interface ShinaRoutineCardProps {
  routine: ShinaRoutinePreview;
  onAddToBag: (product: Pick<ShinaProduct, 'skuId' | 'name' | 'canOrder'>) => Promise<void>;
  onAddManyToBag: (products: ShinaProduct[]) => Promise<void>;
  addingSkuId: string | null;
  addedSkuIds: ReadonlySet<string>;
  isBatchAdding?: boolean;
  onSave?: (steps: SaveStep[]) => void;
  saveState?: 'pending' | 'saved' | 'failed';
}

const SLOT_OF: Record<ShinaRoutinePreview['steps'][number]['timing'], SaveStep['timing']> = {
  am: 'AM',
  pm: 'PM',
  both: 'AS_NEEDED',
  as_needed: 'AS_NEEDED',
};

export function ShinaRoutineCard({
  routine,
  onAddToBag,
  onAddManyToBag,
  addingSkuId,
  addedSkuIds,
  isBatchAdding = false,
  onSave,
  saveState,
}: ShinaRoutineCardProps) {
  const m = useMessages();
  const locale = useLocale();
  const editable = Boolean(onSave) && saveState !== 'saved';
  const [pick, setPick] = useState<Record<number, number>>({});
  const [removed, setRemoved] = useState<ReadonlySet<number>>(() => new Set());
  const [compatibility, setCompatibility] = useState<CompatibilityResult | null>(null);

  const current = routine.steps.map((step, index) => {
    const options = [step.product, ...(step.alternatives ?? [])].filter(
      (p): p is ShinaProduct => Boolean(p),
    );
    const product = options.length ? options[(pick[index] ?? 0) % options.length] : null;
    return { step, index, options, product, removed: removed.has(index) };
  });

  const active = current.filter((entry) => !entry.removed && entry.product);
  const edited = removed.size > 0 || Object.values(pick).some((value) => value > 0);
  const checkSteps = active.map((entry) => ({
    skuId: entry.product!.skuId,
    timing: SLOT_OF[entry.step.timing],
  }));
  const blocked =
    edited &&
    (compatibility === null ||
      compatibility.issues.some((issue) => issue.severity === 'BLOCK'));
  const orderableProducts = active
    .map((entry) => entry.product!)
    .filter((product) => product.canOrder);

  const save = () =>
    onSave?.(
      active.map((entry) => ({
        title: entry.product!.name.slice(0, 80),
        timing: SLOT_OF[entry.step.timing],
        skuId: entry.product!.skuId,
        reason: entry.product!.rationale ? entry.product!.rationale.slice(0, 280) : undefined,
      })),
    );

  return (
    <section
      aria-label={routine.title}
      className="w-full min-w-0 rounded-card border border-line/40 bg-chalk/40 p-2.5 shadow-elevation-1 backdrop-blur-xl transition-shadow hover:shadow-elevation-2 sm:p-3"
    >
      {/* Routine Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/30 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-citron text-ink shadow-elevation-1">
            <Icon name="routine" size={15} />
          </span>
          <div className="min-w-0">
            <h3 className="truncate font-display text-13 font-extrabold text-ink sm:text-14">
              {routine.title}
            </h3>
            {routine.description ? (
              <p className="line-clamp-1 font-text text-11 text-stone leading-snug">{routine.description}</p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="rounded-pill border border-line/40 bg-linen/70 px-2 py-0.5 font-text text-11 font-medium text-stone">
            {routine.source === 'ai-guidance' ? m.shinaSourceAi : m.shinaSourceCatalog}
          </span>
          <span className="rounded-pill bg-cobalt/10 px-2 py-0.5 font-text text-11 font-bold text-cobalt">
            {active.length} خطوات
          </span>
        </div>
      </div>

      {/* Steps list - Compact rows */}
      <ol className="mt-2 space-y-1.5">
        {current.map(({ step, index, options, product: prod, removed: isRemoved }) => {
          const isAdding = prod ? addingSkuId === prod.skuId : false;
          const isAdded = prod ? addedSkuIds.has(prod.skuId) : false;

          return (
            <li
              key={`${step.order}-${step.title}-${index}`}
              className={cn(
                'flex items-center justify-between gap-2 rounded-card border border-line/30 bg-linen/40 p-2 backdrop-blur-md transition-colors hover:bg-linen/70',
                isRemoved && 'opacity-50',
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-cobalt font-display text-11 font-bold text-chalk">
                  {step.order || index + 1}
                </span>

                <div className="min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="font-text text-11 text-stone">
                      {step.roleLabel ?? step.timing.toUpperCase()}
                    </span>
                    {isRemoved ? (
                      <span className="font-text text-11 text-stone">· {m.shinaStepRemoved}</span>
                    ) : null}
                  </div>
                  <p
                    className={cn(
                      'line-clamp-1 font-display text-12 font-bold text-ink leading-snug',
                      isRemoved && 'line-through',
                    )}
                  >
                    {editable && prod ? prod.name : step.title}
                  </p>
                </div>
              </div>

              {prod && !isRemoved ? (
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-display text-11 font-extrabold text-ink">
                    {prod.canOrder && prod.price > 0
                      ? formatAmount(prod.price, locale)
                      : m.shinaUnavailableProduct}
                  </span>

                  <button
                    type="button"
                    disabled={!prod.canOrder || isAdding}
                    aria-busy={isAdding}
                    onClick={() => onAddToBag(prod)}
                    aria-label={fillMessage(m.cardAddLabel, { name: prod.name })}
                    title={isAdded ? m.shinaAddedToBag : m.shinaAddToBag}
                    className={cn(
                      'inline-flex size-7 shrink-0 items-center justify-center rounded-full shadow-action transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt active:scale-90 disabled:cursor-not-allowed disabled:opacity-40',
                      isAdded
                        ? 'bg-citron text-ink'
                        : 'bg-cobalt text-chalk hover:bg-cobalt-deep',
                    )}
                  >
                    <Icon name={isAdded ? 'check' : 'bag'} size={13} />
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {/* Routine safety notes */}
      {routine.notes && routine.notes.length > 0 && !edited ? (
        <ul className="mt-3 space-y-1 rounded-card border border-line/50 bg-linen/70 p-2.5 font-text text-11 text-stone">
          {routine.notes.map((note) => (
            <li key={note} className="flex items-start gap-1.5">
              <Icon name="shield" size={13} className="mt-0.5 shrink-0 text-cobalt" />
              <span>{note}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Routine compatibility panel on edit */}
      {editable && edited ? (
        <div className="mt-3 flex flex-col gap-2">
          <p role="status" className="m-0 font-text text-12 text-stone">
            {m.shinaRoutineEdited}
          </p>
          <RoutineCompatibilityPanel steps={checkSteps} onResult={setCompatibility} />
        </div>
      ) : null}

      {/* Save routine action */}
      {onSave ? (
        <div className="mt-3.5 flex flex-col gap-1.5 border-t border-line/50 pt-3">
          <p className="m-0 font-text text-11 text-stone">{m.shinaSaveRoutineConfirm}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={
                saveState === 'pending' || saveState === 'saved' || active.length === 0 || blocked
              }
              aria-busy={saveState === 'pending'}
              className="inline-flex min-h-control-s items-center gap-1.5 rounded-pill bg-ink px-4 font-display text-12 font-bold text-chalk shadow-action transition-all hover:bg-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Icon name={saveState === 'saved' ? 'check' : 'routine'} size={14} />
              <span>
                {saveState === 'pending'
                  ? m.shinaSaveRoutinePending
                  : saveState === 'saved'
                    ? m.shinaSaveRoutineSaved
                    : m.shinaSaveRoutine}
              </span>
            </button>
            {saveState === 'saved' ? (
              <Link
                href={routes.myRoutine}
                className="font-display text-12 font-bold text-cobalt underline decoration-1 underline-offset-2"
              >
                {m.shinaSaveRoutineSaved}
              </Link>
            ) : null}
            {blocked && compatibility ? (
              <span role="alert" className="font-text text-12 font-semibold text-tomato-ink">
                {m.shinaSaveBlocked}
              </span>
            ) : null}
            {saveState === 'failed' ? (
              <span role="alert" className="font-text text-12 font-semibold text-tomato-ink">
                {m.shinaSaveRoutineFailed}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Batch add & builder buttons */}
      <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-line/50 pt-3">
        {orderableProducts.length > 0 ? (
          <button
            type="button"
            disabled={isBatchAdding}
            aria-busy={isBatchAdding}
            onClick={() => onAddManyToBag(orderableProducts)}
            className="inline-flex min-h-control-s items-center gap-1.5 rounded-pill bg-cobalt px-4 font-display text-12 font-bold text-chalk shadow-action transition-all hover:bg-cobalt-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt active:scale-95 disabled:opacity-50"
          >
            <Icon name="bag" size={15} />
            <span>{fillMessage(m.shinaAddRoutineAvailable, { count: orderableProducts.length })}</span>
          </button>
        ) : null}

        <Link
          href={routes.routineBuilder}
          className="inline-flex min-h-control-s items-center gap-1.5 rounded-pill border border-line bg-linen px-3.5 font-display text-12 font-bold text-ink transition-colors hover:border-cobalt hover:text-cobalt"
        >
          <Icon name="routine" size={14} />
          <span>{m.shinaOpenRoutineBuilder}</span>
        </Link>
      </div>
    </section>
  );
}
