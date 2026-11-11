'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLink } from '@/components/ui/arrow-link';
import { Button, buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { MessageBox } from '@/components/ui/message-box';
import { Money } from '@/components/ui/money';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusChip } from '@/components/ui/status-chip';
import { CART_QUERY_KEY } from '@/features/cart/hooks/useCart';
import { useSkuCatalog } from '@/features/orders/hooks/useSkuCatalog';
import { isFinished, stageLabel, stageTone } from '@/features/orders/lib/order-stages';
import { formatDate, formatNumber, formatProductCount } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { orders as ordersApi, type MyOrder } from '@/lib/orders';
import { routes } from '@/lib/routes';

export interface ProfileOrdersSectionProps {
  orders: MyOrder[];
  total: number;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

const PREVIEW_LIMIT = 3;
const THUMB_LIMIT = 2;

function prioritizeOrders(list: MyOrder[]): MyOrder[] {
  const rank = (stage: MyOrder['stage']) => {
    if (stage === 'ACTION_REQUIRED') return 0;
    if (!isFinished(stage)) return 1;
    return 2;
  };
  return [...list].sort((a, b) => rank(a.stage) - rank(b.stage));
}

/**
 * Customer Orders overview inside Profile (/account).
 * Surfaces orders needing action or in progress first, links cleanly to live tracking (/orders/[id]),
 * and supports one-tap reorder into the authenticated cart.
 */
export function ProfileOrdersSection({
  orders,
  total,
  isLoading,
  error,
  onRetry,
}: ProfileOrdersSectionProps) {
  const m = useMessages();
  const locale = useLocale();
  const queryClient = useQueryClient();

  const visibleOrders = prioritizeOrders(orders).slice(0, PREVIEW_LIMIT);
  const catalog = useSkuCatalog(visibleOrders.flatMap((o) => o.skuIds.slice(0, THUMB_LIMIT)));

  const [reorderingNumber, setReorderingNumber] = useState<string | null>(null);
  const [reorderResult, setReorderResult] = useState<{
    orderNumber: string;
    tone: 'ok' | 'warn' | 'err';
    text: string;
    showCartLink: boolean;
  } | null>(null);

  const handleReorder = async (orderNumber: string) => {
    if (reorderingNumber) return;
    setReorderingNumber(orderNumber);
    setReorderResult(null);

    try {
      const res = await ordersApi.reorder(orderNumber);
      queryClient.setQueryData(CART_QUERY_KEY, res.cart);
      const { totalAdded, totalSkipped } = res.summary;

      if (totalAdded === 0) {
        setReorderResult({
          orderNumber,
          tone: 'warn',
          text: m.buyAgainUnavailable,
          showCartLink: false,
        });
      } else if (totalSkipped > 0) {
        setReorderResult({
          orderNumber,
          tone: 'warn',
          text: fillMessage(m.buyAgainPartial, {
            added: formatNumber(totalAdded, locale),
            skipped: formatNumber(totalSkipped, locale),
          }),
          showCartLink: true,
        });
      } else {
        setReorderResult({
          orderNumber,
          tone: 'ok',
          text: fillMessage(m.buyAgainSuccess, { n: formatProductCount(totalAdded, locale) }),
          showCartLink: true,
        });
      }
    } catch {
      setReorderResult({
        orderNumber,
        tone: 'err',
        text: m.myOrdersLoadFailed,
        showCartLink: false,
      });
    } finally {
      setReorderingNumber(null);
    }
  };

  const activeCount = orders.filter((o) => !isFinished(o.stage)).length;

  return (
    <section id="account-orders" aria-labelledby="profile-orders-heading" className="scroll-mt-24">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <h2
            id="profile-orders-heading"
            className="m-0 font-display text-display-3 font-extrabold text-ink"
          >
            {m.myOrdersTitle}
          </h2>
          {!isLoading && activeCount > 0 ? (
            <StatusChip tone="cobalt">
              {fillMessage(m.profileActiveOrdersCount, { n: formatNumber(activeCount, locale) })}
            </StatusChip>
          ) : null}
        </div>

        {total > 0 ? (
          <ArrowLink href={routes.myOrders} className="text-15">
            {fillMessage(m.profileOrdersAllLink, { n: formatNumber(total, locale) })}
          </ArrowLink>
        ) : null}
      </div>

      {isLoading ? (
        <div className="divide-y divide-line rounded-card border border-line bg-linen">
          {[0, 1].map((idx) => (
            <div key={idx} className="flex items-center justify-between gap-4 p-5">
              <div className="flex items-center gap-3.5">
                <Skeleton className="size-12 rounded-image" />
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-44" />
                </div>
              </div>
              <Skeleton className="h-7 w-24 rounded-pill" />
            </div>
          ))}
        </div>
      ) : error ? (
        <MessageBox tone="err" className="flex flex-col items-start gap-3">
          <span>{m.myOrdersLoadFailed}</span>
          <Button type="button" variant="ghost" size="s" onClick={onRetry}>
            <Icon name="retry" size={16} />
            <span>{m.profileRetry}</span>
          </Button>
        </MessageBox>
      ) : visibleOrders.length === 0 ? (
        <div className="rounded-card border border-line bg-linen p-6 text-start">
          <div className="flex items-start gap-3.5">
            <span className="grid size-10 flex-none place-items-center rounded-pill bg-chalk text-cobalt shadow-outline-control">
              <Icon name="bag" size={20} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className="m-0 font-display text-17 font-bold text-ink">{m.myOrdersEmpty}</p>
              <p className="m-0 text-15 leading-22 text-stone">{m.profileOrdersEmptyHint}</p>
              <div className="pt-2">
                <Link href={routes.products} className={buttonVariants({ variant: 'cobalt', size: 'm' })}>
                  {m.profileBrowseProducts}
                </Link>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <ul className="m-0 list-none divide-y divide-line rounded-card border border-line bg-linen p-0">
          {visibleOrders.map((order) => {
            const thumbs = order.skuIds.slice(0, THUMB_LIMIT);
            const overflow = Math.max(0, order.skuIds.length - THUMB_LIMIT);
            const finished = isFinished(order.stage);
            const needsDecision = order.stage === 'ACTION_REQUIRED';
            const feedbackForOrder =
              reorderResult && reorderResult.orderNumber === order.orderNumber ? reorderResult : null;

            return (
              <li key={order.id} className="flex flex-col gap-3.5 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3.5">
                    <div className="flex flex-none items-center gap-1.5">
                      {thumbs.length > 0 ? (
                        thumbs.map((skuId) => {
                          const entry = catalog[skuId];
                          return (
                            <span
                              key={skuId}
                              className="grid size-12 flex-none place-items-center overflow-hidden rounded-image border border-line bg-chalk"
                            >
                              {entry?.image?.url ? (
                                <img
                                  src={entry.image.url}
                                  alt={entry.image.alt || ''}
                                  className="size-full object-cover"
                                  loading="lazy"
                                />
                              ) : (
                                <Icon name="bag" size={18} className="text-stone" />
                              )}
                            </span>
                          );
                        })
                      ) : (
                        <span className="grid size-12 flex-none place-items-center rounded-image border border-line bg-chalk text-stone">
                          <Icon name="package" size={20} />
                        </span>
                      )}
                      {overflow > 0 ? (
                        <span className="grid size-8 place-items-center rounded-pill border border-line bg-sand px-1.5 font-display text-12 font-bold text-ink">
                          {fillMessage(m.profileOrderCountSuffix, { n: formatNumber(overflow, locale) })}
                        </span>
                      ) : null}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <bdi dir="ltr" className="font-display text-17 font-extrabold tabular-nums text-ink">
                          #{order.orderNumber}
                        </bdi>
                        <StatusChip tone={stageTone(order.stage)}>{stageLabel(order.stage, m)}</StatusChip>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-14 text-stone">
                        <span>{formatDate(order.createdAt, locale)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatProductCount(order.itemCount, locale)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 sm:flex-col sm:items-end sm:gap-1.5">
                    <Money
                      amount={order.currentCodAmount}
                      className="font-display text-18 font-extrabold text-ink"
                    />
                  </div>
                </div>

                {feedbackForOrder ? (
                  <MessageBox tone={feedbackForOrder.tone} className="py-2.5 text-14" role="status">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>{feedbackForOrder.text}</span>
                      {feedbackForOrder.showCartLink ? (
                        <Link href={routes.cart} className="text-link text-14">
                          {m.buyAgainViewCart}
                        </Link>
                      ) : null}
                    </div>
                  </MessageBox>
                ) : null}

                <div className="flex flex-wrap items-center gap-3 pt-0.5">
                  <Link
                    href={routes.order(order.orderNumber)}
                    className={buttonVariants({
                      variant: needsDecision ? 'cobalt' : 'ghost',
                      size: 's',
                    })}
                  >
                    <span>{needsDecision ? m.profileOrdersActionNeeded : m.profileOrderViewDetails}</span>
                  </Link>

                  {finished ? (
                    <Button
                      type="button"
                      variant="text"
                      size="s"
                      loading={reorderingNumber === order.orderNumber}
                      disabled={Boolean(reorderingNumber)}
                      pendingLabel={m.buyAgainAdding}
                      onClick={() => void handleReorder(order.orderNumber)}
                    >
                      {m.buyAgainOrder}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
