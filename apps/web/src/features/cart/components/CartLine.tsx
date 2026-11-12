'use client';

import Link from 'next/link';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { MessageBox } from '@/components/ui/message-box';
import { Money } from '@/components/ui/money';
import { ProductTile } from '@/components/ui/product-tile';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { categoryLabel } from '@/features/catalog/lib/card-model';
import { MAX_LINE_QUANTITY, type CartItem } from '@/lib/cart';
import { formatAmount, formatNumber, formatPackSize } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

export interface CartLineProps {
  item: CartItem;
  /** A quantity change or removal for this line is in flight: the stepper locks. */
  busy: boolean;
  /** The price changed since it was added and the customer has not reviewed it yet. */
  priceReview: boolean;
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
  onPriceReviewed: () => void;
}

/**
 * Editorial Cart Item Card:
 * Soft raised linen surface, distinct brand typography, packshot stage with subtle scale,
 * clean pack size badge, fluid quantity stepper, clear unit price hierarchy, and inline price/availability alerts.
 */
export function CartLine({ item, busy, priceReview, onQuantity, onRemove, onPriceReviewed }: CartLineProps) {
  const m = useMessages();
  const locale = useLocale();
  const { product } = item.sku;
  const name = product.name || item.sku.code;
  const type = categoryLabel(product.category, locale);
  const size = formatPackSize(item.sku.size, item.sku.sizeUnit, locale) ?? item.sku.variantName;
  const unavailable = !item.canOrder;
  const href = product.slug ? routes.productVariant(product.slug, item.skuId) : null;

  const stepper = (
    <QuantityStepper
      value={item.quantity}
      displayValue={formatNumber(item.quantity, locale)}
      max={MAX_LINE_QUANTITY}
      onChange={onQuantity}
      pending={busy}
      disabled={unavailable}
      labels={{ group: fillMessage(m.cartQuantity, { name }), decrease: m.cartDecrease, increase: m.cartIncrease }}
    />
  );

  const amount =
    !unavailable && item.subtotal !== null ? (
      <div className="flex flex-col items-end gap-0.5">
        <Money amount={item.subtotal} className="font-display text-18 font-bold leading-24 text-ink lg:text-20" />
        {item.quantity > 1 && item.price ? (
          <span className="text-12 leading-17 text-stone">
            {fillMessage(m.cartUnitPrice, { price: formatAmount(item.price.amount, locale) })}
          </span>
        ) : null}
      </div>
    ) : null;

  const removeButton = (
    <button
      type="button"
      onClick={onRemove}
      disabled={busy}
      aria-label={fillMessage(m.cartRemoveItem, { name })}
      className="inline-flex min-h-control-s items-center gap-1.5 rounded-pill px-2.5 py-1 text-13 font-semibold text-stone transition-colors duration-fast hover:bg-sand/40 hover:text-ink disabled:opacity-50"
    >
      <Icon name="trash" size={16} />
      <span>{m.cartRemove}</span>
    </button>
  );

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
      className={cn(
        'group relative flex flex-col rounded-24 bg-linen p-4 shadow-elevation-1 transition-all duration-base hover:shadow-elevation-2 lg:p-5',
        unavailable && 'border border-tomato/30',
        priceReview && 'border border-warn/40'
      )}
      aria-busy={busy || undefined}
    >
      <div className="flex gap-4 lg:grid lg:grid-cols-[108px_minmax(0,1fr)_auto_140px] lg:items-center lg:gap-6">
        {/* Packshot tile */}
        <div className="relative flex-none">
          <ProductTile
            size="thumb"
            className={cn(
              'h-26 w-22 flex-none rounded-image shadow-hairline-bottom transition-transform duration-base group-hover:scale-[1.02] lg:h-32 lg:w-26',
              unavailable && 'opacity-50'
            )}
            src={item.sku.image?.url ?? null}
            alt=""
            name={name}
          />
          {unavailable ? (
            <span className="absolute inset-x-1 bottom-1 rounded-pill bg-ink/80 py-0.5 text-center text-11 font-semibold text-chalk backdrop-blur-sm">
              {m.cartLineUnavailable}
            </span>
          ) : null}
        </div>

        {/* Product details */}
        <div className={cn('flex min-w-0 flex-1 flex-col justify-between gap-1.5', unavailable && 'opacity-65')}>
          <div className="flex flex-col gap-1">
            {product.brand.name ? (
              <span dir="ltr" className="text-match-parent font-serif text-13 uppercase tracking-wider text-stone">
                {product.brand.name}
              </span>
            ) : null}

            {href ? (
              <Link
                href={href}
                dir="auto"
                className="text-match-parent text-16 font-bold leading-24 text-ink transition-colors duration-fast hover:text-cobalt lg:text-17"
              >
                {name}
              </Link>
            ) : (
              <span dir="auto" className="text-match-parent text-16 font-bold leading-24 text-ink lg:text-17">
                {name}
              </span>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              {type ? (
                <span className="rounded-pill bg-sand/50 px-2 py-0.5 text-12 font-medium text-stone">
                  {type}
                </span>
              ) : null}
              {size ? (
                <span className="rounded-pill bg-sand/70 px-2.5 py-0.5 text-12 font-semibold text-ink">
                  <bdi>{size}</bdi>
                </span>
              ) : null}
            </div>
          </div>

          {/* Desktop remove button */}
          <div className="hidden pt-1 lg:block">
            {removeButton}
          </div>

          {/* Phone: stepper, remove button and total amount */}
          <div className="mt-2 flex items-center justify-between gap-2 lg:hidden">
            <div className="flex items-center gap-1.5">
              {stepper}
              <button
                type="button"
                onClick={onRemove}
                disabled={busy}
                aria-label={fillMessage(m.cartRemoveItem, { name })}
                className="grid size-9 place-items-center rounded-pill text-stone transition-colors hover:bg-sand/40 hover:text-ink disabled:opacity-50"
              >
                <Icon name="trash" size={17} />
              </button>
            </div>
            {amount}
          </div>
        </div>

        {/* Desktop stepper */}
        <div className="hidden lg:block">
          {stepper}
        </div>

        {/* Desktop amount */}
        <div className="hidden lg:flex lg:justify-end">
          {amount}
        </div>
      </div>

      {/* Inline price review alert */}
      {priceReview && item.priceAtAdd !== null && item.price ? (
        <MessageBox tone="warn" className="mt-3.5 rounded-16">
          <p className="m-0 text-14 font-medium leading-22 text-ink">
            {fillMessage(m.cartPriceChanged, {
              old: formatAmount(item.priceAtAdd, locale),
              new: `${formatAmount(item.price.amount, locale)} ${locale === 'ar' ? 'ج.م' : 'EGP'}`,
            })}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Button variant="ink" size="s" onClick={onPriceReviewed}>
              {m.cartPriceOk}
            </Button>
            <Button variant="light" size="s" onClick={onRemove} disabled={busy}>
              {m.cartRemoveProduct}
            </Button>
          </div>
        </MessageBox>
      ) : null}

      {/* Inline unavailable product alert */}
      {unavailable ? (
        <MessageBox tone="err" className="mt-3.5 rounded-16">
          <p className="m-0 text-14 font-medium leading-22 text-ink">{m.cartLineUnavailable}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <Button variant="ink" size="s" onClick={onRemove} disabled={busy}>
              {m.cartRemoveIt}
            </Button>
            {product.category ? (
              <Link href={routes.productsByCategory(product.category.slug)} className="text-link text-13.5">
                {m.cartSeeAlternative}
              </Link>
            ) : null}
          </div>
        </MessageBox>
      ) : null}
    </motion.li>
  );
}
