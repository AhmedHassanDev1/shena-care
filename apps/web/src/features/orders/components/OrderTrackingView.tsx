'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { signInHref } from '@/features/auth/lib/auth-helpers';
import { ApiError } from '@/lib/api-client';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { orders } from '@/lib/orders';
import { routes } from '@/lib/routes';
import { OrderConfirmation } from './OrderConfirmation';
import { OrderDetail } from './OrderDetail';

/**
 * One order from the customer tracking projection (GLO-74): «طلبك اتسجّل» right after checkout (`placed`), the
 * detail and tracking otherwise. Refreshes every minute and on focus until live updates exist.
 */
export function OrderTrackingView({ orderNumber, placed = false }: { orderNumber: string; placed?: boolean }) {
  const m = useMessages();
  const query = useQuery({
    queryKey: ['order-tracking', orderNumber],
    queryFn: () => orders.getTracking(orderNumber),
    refetchInterval: 60_000,
    retry: (count, error) => !(error instanceof ApiError && [400, 401, 403, 404].includes(error.status)) && count < 2,
  });

  if (query.status === 'pending') return <OrderSkeleton label={m.loading} />;
  if (query.status === 'error') {
    const status = query.error instanceof ApiError ? query.error.status : 0;
    const access = status === 401 || status === 403;
    const missing = access || status === 404 || status === 400;
    return (
      <section className="flex flex-col items-center gap-3 rounded-card bg-linen px-5 py-10 text-center shadow-outline-hairline">
        <h1 className="m-0 text-17 font-bold text-night">{missing ? m.orderNotFoundTitle : m.orderLoadError}</h1>
        {missing ? <p className="m-0 text-14 text-ink-2">{access ? m.orderNeedsAccessBody : m.orderNotFoundBody}</p> : null}
        {access ? (
          <Link href={signInHref(routes.order(orderNumber))} className={buttonVariants({ variant: 'ink' })}>
            {m.orderSignIn}
          </Link>
        ) : missing ? (
          <Link href={routes.myOrders} className={buttonVariants({ variant: 'light' })}>
            {m.myOrdersBack}
          </Link>
        ) : (
          <Button variant="light" onClick={() => query.refetch()}>
            {m.checkoutRetry}
          </Button>
        )}
      </section>
    );
  }

  return placed ? <OrderConfirmation order={query.data} /> : <OrderDetail order={query.data} />;
}

function OrderSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="flex flex-col gap-4">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-64 w-full rounded-card" />
    </div>
  );
}
