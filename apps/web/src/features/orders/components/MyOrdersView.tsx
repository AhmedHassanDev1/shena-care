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
 * «طلباتي» (OrdersD, CommerceMobile ٦/٦ب/٧). Desktop: the list at the reading start and the selected order's detail
 * beside it (the newest when none is chosen). Phone: the list on /orders, the order alone on /orders/[id].
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
        <nav aria-label={m.myOrdersAccount} className="flex items-center gap-1.5 text-13.5">
          <Link href={routes.account} className="text-link min-h-0">
            {m.myOrdersAccount}
          </Link>
          <Icon name="chevron-forward" size={14} className="text-ink-3" />
          <span aria-current="page" className="font-bold text-night">
            {m.myOrdersTitle}
          </span>
        </nav>
        <h1 className="m-0 mt-2 font-display text-44 font-extrabold leading-50 text-night">{m.myOrdersTitle}</h1>
      </header>

      <div className="lg:grid lg:grid-cols-[365px_minmax(0,1fr)] lg:items-start lg:gap-8">
        <section aria-label={m.myOrdersTitle} className={cn('lg:sticky lg:top-6', selected && 'hidden lg:block')}>
          {list}
        </section>
        {(selected || desktop) && shown ? (
          <section>
            <OrderTrackingView key={shown} orderNumber={shown} />
          </section>
        ) : null}
      </div>
    </div>
  );
}
