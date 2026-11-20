'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { ProductTile } from '@/components/ui/product-tile';
import { Timeline } from '@/components/ui/timeline';
import { formatDate, formatEgp, formatNumber, formatPackSize, formatProductCount } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import type { OrderTracking } from '@/lib/orders';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { useSkuCatalog } from '../hooks/useSkuCatalog';
import { addressLine, groupOrderReference, orderDiscount, trackingSteps } from '../lib/order-stages';

/**
 * Order confirmation, shown right after checkout. It answers four questions in order: what happened (placed), what do I pay
 * (the line items, the summary and the cash-on-delivery amount), when and where (delivery card, with an honest estimated /
 * confirmed distinction) and what happens next. Payment method and order progress are separate things: progress comes only
 * from the backend's own stages, payment is a plain fact about how the order is paid.
 */
export function OrderConfirmation({ order }: { order: OrderTracking }) {
  const m = useMessages();
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  const catalog = useSkuCatalog(order.items.map((item) => item.skuId));

  const due = order.amounts.currentCodAmount;
  const lines = order.items.filter((item) => item.lineState !== 'removed');
  const count = lines.reduce((sum, item) => sum + item.quantity, 0);
  const discount = orderDiscount(order);
  const address = addressLine(order.deliveryAddress, m);
  const reference = groupOrderReference(order.orderNumber);
  const progress = trackingSteps(order, m, locale).filter((step) => step.id !== 'payment');
  const paidLine = fillMessage(m.stagePaymentCodAmount, { amount: formatEgp(due, order.amounts.currency, locale) ?? '' });

  const date = order.delivery.estimatedDate ? formatDate(order.delivery.estimatedDate, locale) : null;
  const timing =
    order.delivery.certainty === 'confirmed' && date
      ? { text: fillMessage(m.confirmWhenConfirmed, { date }), note: null }
      : order.delivery.certainty === 'estimated' && date
        ? { text: fillMessage(m.confirmWhenEstimated, { date }), note: m.confirmWhenEstimatedNote }
        : { text: m.checkoutDeliveryPromise, note: null };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(order.orderNumber);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable: the number stays selectable on screen.
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.2, 0, 0, 1] }}
      className="pb-nav-safe mx-auto flex max-w-container flex-col gap-5 pt-5 lg:gap-8 lg:pt-12"
    >
      <header className="flex flex-col items-center text-center">
        <div className="mb-3 grid size-16 place-items-center rounded-pill bg-ok-tint text-ok lg:size-20">
          <Icon name="check" size={32} strokeWidth={2.8} />
        </div>
        <h1 className="m-0 font-display text-34 font-extrabold leading-40 text-ink lg:text-52 lg:leading-52">{m.confirmTitle}</h1>

        {/* The one place the order reference appears: grouped to be readable, copied whole. */}
        <div className="mt-3.5 flex flex-wrap items-center justify-center gap-2.5 rounded-pill border border-line/70 bg-linen/95 px-4 py-2 shadow-elevation-1">
          <span className="text-14 font-medium text-stone">{m.confirmNumber}</span>
          <bdi dir="ltr" className="font-display text-17 font-extrabold tabular-nums text-ink">
            {reference}
          </bdi>
          <button
            type="button"
            onClick={copy}
            aria-label={m.confirmCopy}
            className="grid size-9 place-items-center rounded-pill text-stone transition-colors hover:bg-sand hover:text-ink"
          >
            <Icon name={copied ? 'check' : 'copy'} size={16} />
          </button>
          {copied ? (
            <span role="status" className="font-display text-13 font-bold text-ok">
              {m.confirmCopied}
            </span>
          ) : null}
        </div>
      </header>

      {/* Phone: payment, delivery, items and summary, progress, next. Desktop: items and summary on the start side, the rest stacked beside them. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:grid-rows-[repeat(4,auto)_1fr] lg:items-start lg:gap-x-8 lg:gap-y-5">
        <div className="contents">
          <section aria-labelledby="confirm-items" className="order-3 rounded-card border border-line/70 bg-linen/95 p-4 shadow-elevation-1 lg:col-start-1 lg:row-span-5 lg:row-start-1 lg:rounded-sheet lg:p-6">
            <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
              <h2 id="confirm-items" className="m-0 font-display text-20 font-bold text-ink">
                {m.orderItems}
              </h2>
              <span className="rounded-pill bg-sand/70 px-3 py-1 text-13 font-bold text-ink">{formatProductCount(count, locale)}</span>
            </div>
            <ul className="m-0 flex list-none flex-col p-0">
              {lines.map((item, index) => {
                const entry = catalog[item.skuId];
                const size = (entry ? formatPackSize(entry.size, entry.sizeUnit, locale) : null) ?? item.variantName ?? '';
                const name = item.productName ?? '';
                return (
                  <li key={item.id} className={cn('flex items-center gap-3.5 py-3.5', index < lines.length - 1 && 'border-b border-line/70')}>
                    <ProductTile size="thumb" className="h-16 w-13 flex-none rounded-image shadow-hairline-bottom" src={entry?.image?.url ?? null} alt="" name={name} />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span dir="auto" className="text-match-parent text-15 font-bold leading-22 text-ink">
                        {name}
                      </span>
                      <span className="text-13 text-stone">{fillMessage(m.checkoutLineMeta, { size, qty: formatNumber(item.quantity, locale) })}</span>
                      <span className="text-13 text-stone">
                        {fillMessage(m.confirmUnitPrice, { price: formatEgp(item.unitPrice, item.currency, locale) ?? '' })}
                      </span>
                    </div>
                    <Money amount={item.lineTotal} className="font-display text-16 font-bold text-ink" />
                  </li>
                );
              })}
            </ul>

            {/* Summary: every figure is the server's; the total is what the courier collects. */}
            <dl aria-label={m.confirmSummaryTitle} className="m-0 mt-1 flex flex-col gap-2.5 border-t border-line pt-4 text-14">
              <SummaryRow label={fillMessage(m.checkoutSubtotalCount, { count: formatProductCount(count, locale) })}>
                <Money amount={order.amounts.subtotal + discount} />
              </SummaryRow>
              {discount > 0 ? (
                <SummaryRow label={m.confirmDiscounts}>
                  <span className="font-bold text-ok">{fillMessage(m.confirmSaved, { amount: formatEgp(discount, order.amounts.currency, locale) ?? '' })}</span>
                </SummaryRow>
              ) : null}
              <SummaryRow label={m.checkoutShipping}>
                {order.amounts.shippingFee === 0 ? (
                  <span className="rounded-pill bg-ok-tint px-2.5 py-0.5 text-13 font-bold text-ok">{m.checkoutFree}</span>
                ) : (
                  <Money amount={order.amounts.shippingFee} />
                )}
              </SummaryRow>
              <div aria-hidden="true" className="h-px bg-line" />
              <SummaryRow label={m.checkoutTotal} strong>
                <Money amount={due} className="font-display text-22 font-extrabold text-ink" />
              </SummaryRow>
              {order.amounts.originalCodAmount !== due ? (
                <p className="m-0 text-13 text-stone">
                  {fillMessage(m.orderCodWas, { amount: formatEgp(order.amounts.originalCodAmount, order.amounts.currency, locale) ?? '' })}
                </p>
              ) : null}
            </dl>
          </section>
        </div>

        <div className="contents">
          <section aria-labelledby="confirm-payment" className="order-1 flex items-start gap-3.5 rounded-card border border-line/70 bg-linen/95 p-4 shadow-elevation-1 lg:col-start-2 lg:row-start-1 lg:rounded-sheet lg:p-5">
            <span aria-hidden="true" className="grid size-10 flex-none place-items-center rounded-pill bg-sand text-ink">
              <Icon name="cash" size={20} />
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 id="confirm-payment" className="m-0 font-display text-17 font-bold text-ink">
                {m.stagePaymentCod}
              </h2>
              <p className="m-0 text-15 font-semibold text-ink">{paidLine}</p>
              <p className="m-0 text-13 text-stone">{m.confirmCourierCash}</p>
            </div>
          </section>

          <section aria-labelledby="confirm-delivery" className="order-2 flex flex-col gap-4 rounded-card border border-line/70 bg-linen/95 p-4 shadow-elevation-1 lg:col-start-2 lg:row-start-2 lg:rounded-sheet lg:p-6">
            <h2 id="confirm-delivery" className="m-0 border-b border-line pb-3 font-display text-20 font-bold text-ink">
              {m.orderDeliveryTitle}
            </h2>
            <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-3 text-15 leading-22">
              <dt className="font-bold text-ink">{m.confirmRecipient}</dt>
              <dd dir="auto" className="m-0 text-match-parent text-ink">{order.customerName}</dd>

              <dt className="font-bold text-ink">{m.confirmAddress}</dt>
              <dd dir="auto" className="m-0 text-match-parent text-ink">{address}</dd>

              <dt className="font-bold text-ink">{m.confirmWhen}</dt>
              <dd className="m-0 flex flex-col gap-1">
                <span className="font-semibold text-ink">{timing.text}</span>
                {timing.note ? <span className="text-13 text-stone">{timing.note}</span> : null}
              </dd>
            </dl>
          </section>

          <section aria-labelledby="confirm-progress" className="order-4 rounded-card border border-line/70 bg-linen/95 p-4 shadow-elevation-1 lg:col-start-2 lg:row-start-3 lg:rounded-sheet lg:p-6">
            <h2 id="confirm-progress" className="m-0 mb-4 font-display text-20 font-bold text-ink">
              {m.confirmProgressTitle}
            </h2>
            <Timeline items={progress} label={m.confirmProgressTitle} />
          </section>

          <section aria-labelledby="confirm-next" className="order-5 flex items-start gap-3 rounded-card border border-line/60 bg-chalk/60 p-4 lg:col-start-2 lg:row-start-4">
            <Icon name="truck" size={22} className="mt-0.5 flex-none text-cobalt" />
            <div className="flex flex-col gap-1.5">
              <h2 id="confirm-next" className="m-0 font-display text-16 font-bold text-ink">
                {m.confirmNextTitle}
              </h2>
              <p className="m-0 text-14 leading-22 text-stone">{m.confirmNextSteps}</p>
              <p className="m-0 text-14 leading-22 text-stone">{m.confirmAdvice}</p>
              {order.canCancel ? <p className="m-0 text-14 leading-22 text-ink">{m.confirmNextCancel}</p> : null}
            </div>
          </section>
        </div>
      </div>

      <div className="flex flex-wrap gap-3.5">
        <Link href={routes.order(order.orderNumber)} replace className={buttonVariants({ variant: 'cobalt', size: 'l', className: 'flex-1 lg:flex-none text-16' })}>
          <Icon name="package" size={18} />
          <span>{m.confirmTrack}</span>
        </Link>
        <Link href={routes.products} className={buttonVariants({ variant: 'light', size: 'l', className: 'flex-1 lg:flex-none text-16 border border-line/70' })}>
          <Icon name="shop" size={18} />
          <span>{m.confirmShop}</span>
        </Link>
      </div>
    </motion.div>
  );
}

function SummaryRow({ label, strong, children }: { label: string; strong?: boolean; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className={cn('m-0', strong ? 'font-display text-17 font-bold text-ink' : 'text-stone')}>{label}</dt>
      <dd className="m-0 text-ink">{children}</dd>
    </div>
  );
}
