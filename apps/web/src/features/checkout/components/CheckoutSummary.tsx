'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AsyncButton, Button, type AsyncState } from '@/components/ui/button';
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

interface CheckoutSummaryProps {
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
 * «طلبك» (CheckoutD order summary, CommerceMobile ٣): the lines, discount code, subtotal, delivery and total from the
 * server quote, «أكد الطلب · total» and the legal line. Sticky beside the sections on desktop; below them on the
 * phone, where the button lives in the sticky action area instead.
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
      className="flex flex-col gap-4 rounded-24 bg-linen p-4.5 shadow-outline-hairline lg:sticky lg:top-6 lg:rounded-sheet lg:p-6.5 lg:shadow-elevation-3 lg:outline lg:outline-1 lg:outline-line"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="co-summary" className="m-0 font-display text-24 font-extrabold leading-30 text-night">
          {m.checkoutYourOrder}
        </h2>
        <Link href={routes.cart} className="text-link text-13.5">
          <span className="lg:hidden">{count} · </span>
          {m.checkoutEditCart}
        </Link>
      </div>

      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {cart.items.map((item) => {
          const name = item.sku.product.name || item.sku.code;
          const size = formatPackSize(item.sku.size, item.sku.sizeUnit, locale) ?? item.sku.variantName;
          const total = lineTotal(item.skuId, item.subtotal);
          return (
            <li key={item.skuId} className="flex items-center gap-3">
              <ProductTile size="thumb" className="h-15 w-12 flex-none rounded-10" src={item.sku.image?.url ?? null} alt="" name={name} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span dir="auto" className="truncate text-match-parent text-13.5 font-semibold text-night">
                  {name}
                </span>
                <span className="text-12.5 text-ink-2">
                  {fillMessage(m.checkoutLineMeta, { size: size ?? '', qty: formatNumber(item.quantity, locale) })}
                </span>
              </span>
              {total !== null ? <Money amount={total} className="text-14 font-bold text-night" /> : null}
            </li>
          );
        })}
      </ul>

      <form
        className="flex flex-col gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (code.trim()) onApplyCoupon(code.trim());
        }}
      >
        <label htmlFor="co-coupon" className="text-13 font-semibold text-night">
          {m.checkoutCoupon} <span className="font-normal text-ink-2">{m.checkoutCouponOptional}</span>
        </label>
        <span className="flex gap-2">
          <span className="field-box flex h-12 min-w-0 flex-1 items-center px-4">
            <input
              id="co-coupon"
              value={code}
              dir="ltr"
              autoComplete="off"
              autoCapitalize="characters"
              placeholder={m.checkoutCouponPlaceholder}
              onChange={(event) => setCode(event.target.value)}
              readOnly={coupon.status === 'applied'}
              className="min-w-0 flex-1 bg-transparent text-match-parent text-15 text-night outline-none placeholder:text-ink-3"
            />
          </span>
          {coupon.status === 'applied' ? (
            <Button
              variant="light"
              className="h-12"
              onClick={() => {
                setCode('');
                onRemoveCoupon();
              }}
            >
              {m.checkoutCouponRemove}
            </Button>
          ) : (
            <Button type="submit" variant="light" className="h-12" loading={coupon.status === 'applying'} pendingLabel={m.checkoutCouponApplying} disabled={!code.trim()}>
              {m.checkoutCouponApply}
            </Button>
          )}
        </span>
        {coupon.status === 'applied' ? (
          <p role="status" className="m-0 text-13 font-semibold text-ok">
            {m.checkoutCouponApplied}
          </p>
        ) : coupon.status === 'not-applied' ? (
          <InlineError>{m.checkoutCouponNotApplied}</InlineError>
        ) : null}
      </form>

      <div className="flex flex-col gap-1">
        <Row label={fillMessage(m.checkoutSubtotalCount, { count })}>
          <Money amount={subtotal} />
        </Row>
        {discount > 0 ? (
          <Row label={m.checkoutDiscount}>
            <span className="text-ok">
              − <Money amount={discount} />
            </span>
          </Row>
        ) : null}
        <Row label={m.checkoutShipping}>
          {quoteStatus === 'ready' && quote ? (
            quote.shippingFee === 0 ? m.checkoutFree : <Money amount={quote.shippingFee} />
          ) : (
            <span className="text-ink-3">
              {quoteStatus === 'loading' ? m.checkoutFeeCalculating : quoteStatus === 'error' ? m.checkoutFeeFailed : m.cartShippingLater}
            </span>
          )}
        </Row>
        <div aria-hidden="true" className="my-1.5 h-px bg-line" />
        <Row label={m.checkoutTotal} strong>
          {quoteStatus === 'ready' && quote ? <Money amount={quote.totalAmount} /> : <span className="text-ink-3">—</span>}
        </Row>
      </div>

      <div className="hidden lg:block">
        <AsyncButton size="l" className="w-full" state={placeState} pendingLabel={m.checkoutPlacing} retryLabel={placeLabel} disabled={!canPlace} onClick={onPlace}>
          {placeLabel}
        </AsyncButton>
      </div>
      <p className="m-0 text-12.5 leading-20 text-ink-3">{m.checkoutLegal}</p>
    </aside>
  );
}

function Row({ label, strong, children }: { label: string; strong?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn('flex min-h-7.5 items-center justify-between gap-3', strong ? 'text-17 font-bold' : 'text-14.5 font-medium', 'text-night')}>
      <span>{label}</span>
      <span className="tabular-nums">{children}</span>
    </div>
  );
}
