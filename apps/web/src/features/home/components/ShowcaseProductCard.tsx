'use client';

import { useEffect, useId, useRef, useState } from 'react';
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
 * Editorial Showcase Product Card (Stitch SAHEL Visual Direction):
 * - ZERO outer padding around media: connects directly to card boundaries.
 * - Portrait 4:5 editorial media stage with subtle warm limestone ground.
 * - Gentle scale-105 hover transition.
 * - Genuine discount ribbon and category solution tag.
 * - Tactile wishlist control.
 * - Latin brand attribution in campaign Instrument Serif Italic.
 * - Title in bold Beiruti with smooth hover response.
 * - Real pricing with genuine compare-at discount strikethrough.
 * - High-touch Cobalt purchase CTA button and integrated cart quantity stepper.
 */
export function ShowcaseProductCard({ product, priority = false }: ShowcaseProductCardProps) {
  const m = useMessages();
  const locale = useLocale();
  const [wishlisted, setWishlisted] = useState(false);
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
      className="group/card relative flex h-full w-full min-w-0 flex-col overflow-hidden rounded-card border border-line/80 bg-linen font-display text-ink shadow-elevation-1 transition-all duration-base hover:-translate-y-1 hover:border-cobalt/40 hover:bg-chalk hover:shadow-elevation-2"
    >
      {/* 1. Full-Bleed Media Frame (Zero outer padding: connects directly to card boundaries) */}
      <div className="relative aspect-[4/5] w-full overflow-hidden border-b border-line/50 bg-sand/20">
        <Link href={href} tabIndex={-1} aria-hidden="true" className="block size-full">
          <ProductTile
            src={product.imageUrl}
            alt={product.imageAlt}
            name={product.name}
            priority={priority}
            className={cn(
              'size-full rounded-none aspect-auto [&_img]:object-cover group-hover/card:[&_img]:scale-105 [&_img]:transition-transform [&_img]:duration-500 [&_img]:ease-out',
              product.unavailable && '[&_img]:opacity-45 [&_img]:grayscale-[.7]'
            )}
          >
            {/* Top Start: Genuine Discount Badge or Category Type */}
            {product.discountPercent ? (
              <span className="absolute start-3 top-3 z-10 inline-flex h-6.5 items-center rounded-pill bg-tomato px-2.5 text-11 font-bold text-chalk shadow-elevation-1">
                {fillMessage(m.cardSaveDiscount, { n: String(product.discountPercent) })}
              </span>
            ) : product.type ? (
              <span className="absolute start-3 top-3 z-10 inline-flex h-6.5 items-center rounded-pill border border-line/60 bg-chalk/90 px-2.5 text-11 font-semibold text-ink shadow-elevation-1 backdrop-blur-md">
                {product.type}
              </span>
            ) : null}

            {/* Out of stock badge if unavailable */}
            {product.unavailable ? (
              <span className="absolute end-12 top-3 z-10 inline-flex h-6.5 items-center rounded-pill bg-ink px-2.5 text-11 font-semibold text-chalk shadow-elevation-1">
                {m.cardUnavailableBadge}
              </span>
            ) : null}

            {/* Bottom End: Semantic Usage or Size Overlay */}
            {product.usage ? (
              <span className="absolute bottom-2.5 end-2.5 z-10 max-w-[85%] truncate rounded-4 bg-ink/75 px-2.5 py-1 text-11 font-medium text-chalk backdrop-blur-sm shadow-elevation-1">
                {product.usage}
              </span>
            ) : product.sizeLine ? (
              <span className="absolute bottom-2.5 end-2.5 z-10 inline-flex h-5.5 items-center rounded-4 bg-ink/80 px-2 text-11 font-medium tabular-nums text-chalk backdrop-blur-md">
                {product.sizeLine}
              </span>
            ) : null}
          </ProductTile>
        </Link>

        {/* Top End: Tactile Wishlist Toggle Button */}
        <button
          type="button"
          aria-label={wishlisted ? m.wishlistRemove : m.wishlistAdd}
          aria-pressed={wishlisted}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setWishlisted(!wishlisted);
          }}
          className={cn(
            'absolute end-3 top-3 z-10 flex size-8 items-center justify-center rounded-full bg-chalk/90 backdrop-blur-md shadow-elevation-1 transition-all duration-fast hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt',
            wishlisted ? 'text-tomato' : 'text-stone hover:text-tomato'
          )}
        >
          <Icon name="heart" size={16} />
        </button>
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

      {/* 2. Editorial Information Body */}
      <div className="flex flex-1 flex-col p-4 sm:p-4.5">
        {/* Brand attribution with product line / size */}
        <div className="flex items-center justify-between gap-2">
          <p className="m-0 truncate font-serif text-14 italic leading-18 text-stone">
            <bdi>{product.brandName}</bdi>
          </p>
          {product.productLine ? (
            <span className="truncate text-11 font-normal text-stone/80">
              {product.productLine}
            </span>
          ) : product.sizeLine ? (
            <span className="truncate text-11 font-normal text-stone/80 tabular-nums">
              {product.sizeLine}
            </span>
          ) : null}
        </div>

        {/* Product Name: calibrated min-height so prices align across row */}
        <Link href={href} className="group/name mt-1 text-ink no-underline">
          <h3
            dir="auto"
            className="text-match-parent m-0 min-h-[44px] line-clamp-2 text-15 font-bold leading-22 transition-colors duration-fast group-hover/name:text-cobalt"
          >
            {product.name}
          </h3>
        </Link>

        {/* Semantic Category / Benefit Micro-Tag */}
        <div className="mt-2 flex items-center gap-1.5 truncate">
          {product.type ? (
            <span className="inline-flex max-w-full items-center gap-1 truncate rounded-pill border border-line/50 bg-sand/35 px-2.5 py-0.5 text-11 font-medium text-stone">
              <span className="truncate">{product.type}</span>
            </span>
          ) : null}
          {product.sizeLine && product.productLine ? (
            <span className="inline-flex items-center rounded-pill border border-line/40 bg-sand/20 px-2 py-0.5 text-11 font-medium tabular-nums text-stone">
              {product.sizeLine}
            </span>
          ) : null}
        </div>

        {/* Pricing & Delivery Reassurance */}
        <div className="mt-auto flex items-baseline justify-between gap-2 border-t border-line/40 pt-3">
          <div className="flex items-baseline gap-1">
            {priceText ? (
              <>
                {product.priceIsFrom ? (
                  <span className="me-0.5 text-11 font-normal text-stone">{m.cardFrom}</span>
                ) : null}
                <span
                  className={cn(
                    'text-18 sm:text-20 font-extrabold tabular-nums',
                    product.discountPercent ? 'text-tomato' : 'text-ink'
                  )}
                >
                  <bdi>{priceText}</bdi>
                </span>
                <span className="ms-0.5 text-11 font-medium text-stone">{currencyLabel(locale)}</span>
                {product.compareAtPrice ? (
                  <span className="ms-1.5 line-through text-12 font-normal tabular-nums text-stone/70">
                    <bdi>{formatAmount(product.compareAtPrice.amount, locale)} {currencyLabel(locale)}</bdi>
                  </span>
                ) : null}
              </>
            ) : (
              <span />
            )}
          </div>
          <span className="truncate text-11 font-medium text-ok">{m.cardFastDelivery}</span>
        </div>

        {/* Purchase Action Button */}
        <div className="pt-3">
          {product.unavailable ? (
            <div className="flex h-11 w-full items-center justify-center rounded-pill bg-sand text-13 font-semibold text-stone cursor-not-allowed">
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
                'sl group/btn inline-flex h-11 w-full items-center justify-center gap-2 rounded-pill bg-cobalt hover:bg-cobalt-deep px-4 text-13.5 font-bold text-chalk shadow-elevation-1 transition-all duration-fast active:scale-95',
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
                  <span>
                    {multi
                      ? m.pdpChooseSize
                      : product.discountPercent
                      ? fillMessage(m.cardSaveDiscount, { n: String(product.discountPercent) })
                      : m.cardAdd}
                  </span>
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
      </div>
    </article>
  );
}

/** Loading card in elevated Showcase format */
export function ShowcaseProductCardSkeleton() {
  return (
    <div aria-hidden="true" className="flex h-full flex-col overflow-hidden rounded-card border border-line/60 bg-linen/50 font-display">
      <Skeleton className="aspect-[4/5] w-full rounded-none" />
      <div className="flex flex-1 flex-col p-4 gap-2">
        <Skeleton className="h-3.5 w-1/3 rounded-4" />
        <Skeleton className="h-4 w-5/6 rounded-4" />
        <Skeleton className="h-4 w-2/3 rounded-4" />
        <div className="mt-auto flex items-center justify-between border-t border-line/30 pt-3">
          <Skeleton className="h-5 w-20 rounded-4" />
          <Skeleton className="h-3.5 w-16 rounded-4" />
        </div>
        <Skeleton className="mt-3 h-11 w-full rounded-pill" />
      </div>
    </div>
  );
}
