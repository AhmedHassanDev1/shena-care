'use client';

import { useEffect, useId, useRef } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { ProductTile } from '@/components/ui/product-tile';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { Skeleton } from '@/components/ui/skeleton';
import { MAX_LINE_QUANTITY } from '@/lib/cart';
import { currencyLabel, formatAmount, formatNumber } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { useQuickAdd } from '@/features/catalog/hooks/useQuickAdd';
import type { CardModel } from '@/features/catalog/lib/card-model';
import { SizePicker } from '@/features/catalog/components/SizePicker';

export interface ShowcaseProductCardProps {
  product: CardModel;
  priority?: boolean;
}

/**
 * Creative Showcase Product Card
 * Elevated editorial presentation tailored for the Home Products Showcase:
 * - 4:5 editorial packshot frame with generous negative space
 * - Ambient floating micro-tags for genuine discounts and category solutions
 * - Latin brand in campaign Instrument Serif Italic with line attribution
 * - Bold Beiruti product title with smooth interactive hover
 * - Real pricing with compare-at strikethrough and fast coastal delivery indicator
 * - High-touch Sahel Cobalt action button with smooth cart feedback and integrated stepper
 */
export function ShowcaseProductCard({ product, priority = false }: ShowcaseProductCardProps) {
  const m = useMessages();
  const locale = useLocale();
  const { state, multi, line, pickerOpen, qtyPending, add, start, changeQuantity, closePicker } = useQuickAdd(product);
  const addRef = useRef<HTMLButtonElement>(null);
  const errorId = useId();
  const href = routes.product(product.slug);

  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !pickerOpen && !line) addRef.current?.focus();
    wasOpen.current = pickerOpen;
  }, [pickerOpen, line]);

  const priceText = product.price ? formatAmount(product.price.amount, locale) : null;

  return (
    <article
      aria-label={`${product.brandName} ${product.name}`}
      className="group/card relative flex h-full w-full min-w-0 flex-col rounded-card border border-line/70 bg-linen/70 p-3 font-display text-ink shadow-elevation-1 transition-all duration-base hover:border-cobalt/40 hover:bg-chalk hover:shadow-elevation-2"
    >
      {/* 1. Media Frame: 4:5 proportion with ambient frosted tags */}
      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-image bg-sand/20 shadow-outline-hairline transition-shadow duration-base ease-standard group-hover/card:shadow-elevation-1">
        <Link href={href} tabIndex={-1} aria-hidden="true" className="block size-full">
          <ProductTile
            src={product.imageUrl}
            alt={product.imageAlt}
            name={product.name}
            priority={priority}
            className={cn('size-full', product.unavailable && '[&_img]:opacity-45 [&_img]:grayscale-[.7]')}
          >
            {/* Ambient Overlays */}
            {product.discountPercent ? (
              <span className="absolute start-2.5 top-2.5 z-10 inline-flex h-6.5 items-center rounded-pill bg-tomato px-2.5 text-11 font-bold text-ink shadow-elevation-1">
                {fillMessage(m.cardSaveDiscount, { n: String(product.discountPercent) })}
              </span>
            ) : product.type ? (
              <span className="absolute start-2.5 top-2.5 z-10 inline-flex h-6.5 items-center rounded-pill border border-line/60 bg-chalk/90 px-2.5 text-11 font-semibold text-ink shadow-elevation-1 backdrop-blur-md">
                {product.type}
              </span>
            ) : null}

            {product.unavailable ? (
              <span className="absolute end-2.5 top-2.5 z-10 inline-flex h-6.5 items-center rounded-pill bg-ink px-2.5 text-11 font-semibold text-chalk shadow-elevation-1">
                {m.cardUnavailableBadge}
              </span>
            ) : null}

            {product.sizeLine ? (
              <span className="absolute bottom-2.5 end-2.5 z-10 inline-flex h-5.5 items-center rounded-4 bg-ink/80 px-2 text-11 font-medium tabular-nums text-chalk backdrop-blur-md">
                {product.sizeLine}
              </span>
            ) : null}
          </ProductTile>
        </Link>
      </div>

      {multi && pickerOpen ? (
        <SizePicker
          product={product}
          pending={state === 'pending'}
          failed={state === 'error'}
          onAdd={add}
          onClose={closePicker}
        />
      ) : null}

      {/* 2. Semantic Usage Micro-Tag */}
      {product.usage ? (
        <div className="mt-2.5 flex items-center gap-1.5 truncate">
          <span className="inline-flex max-w-full items-center gap-1 truncate rounded-pill border border-line/40 bg-sand/40 px-2 py-0.5 text-11 font-medium text-stone">
            <Icon name="routine" size={12} className="flex-none text-cobalt" />
            <span className="truncate">{product.usage}</span>
          </span>
        </div>
      ) : null}

      {/* 3. Brand (Latin wordmark in campaign serif + product line) */}
      <p className="m-0 mt-2 truncate font-serif text-13.5 italic leading-18 text-stone">
        <bdi>{product.brandName}</bdi>
        {product.productLine ? (
          <span className="ms-1.5 text-11 font-normal not-italic text-stone/80">
            • {product.productLine}
          </span>
        ) : null}
      </p>

      {/* 4. Product Name: calibrated min-height so prices align across row */}
      <Link href={href} className="group/name mt-1 text-ink no-underline">
        <h3
          dir="auto"
          className="text-match-parent m-0 min-h-10 line-clamp-2 text-15 font-bold leading-20 transition-colors duration-fast group-hover/name:text-cobalt"
        >
          {product.name}
        </h3>
      </Link>

      {/* 5. Pricing & Delivery Reassurance */}
      <div className="mt-auto flex items-baseline justify-between gap-2 border-t border-line/40 pt-2.5">
        <div className="flex items-baseline gap-1">
          {priceText ? (
            <>
              {product.priceIsFrom ? (
                <span className="me-0.5 text-11 font-normal text-stone">{m.cardFrom}</span>
              ) : null}
              <span
                className={cn(
                  'text-18 font-extrabold tabular-nums',
                  product.unavailable ? 'text-stone' : 'text-ink'
                )}
              >
                <bdi>{priceText}</bdi>
              </span>
              <span className="ms-0.5 text-11 font-medium text-stone">{currencyLabel(locale)}</span>
              {product.compareAtPrice ? (
                <span className="ms-1.5 line-through text-12 font-normal tabular-nums text-stone/70">
                  <bdi>{formatAmount(product.compareAtPrice.amount, locale)}</bdi>
                </span>
              ) : null}
            </>
          ) : (
            <span />
          )}
        </div>
        <span className="truncate text-11 font-medium text-ok">{m.cardFastDelivery}</span>
      </div>

      {/* 6. Purchase Action: Ergonomic Sahel Cobalt button or confirmed QuantityStepper */}
      <div className="pt-2.5">
        {product.unavailable ? (
          <div className="flex h-11 w-full items-center justify-center rounded-pill bg-sand text-13 font-semibold text-stone">
            {m.cardUnavailable}
          </div>
        ) : line ? (
          <div className="flex h-11 w-full items-center justify-between rounded-pill border border-line-2/40 bg-linen px-2 shadow-elevation-1">
            <span className="flex items-center gap-1 ps-2 text-11 font-bold text-cobalt">
              <Icon name="check" size={14} className="flex-none" />
              <span className="truncate">{m.cardInCartActive}</span>
            </span>
            <QuantityStepper
              tone="commerce"
              value={line.quantity}
              displayValue={formatNumber(line.quantity, locale)}
              min={0}
              max={MAX_LINE_QUANTITY}
              pending={qtyPending}
              onChange={changeQuantity}
              labels={{ group: m.cardQtyGroup, increase: m.qtyIncrease, decrease: m.qtyDecrease }}
            />
          </div>
        ) : (
          <button
            ref={addRef}
            type="button"
            aria-label={
              state === 'pending'
                ? m.cardAdding
                : fillMessage(multi ? m.cardChooseAddLabel : m.cardAddLabel, { name: product.name })
            }
            aria-haspopup={multi ? 'dialog' : undefined}
            aria-expanded={multi ? pickerOpen : undefined}
            aria-busy={state === 'pending' && !multi ? true : undefined}
            aria-disabled={state === 'pending' && !multi ? true : undefined}
            aria-describedby={state === 'error' && !multi ? errorId : undefined}
            onClick={start}
            className={cn(
              'sl group/btn inline-flex h-11 w-full items-center justify-center gap-2 rounded-pill bg-cobalt px-4 text-13.5 font-bold text-chalk shadow-elevation-1 transition-all duration-fast',
              'hover:bg-cobalt-deep hover:shadow-elevation-2 active:scale-95',
              multi && pickerOpen && 'bg-cobalt-deep'
            )}
          >
            {state === 'pending' && !multi ? (
              <span>{m.cardAdding}</span>
            ) : state === 'error' && !multi ? (
              <>
                <Icon name="retry" size={15} strokeWidth={2} />
                <span>{m.cardRetry}</span>
              </>
            ) : (
              <>
                <Icon
                  name="bag"
                  size={15}
                  strokeWidth={2}
                  className="transition-transform group-hover/btn:-translate-y-0.5"
                />
                <span>{multi ? m.pdpChooseSize : m.cardAdd}</span>
              </>
            )}
          </button>
        )}
      </div>

      {state === 'error' && !multi ? (
        <p
          id={errorId}
          role="alert"
          className="m-0 mt-2 flex items-start gap-1.5 text-13 font-semibold text-tomato-ink"
        >
          <span
            aria-hidden="true"
            className="mt-1 flex size-3.5 flex-none items-center justify-center rounded-full bg-tomato text-10.5 font-bold text-ink"
          >
            !
          </span>
          {m.cardAddFailed}
        </p>
      ) : null}
    </article>
  );
}

/** Loading card in elevated Showcase format */
export function ShowcaseProductCardSkeleton() {
  return (
    <div aria-hidden="true" className="flex h-full flex-col rounded-card border border-line/60 bg-linen/50 p-3 font-display">
      <Skeleton className="aspect-[4/5] w-full rounded-image" />
      <div className="mt-3 flex flex-1 flex-col gap-2">
        <Skeleton className="h-3.5 w-1/3 rounded-4" />
        <Skeleton className="h-4 w-5/6 rounded-4" />
        <Skeleton className="h-4 w-2/3 rounded-4" />
        <div className="mt-auto flex items-center justify-between border-t border-line/30 pt-2.5">
          <Skeleton className="h-5 w-20 rounded-4" />
          <Skeleton className="h-3.5 w-16 rounded-4" />
        </div>
        <Skeleton className="mt-2.5 h-11 w-full rounded-pill" />
      </div>
    </div>
  );
}
