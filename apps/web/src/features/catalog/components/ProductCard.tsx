'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { ProductTile } from '@/components/ui/product-tile';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
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

/**
 * Premium editorial beauty-commerce Product Card adhering to the SAHEL Design System.
 * Features:
 * - Large 4:5 immersive editorial packaging container with safe spacing and object-contain.
 * - Warm limestone studio lighting with category-appropriate subtle SAHEL accents.
 * - Floating subtle benefit badge & interactive wishlist button.
 * - Cobalt blue brand accent, real ratings/reviews when available.
 * - Arabic primary title & original English packaging subtitle.
 * - Two compact category/type chips.
 * - Emphasized EGP price with solid cobalt Add to Cart CTA and integrated quantity stepper.
 */
export function ProductCard({ product, priority = false, feature = false }: ProductCardProps) {
  const m = useMessages();
  const locale = useLocale();
  const { withAuth } = useAuth();
  const [wishlisted, setWishlisted] = useState(false);
  const { state, multi, line, pickerOpen, qtyPending, add, start, changeQuantity, closePicker, resolving } = useQuickAdd(product);
  const addRef = useRef<HTMLButtonElement>(null);
  const errorId = useId();
  const href = routes.product(product.slug);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (wasOpen.current && !pickerOpen && !line) addRef.current?.focus();
    wasOpen.current = pickerOpen;
  }, [pickerOpen, line]);

  const priceText = product.price ? formatAmount(product.price.amount, locale) : null;
  const displayName = locale === 'ar' ? (product.arabicName || product.name) : (product.englishName || product.name);
  const isSunCare = product.categorySlug === 'sunscreens';
  const isSerum = product.categorySlug === 'serums-treatments';
  const isHairCare = product.categorySlug === 'shampoos' || product.categorySlug === 'conditioners' || product.categorySlug === 'hair-treatments-styling';

  return (
    <article
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      aria-label={`${product.brandName} ${displayName}`}
      className="group group/card relative flex h-full min-w-0 flex-col font-display text-ink"
    >
      {/* Square Studio Image Stage */}
      <div className="relative aspect-square w-full overflow-hidden rounded-image bg-sand/20">
        {/* Layer A: Studio lighting & warm limestone ground */}
        <div className="pointer-events-none absolute inset-0 sahel-studio-ground" />
        <div className="pointer-events-none absolute inset-0 sahel-studio-spotlight" />

        {/* Layer B: Category-appropriate subtle SAHEL elements */}
        {isSunCare ? (
          <div className="pointer-events-none absolute inset-0 sahel-studio-sun" />
        ) : isSerum ? (
          <div className="pointer-events-none absolute inset-0 sahel-studio-serum" />
        ) : isHairCare ? (
          <div className="pointer-events-none absolute inset-0 sahel-studio-hair" />
        ) : (
          <div className="pointer-events-none absolute inset-0 sahel-studio-skin" />
        )}

        {/* Layer C: Natural pedestal contact shadow under the product base */}
        <div className="pointer-events-none absolute inset-x-10 bottom-2.5 h-3 rounded-full bg-stone/10 blur-[6px]" />

        {/* Layer D: Product packaging image filling the layout with object-cover */}
        <Link href={href} tabIndex={-1} aria-hidden="true" className="relative flex size-full items-center justify-center">
          <ProductTile
            src={product.imageUrl}
            alt={product.imageAlt}
            name={product.name}
            priority={priority}
            fit="cover"
            sizes={feature ? '(min-width: 1280px) 280px, (min-width: 1024px) 25vw, (min-width: 640px) 45vw, 78vw' : undefined}
            className={cn(
              'size-full aspect-auto rounded-none bg-transparent',
              '[&_img]:object-cover sahel-packshot-shadow',
              '[&_img]:transition-transform [&_img]:duration-500 [&_img]:ease-out group-hover:[&_img]:scale-105 group-focus-within:[&_img]:scale-105 motion-reduce:group-hover:[&_img]:scale-100',
              product.unavailable && '[&_img]:opacity-50'
            )}
          />
        </Link>

        {/* Layer E: Floating Benefit Badge */}
        {product.benefitBadge ? (
          <div className="pointer-events-none absolute start-2.5 top-2.5 z-10 max-w-[65%]">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-11 font-bold shadow-elevation-1 backdrop-blur-md',
                product.discountPercent && product.discountPercent > 0
                  ? 'border-tomato/30 bg-linen/95 text-tomato-ink'
                  : 'border-line/60 bg-linen/90 text-stone'
              )}
            >
              {product.discountPercent && product.discountPercent > 0 ? (
                <span className="size-1.5 rounded-full bg-tomato" />
              ) : null}
              <span className="truncate">{product.benefitBadge}</span>
            </span>
          </div>
        ) : null}

        {/* Layer F: Floating Wishlist Button */}
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
            'absolute end-2.5 top-2.5 z-10 flex size-8 items-center justify-center rounded-full border border-line/60 bg-linen/90 text-ink shadow-elevation-1 backdrop-blur-md transition-all duration-fast hover:scale-105 hover:border-cobalt hover:text-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt active:scale-95',
            wishlisted && 'border-cobalt text-cobalt'
          )}
        >
          <Icon name="heart" size={16} fill={wishlisted ? 'currentColor' : 'none'} />
        </button>
      </div>

      {multi && pickerOpen ? (
        <SizePicker product={product} pending={state === 'pending'} failed={state === 'error'} onAdd={add} onClose={closePicker} />
      ) : null}

      {/* Editorial Product Information */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-3">
        {/* Brand name in cobalt blue + Real Rating and Review count */}
        <div className="flex items-center justify-between gap-2">
          <p className="m-0 truncate text-11 font-bold uppercase tracking-wider text-cobalt sm:text-12" title={product.brandName}>
            <bdi>{product.brandName}</bdi>
          </p>
          {product.rating && product.rating.count > 0 ? (
            <div className="flex flex-none items-center gap-1 text-11 font-bold text-ink sm:text-12">
              <Icon name="star" size={12} fill="currentColor" className="text-warn" />
              <span className="tabular-nums">{formatNumber(product.rating.average, locale)}</span>
              <span className="text-11 font-medium text-stone">({formatNumber(product.rating.count, locale)})</span>
            </div>
          ) : null}
        </div>

        {/* Localized Product Title (Single line, no stacked subtitle) */}
        <Link
          href={href}
          title={displayName}
          className="group/title block rounded-4 text-ink no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
        >
          <h3
            dir="auto"
            className="m-0 line-clamp-1 text-14 font-bold leading-20 text-ink transition-colors group-hover/title:text-cobalt sm:text-15 sm:leading-22"
          >
            {displayName}
          </h3>
        </Link>

        {/* Product Characteristics / Meta (plain text separated by a divider line) */}
        {product.chip1 || product.chip2 ? (
          <div className="flex min-w-0 items-center text-11 font-medium text-stone sm:text-12">
            {product.chip1 ? <span className="truncate">{product.chip1}</span> : null}
            {product.chip1 && product.chip2 ? (
              <span className="mx-1.5 h-2.5 w-px flex-none bg-line-2" aria-hidden="true" />
            ) : null}
            {product.chip2 ? <span className="truncate">{product.chip2}</span> : null}
          </div>
        ) : null}

        {/* Pricing & Add to Cart Action Row */}
        <div className="mt-auto flex min-w-0 items-center justify-between gap-2 border-t border-line/50 pt-2.5">
          <div className="flex min-w-0 flex-col">
            {product.compareAtPrice ? (
              <del className="text-11 leading-none text-stone/70 line-through tabular-nums">
                <bdi>
                  {formatAmount(product.compareAtPrice.amount, locale)} {currencyLabel(locale)}
                </bdi>
              </del>
            ) : null}
            <div className="flex items-baseline gap-1 whitespace-nowrap">
              {product.priceIsFrom ? <span className="text-11 text-stone">{m.cardFrom}</span> : null}
              <strong className="text-16 font-extrabold leading-none tabular-nums text-ink sm:text-18">
                <bdi>{priceText}</bdi>
              </strong>
              <span className="text-11 font-bold text-stone">{currencyLabel(locale)}</span>
            </div>
          </div>

          {product.unavailable ? (
            <span className="flex h-9 min-w-0 items-center justify-center rounded-pill bg-sand/60 px-2.5 text-center text-11 font-bold text-stone">
              {m.cardUnavailable}
            </span>
          ) : resolving ? (
            <div className="sl-inward inline-flex h-9 flex-none items-center justify-center gap-1.5 rounded-pill border border-line/60 bg-sand/50 px-3 text-11 font-bold text-stone cursor-wait select-none sm:text-12">
              <Spinner size="xs" tone="cobalt" />
              <span>{m.loading}</span>
            </div>
          ) : line ? (
            <div className="flex h-9 min-w-[104px] items-center justify-center rounded-pill border border-line bg-chalk px-1 shadow-elevation-1">
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
              disabled={state === 'pending' && !multi}
              aria-describedby={state === 'error' && !multi ? errorId : undefined}
              onClick={start}
              className={cn(
                'sl inline-flex h-9 flex-none items-center justify-center gap-1.5 rounded-pill bg-cobalt px-3 text-12 font-bold text-chalk shadow-elevation-1 transition-all duration-fast hover:bg-cobalt-deep hover:shadow-elevation-2 active:scale-95 disabled:cursor-wait sm:px-3.5',
                multi && pickerOpen && 'bg-cobalt-deep'
              )}
            >
              {state === 'pending' && !multi ? (
                <Spinner size="xs" className="text-chalk" />
              ) : (
                <Icon name={state === 'error' && !multi ? 'retry' : 'cart'} size={15} className="flex-none" />
              )}
              <span>
                {state === 'pending' && !multi
                  ? m.cardAdding
                  : state === 'error' && !multi
                  ? m.cardRetry
                  : multi
                  ? m.pdpChooseSize
                  : m.cardAddToCart}
              </span>
            </button>
          )}
        </div>
        {state === 'error' && !multi ? (
          <p id={errorId} role="alert" className="m-0 text-12 font-semibold text-tomato-ink">
            {m.cardAddFailed}
          </p>
        ) : null}
      </div>
    </article>
  );
}

