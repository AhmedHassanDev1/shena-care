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
    <article
      className={cn(
        'group relative flex items-center gap-3 rounded-card border border-line/60 bg-chalk/90 p-3 shadow-elevation-1 transition-all duration-fast hover:border-line-2/40 hover:bg-chalk hover:shadow-elevation-2',
        className,
      )}
    >
      {/* Product Image */}
      <Link
        href={routes.product(product.slug)}
        className="relative size-20 shrink-0 overflow-hidden rounded-image border border-line/40 bg-sand/20 p-1 transition-transform group-hover:scale-102 sm:size-22"
      >
        <ProductTile
          src={product.imageUrl ?? null}
          alt={product.name}
          name={product.name}
          fit="contain"
          className="size-full rounded-none bg-transparent"
        />
        {product.stepBadge ? (
          <span className="pointer-events-none absolute start-1 top-1 max-w-full truncate rounded-pill bg-linen/95 px-1.5 py-0.5 font-text text-11 font-medium text-stone shadow-elevation-1">
            {product.stepBadge}
          </span>
        ) : null}
      </Link>

      {/* Meta details */}
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate font-text text-11 font-semibold uppercase tracking-wider text-stone">
          {product.brand}
        </p>
        <Link
          href={routes.product(product.slug)}
          className="line-clamp-2 block font-display text-13 font-bold leading-snug text-ink transition-colors hover:text-cobalt sm:text-14"
        >
          {product.name}
        </Link>
        {product.variantName ? (
          <p className="truncate font-text text-11 text-stone">{product.variantName}</p>
        ) : null}
        {product.rationale ? (
          <p className="line-clamp-1 font-text text-11 leading-snug text-stone">
            <span className="font-semibold text-cobalt">✓ </span>
            {product.rationale}
          </p>
        ) : null}
        <p className="pt-0.5 font-display text-14 font-extrabold text-ink sm:text-15">
          {product.canOrder && product.price != null && product.price > 0
            ? formatAmount(product.price, locale)
            : m.shinaUnavailableProduct}
        </p>
      </div>

      {/* Primary Action Button */}
      <div className="shrink-0 self-center">
        <button
          type="button"
          disabled={!product.canOrder || isAdding}
          aria-busy={isAdding}
          onClick={() => onAddToBag(product)}
          aria-label={fillMessage(m.cardAddLabel, { name: product.name })}
          className={cn(
            'inline-flex min-h-control-s items-center justify-center gap-1.5 rounded-pill px-3.5 font-display text-12 font-bold shadow-action transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt disabled:cursor-not-allowed disabled:opacity-50',
            !product.canOrder
              ? 'border border-line bg-sand/60 text-stone'
              : isAdded
                ? 'bg-citron text-ink'
                : 'bg-cobalt text-chalk hover:bg-cobalt-deep active:scale-95',
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

  // Single product: display a comfortable wide card
  if (products.length === 1) {
    const p = products[0];
    return (
      <div className="w-full">
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

  // Two products: clean dual-column grid on desktop, swipeable on mobile
  if (products.length === 2) {
    return (
      <div className="grid w-full min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-2">
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

  // 3+ products: swipeable carousel with desktop navigation
  return (
    <div className="relative w-full min-w-0">
      <div className="mb-2 hidden items-center justify-between sm:flex">
        <span className="font-text text-11 font-medium text-stone">
          {products.length} منتجات موصى بها
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => swiper?.slidePrev()}
            aria-label={m.pdpCarouselPrev}
            className="inline-flex size-8 items-center justify-center rounded-full border border-line bg-chalk text-ink shadow-elevation-1 transition-colors hover:border-cobalt hover:text-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
          >
            <Icon name="chevron-back" size={15} />
          </button>
          <button
            type="button"
            onClick={() => swiper?.slideNext()}
            aria-label={m.pdpCarouselNext}
            className="inline-flex size-8 items-center justify-center rounded-full border border-line bg-chalk text-ink shadow-elevation-1 transition-colors hover:border-cobalt hover:text-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
          >
            <Icon name="chevron-forward" size={15} />
          </button>
        </div>
      </div>

      <Swiper
        modules={[Navigation, A11y, Keyboard]}
        onSwiper={setSwiper}
        spaceBetween={10}
        slidesPerView={1.12}
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
  const prefersReduced = Boolean(useReducedMotion());
  const [showDiffs, setShowDiffs] = useState(false);

  const hasSpecs = comparison.products.some((p) => p.specs && p.specs.length > 0);

  return (
    <section
      aria-label={comparison.title}
      className="w-full min-w-0 rounded-card border border-line/70 bg-chalk/90 p-3.5 shadow-elevation-1 backdrop-blur-md transition-shadow hover:shadow-elevation-2 sm:p-4"
    >
      {/* Comparison Header */}
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-line/40 pb-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-cobalt/10 text-cobalt">
            <Icon name="swap" size={15} />
          </span>
          <h3 className="truncate font-display text-13 font-bold text-ink sm:text-14">
            {comparison.title}
          </h3>
        </div>

        {hasSpecs ? (
          <button
            type="button"
            onClick={() => setShowDiffs((v) => !v)}
            className="inline-flex min-h-control-s shrink-0 items-center gap-1 rounded-pill bg-linen px-3 font-display text-12 font-bold text-cobalt transition-colors hover:bg-sand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
          >
            <Icon
              name="chevron-down"
              size={14}
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

      {/* Expandable Differences Matrix */}
      <AnimatePresence>
        {hasSpecs && showDiffs ? (
          <motion.div
            initial={prefersReduced ? undefined : { opacity: 0, height: 0 }}
            animate={prefersReduced ? undefined : { opacity: 1, height: 'auto' }}
            exit={prefersReduced ? undefined : { opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="mt-3.5 grid grid-cols-1 gap-2.5 border-t border-line/50 pt-3 md:grid-cols-2">
              {comparison.products.map((item) => (
                <div
                  key={`specs-${item.slug}-${item.skuId}`}
                  className="rounded-card border border-line/60 bg-linen/70 p-3 text-12 shadow-elevation-1"
                >
                  <p className="font-display text-13 font-bold text-ink">{item.name}</p>
                  <dl className="mt-2.5 space-y-2">
                    {item.specs.map((spec) => (
                      <div
                        key={`${item.slug}-${spec.label}`}
                        className="flex items-baseline justify-between gap-3 border-b border-line/40 pb-1.5 font-text text-11"
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
      className="w-full min-w-0 rounded-card border border-line/70 bg-chalk/90 p-3.5 shadow-elevation-1 backdrop-blur-md transition-shadow hover:shadow-elevation-2 sm:p-4.5"
    >
      {/* Routine Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/50 pb-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-citron text-ink shadow-elevation-1">
            <Icon name="routine" size={18} />
          </span>
          <div className="min-w-0">
            <h3 className="font-display text-14 font-extrabold text-ink sm:text-15">
              {routine.title}
            </h3>
            {routine.description ? (
              <p className="font-text text-12 text-stone leading-snug">{routine.description}</p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="rounded-pill border border-line/60 bg-linen px-2.5 py-0.5 font-text text-11 font-medium text-stone">
            {routine.source === 'ai-guidance' ? m.shinaSourceAi : m.shinaSourceCatalog}
          </span>
          <span className="rounded-pill bg-cobalt/10 px-2 py-0.5 font-text text-11 font-bold text-cobalt">
            {active.length} خطوات
          </span>
        </div>
      </div>

      {/* Steps list */}
      <ol className="mt-3.5 space-y-2.5">
        {current.map(({ step, index, options, product: prod, removed: isRemoved }) => {
          const isAdding = prod ? addingSkuId === prod.skuId : false;
          const isAdded = prod ? addedSkuIds.has(prod.skuId) : false;
          const swapped = (pick[index] ?? 0) % Math.max(options.length, 1) > 0;

          return (
            <li
              key={`${step.order}-${step.title}-${index}`}
              className={cn(
                'flex flex-col gap-2.5 rounded-card border border-line/50 bg-linen/60 p-3 transition-colors hover:border-line hover:bg-linen/90 sm:flex-row sm:items-center sm:justify-between',
                isRemoved && 'opacity-50',
              )}
            >
              <div className="flex min-w-0 items-start gap-2.5">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-cobalt font-display text-11 font-bold text-chalk">
                  {step.order || index + 1}
                </span>

                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 font-text text-11 font-medium text-stone">
                      <Icon name={step.timing === 'pm' ? 'evening' : 'routine'} size={13} />
                      <span>{step.roleLabel ?? step.timing.toUpperCase()}</span>
                    </span>
                    {isRemoved ? (
                      <span className="font-text text-11 font-semibold text-stone">
                        · {m.shinaStepRemoved}
                      </span>
                    ) : null}
                  </div>
                  <p
                    className={cn(
                      'font-display text-13 font-bold text-ink leading-snug sm:text-14',
                      isRemoved && 'line-through',
                    )}
                  >
                    {editable && prod ? prod.name : step.title}
                  </p>
                  {(swapped ? prod?.rationale : step.instructions) ? (
                    <p className="font-text text-12 text-stone leading-snug">
                      {swapped ? prod?.rationale : step.instructions}
                    </p>
                  ) : null}

                  {editable ? (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {options.length > 1 && !isRemoved ? (
                        <button
                          type="button"
                          onClick={() =>
                            setPick((prev) => ({
                              ...prev,
                              [index]: ((prev[index] ?? 0) + 1) % options.length,
                            }))
                          }
                          className="inline-flex min-h-control-s items-center gap-1 rounded-pill border border-line bg-chalk px-3 font-display text-12 font-bold text-ink transition-colors hover:border-cobalt hover:text-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
                        >
                          <Icon name="retry" size={13} />
                          <span>{m.shinaSwapProduct}</span>
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() =>
                          setRemoved((prev) => {
                            const next = new Set(prev);
                            if (next.has(index)) next.delete(index);
                            else next.add(index);
                            return next;
                          })
                        }
                        aria-pressed={isRemoved}
                        className="inline-flex min-h-control-s items-center gap-1 rounded-pill border border-line bg-chalk px-3 font-display text-12 font-bold text-ink transition-colors hover:border-cobalt hover:text-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
                      >
                        <span>{isRemoved ? m.shinaRestoreStep : m.shinaRemoveStep}</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              {prod && !isRemoved ? (
                <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line/40 pt-2 sm:border-t-0 sm:pt-0">
                  <Link
                    href={routes.product(prod.slug)}
                    className="flex items-center gap-2 font-display text-12 font-bold text-cobalt transition-colors hover:underline"
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
                      'inline-flex min-h-control-s items-center gap-1 rounded-pill px-3 font-display text-12 font-bold shadow-action transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt disabled:cursor-not-allowed disabled:opacity-50',
                      isAdded
                        ? 'bg-citron text-ink'
                        : 'bg-cobalt text-chalk hover:bg-cobalt-deep active:scale-95',
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
