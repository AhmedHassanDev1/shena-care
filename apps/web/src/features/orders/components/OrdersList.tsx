'use client';

import { useState } from 'react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Icon } from '@/components/ui/icon';
import { MessageBox } from '@/components/ui/message-box';
import { ProductTile } from '@/components/ui/product-tile';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusChip } from '@/components/ui/status-chip';
import { useAuth } from '@/features/auth/AuthContext';
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
 * Editorial Orders List (OrdersD start column, CommerceMobile ٦/٦ب):
 * - Clean filter chips for All / Active / Completed orders
 * - Scannable beauty order cards with status chips, item packshot strip, and total COD amount
 * - High-visibility selection indicator for desktop master-detail navigation
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
    <div className="flex flex-col gap-4">
      {filterable ? (
        <div role="group" aria-label={m.myOrdersFilter} className="flex gap-2 pb-1">
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
        <div className="rounded-24 bg-linen p-8 text-center shadow-elevation-1">
          <p className="m-0 text-14 text-stone">{m.myOrdersEmptyFilter}</p>
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
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
        'group flex flex-col gap-3 rounded-24 bg-linen p-4.5 text-ink no-underline transition-all duration-base hover:shadow-elevation-2',
        selected
          ? 'border border-cobalt bg-cobalt/5 shadow-outline-cobalt ring-2 ring-cobalt/15'
          : 'border border-line/60 shadow-elevation-1'
      )}
    >
      {/* Top row: Order Number & Stage chip */}
      <div className="flex items-center justify-between gap-3">
        <bdi dir="ltr" className="font-display text-16 font-extrabold tabular-nums text-ink">
          {order.orderNumber}
        </bdi>
        <StatusChip tone={stageTone(order.stage)} className="text-11 font-bold">
          {stageLabel(order.stage, m)}
        </StatusChip>
      </div>

      {/* Meta row: Date · Product count · Total COD */}
      <div className="flex items-center justify-between gap-2 text-13">
        <span className="text-stone">
          {formatDate(order.createdAt, locale)} · {formatProductCount(order.itemCount, locale)}
        </span>
        <bdi className="font-display text-15 font-bold text-ink">{total}</bdi>
      </div>

      {/* Thumbnail preview strip */}
      {order.skuIds.length ? (
        <div className="flex items-center gap-2 pt-1 border-t border-line/50">
          <div className="flex gap-2">
            {order.skuIds.slice(0, THUMBS).map((skuId) => (
              <ProductTile
                key={skuId}
                size="thumb"
                className="h-12 w-10 flex-none rounded-image shadow-hairline-bottom"
                src={catalog[skuId]?.image?.url ?? null}
                alt=""
                name=""
              />
            ))}
          </div>
          <span className="ms-auto inline-flex items-center gap-1 text-12 font-semibold text-stone transition-colors group-hover:text-cobalt">
            <span>{m.myOrdersViewDetails}</span>
            <Icon name="arrow-forward" size={14} />
          </span>
        </div>
      ) : null}
    </Link>
  );
}

export function OrdersListSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3.5">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="flex flex-col gap-3 rounded-24 bg-linen p-5 shadow-elevation-1">
          <div className="flex justify-between items-center">
            <Skeleton className="h-4 w-32 rounded-pill" />
            <Skeleton className="h-5 w-20 rounded-pill" />
          </div>
          <Skeleton className="h-3.5 w-48 rounded-pill" />
          <div className="flex gap-2 pt-1">
            <Skeleton className="h-12 w-10 rounded-image" />
            <Skeleton className="h-12 w-10 rounded-image" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function OrdersSignIn() {
  const m = useMessages();
  const { openAuthModal } = useAuth();
  return (
    <section className="flex flex-col items-center gap-4 rounded-sheet bg-linen p-8 text-center shadow-elevation-1">
      <div className="grid size-14 place-items-center rounded-pill bg-sand text-ink">
        <Icon name="user" size={26} />
      </div>
      <p className="m-0 font-display text-18 font-bold text-ink">{m.myOrdersSignIn}</p>
      <Link
        href={signInHref(routes.myOrders)}
        onClick={(e) => {
          e.preventDefault();
          openAuthModal();
        }}
        className={buttonVariants({ variant: 'ink', size: 'l' })}
      >
        {m.myOrdersSignInButton}
      </Link>
    </section>
  );
}

export function OrdersEmpty() {
  const m = useMessages();
  return (
    <section className="flex flex-col items-center gap-4 rounded-sheet bg-linen px-6 py-12 text-center shadow-elevation-1">
      <div className="grid size-14 place-items-center rounded-pill bg-sand text-ink">
        <Icon name="bag" size={26} />
      </div>
      <p className="m-0 font-display text-20 font-bold text-ink">{m.myOrdersEmpty}</p>
      <Link href={routes.products} className={buttonVariants({ variant: 'ink', size: 'l' })}>
        {m.cartShop}
      </Link>
    </section>
  );
}

export function OrdersLoadFailed({ onRetry }: { onRetry: () => void }) {
  const m = useMessages();
  return (
    <MessageBox tone="err" role="alert" className="rounded-24">
      <p className="m-0 text-14">{m.myOrdersLoadFailed}</p>
      <button type="button" onClick={onRetry} className="text-link text-13.5 mt-2">
        {m.checkoutRetry}
      </button>
    </MessageBox>
  );
}
