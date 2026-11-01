'use client';

import { useState } from 'react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { MessageBox } from '@/components/ui/message-box';
import { ProductTile } from '@/components/ui/product-tile';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusChip } from '@/components/ui/status-chip';
import { signInHref } from '@/features/auth/lib/auth-helpers';
import { formatDate, formatEgp, formatProductCount } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import type { MyOrder } from '@/lib/orders';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { useSkuCatalog } from '../hooks/useSkuCatalog';
import { isFinished, stageLabel, stageTone } from '../lib/order-stages';

type Filter = 'all' | 'active' | 'done';

const THUMBS = 3;

/**
 * «طلباتي» list (OrdersD start column, CommerceMobile ٦/٦ب): order cards with reference, stage chip, date · count ·
 * total and up to three product thumbnails; the selected order has the cobalt ring on desktop. The phone adds the
 * «الكل · شغّالة · خلصت» filter. Stages are the server's customer stages (the same as the order page).
 */
export function OrdersList({
  orders,
  selected,
  filterable,
}: {
  orders: MyOrder[];
  selected?: string | null;
  filterable?: boolean;
}) {
  const m = useMessages();
  const [filter, setFilter] = useState<Filter>('all');
  const catalog = useSkuCatalog(orders.flatMap((order) => order.skuIds.slice(0, THUMBS)));
  const visible = orders.filter((order) => filter === 'all' || (filter === 'done') === isFinished(order.stage));

  return (
    <div className="flex flex-col gap-3">
      {filterable ? (
        <div role="group" aria-label={m.myOrdersFilter} className="flex gap-2">
          {(
            [
              ['all', m.myOrdersAll],
              ['active', m.myOrdersActive],
              ['done', m.myOrdersDone],
            ] as Array<[Filter, string]>
          ).map(([value, label]) => (
            <Chip key={value} selected={filter === value} onClick={() => setFilter(value)}>
              {label}
            </Chip>
          ))}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <p className="m-0 py-6 text-center text-14 text-stone">{m.myOrdersEmptyFilter}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {visible.map((order) => (
            <li key={order.id}>
              <OrderCard order={order} selected={order.orderNumber === selected} catalog={catalog} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OrderCard({
  order,
  selected,
  catalog,
}: {
  order: MyOrder;
  selected: boolean;
  catalog: ReturnType<typeof useSkuCatalog>;
}) {
  const m = useMessages();
  const locale = useLocale();
  const total = formatEgp(order.currentCodAmount ?? order.codAmount ?? order.totalAmount, order.currency, locale);
  return (
    <Link
      href={routes.order(order.orderNumber)}
      aria-current={selected ? 'page' : undefined}
      className={cn(
        'flex flex-col gap-2 rounded-card bg-linen p-4 text-ink no-underline',
        selected ? 'shadow-outline-cobalt' : 'shadow-outline-hairline hover:shadow-outline-control'
      )}
    >
      <span className="flex items-center justify-between gap-3">
        <bdi dir="ltr" className="text-16 font-bold tabular-nums">
          {order.orderNumber}
        </bdi>
        <StatusChip tone={stageTone(order.stage)}>{stageLabel(order.stage, m)}</StatusChip>
      </span>
      <span className="text-13 text-stone">
        {formatDate(order.createdAt, locale)} · {formatProductCount(order.itemCount, locale)} · <bdi className="font-bold text-ink">{total}</bdi>
      </span>
      {order.skuIds.length ? (
        <span className="flex gap-2">
          {order.skuIds.slice(0, THUMBS).map((skuId) => (
            <ProductTile key={skuId} size="thumb" className="h-12.5 w-10 flex-none rounded-8" src={catalog[skuId]?.image?.url ?? null} alt="" name="" />
          ))}
        </span>
      ) : null}
    </Link>
  );
}

export function OrdersListSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      {Array.from({ length: 3 }, (_, index) => (
        <Skeleton key={index} className="h-32 w-full rounded-card" />
      ))}
    </div>
  );
}

export function OrdersSignIn() {
  const m = useMessages();
  return (
    <section className="flex flex-col items-start gap-3 rounded-card bg-linen p-5 shadow-outline-hairline">
      <p className="m-0 text-15 text-ink">{m.myOrdersSignIn}</p>
      <Link href={signInHref(routes.myOrders)} className={buttonVariants({ variant: 'ink' })}>
        {m.myOrdersSignInButton}
      </Link>
    </section>
  );
}

export function OrdersEmpty() {
  const m = useMessages();
  return (
    <section className="flex flex-col items-center gap-3 rounded-card bg-linen px-5 py-10 text-center shadow-outline-hairline">
      <p className="m-0 text-15 text-ink">{m.myOrdersEmpty}</p>
      <Link href={routes.products} className={buttonVariants({ variant: 'ink' })}>
        {m.cartShop}
      </Link>
    </section>
  );
}

export function OrdersLoadFailed({ onRetry }: { onRetry: () => void }) {
  const m = useMessages();
  return (
    <MessageBox tone="err" role="alert">
      <p className="m-0 text-14">{m.myOrdersLoadFailed}</p>
      <button type="button" onClick={onRetry} className="text-link text-13.5">
        {m.checkoutRetry}
      </button>
    </MessageBox>
  );
}
