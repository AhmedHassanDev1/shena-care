'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Button, buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/AuthContext';
import { signInHref } from '@/features/auth/lib/auth-helpers';
import { ApiError } from '@/lib/api-client';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { orders } from '@/lib/orders';
import { routes } from '@/lib/routes';
import { OrderConfirmation } from './OrderConfirmation';
import { OrderDetail } from './OrderDetail';

/**
 * Live Order Tracking Projection (GLO-74):
 * - Displays OrderConfirmation right after checkout (`placed`), or OrderDetail live tracking.
 * - Handles authenticating, not-found, and error states gracefully.
 */
export function OrderTrackingView({
  orderNumber,
  placed = false,
  errorHeadingLevel = 1,
}: {
  orderNumber: string;
  placed?: boolean;
  errorHeadingLevel?: 1 | 2;
}) {
  const m = useMessages();
  const { openAuthModal } = useAuth();
  const ErrorHeading = `h${errorHeadingLevel}` as const;

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
      <section className="mx-auto flex max-w-narrow flex-col items-center gap-4 rounded-sheet bg-linen px-6 py-12 text-center shadow-elevation-1">
        <div className="grid size-14 place-items-center rounded-pill bg-sand text-ink">
          <Icon name="package" size={26} />
        </div>
        <ErrorHeading className="m-0 font-display text-22 font-bold text-ink">
          {missing ? m.orderNotFoundTitle : m.orderLoadError}
        </ErrorHeading>
        {missing ? <p className="m-0 max-w-sm text-14 leading-22 text-stone">{access ? m.orderNeedsAccessBody : m.orderNotFoundBody}</p> : null}
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          {access ? (
            <Link
              href={signInHref(routes.order(orderNumber))}
              onClick={(e) => {
                e.preventDefault();
                openAuthModal();
              }}
              className={buttonVariants({ variant: 'ink', size: 'l' })}
            >
              {m.orderSignIn}
            </Link>
          ) : missing ? (
            <Link href={routes.myOrders} className={buttonVariants({ variant: 'light', size: 'l' })}>
              {m.myOrdersBack}
            </Link>
          ) : (
            <Button variant="light" size="l" onClick={() => query.refetch()}>
              {m.checkoutRetry}
            </Button>
          )}
        </div>
      </section>
    );
  }

  return placed ? <OrderConfirmation order={query.data} /> : <OrderDetail order={query.data} />;
}

function OrderSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="flex flex-col gap-5 rounded-24 bg-linen p-6 lg:p-7">
      <div className="flex justify-between items-center pb-2">
        <Skeleton className="h-4 w-36 rounded-pill" />
        <Skeleton className="h-6 w-24 rounded-pill" />
      </div>
      <Skeleton className="h-14 w-full rounded-24" />
      <Skeleton className="h-44 w-full rounded-24" />
      <Skeleton className="h-32 w-full rounded-24" />
    </div>
  );
}
