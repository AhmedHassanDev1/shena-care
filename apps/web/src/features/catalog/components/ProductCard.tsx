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
import { useQuickAdd } from '../hooks/useQuickAdd';
import type { CardModel } from '../lib/card-model';
import { SizePicker } from './SizePicker';

/**
 * ShinaCare · Sahel Product Card
 * Reference: apps/web/docs/design-system/ShinaCare-Design-System-Sahel (boards/04-components.html)
 *
 * Rules:
 * - Editorial: image first, no outer box; 4px crisp frame on the sand field.
 * - Brand in Instrument Serif Italic (Latin brand names), product name in Beiruti bold.
 * - Price, then the real pack sizes from the catalog. No ratings, badges or wishlist until the backend has them:
 *   the board's star and heart are placeholders, never data.
 * - Pill button (Sahel Ink → Cobalt hover).
 */
export function ProductCard({
  product,
  priority = false,
  feature = false,
}: {
  product: CardModel;
  priority?: boolean;
  feature?: boolean;
}) {
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
      className="group/card relative flex h-full w-full min-w-0 flex-col font-display text-ink"
    >
      {/* 1. Image frame: full width, no card box around it */}
      <div className="relative aspect-square w-full overflow-hidden rounded-image bg-sand/30 shadow-outline-hairline transition-shadow duration-base ease-standard group-hover/card:shadow-elevation-1">
        <Link href={href} tabIndex={-1} aria-hidden="true" className="block size-full">
          <ProductTile
            src={product.imageUrl}
            alt={product.imageAlt}
            name={product.name}
            priority={priority}
            sizes={feature ? '(min-width: 1024px) 564px, 100vw' : undefined}
            className={cn('size-full', product.unavailable && '[&_img]:opacity-45 [&_img]:grayscale-[.7]')}
          >
            {product.unavailable ? (
              <span className="absolute start-3 top-3 inline-flex h-7 items-center rounded-pill bg-ink px-3 text-12 font-semibold text-chalk shadow-elevation-1 z-10">
                {m.cardUnavailableBadge}
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

      {/* 2. Brand (Latin wordmark in the campaign serif) */}
      <p className="m-0 mt-3 truncate font-serif text-15 italic leading-20 text-stone">
        <bdi>{product.brandName}</bdi>
      </p>

      {/* 3. Product name: always two lines tall so prices align across a row */}
      <Link href={href} className="group/name mt-0.5 text-ink no-underline">
        <h3 dir="auto" className="text-match-parent m-0 line-clamp-2 min-h-10 text-15 font-bold leading-20 transition-colors duration-fast group-hover/name:text-cobalt">
          {product.name}
        </h3>
      </Link>

      {/* 4. Price and pack sizes (catalog data only) */}
      <div className="mt-2 flex items-baseline justify-between gap-2">
        {priceText ? (
          <p className={cn('m-0 whitespace-nowrap tabular-nums text-17 font-extrabold', product.unavailable ? 'text-stone' : 'text-ink')}>
            {product.priceIsFrom ? <span className="me-1 text-12 font-normal text-stone">{m.cardFrom}</span> : null}
            <bdi>{priceText}</bdi>
            <span className="ms-1 text-12 font-medium text-stone">{currencyLabel(locale)}</span>
          </p>
        ) : (
          <span />
        )}
        {product.sizeLine ? <span className="truncate text-12 font-medium text-stone">{product.sizeLine}</span> : null}
      </div>

      {/* 5. Action: pinned to the bottom so buttons line up in a grid row */}
      <div className="mt-auto pt-3">
        {product.unavailable ? (
          <div className="flex h-10 w-full items-center justify-center rounded-pill bg-sand text-13 font-semibold text-stone">
            {m.cardUnavailable}
          </div>
        ) : line ? (
          <div className="flex justify-center">
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
            aria-label={state === 'pending' ? m.cardAdding : fillMessage(multi ? m.cardChooseAddLabel : m.cardAddLabel, { name: product.name })}
            aria-haspopup={multi ? 'dialog' : undefined}
            aria-expanded={multi ? pickerOpen : undefined}
            aria-busy={state === 'pending' && !multi ? true : undefined}
            aria-disabled={state === 'pending' && !multi ? true : undefined}
            aria-describedby={state === 'error' && !multi ? errorId : undefined}
            onClick={start}
            className={cn(
              'sl inline-flex h-10 w-full items-center justify-center gap-2 rounded-pill px-4 text-13.5 font-bold text-chalk shadow-elevation-1 transition-all duration-fast',
              'hover:bg-cobalt hover:shadow-elevation-2 active:scale-95',
              multi && pickerOpen ? 'bg-cobalt-deep' : 'bg-ink'
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
                <Icon name="bag" size={15} strokeWidth={2} />
                <span>{m.cardAdd}</span>
              </>
            )}
          </button>
        )}
      </div>

      {state === 'error' && !multi ? (
        <p id={errorId} role="alert" className="mt-2 m-0 flex items-start gap-1.5 text-13 font-semibold text-tomato-ink">
          <span aria-hidden="true" className="mt-1 flex size-3.5 flex-none items-center justify-center rounded-full bg-tomato text-10.5 font-bold text-ink">!</span>
          {m.cardAddFailed}
        </p>
      ) : null}
    </article>
  );
}

/** Loading card in Sahel format */
export function ProductCardSkeleton() {
  return (
    <div aria-hidden="true" className="flex h-full flex-col font-display">
      <Skeleton className="aspect-square w-full rounded-image" />
      <div className="mt-3 flex flex-1 flex-col gap-1.5">
        <Skeleton className="h-4 w-[40%] rounded-4" />
        <Skeleton className="h-4 w-[90%] rounded-4" />
        <Skeleton className="h-4 w-[65%] rounded-4" />
        <div className="mt-1.5 flex items-center justify-between">
          <Skeleton className="h-5 w-20 rounded-4" />
          <Skeleton className="h-3.5 w-12 rounded-4" />
        </div>
        <Skeleton className="mt-auto h-10 w-full rounded-pill" />
      </div>
    </div>
  );
}
