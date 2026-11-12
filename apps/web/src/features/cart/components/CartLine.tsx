'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { iconButtonVariants } from '@/components/ui/icon-button';
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

interface CartLineProps {
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
 * One cart line (CartD row, CommerceMobile ١ row, CommerceStates §١): sand image tile, brand caps, product name,
 * product type, size, «شيل»; the quantity stepper; the line total with the unit price when more than one.
 * A changed price or an unavailable product shows on the line itself with its decision.
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
      <span className="flex flex-col items-end gap-0.5">
        <Money amount={item.subtotal} className="text-17 font-bold leading-24 text-ink lg:text-18" />
        {item.quantity > 1 && item.price ? (
          <span className="text-12 leading-17 text-stone">
            {fillMessage(m.cartUnitPrice, { price: formatAmount(item.price.amount, locale) })}
          </span>
        ) : null}
      </span>
    ) : null;

  const removeLink = (
    <button
      type="button"
      onClick={onRemove}
      disabled={busy}
      aria-label={fillMessage(m.cartRemoveItem, { name })}
      className="inline-flex min-h-control-s items-center gap-1.5 px-1 text-13.5 font-semibold text-stone underline underline-offset-4 hover:text-ink disabled:opacity-50"
    >
      <Icon name="trash" size={18} />
      {m.cartRemove}
    </button>
  );

  return (
    <li className="py-4 shadow-hairline-bottom lg:py-5" aria-busy={busy || undefined}>
      <div className="flex gap-3.5 lg:grid lg:grid-cols-[104px_minmax(0,1fr)_auto_140px] lg:items-center lg:gap-6">
        <ProductTile
          size="thumb"
          className={cn('h-22.5 w-18 flex-none rounded-image lg:h-32.5 lg:w-26', unavailable && 'opacity-50')}
          src={item.sku.image?.url ?? null}
          alt=""
          name={name}
        />

        <div className={cn('flex min-w-0 flex-1 flex-col gap-1', unavailable && 'opacity-60')}>
          {product.brand.name ? (
            <span dir="ltr" className="text-match-parent text-brand uppercase text-stone">
              {product.brand.name}
            </span>
          ) : null}
          {href ? (
            <Link href={href} dir="auto" className="text-match-parent -my-2.5 py-2.5 text-15 font-semibold leading-23 text-ink no-underline lg:text-16 lg:leading-24">
              {name}
            </Link>
          ) : (
            <span dir="auto" className="text-match-parent text-15 font-semibold leading-23 text-ink lg:text-16 lg:leading-24">
              {name}
            </span>
          )}
          {type ? <span className="hidden text-14 leading-22 text-stone lg:block">{type}</span> : null}
          <span className="flex flex-wrap items-center gap-x-3 text-13 leading-20 text-stone">
            {size ? <bdi>{size}</bdi> : null}
            <span className="hidden lg:inline-flex">{removeLink}</span>
          </span>
          {/* Phone: stepper and amount under the name (CommerceMobile ١). */}
          <span className="mt-1.5 flex items-center justify-between gap-2 lg:hidden">
            <span className="flex items-center gap-1">
              {stepper}
              <button
                type="button"
                onClick={onRemove}
                disabled={busy}
                aria-label={fillMessage(m.cartRemoveItem, { name })}
                className={cn(iconButtonVariants(), 'text-stone')}
              >
                <Icon name="trash" size={20} />
              </button>
            </span>
            {amount}
          </span>
        </div>

        <span className="hidden lg:block">{stepper}</span>
        <span className="hidden lg:flex lg:justify-end">{amount}</span>
      </div>

      {priceReview && item.priceAtAdd !== null && item.price ? (
        <MessageBox tone="warn" className="mt-3">
          <p className="m-0 text-14 leading-22">
            {fillMessage(m.cartPriceChanged, {
              old: formatAmount(item.priceAtAdd, locale),
              new: `${formatAmount(item.price.amount, locale)} ${locale === 'ar' ? 'ج.م' : 'EGP'}`,
            })}
          </p>
          <span className="mt-2 flex flex-wrap gap-2">
            <Button variant="ink" size="s" onClick={onPriceReviewed}>
              {m.cartPriceOk}
            </Button>
            <Button variant="light" size="s" onClick={onRemove} disabled={busy}>
              {m.cartRemoveProduct}
            </Button>
          </span>
        </MessageBox>
      ) : null}

      {unavailable ? (
        <MessageBox tone="err" className="mt-3">
          <p className="m-0 text-14 leading-22">{m.cartLineUnavailable}</p>
          <span className="mt-2 flex flex-wrap items-center gap-3">
            <Button variant="ink" size="s" onClick={onRemove} disabled={busy}>
              {m.cartRemoveIt}
            </Button>
            {product.category ? (
              <Link href={routes.productsByCategory(product.category.slug)} className="text-link text-13.5">
                {m.cartSeeAlternative}
              </Link>
            ) : null}
          </span>
        </MessageBox>
      ) : null}
    </li>
  );
}