export function ProductCardSkeleton() {
  return (
    <article
      aria-hidden="true"
      className="flex h-full flex-col overflow-hidden rounded-card border border-line/60 bg-linen p-3 sm:p-3.5 shadow-elevation-1 transition-all duration-300"
    >
      {/* Square Image Frame with Shutter Drift, Glow Container and Slatted Blinds from Stitch */}
      <div className="relative aspect-square w-full overflow-hidden rounded-image bg-sand/35 shutter-glow-container shutter-slats shutter-drift-slats animate-shutter-drift flex items-center justify-center">
        {/* Animated moving slatted wooden blind lines layer (Stitch exact: 25° · 2.8s cubic-bezier) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
        >
          <div className="absolute -inset-[50%] shutter-slats-drift" />
        </div>

        {/* Floating Heart / Wishlist Pebble Action Skeleton */}
        <div className="absolute top-2.5 end-2.5 z-10 flex size-8 items-center justify-center rounded-full bg-chalk/70 backdrop-blur-sm shadow-elevation-1 border border-line/40">
          <span className="size-3.5 rounded-full bg-sand/80" />
        </div>

        {/* Floating Benefit Tag / New Badge Placeholder */}
        <div className="absolute top-2.5 start-2.5 z-10 h-4 w-11 rounded-pill bg-chalk/50 backdrop-blur-sm border border-line/30" />

        {/* Center Packshot Dropper Bottle Placeholder Silhouette (Stitch exact form) */}
        <div className="relative z-10 flex flex-col items-center opacity-85">
          {/* Dropper Cap */}
          <div className="h-5 w-3.5 rounded-t-4 bg-sand/70" />
          <div className="mb-0.5 h-2.5 w-7 rounded-4 bg-sand/80" />
          {/* Bottle Body */}
          <div className="relative h-20 w-12 overflow-hidden rounded-t-14 rounded-b-4 bg-sand/60 shadow-elevation-1">
            {/* Minimal Label Cutout */}
            <div className="absolute inset-x-1.5 top-6 h-6 rounded-4 bg-chalk/50" />
          </div>
          {/* Cast Ground Contact Shadow */}
          <div className="mt-1 sahel-skeleton-shadow" />
        </div>

        {/* Coastal Shutter Light Ray Indicator Label (Stitch Signature Pill) */}
        <div className="absolute bottom-2 start-2.5 z-10 flex items-center gap-1 rounded-pill bg-chalk/80 px-2 py-0.5 text-11 font-medium text-stone backdrop-blur-sm shadow-elevation-1">
          <span className="inline-block size-1.5 rounded-full bg-citron animate-pulse" />
          <span>خطوط شيش متحركة (٢٥° · ٢.٨ث)</span>
        </div>
      </div>

      {/* Product Details Section (Typography Skeletons with slatted light drift) */}
      <div className="mt-3 flex flex-1 flex-col gap-2">
        {/* Brand Name & Rating */}
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-20 rounded-pill" />
          <Skeleton className="h-3 w-8 rounded-pill" />
        </div>

        {/* Primary Localized Title */}
        <div className="pt-0.5">
          <Skeleton className="h-4 w-10/12 rounded-pill" />
        </div>

        {/* Meta / Attributes divider line */}
        <div className="flex items-center gap-1.5 pt-0.5">
          <Skeleton className="h-2.5 w-12 rounded-pill" />
          <span className="h-2.5 w-px bg-line-2" />
          <Skeleton className="h-2.5 w-16 rounded-pill" />
        </div>

        {/* Price & Unit Indicator */}
        <div className="flex items-baseline justify-between pt-1">
          <div className="flex items-baseline gap-1.5">
            <Skeleton className="h-4 w-14 rounded-8" />
            <Skeleton className="h-2.5 w-5 rounded-pill" />
          </div>
          <Skeleton className="h-3 w-12 rounded-pill" />
        </div>

        {/* CTA Button Skeleton */}
        <div className="mt-auto pt-2">
          <div className="flex h-9 w-full items-center justify-center rounded-pill border border-line/50 bg-sand/50 skeleton-bone animate-shutter-drift">
            <span className="h-2.5 w-20 rounded-pill bg-chalk/60" />
          </div>
        </div>
      </div>
    </article>
  );
}
