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
import { useAuth } from '@/features/auth/AuthContext';
import { useQuickAdd } from '../hooks/useQuickAdd';
import type { CardModel } from '../lib/card-model';
import { SizePicker } from './SizePicker';

export interface ProductCardProps {
  product: CardModel;
  priority?: boolean;
  feature?: boolean;
}

/** Shared catalog and home card. Product and commerce state come from the catalog and cart. */
export function ProductCard({ product, priority = false, feature = false }: ProductCardProps) {
  const m = useMessages();
  const locale = useLocale();
  const { withAuth } = useAuth();
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
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      aria-label={`${product.brandName} ${product.name}`}
      className="relative flex h-full min-w-0 flex-col overflow-hidden rounded-card bg-linen font-display text-ink shadow-elevation-1 transition-shadow duration-base hover:shadow-elevation-2 focus-within:shadow-elevation-2 motion-reduce:transition-none"
    >
      <div className="relative aspect-[6/5] w-full overflow-hidden rounded-image bg-chalk">
        <Link href={href} tabIndex={-1} aria-hidden="true" className="block size-full">
          <ProductTile
            src={product.imageUrl}
            alt={product.imageAlt}
            name={product.name}
            priority={priority}
            sizes={feature ? '(min-width: 1024px) 288px, (min-width: 640px) 46vw, 78vw' : undefined}
            className={cn(
              'size-full aspect-auto rounded-none bg-chalk [&_img]:object-contain',
              product.unavailable && '[&_img]:opacity-50'
            )}
          />
        </Link>
        <button
          type="button"
          aria-label={wishlisted ? m.wishlistRemove : m.wishlistAdd}
          aria-pressed={wishlisted}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            withAuth(
              () => {
                setWishlisted((current) => !current);
              },
              {
                title: m.wishlistAdd,
                description: 'سجّل دخولك لحفظ منتجاتك المفضلة والوصول إليها لاحقاً.',
                intent: 'wishlist',
              }
            );
          }}
          className={cn(
            'absolute start-3 top-3 z-10 flex size-9 items-center justify-center rounded-full bg-linen text-ink shadow-elevation-1 transition-colors duration-fast hover:text-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt',
            wishlisted && 'text-cobalt'
          )}
        >
          <Icon name="heart" size={19} />
        </button>
      </div>

      {multi && pickerOpen ? (
        <SizePicker product={product} pending={state === 'pending'} failed={state === 'error'} onAdd={add} onClose={closePicker} />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 px-3 pb-3 pt-2 sm:px-4 sm:pb-4">
        <p className="m-0 truncate text-14 font-bold leading-18 text-cobalt sm:text-16">
          <bdi>{product.brandName}</bdi>
        </p>
        <Link href={href} className="text-ink no-underline hover:text-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt">
          <h3 dir="auto" className="m-0 line-clamp-2 min-h-[44px] text-16 font-bold leading-22 sm:text-18 sm:leading-22">
            {product.name}
          </h3>
        </Link>
        <div className="min-h-7 min-w-0">
          {product.categoryChip ? (
            <span className="inline-flex max-w-full items-center rounded-pill bg-sand/50 px-2.5 py-1 text-11 font-semibold leading-16 text-ink sm:text-12">
              <span className="truncate">{product.categoryChip}</span>
            </span>
          ) : null}
        </div>

        <div className="mt-auto flex min-w-0 items-center gap-2 border-t border-line/60 pt-3">
          <div className="flex flex-none items-baseline gap-0.5 whitespace-nowrap">
            {priceText ? (
              <>
                {product.priceIsFrom ? <span className="text-11 text-stone">{m.cardFrom}</span> : null}
                <strong className="min-w-0 text-16 font-extrabold tabular-nums leading-none text-ink sm:text-20">
                  <bdi>{priceText}</bdi>
                </strong>
                <span className="text-11 font-semibold text-ink sm:text-12">{currencyLabel(locale)}</span>
              </>
            ) : null}
          </div>
          <span aria-hidden="true" className="h-7 w-px flex-none bg-line" />
          {product.unavailable ? (
            <span className="flex h-10 min-w-0 flex-1 items-center justify-center rounded-pill bg-sand px-2 text-center text-11 font-semibold text-stone sm:h-11 sm:text-13">
              {m.cardUnavailable}
            </span>
          ) : line ? (
            <div className="flex h-10 min-w-0 flex-1 items-center justify-center rounded-pill bg-chalk px-1 sm:h-11">
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
              disabled={state === 'pending' && !multi}
              aria-describedby={state === 'error' && !multi ? errorId : undefined}
              onClick={start}
              className={cn(
                'sl flex h-10 min-w-0 flex-1 items-center justify-center gap-1 rounded-pill bg-cobalt px-2 text-11 font-bold text-chalk transition-colors duration-fast hover:bg-cobalt-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-deep disabled:cursor-wait sm:h-11 sm:gap-2 sm:text-13',
                multi && pickerOpen && 'bg-cobalt-deep'
              )}
            >
              <Icon name={state === 'error' && !multi ? 'retry' : 'cart'} size={15} className="flex-none" />
              <span className="truncate">{state === 'pending' && !multi ? m.cardAdding : state === 'error' && !multi ? m.cardRetry : multi ? m.pdpChooseSize : m.cardAddToCart}</span>
            </button>
          )}
        </div>
        {state === 'error' && !multi ? <p id={errorId} role="alert" className="m-0 text-12 font-semibold text-tomato-ink">{m.cardAddFailed}</p> : null}
      </div>
    </article>
  );
}

export function ProductCardSkeleton() {
  return (
    <div aria-hidden="true" className="flex h-full flex-col overflow-hidden rounded-card bg-linen shadow-elevation-1">
      <Skeleton className="aspect-[6/5] w-full rounded-none" />
      <div className="flex flex-1 flex-col gap-2 px-3 pb-3 pt-2 sm:px-4 sm:pb-4">
        <Skeleton className="h-4 w-1/3 rounded-4" />
        <Skeleton className="h-6 w-5/6 rounded-4" />
        <Skeleton className="h-6 w-2/3 rounded-4" />
        <Skeleton className="h-7 w-3/4 rounded-pill" />
        <Skeleton className="mt-3 h-11 w-full rounded-pill" />
      </div>
    </div>
  );
}
