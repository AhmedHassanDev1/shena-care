'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AsyncButton, Button, type AsyncState } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { ProductTile } from '@/components/ui/product-tile';
import type { Cart } from '@/lib/cart';
import { formatNumber, formatPackSize, formatProductCount } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import type { CheckoutQuote } from '@/lib/orders';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { InlineError, type QuoteStatus } from './CheckoutSections';

export type CouponStatus = 'idle' | 'applying' | 'applied' | 'not-applied';

export interface CheckoutSummaryProps {
  cart: Cart;
  quote: CheckoutQuote | null;
  quoteStatus: QuoteStatus;
  coupon: { code: string; status: CouponStatus };
  onApplyCoupon: (code: string) => void;
  onRemoveCoupon: () => void;
  placeState: AsyncState;
  placeLabel: string;
  canPlace: boolean;
  onPlace: () => void;
}

/**
 * Editorial Order Summary Sidebar (CheckoutD, CommerceMobile ٣):
 * - Itemized list of products in the cart with thumbnail, variant, and line total
 * - Promo code application with instant feedback
 * - Clear subtotal, discount, shipping fee and total calculation
 * - Confident, high-contrast place-order button with shutter loading state
 */
export function CheckoutSummary({
  cart,
  quote,
  quoteStatus,
  coupon,
  onApplyCoupon,
  onRemoveCoupon,
  placeState,
  placeLabel,
  canPlace,
  onPlace,
}: CheckoutSummaryProps) {
  const m = useMessages();
  const locale = useLocale();
  const [code, setCode] = useState(coupon.code);
  const lineTotal = (skuId: string, fallback: number | null) => quote?.items.find((item) => item.skuId === skuId)?.lineTotal ?? fallback;
  const subtotal = quote?.subtotal ?? cart.total;
  const discount = quote ? Math.round((quote.subtotal + quote.shippingFee - quote.totalAmount) * 100) / 100 : 0;
  const count = formatProductCount(cart.itemCount, locale);

  return (
    <aside
      aria-labelledby="co-summary"
      className="flex flex-col gap-5 rounded-24 bg-linen p-5 shadow-elevation-1 lg:sticky lg:top-6 lg:rounded-sheet lg:p-7 lg:shadow-elevation-2"
    >
      <div className="flex items-baseline justify-between gap-3 border-b border-line pb-3">
        <div className="flex items-center gap-2">
          <h2 id="co-summary" className="m-0 font-display text-24 font-extrabold leading-30 text-ink">
            {m.checkoutYourOrder}
          </h2>
          <span className="rounded-pill bg-sand/70 px-2.5 py-0.5 text-12 font-bold text-ink">
            {count}
          </span>
        </div>
        <Link href={routes.cart} className="rounded-pill px-2.5 py-1 text-13 font-semibold text-cobalt transition-colors hover:bg-sand/40 hover:text-cobalt-deep">
          {m.checkoutEditCart}
        </Link>
      </div>

      {/* Product line items */}
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {cart.items.map((item) => {
          const name = item.sku.product.name || item.sku.code;
          const size = formatPackSize(item.sku.size, item.sku.sizeUnit, locale) ?? item.sku.variantName;
          const total = lineTotal(item.skuId, item.subtotal);
          return (
            <li key={item.skuId} className="flex items-center gap-3 rounded-16 bg-chalk/40 p-2.5">
              <ProductTile size="thumb" className="h-16 w-13 flex-none rounded-image shadow-hairline-bottom" src={item.sku.image?.url ?? null} alt="" name={name} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span dir="auto" className="truncate text-match-parent text-14 font-bold text-ink">
                  {name}
                </span>
                <span className="text-12 text-stone">
                  {fillMessage(m.checkoutLineMeta, { size: size ?? '', qty: formatNumber(item.quantity, locale) })}
                </span>
              </div>
              {total !== null ? (
                <div className="flex-none">
                  <Money amount={total} className="font-display text-15 font-bold text-ink" />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {/* Coupon form */}
      <form
        className="flex flex-col gap-2 rounded-16 bg-chalk/60 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (code.trim()) onApplyCoupon(code.trim());
        }}
      >
        <div className="flex items-center justify-between text-13 font-semibold text-ink">
          <span>{m.checkoutCoupon}</span>
          <span className="text-12 font-normal text-stone">{m.checkoutCouponOptional}</span>
        </div>
        <div className="flex gap-2">
          <div className="field-box flex h-11 min-w-0 flex-1 items-center px-3.5">
            <input
              id="co-coupon"
              value={code}
              dir="ltr"
              autoComplete="off"
              autoCapitalize="characters"
              placeholder={m.checkoutCouponPlaceholder}
              onChange={(event) => setCode(event.target.value)}
              readOnly={coupon.status === 'applied'}
              className="min-w-0 flex-1 bg-transparent text-match-parent text-14 text-ink outline-none placeholder:text-stone"
            />
          </div>
          {coupon.status === 'applied' ? (
            <Button
              variant="light"
              className="h-11 rounded-input"
              onClick={() => {
                setCode('');
                onRemoveCoupon();
              }}
            >
              {m.checkoutCouponRemove}
            </Button>
          ) : (
            <Button
              type="submit"
              variant="ink"
              className="h-11 rounded-input"
              loading={coupon.status === 'applying'}
              pendingLabel={m.checkoutCouponApplying}
              disabled={!code.trim()}
            >
              {m.checkoutCouponApply}
            </Button>
          )}
        </div>
        {coupon.status === 'applied' ? (
          <p role="status" className="m-0 flex items-center gap-1.5 text-12.5 font-semibold text-ok">
            <Icon name="check" size={14} strokeWidth={2.8} />
            <span>{m.checkoutCouponApplied}</span>
          </p>
        ) : coupon.status === 'not-applied' ? (
          <InlineError>{m.checkoutCouponNotApplied}</InlineError>
        ) : null}
      </form>

      {/* Financial breakdown */}
      <div className="flex flex-col gap-2 pt-1">
        <SummaryRow label={fillMessage(m.checkoutSubtotalCount, { count })}>
          <Money amount={subtotal} />
        </SummaryRow>
        {discount > 0 ? (
          <SummaryRow label={m.checkoutDiscount}>
            <span className="font-bold text-ok">
              − <Money amount={discount} />
            </span>
          </SummaryRow>
        ) : null}
        <SummaryRow label={m.checkoutShipping}>
          {quoteStatus === 'ready' && quote ? (
            quote.shippingFee === 0 ? (
              <span className="rounded-pill bg-ok-tint px-2 py-0.5 text-12 font-bold text-ok">
                {m.checkoutFree}
              </span>
            ) : (
              <Money amount={quote.shippingFee} />
            )
          ) : (
            <span className="text-13 text-stone">
              {quoteStatus === 'loading' ? m.checkoutFeeCalculating : quoteStatus === 'error' ? m.checkoutFeeFailed : m.cartShippingLater}
            </span>
          )}
        </SummaryRow>
        <div aria-hidden="true" className="my-1.5 h-px bg-line" />
        <SummaryRow label={m.checkoutTotal} strong>
          {quoteStatus === 'ready' && quote ? (
            <Money amount={quote.totalAmount} className="font-display text-24 font-extrabold text-ink" />
          ) : (
            <span className="text-stone">—</span>
          )}
        </SummaryRow>
      </div>

      {/* Desktop place button */}
      <div className="hidden pt-2 lg:block">
        <AsyncButton
          size="l"
          className="w-full text-17"
          state={quoteStatus === 'loading' ? 'resolving' : placeState}
          pendingLabel={m.checkoutPlacing}
          resolvingLabel={m.checkoutFeeCalculating}
          retryLabel={placeLabel}
          disabled={!canPlace && quoteStatus !== 'loading'}
          onClick={onPlace}
        >
          {placeLabel}
        </AsyncButton>
      </div>

      <p className="m-0 text-center text-12 leading-18 text-stone">{m.checkoutLegal}</p>
    </aside>
  );
}

function SummaryRow({ label, strong, children }: { label: string; strong?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn('flex min-h-7.5 items-center justify-between gap-3', strong ? 'text-17 font-bold' : 'text-14.5 font-medium', 'text-ink')}>
      <span>{label}</span>
      <span className="tabular-nums">{children}</span>
    </div>
  );
}
