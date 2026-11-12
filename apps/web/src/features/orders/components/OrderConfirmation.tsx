'use client';

import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { ProductTile } from '@/components/ui/product-tile';
import { formatDate, formatEgp, formatProductCount } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import type { OrderTracking } from '@/lib/orders';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { addressLine } from '../lib/order-stages';

/**
 * Editorial Order Confirmation Experience (ConfirmD, CommerceMobile ٥):
 * - Celebratory, reassuring entrance with sun-glow emblem
 * - Distinct order number with one-touch copy and tactile confirmation
 * - 3-stage delivery progress ladder (Registered -> COD -> Warehouse availability)
 * - Clear courier advice and inspection reassurance
 * - Item packshot preview strip and action CTAs
 */
export function OrderConfirmation({ order }: { order: OrderTracking }) {
  const m = useMessages();
  const locale = useLocale();
  const [copied, setCopied] = useState(false);

  const due = order.amounts.currentCodAmount;
  const count = order.items.filter((item) => item.lineState !== 'removed').reduce((sum, item) => sum + item.quantity, 0);
  const confirmed = order.availabilityConfirmed;
  const address = addressLine(order.deliveryAddress, m);
  const when = order.delivery.deliveredAt
    ? formatDate(order.delivery.deliveredAt, locale)
    : order.delivery.estimatedDate
      ? formatDate(order.delivery.estimatedDate, locale)
      : m.checkoutDeliveryPromise;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(order.orderNumber);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable fallback
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.2, 0, 0, 1] }}
      className="pb-nav-safe mx-auto flex max-w-narrow flex-col gap-6 pt-6 lg:gap-8 lg:pt-12"
    >
      {/* Celebratory hero emblem and title */}
      <header className="flex flex-col items-center text-center">
        <div className="relative mb-4 grid size-20 place-items-center rounded-pill bg-ok-tint text-ok shadow-elevation-1">
          <span aria-hidden="true" className="sun sm think absolute -top-1 -end-1" />
          <Icon name="check" size={32} strokeWidth={2.8} />
        </div>

        <h1 className="m-0 font-display text-34 font-extrabold leading-40 text-ink lg:text-52 lg:leading-52">
          {m.confirmTitle}
        </h1>

        {/* Order reference pill */}
        <div className="mt-3.5 flex items-center gap-2.5 rounded-pill bg-linen px-4 py-2 shadow-elevation-1 border border-line">
          <span className="text-14 font-medium text-stone">{m.confirmNumber}</span>
          <bdi dir="ltr" className="font-display text-17 font-extrabold tabular-nums text-ink">
            {order.orderNumber}
          </bdi>
          <button
            type="button"
            onClick={copy}
            aria-label={m.confirmCopy}
            className="grid size-8 place-items-center rounded-pill text-stone transition-colors hover:bg-sand hover:text-ink"
          >
            <Icon name={copied ? 'check' : 'copy'} size={16} />
          </button>
          {copied ? (
            <span role="status" className="font-display text-12 font-bold text-ok">
              {m.confirmCopied}
            </span>
          ) : null}
        </div>
      </header>

      {/* 3-Stage Delivery Progress Ladder */}
      <section aria-label="مراحل معالجة الطلب" className="rounded-24 bg-linen p-5 shadow-elevation-1 lg:p-7">
        <ol className="m-0 flex list-none flex-col p-0">
          <StageRow
            icon="done"
            title={m.stageRegistered}
            detail={fillMessage(m.stageRegisteredDetail, { n: order.orderNumber })}
            ltrDetail
          />
          <StageRow
            icon="cash"
            title={m.stagePaymentCod}
            detail={fillMessage(m.stagePaymentCodAmount, { amount: formatEgp(due, order.amounts.currency, locale) ?? '' })}
          />
          <StageRow
            icon={confirmed ? 'done' : 'wait'}
            title={confirmed ? m.stageConfirmed : m.stageConfirm}
            detail={confirmed ? undefined : m.stageConfirmWaiting}
            last
          />
        </ol>
      </section>

      {/* Delivery details and items preview card */}
      <section
        aria-labelledby="confirm-delivery"
        className="flex flex-col gap-5 rounded-24 bg-linen p-5 shadow-elevation-1 lg:p-7"
      >
        <div className="flex items-center justify-between border-b border-line pb-3">
          <h2 id="confirm-delivery" className="m-0 font-display text-22 font-bold leading-28 text-ink">
            {m.orderDeliveryTitle}
          </h2>
          <span className="rounded-pill bg-sand/70 px-2.5 py-0.5 text-12 font-bold text-ink">
            {formatProductCount(count, locale)}
          </span>
        </div>

        {/* Courier reassurance banner */}
        <div className="flex items-start gap-3 rounded-16 bg-chalk/70 p-3.5">
          <Icon name="truck" size={20} className="mt-0.5 text-cobalt flex-none" />
          <p className="m-0 text-13.5 leading-21 text-stone">
            {m.confirmAdvice}
          </p>
        </div>

        {/* Delivery specification grid */}
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-3 text-14 leading-22">
          <dt className="font-bold text-ink">{m.confirmRecipient}</dt>
          <dd className="m-0 text-ink">{order.customerName}</dd>

          <dt className="font-bold text-ink">{m.confirmAddress}</dt>
          <dd className="m-0 text-ink">{address}</dd>

          <dt className="font-bold text-ink">{m.confirmWhen}</dt>
          <dd className="m-0 text-stone">{when}</dd>

          <dt className="font-bold text-ink">{m.confirmTotal}</dt>
          <dd className="m-0 flex items-center gap-2 text-ink">
            <Money amount={due} className="font-display text-17 font-extrabold text-ink" />
            <span className="text-12 text-stone">({m.confirmCourierCash})</span>
          </dd>
        </dl>

        {/* Ordered items preview strip */}
        {order.items.length ? (
          <div className="border-t border-line pt-4">
            <span className="mb-2.5 block text-13 font-semibold text-stone">{m.orderItems}</span>
            <div className="flex flex-wrap gap-2.5">
              {order.items
                .filter((item) => item.lineState !== 'removed')
                .map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 rounded-16 bg-chalk/50 p-2 shadow-hairline-bottom"
                  >
                    <ProductTile size="thumb" className="h-12 w-10 rounded-image" src={null} alt="" name={item.productName ?? ''} />
                    <div className="flex flex-col pe-2">
                      <span className="text-13 font-bold text-ink line-clamp-1">{item.productName}</span>
                      <span className="text-11 text-stone">
                        {item.variantName ? `${item.variantName} · ` : ''}
                        {formatProductCount(item.quantity, locale)}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ) : null}
      </section>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3.5">
        <Link
          href={routes.order(order.orderNumber)}
          replace
          className={buttonVariants({ variant: 'ink', size: 'l', className: 'flex-1 lg:flex-none text-16' })}
        >
          <Icon name="package" size={18} />
          <span>{m.confirmTrack}</span>
        </Link>
        <Link
          href={routes.products}
          className={buttonVariants({ variant: 'light', size: 'l', className: 'flex-1 lg:flex-none text-16' })}
        >
          <Icon name="shop" size={18} />
          <span>{m.confirmShop}</span>
        </Link>
      </div>
    </motion.div>
  );
}

function StageRow({
  icon,
  title,
  detail,
  ltrDetail,
  last,
}: {
  icon: 'done' | 'cash' | 'wait';
  title: string;
  detail?: string;
  ltrDetail?: boolean;
  last?: boolean;
}) {
  return (
    <li className={cn('flex items-center gap-3.5 py-3.5', !last && 'border-b border-line')}>
      <span
        aria-hidden="true"
        className={cn(
          'grid size-8 flex-none place-items-center rounded-pill shadow-elevation-1 transition-colors',
          icon === 'done' && 'bg-ok text-white',
          icon === 'cash' && 'bg-sand text-ink',
          icon === 'wait' && 'bg-linen ring-2 ring-warn'
        )}
      >
        {icon === 'done' ? <Icon name="check" size={16} strokeWidth={2.8} /> : null}
        {icon === 'cash' ? <Icon name="cash" size={16} /> : null}
        {icon === 'wait' ? <span className="size-2 rounded-pill bg-warn animate-pulse" /> : null}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-display text-15 font-bold text-ink">{title}</span>
        {detail ? (
          <span className="text-13 text-stone">
            {ltrDetail ? <bdi>{detail}</bdi> : detail}
          </span>
        ) : null}
      </div>
    </li>
  );
}
