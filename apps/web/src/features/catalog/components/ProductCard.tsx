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
 * The shared product card (ProductCard board; Home, PLP and every state board). One component, two layouts by
 * breakpoint: phone (two-column 390) and desktop. Modes: default, focus (keyboard ring), adding (Shutter Loading on
 * «أضف» → «بيتضاف…»), added (the card shows the line's quantity stepper), variant-open (size picker: popover over the
 * image on desktop, bottom sheet on phones), skeleton (ProductCardSkeleton), img-error (ProductTile).
 * Everything shown comes from the catalog and the cart; nothing is invented (see card-model.ts).
 */
export function ProductCard({ product, priority = false, feature = false }: { product: CardModel; priority?: boolean; feature?: boolean }) {
  const m = useMessages();
  const locale = useLocale();
  const { state, multi, line, pickerOpen, qtyPending, add, start, changeQuantity, closePicker } = useQuickAdd(product);
  const addRef = useRef<HTMLButtonElement>(null);
  const errorId = useId();
  const href = routes.product(product.slug);

  // Return focus to «أضف» when the size picker closes without adding.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !pickerOpen && !line) addRef.current?.focus();
    wasOpen.current = pickerOpen;
  }, [pickerOpen, line]);

  const priceText = product.price ? formatAmount(product.price.amount, locale) : null;

  return (
    <article aria-label={`${product.brandName} ${product.name}`} className="relative flex h-full w-full min-w-0 flex-col gap-2.5 text-night lg:gap-4">
      <Link
        href={href}
        tabIndex={-1}
        aria-hidden="true"
        className={cn(
          'group block rounded-image shadow-elevation-1 transition-shadow duration-base ease-standard hover:shadow-elevation-2',
          feature && 'lg:flex lg:min-h-[300px] lg:flex-1'
        )}
      >
        <ProductTile
          src={product.imageUrl}
          alt={product.imageAlt}
          name={product.name}
          priority={priority}
          sizes={feature ? '(min-width: 1024px) 564px, 100vw' : undefined}
          className={cn(feature && 'lg:aspect-auto lg:min-h-full lg:w-full', product.unavailable && '[&_img]:opacity-45 [&_img]:grayscale-[.7]')}
        >
          {product.unavailable ? (
            <span className="absolute start-2.5 top-2.5 inline-flex h-6.5 items-center rounded-pill bg-night px-2.5 text-11.5 font-semibold leading-16 text-linen">
              {m.cardUnavailableBadge}
            </span>
          ) : null}
        </ProductTile>
      </Link>

      {multi && pickerOpen ? (
        <SizePicker
          product={product}
          pending={state === 'pending'}
          failed={state === 'error'}
          onAdd={add}
          onClose={closePicker}
        />
      ) : null}

      <div className="flex flex-1 flex-col gap-1.5 px-0.5 lg:gap-2">
        <span lang="en" dir="ltr" className="truncate text-10.5 font-semibold leading-13 tracking-brand text-ink-2 text-match-parent lg:text-11">
          {product.brandName.toUpperCase()}
        </span>
        <Link href={href} className="group/name flex flex-col py-px text-night no-underline">
          <span
            dir="auto"
            className="line-clamp-2 min-h-10 text-14 font-semibold leading-20 text-match-parent group-hover/name:underline group-hover/name:underline-offset-[5px] lg:line-clamp-1 lg:min-h-0 lg:leading-22"
          >
            {product.name}
          </span>
        </Link>

        {/* Desktop: type chip, then the size line. */}
        <span className="hidden min-h-6.5 flex-nowrap gap-1.5 overflow-hidden lg:flex">
          {product.type ? (
            <span className="inline-flex h-6.5 flex-none items-center rounded-pill bg-sand px-2.5 text-12 font-semibold leading-16">{product.type}</span>
          ) : null}
        </span>
        {product.sizeLine ? <span className="hidden min-h-4 text-12 leading-17 text-ink-2 lg:block">{product.sizeLine}</span> : null}

        {/* Phone: type · size on one meta line. */}
        {product.type || product.sizeLine ? (
          <span className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-12 leading-17 text-ink-2 lg:hidden">
            {product.type ? <span className="font-semibold text-night">{product.type}</span> : null}
            {product.type && product.sizeLine ? <span aria-hidden="true" className="size-[3px] flex-none rounded-full bg-line-2" /> : null}
            {product.sizeLine ? <span className="truncate">{product.sizeLine}</span> : null}
          </span>
        ) : null}

        {/* Footer pinned to the bottom so every Quick Add lines up across a row. */}
        <span className="mt-auto flex min-h-13.5 items-center justify-between gap-2 pt-2.5 shadow-hairline-top lg:min-h-15 lg:pt-3">
          {priceText ? (
            <span className={cn('whitespace-nowrap text-17 font-bold leading-24 tabular-nums lg:text-18', product.unavailable ? 'text-ink-3' : 'text-night')}>
              {product.priceIsFrom ? <span className="me-1 text-11 font-medium text-ink-2 lg:text-12">{m.cardFrom}</span> : null}
              <bdi>{priceText}</bdi>
              <span className="ms-[3px] text-11 font-medium text-ink-2 lg:text-12">{currencyLabel(locale)}</span>
            </span>
          ) : (
            <span />
          )}

          {product.unavailable ? (
            <span className="text-13 font-semibold leading-20 text-ink-3">{m.cardUnavailable}</span>
          ) : line ? (
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
                'sl inline-flex h-control-s flex-none items-center gap-[5px] rounded-pill px-3.5 text-14 font-semibold text-white shadow-action transition-[background-color,transform] duration-fast ease-standard lg:px-4',
                multi && pickerOpen ? 'bg-blue-deep outline outline-[2.5px] outline-offset-[3px] outline-blue' : 'bg-blue hover:bg-blue-hover active:scale-[.97] active:bg-blue-deep'
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
                  <Icon name="plus" size={15} strokeWidth={2.25} />
                  <span>{feature ? m.sizeAddToCart : m.cardAdd}</span>
                </>
              )}
            </button>
          )}
        </span>
        {state === 'error' && !multi ? (
          <p id={errorId} role="alert" className="m-0 flex items-start gap-2 text-12.5 leading-19 text-err">
            <span aria-hidden="true" className="mt-1.5 size-1.75 flex-none rounded-full bg-err" />
            {m.cardAddFailed}
          </p>
        ) : null}
      </div>
    </article>
  );
}

/** Loading card: the same box sizes as the real card, so a loading row never shifts (ProductCard «skeleton»). */
export function ProductCardSkeleton() {
  return (
    <div aria-hidden="true" className="flex h-full flex-col gap-2.5 lg:gap-4">
      <Skeleton className="aspect-[4/5] w-full" />
      <div className="flex flex-1 flex-col gap-2 px-0.5">
        <Skeleton className="h-3 w-[36%] rounded-4 bg-line" />
        <Skeleton className="h-4.5 w-[86%] rounded-4 bg-line" />
        <Skeleton className="h-4 w-[70%] rounded-4 bg-line" />
        <Skeleton className="h-3.5 w-[52%] rounded-4 bg-line" />
        <span className="mt-auto flex items-center justify-between pt-2.5 shadow-hairline-top">
          <Skeleton className="h-5 w-14 rounded-4 bg-line" />
          <Skeleton className="h-control-s w-18 rounded-pill bg-line" />
        </span>
      </div>
    </div>
  );
}
