'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '@/components/ui/icon';
import { useAuth } from '@/features/auth/AuthContext';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { orders } from '@/lib/orders';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { OrdersEmpty, OrdersList, OrdersListSkeleton, OrdersLoadFailed, OrdersSignIn } from './OrdersList';
import { OrderTrackingView } from './OrderTrackingView';

function useDesktop(): boolean {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return desktop;
}

/**
 * Editorial My Orders Hub (OrdersD, CommerceMobile ٦/٦ب/٧):
 * - Master-detail desktop view with instantaneous order tracking inspection
 * - Responsive mobile view with seamless drill-down to /orders/[id]
 * - Graceful loading, empty, and authentication states
 */
export function MyOrdersView({ selected }: { selected?: string }) {
  const m = useMessages();
  const desktop = useDesktop();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const query = useQuery({ queryKey: ['my-orders'], queryFn: () => orders.listMine(), enabled: isAuthenticated });
  const shown = selected ?? query.data?.items[0]?.orderNumber ?? null;

  const list = authLoading || (isAuthenticated && query.isPending) ? (
    <OrdersListSkeleton />
  ) : !isAuthenticated ? (
    <OrdersSignIn />
  ) : query.isError ? (
    <OrdersLoadFailed onRetry={() => query.refetch()} />
  ) : query.data && query.data.items.length === 0 ? (
    <OrdersEmpty />
  ) : query.data ? (
    <OrdersList orders={query.data.items} selected={desktop ? shown : null} filterable={!desktop} />
  ) : null;

  return (
    <div className="pb-nav-safe">
      <header className="mb-6 hidden lg:block">
        <nav aria-label={m.myOrdersAccount} className="flex items-center gap-2 text-13.5">
          <Link href={routes.account} className="text-stone transition-colors hover:text-ink">
            {m.myOrdersAccount}
          </Link>
          <Icon name="chevron-forward" size={13} className="text-stone" />
          <span aria-current="page" className="font-bold text-ink">
            {m.myOrdersTitle}
          </span>
        </nav>
        <div className="mt-2 flex items-baseline gap-3">
          <h1 className="m-0 font-display text-44 font-extrabold leading-52 text-ink">{m.myOrdersTitle}</h1>
          {query.data?.items.length ? (
            <span className="rounded-pill bg-sand/80 px-2.5 py-0.5 text-13 font-bold text-ink">
              {query.data.items.length}
            </span>
          ) : null}
        </div>
      </header>

      <div className="lg:grid lg:grid-cols-[380px_minmax(0,1fr)] lg:items-start lg:gap-8">
        <section aria-label={m.myOrdersTitle} className={cn('lg:sticky lg:top-6', selected && 'hidden lg:block')}>
          {list}
        </section>
        {(selected || desktop) && shown ? (
          <section className="min-w-0">
            <OrderTrackingView key={shown} orderNumber={shown} errorHeadingLevel={2} />
          </section>
        ) : null}
      </div>
    </div>
  );
}
