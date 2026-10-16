'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { auth } from '@/lib/auth';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { formatDate, formatEgp } from '@/lib/i18n/format';
import { fillMessage } from '@/lib/i18n/messages';
import { orders, type ReorderResult } from '@/lib/orders';
import { routes } from '@/lib/routes';

interface ReorderFeedback {
  orderNumber: string;
  result?: ReorderResult;
  error?: boolean;
}

/**
 * "My orders" (C0 W6): the signed-in customer's own orders. A guest who verifies the phone they ordered
 * with sees those orders here on any device; without signing in, only this device's order links work.
 */
export function MyOrdersView() {
  const m = useMessages();
  const locale = useLocale();
  const queryClient = useQueryClient();
  // Read after mount: the token lives in the browser, so server and first client render agree.
  const [signedIn, setSignedIn] = useState(false);
  const [reorderingNumber, setReorderingNumber] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ReorderFeedback | null>(null);

  useEffect(() => setSignedIn(!!auth.getToken()), []);
  const query = useQuery({ queryKey: ['my-orders'], queryFn: () => orders.listMine(), enabled: signedIn });

  const handleReorder = async (orderNumber: string) => {
    setReorderingNumber(orderNumber);
    setFeedback(null);
    try {
      const result = await orders.reorder(orderNumber);
      await queryClient.invalidateQueries({ queryKey: ['cart'] });
      setFeedback({ orderNumber, result });
    } catch {
      setFeedback({ orderNumber, error: true });
    } finally {
      setReorderingNumber(null);
    }
  };

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
        <ul className="space-y-3">
          {query.data.items.map((order) => {
            const isReordering = reorderingNumber === order.orderNumber;
            const currentFeedback = feedback?.orderNumber === order.orderNumber ? feedback : null;

            return (
              <li key={order.id} className="rounded-md border border-border bg-card overflow-hidden">
                <Link
                  href={routes.order(order.orderNumber)}
                  className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-sand/30"
                >
                  <span className="space-y-1">
                    <bdi className="block text-body-s font-semibold text-foreground">{order.orderNumber}</bdi>
                    <span className="block text-caption text-ink-soft">{formatDate(order.createdAt, locale)}</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <bdi className="text-body-s font-semibold text-foreground">{formatEgp(order.codAmount ?? order.totalAmount, order.currency, locale)}</bdi>
                    <Icon name="chevron-forward" size={16} className="text-ink-subtle" />
                  </div>
                </Link>

                <div className="border-t border-border bg-card px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={isReordering}
                    onClick={() => handleReorder(order.orderNumber)}
                  >
                    <Icon name="refresh" size={16} />
                    <span>{m.buyAgain}</span>
                  </Button>

                  <Link
                    href={routes.order(order.orderNumber)}
                    className="text-caption text-ink-soft hover:text-foreground transition-colors"
                  >
                    {order.status}
                  </Link>
                </div>

                {currentFeedback?.error ? (
                  <div className="p-3 border-t border-border">
                    <Alert variant="destructive">
                      <p className="text-body-s">{m.unexpectedErrorDescription}</p>
                    </Alert>
                  </div>
                ) : currentFeedback?.result ? (
                  <div className="p-3 border-t border-border">
                    {currentFeedback.result.summary.totalAdded > 0 ? (
                      <Alert variant="success">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <p className="text-body-s">
                            {currentFeedback.result.summary.totalSkipped > 0
                              ? fillMessage(m.buyAgainPartial, {
                                  added: currentFeedback.result.summary.totalAdded,
                                  skipped: currentFeedback.result.summary.totalSkipped,
                                })
                              : fillMessage(m.buyAgainSuccess, {
                                  n: currentFeedback.result.summary.totalAdded,
                                })}
                          </p>
                          <Link href={routes.cart} className={buttonVariants({ size: 'sm', variant: 'secondary' })}>
                            {m.buyAgainViewCart}
                          </Link>
                        </div>
                      </Alert>
                    ) : (
                      <Alert variant="warning">
                        <p className="text-body-s">{m.buyAgainUnavailable}</p>
                      </Alert>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
