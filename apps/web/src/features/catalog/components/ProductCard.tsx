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
 * Single source of truth: apps/web/docs/design-system/ShinaCare-Design-System-Sahel (boards/04-components.html)
 *
 * Rules:
 * - Editorial: Image first, no outer box.
 * - 4px crisp frame with painted field and subtle shutter light.
 * - Citron sun badge «جديد» at start edge.
 * - Brand in Instrument Serif Italic.
 * - Product title in Beiruti bold.
 * - Price and tomato rating star.
 * - Pill button (Sahel Ink -> Cobalt hover).
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
      {/* 1. Image Frame (100% width, zero inset padding, no bulky card border) */}
      <div className="relative aspect-square w-full overflow-hidden rounded-image bg-sand/30 shadow-outline-hairline transition-all duration-base ease-standard group-hover/card:shadow-e1">
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
              <span className="absolute start-3 top-3 inline-flex h-7 items-center rounded-pill bg-ink px-3 text-12 font-semibold text-chalk shadow-e1 z-10">
                {m.cardUnavailableBadge}
              </span>
            ) : null}
          </ProductTile>
        </Link>

        {/* Wishlist Heart Icon Button */}
        <button
          type="button"
          aria-label="إضافة للمفضلة"
          className="absolute top-2.5 start-2.5 z-10 flex size-8 items-center justify-center rounded-full bg-chalk/85 text-ink shadow-e1 transition-transform hover:scale-110 active:scale-95"
        >
          <Icon name="heart" size={15} />
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

      {/* 2. Brand Name */}
      <div className="mt-2.5">
        <span lang="en" dir="ltr" className="block font-serif italic text-14 text-stone text-start">
          {product.brandName}
        </span>
      </div>

      {/* 3. Product Title */}
      <Link href={href} className="group/name mt-1 text-ink no-underline">
        <h3
          dir="auto"
          className="line-clamp-2 min-h-[38px] text-15 font-bold leading-snug group-hover/name:text-cobalt transition-colors"
        >
          {product.name}
        </h3>
      </Link>

      {/* 4. Commercial Price & Rating */}
      <div className="mt-2 flex items-center justify-between gap-2">
        {priceText ? (
          <div className="whitespace-nowrap tabular-nums">
            <span className={cn('text-17 font-extrabold', product.unavailable ? 'text-stone' : 'text-ink')}>
              {product.priceIsFrom ? <span className="me-1 text-12 font-normal text-stone">{m.cardFrom}</span> : null}
              <bdi>{priceText}</bdi>
              <span className="ms-1 text-12 font-medium text-stone">{currencyLabel(locale)}</span>
            </span>
          </div>
        ) : (
          <span />
        )}

        <span className="inline-flex items-center gap-1 text-12 font-medium text-stone">
          <i className="not-italic text-tomato font-bold">★</i>
          <span>٤٫٨</span>
        </span>
      </div>

      {/* 5. Action Button */}
      <div className="mt-2.5">
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
              'sl inline-flex h-10 w-full items-center justify-center gap-2 rounded-pill px-4 text-13.5 font-bold text-chalk shadow-e1 transition-all duration-fast',
              'hover:bg-cobalt hover:shadow-e2 active:scale-95',
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
          <span aria-hidden="true" className="mt-1 flex size-3.5 flex-none items-center justify-center rounded-full bg-tomato text-10 font-bold text-ink">!</span>
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
      <Skeleton className="aspect-[4/5] w-full rounded-image" />
      <div className="mt-3 flex flex-col gap-2">
        <Skeleton className="h-4 w-[40%] rounded-4" />
        <Skeleton className="h-5 w-[85%] rounded-4" />
        <Skeleton className="h-3.5 w-[60%] rounded-4" />
        <div className="mt-3 flex items-center justify-between">
          <Skeleton className="h-6 w-20 rounded-4" />
          <Skeleton className="h-4 w-12 rounded-4" />
        </div>
        <Skeleton className="mt-4 h-control-m w-full rounded-pill" />
      </div>
    </div>
  );
}
