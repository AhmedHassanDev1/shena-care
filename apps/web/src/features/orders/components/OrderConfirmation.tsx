'use client';

import { useState } from 'react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { formatDate, formatEgp, formatProductCount } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import type { OrderTracking } from '@/lib/orders';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { addressLine } from '../lib/order-stages';

/**
 * «طلبك اتسجّل» (ConfirmD, CommerceMobile ٥), cash on delivery. Every row is green only for what the server reports:
 * the order exists; cash has no payment step (it is collected by the courier, so the row is neutral); preparation is
 * waiting until the team confirms availability. No message is promised here: the API sends none at placement.
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
      // Clipboard unavailable: the number stays selectable on the page.
    }
  };

  return (
    <div className="pb-nav-safe mx-auto flex max-w-narrow flex-col gap-5 pt-4 lg:gap-6 lg:pt-10">
      <header className="flex flex-col items-start gap-3">
        <span aria-hidden="true" className="grid size-14 place-items-center rounded-pill bg-ok-tint text-ok">
          <Icon name="check" size={24} strokeWidth={2.4} />
        </span>
        <h1 className="m-0 font-display text-34 font-extrabold leading-40 text-night lg:text-52 lg:leading-56">{m.confirmTitle}</h1>
        <p className="m-0 flex items-center gap-2 text-15 text-ink-2">
          {m.confirmNumber}
          <bdi dir="ltr" className="font-bold tabular-nums text-night">
            {order.orderNumber}
          </bdi>
          <button
            type="button"
            onClick={copy}
            aria-label={m.confirmCopy}
            className="inline-grid size-9 place-items-center rounded-pill text-ink-2 hover:bg-sand hover:text-night"
          >
            <Icon name={copied ? 'check' : 'copy'} size={18} />
          </button>
          <span role="status" className="text-13 font-semibold text-ok">
            {copied ? m.confirmCopied : ''}
          </span>
        </p>
      </header>

      <ol className="m-0 flex list-none flex-col rounded-24 bg-linen px-4.5 py-2 shadow-outline-hairline lg:px-6">
        <StageRow icon="done" title={m.stageRegistered} detail={fillMessage(m.stageRegisteredDetail, { n: order.orderNumber })} ltrDetail />
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

      <section aria-labelledby="confirm-delivery" className="flex flex-col gap-3 rounded-24 bg-linen p-4.5 shadow-outline-hairline lg:p-6">
        <h2 id="confirm-delivery" className="m-0 font-display text-22 font-bold leading-29 text-night">
          {m.orderDeliveryTitle}
        </h2>
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-14 leading-22">
          <dt className="font-bold text-night">{m.confirmRecipient}</dt>
          <dd className="m-0 text-night">{order.customerName}</dd>
          <dt className="font-bold text-night">{m.confirmAddress}</dt>
          <dd className="m-0 text-night">{address}</dd>
          <dt className="font-bold text-night">{m.confirmWhen}</dt>
          <dd className="m-0 text-ink-2">{when}</dd>
          <dt className="font-bold text-night">{m.confirmTotal}</dt>
          <dd className="m-0 text-ink-2">
            <Money amount={due} className="font-bold text-night" /> · {formatProductCount(count, locale)}
          </dd>
        </dl>
      </section>

      <div className="flex flex-wrap gap-3">
        <Link href={routes.order(order.orderNumber)} replace className={buttonVariants({ variant: 'ink', size: 'l', className: 'flex-1 lg:flex-none' })}>
          {m.confirmTrack}
        </Link>
        <Link href={routes.products} className={buttonVariants({ variant: 'light', size: 'l', className: 'flex-1 lg:flex-none' })}>
          {m.confirmShop}
        </Link>
      </div>
    </div>
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
    <li className={cn('flex items-center gap-3 py-3.5', !last && 'shadow-hairline-bottom')}>
      <span
        aria-hidden="true"
        className={cn(
          'grid size-7 flex-none place-items-center rounded-pill',
          icon === 'done' && 'bg-ok text-white',
          icon === 'cash' && 'bg-linen text-night shadow-outline-control',
          icon === 'wait' && 'bg-linen shadow-outline-warn'
        )}
      >
        {icon === 'done' ? <Icon name="check" size={16} strokeWidth={2.6} /> : null}
        {icon === 'cash' ? <Icon name="cash" size={15} /> : null}
        {icon === 'wait' ? <span className="size-2 rounded-pill bg-warn" /> : null}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-15 font-bold text-night">{title}</span>
        {detail ? (
          <span className="text-13 text-ink-2">
            {ltrDetail ? <bdi>{detail}</bdi> : detail}
          </span>
        ) : null}
      </span>
    </li>
  );
}
