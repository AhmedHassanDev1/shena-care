'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { auth } from '@/lib/auth';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { formatDate, formatEgp } from '@/lib/i18n/format';
import { orders } from '@/lib/orders';
import { routes } from '@/lib/routes';

/**
 * "My orders" (C0 W6): the signed-in customer's own orders. A guest who verifies the phone they ordered
 * with sees those orders here on any device; without signing in, only this device's order links work.
 */
export function MyOrdersView() {
  const m = useMessages();
  const locale = useLocale();
  // Read after mount: the token lives in the browser, so server and first client render agree.
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => setSignedIn(!!auth.getToken()), []);
  const query = useQuery({ queryKey: ['my-orders'], queryFn: () => orders.listMine(), enabled: signedIn });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-display-m text-foreground">{m.myOrdersTitle}</h1>
      {!signedIn ? (
        <div className="space-y-3 rounded-md border border-border bg-card p-4">
          <p className="text-body-s text-ink-soft">{m.myOrdersSignIn}</p>
          <Link href={`${routes.login}?returnTo=${encodeURIComponent('/orders')}`} className={buttonVariants()}>{m.myOrdersSignInButton}</Link>
        </div>
      ) : query.isPending ? (
        <Skeleton shape="rect" className="h-32 w-full" />
      ) : query.isError ? (
        <Alert variant="destructive"><p className="text-body-s">{m.myOrdersLoadFailed}</p></Alert>
      ) : query.data.items.length === 0 ? (
        <p className="text-body-s text-ink-soft">{m.myOrdersEmpty}</p>
      ) : (
        <ul className="space-y-2">
          {query.data.items.map((order) => (
            <li key={order.id}>
              <Link href={routes.order(order.orderNumber)} className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-4 hover:border-foreground">
                <span className="space-y-1">
                  <bdi className="block text-body-s font-semibold text-foreground">{order.orderNumber}</bdi>
                  <span className="block text-caption text-ink-soft">{formatDate(order.createdAt, locale)}</span>
                </span>
                <bdi className="text-body-s text-foreground">{formatEgp(order.codAmount ?? order.totalAmount, order.currency, locale)}</bdi>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
