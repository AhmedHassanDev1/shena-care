'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageBox } from '@/components/ui/message-box';
import { StatusChip } from '@/components/ui/status-chip';
import { Button, buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { Timeline, type TimelineItem } from '@/components/ui/timeline';
import { ApiError } from '@/lib/api-client';
import { createIdempotencyKey } from '@/lib/idempotency';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { formatDate, formatEgp, formatPackSize } from '@/lib/i18n/format';
import { fillMessage, type Messages } from '@/lib/i18n/messages';
import { orders, type AvailabilityAction, type AvailabilityDecision, type OrderTracking } from '@/lib/orders';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { OrderActions } from './OrderActions';
import { ReportProblem } from './ReportProblem';

/** Backend default; any other promise string is shown as the generic confirmation note too. */
const STAGE_KEY = (stage: OrderTracking['status']) => `orderStage${stage}` as keyof Messages;
const ITEM_KEY: Record<OrderTracking['items'][number]['status'], keyof Messages> = {
  checking: 'orderItemchecking',
  confirmed: 'orderItemconfirmed',
  'action-required': 'orderItemactionRequired',
  resolved: 'orderItemresolved',
};

/**
 * Customer-safe order tracking (GLO-74 projection). Nothing about sourcing or fulfilment is derived
 * here: stage, timeline, item states and COD amounts are rendered as the API reports them. When the
 * API reports ACTION_REQUIRED, the decision panel takes over the top of the page. Refreshes every
 * minute and on focus until live updates (W25) exist.
 */
export function OrderTrackingView({ orderNumber }: { orderNumber: string }) {
  const m = useMessages();
  const placed = useSearchParams().get('placed') === '1';
  const query = useQuery({
    queryKey: ['order-tracking', orderNumber],
    queryFn: () => orders.getTracking(orderNumber),
    refetchInterval: 60_000,
    retry: (count, error) => !(error instanceof ApiError && [400, 401, 403, 404].includes(error.status)) && count < 2,
  });

  if (query.status === 'pending') return <TrackingSkeleton label={m.loading} />;
  if (query.status === 'error') {
    const status = query.error instanceof ApiError ? query.error.status : 0;
    const access = status === 401 || status === 403;
    return (
      <section className="mx-auto max-w-xl rounded-card border border-line bg-linen px-5 py-8 text-center">
        <h1 className="text-title text-night">{access || status === 404 || status === 400 ? m.orderNotFoundTitle : m.orderLoadError}</h1>
        <p className="mt-2 text-14 text-ink-2">{access ? m.orderNeedsAccessBody : status === 404 || status === 400 ? m.orderNotFoundBody : null}</p>
        <div className="mt-5 flex justify-center gap-3">
          {access ? (
            <Link href={routes.login} className={buttonVariants()}>
              {m.orderSignIn}
            </Link>
          ) : (
            <Button variant="light" onClick={() => query.refetch()}>
              {m.tryAgain}
            </Button>
          )}
        </div>
      </section>
    );
  }

  return <Tracking order={query.data} placed={placed} />;
}

function Tracking({ order, placed }: { order: OrderTracking; placed: boolean }) {
  const m = useMessages();
  const locale = useLocale();
  // Kept here, not in the decision panel: the panel disappears once the API reports no action required.
  const [receipt, setReceipt] = useState<AvailabilityDecision['receipt']>(null);
  const [problemSent, setProblemSent] = useState(false);
  const money = (value: number) => formatEgp(value, order.amounts.currency, locale) ?? '';
  const { delivery } = order;

  const steps: TimelineItem[] = order.timeline.map((event, index) => ({
    id: `${event.status}-${index}`,
    label: m[STAGE_KEY(event.status)] as string,
    detail: formatDate(event.occurredAt, locale),
    dot: index === order.timeline.length - 1 ? 'now' : 'done',
  }));

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {placed ? (
        <MessageBox tone="ok">
          <div className="text-14">
            <p className="font-semibold">{m.orderPlacedTitle}</p>
            <p>{m.orderPlacedBody}</p>
          </div>
        </MessageBox>
      ) : null}

      <header className="space-y-1">
        <p className="text-12 text-ink-2">
          <bdi>{fillMessage(m.orderNumber, { n: order.orderNumber })}</bdi> · {fillMessage(m.orderPlacedOn, { date: formatDate(order.createdAt, locale) })}
        </p>
        <h1 className="text-display-3 text-night">{m[STAGE_KEY(order.status)] as string}</h1>
        <p className="flex items-start gap-2 text-14 text-ink-2">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
          {delivery.deliveredAt
            ? fillMessage(m.orderDeliveredOn, { date: formatDate(delivery.deliveredAt, locale) })
            : delivery.estimatedDate
              ? fillMessage(m.orderEstimated, { date: formatDate(delivery.estimatedDate, locale) })
              : m.orderPromise}
        </p>
        {delivery.nextUpdateBy ? (
          <p className="text-14 text-ink-2">{fillMessage(m.orderNextUpdate, { date: formatDate(delivery.nextUpdateBy, locale) })}</p>
        ) : null}
      </header>

      {receipt ? (
        <MessageBox tone="ok">
          <p className="text-14">
            {fillMessage(m.decisionReceipt, {
              before: formatEgp(receipt.amounts.codBefore, receipt.amounts.currency, locale) ?? '',
              after: formatEgp(receipt.amounts.codAfter, receipt.amounts.currency, locale) ?? '',
            })}
          </p>
        </MessageBox>
      ) : null}

      {problemSent ? (
        <MessageBox tone="ok">
          <p className="text-14">{m.problemSent}</p>
        </MessageBox>
      ) : null}

      {order.actionRequired ? <DecisionPanel orderNumber={order.orderNumber} onResolved={setReceipt} /> : null}

      <Section title={m.orderItems}>
        <ul className="divide-y divide-line">
          {order.items.map((item) => {
            const gone = item.lineState === 'removed' || item.lineState === 'replaced';
            return (
              <li key={item.id} className="py-3 text-14">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p dir="auto" className={cn('text-night text-match-parent', gone && 'text-ink-3 line-through')}>
                      {item.productName}
                      {item.variantName ? <span className="text-ink-3"> · <bdi>{item.variantName}</bdi></span> : null}
                      <span className="text-ink-3"> × <bdi>{item.quantity}</bdi></span>
                    </p>
                    <StatusChip tone={item.status === 'action-required' ? 'warn' : item.status === 'confirmed' ? 'ok' : 'gray'}>
                      {gone ? (item.lineState === 'removed' ? m.orderItemRemoved : m.orderItemReplaced) : (m[ITEM_KEY[item.status]] as string)}
                    </StatusChip>
                  </div>
                  <bdi className={cn('shrink-0 tabular-nums text-night', gone && 'text-ink-3 line-through')}>{money(item.lineTotal)}</bdi>
                </div>
                {gone ? null : (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <BuyAgainItemButton orderNumber={order.orderNumber} skuId={item.skuId} />
                    <ReportProblem
                      orderNumber={order.orderNumber}
                      itemId={item.id}
                      maxQuantity={item.quantity}
                      onSent={() => setProblemSent(true)}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title={m.orderAmounts}>
        <dl className="space-y-2 text-14">
          <Row label={m.checkoutSubtotal} value={money(order.amounts.subtotal)} />
          <Row label={m.checkoutShipping} value={order.amounts.shippingFee === 0 ? m.checkoutFree : money(order.amounts.shippingFee)} />
          <div className="flex justify-between gap-3 border-t border-line pt-2">
            <dt className="text-14 font-semibold text-night">{m.orderCodNow}</dt>
            <dd className="text-price tabular-nums text-night">
              <bdi>{money(order.amounts.currentCodAmount)}</bdi>
            </dd>
          </div>
          {order.amounts.originalCodAmount !== order.amounts.currentCodAmount ? (
            <p className="text-12 text-ink-3">{fillMessage(m.orderCodWas, { amount: money(order.amounts.originalCodAmount) })}</p>
          ) : null}
        </dl>
      </Section>

      {steps.length ? (
        <Section title={m.orderTimeline}>
          <Timeline items={steps} label={m.orderTimeline} />
        </Section>
      ) : null}

      <Section title={m.orderAddress}>
        <p className="text-14 text-night">{order.customerName}</p>
        <p className="text-14 text-ink-2">
          {[order.deliveryAddress.address, order.deliveryAddress.area, order.deliveryAddress.governorate].filter(Boolean).join('، ')}
        </p>
        {order.deliveryAddress.latitude && order.deliveryAddress.longitude ? (
          <div className="flex flex-wrap items-center gap-2 pt-1 text-12 text-ink-2">
            <Icon name="pin" size={16} className="text-blue" />
            <span>{m.orderConfirmedLocation}:</span>
            <bdi>
              {order.deliveryAddress.latitude.toFixed(4)}, {order.deliveryAddress.longitude.toFixed(4)}
            </bdi>
            <StatusChip tone="ok" className="px-1.5 py-0 text-12">
              {m.checkoutMapConfirmed}
            </StatusChip>
          </div>
        ) : null}
      </Section>

      {order.resolutions.length ? (
        <Section title={m.orderResolutions}>
          <ul className="space-y-2 text-14">
            {order.resolutions.map((resolution, index) => (
              <li key={index} className="space-y-1">
                <StatusChip tone="gray">{m[`orderResolutionStatus${resolution.status}` as keyof Messages] as string}</StatusChip>
                {resolution.refund ? (
                  <p className="text-ink-2">
                    {fillMessage(m.orderRefund, {
                      amount: formatEgp(resolution.refund.amount, resolution.refund.currency, locale) ?? '',
                      status: resolution.refund.status,
                    })}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <OrderActions order={order} />
    </div>
  );
}

/** Availability decisions (GLO-190): every option shows the server's own preview of the new COD amount. */
function DecisionPanel({
  orderNumber,
  onResolved,
}: {
  orderNumber: string;
  onResolved: (receipt: AvailabilityDecision['receipt']) => void;
}) {
  const m = useMessages();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const keys = useRef(new Map<string, string>());
  const [choice, setChoice] = useState<{ decisionId: string; action: AvailabilityAction; skuId?: string } | null>(null);
  const [state, setState] = useState<'idle' | 'pending' | 'failed' | 'stale'>('idle');
  const decisions = useQuery({ queryKey: ['order-decisions', orderNumber], queryFn: () => orders.listDecisions(orderNumber) });

  const pending = decisions.data?.filter((decision) => decision.status === 'pending') ?? [];
  const money = (value: number, currency: string) => formatEgp(value, currency, locale) ?? '';

  const confirm = async (decision: AvailabilityDecision) => {
    if (!choice || choice.decisionId !== decision.id) return;
    // One key per decision version and choice, so a retried tap is applied at most once.
    const keyId = `${decision.id}:${decision.version}:${choice.action}:${choice.skuId ?? ''}`;
    if (!keys.current.has(keyId)) keys.current.set(keyId, createIdempotencyKey());
    setState('pending');
    try {
      const result = await orders.decide(orderNumber, decision.id, {
        action: choice.action,
        candidateSkuId: choice.skuId,
        version: decision.version,
        idempotencyKey: keys.current.get(keyId)!,
      });
      onResolved(result.receipt);
      setChoice(null);
      setState('idle');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['order-decisions', orderNumber] }),
        queryClient.invalidateQueries({ queryKey: ['order-tracking', orderNumber] }),
      ]);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setState('stale');
        setChoice(null);
        decisions.refetch();
      } else {
        setState('failed');
      }
    }
  };

  return (
    <section aria-labelledby="decision-title" className="space-y-4 rounded-card border border-saffron-ink bg-saffron-tint p-4">
      <h2 id="decision-title" className="flex items-center gap-2 text-title text-saffron-ink">
        <Icon name="alert" size={20} />
        {m.decisionTitle}
      </h2>
      {state === 'failed' ? <p role="alert" className="text-14 text-err">{m.decisionFailed}</p> : null}
      {state === 'stale' ? <p role="status" className="text-14 text-night">{m.decisionStale}</p> : null}
      {decisions.isPending ? <p className="text-14 text-ink-2">{m.decisionLoading}</p> : null}

      {pending.map((decision) => {
        const name = decision.original.productName ?? '';
        const options: Array<{ action: AvailabilityAction; skuId?: string; label: string; detail: string }> = [];
        if (decision.availableActions.includes('REPLACE_WITH')) {
          for (const candidate of decision.candidates) {
            const size = formatPackSize(candidate.size, candidate.sizeUnit, locale) ?? candidate.variantName;
            const delta = candidate.preview.priceDelta;
            options.push({
              action: 'REPLACE_WITH',
              skuId: candidate.skuId,
              label: fillMessage(m.decisionReplaceWith, { variant: size }),
              detail: `${money(candidate.unitPrice, candidate.currency)}${delta ? ` · ${fillMessage(m.decisionPriceDelta, { delta: `${delta > 0 ? '+' : '−'}${money(Math.abs(delta), candidate.currency)}` })}` : ''} · ${fillMessage(m.decisionCodAfter, { amount: money(candidate.preview.codAfter, candidate.currency) })}`,
            });
          }
        }
        if (decision.availableActions.includes('CONTINUE_WITHOUT_ITEM') && decision.previews.continueWithoutItem) {
          options.push({
            action: 'CONTINUE_WITHOUT_ITEM',
            label: m.decisionContinue,
            detail: fillMessage(m.decisionCodAfter, { amount: money(decision.previews.continueWithoutItem.codAfter, decision.original.currency) }),
          });
        }
        if (decision.availableActions.includes('CANCEL_ORDER')) {
          options.push({
            action: 'CANCEL_ORDER',
            label: m.decisionCancel,
            detail: fillMessage(m.decisionCodAfter, { amount: money(decision.previews.cancelOrder.codAfter, decision.original.currency) }),
          });
        }
        return (
          <fieldset key={decision.id} className="space-y-3">
            <legend className="text-14 text-night">
              {fillMessage(m.decisionIntro, { qty: decision.unresolvedQuantity, name })}
            </legend>
            {options.map((option) => {
              const selected = choice?.decisionId === decision.id && choice.action === option.action && choice.skuId === option.skuId;
              return (
                <label
                  key={`${option.action}-${option.skuId ?? ''}`}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-input border bg-linen p-3',
                    selected ? 'border-night' : 'border-line',
                  )}
                >
                  <input
                    type="radio"
                    name={`decision-${decision.id}`}
                    className="mt-1 size-4 accent-blue"
                    checked={selected}
                    onChange={() => setChoice({ decisionId: decision.id, action: option.action, skuId: option.skuId })}
                  />
                  <span className="space-y-0.5">
                    <span className={cn('block text-14 text-night', selected && 'font-semibold')}>{option.label}</span>
                    <span className="block text-12 text-ink-2">{option.detail}</span>
                  </span>
                </label>
              );
            })}
            <Button
              className="w-full"
              disabled={choice?.decisionId !== decision.id}
              loading={state === 'pending' && choice?.decisionId === decision.id}
              onClick={() => confirm(decision)}
            >
              {m.decisionConfirm}
            </Button>
          </fieldset>
        );
      })}
    </section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-card border border-line bg-linen p-4">
      <h2 className="text-title text-night">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-2">{label}</dt>
      <dd className="tabular-nums text-night">
        <bdi>{value}</bdi>
      </dd>
    </div>
  );
}

function TrackingSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="mx-auto max-w-2xl space-y-4">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-32 w-full rounded-card" />
    </div>
  );
}

function BuyAgainItemButton({ orderNumber, skuId }: { orderNumber: string; skuId: string }) {
  const m = useMessages();
  const queryClient = useQueryClient();
  const [state, setState] = useState<'idle' | 'pending' | 'success' | 'unavailable' | 'error'>('idle');

  const handleReorder = async () => {
    setState('pending');
    try {
      const res = await orders.reorder(orderNumber, [skuId]);
      await queryClient.invalidateQueries({ queryKey: ['cart'] });
      if (res.summary.totalAdded > 0) {
        setState('success');
      } else {
        setState('unavailable');
      }
    } catch {
      setState('error');
    }
  };

  if (state === 'success') {
    return (
      <div className="flex items-center gap-2">
        <StatusChip tone="ok">
          <Icon name="check" size={14} />
          <span>{m.buyAgainItemAdded}</span>
        </StatusChip>
        <Link href={routes.cart} className={buttonVariants({ size: 's', variant: 'light' })}>
          {m.buyAgainViewCart}
        </Link>
      </div>
    );
  }

  if (state === 'unavailable') {
    return (
      <StatusChip tone="gray">
        <span>{m.buyAgainItemUnavailable}</span>
      </StatusChip>
    );
  }

  return (
    <Button
      variant="light"
      size="s"
      loading={state === 'pending'}
      onClick={handleReorder}
    >
      <Icon name="retry" size={14} />
      <span>{m.buyAgainItem}</span>
    </Button>
  );
}

