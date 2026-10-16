'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { Steps, type StepItem } from '@/components/ui/steps';
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
      <section className="mx-auto max-w-xl rounded-md border border-border bg-card px-5 py-8 text-center">
        <h1 className="text-title text-foreground">{access || status === 404 || status === 400 ? m.orderNotFoundTitle : m.orderLoadError}</h1>
        <p className="mt-2 text-body-s text-muted-foreground">{access ? m.orderNeedsAccessBody : status === 404 || status === 400 ? m.orderNotFoundBody : null}</p>
        <div className="mt-5 flex justify-center gap-3">
          {access ? (
            <Link href={routes.login} className={buttonVariants()}>
              {m.orderSignIn}
            </Link>
          ) : (
            <Button variant="secondary" onClick={() => query.refetch()}>
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

  const steps: StepItem[] = order.timeline.map((event, index) => ({
    id: `${event.status}-${index}`,
    label: m[STAGE_KEY(event.status)] as string,
    detail: <bdi>{formatDate(event.occurredAt, locale)}</bdi>,
    status: index === order.timeline.length - 1 ? 'current' : 'complete',
  }));

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {placed ? (
        <Alert variant="success">
          <div className="text-body-s">
            <p className="font-semibold">{m.orderPlacedTitle}</p>
            <p>{m.orderPlacedBody}</p>
          </div>
        </Alert>
      ) : null}

      <header className="space-y-1">
        <p className="text-caption text-ink-soft">
          <bdi>{fillMessage(m.orderNumber, { n: order.orderNumber })}</bdi> · {fillMessage(m.orderPlacedOn, { date: formatDate(order.createdAt, locale) })}
        </p>
        <h1 className="text-display-m text-foreground">{m[STAGE_KEY(order.status)] as string}</h1>
        <p className="flex items-start gap-2 text-body-s text-ink-soft">
          <Icon name="clock" size={18} className="mt-0.5 shrink-0" />
          {delivery.deliveredAt
            ? fillMessage(m.orderDeliveredOn, { date: formatDate(delivery.deliveredAt, locale) })
            : delivery.estimatedDate
              ? fillMessage(m.orderEstimated, { date: formatDate(delivery.estimatedDate, locale) })
              : m.orderPromise}
        </p>
        {delivery.nextUpdateBy ? (
          <p className="text-body-s text-ink-soft">{fillMessage(m.orderNextUpdate, { date: formatDate(delivery.nextUpdateBy, locale) })}</p>
        ) : null}
      </header>

      {receipt ? (
        <Alert variant="success">
          <p className="text-body-s">
            {fillMessage(m.decisionReceipt, {
              before: formatEgp(receipt.amounts.codBefore, receipt.amounts.currency, locale) ?? '',
              after: formatEgp(receipt.amounts.codAfter, receipt.amounts.currency, locale) ?? '',
            })}
          </p>
        </Alert>
      ) : null}

      {problemSent ? (
        <Alert variant="success">
          <p className="text-body-s">{m.problemSent}</p>
        </Alert>
      ) : null}

      {order.actionRequired ? <DecisionPanel orderNumber={order.orderNumber} onResolved={setReceipt} /> : null}

      <Section title={m.orderItems}>
        <ul className="divide-y divide-border">
          {order.items.map((item) => {
            const gone = item.lineState === 'removed' || item.lineState === 'replaced';
            return (
              <li key={item.id} className="py-3 text-body-s">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p dir="auto" className={cn('text-foreground [text-align:match-parent]', gone && 'text-ink-subtle line-through')}>
                      {item.productName}
                      {item.variantName ? <span className="text-ink-subtle"> · <bdi>{item.variantName}</bdi></span> : null}
                      <span className="text-ink-subtle"> × <bdi>{item.quantity}</bdi></span>
                    </p>
                    <Badge variant={item.status === 'action-required' ? 'warning' : item.status === 'confirmed' ? 'success' : 'neutral'}>
                      {gone ? (item.lineState === 'removed' ? m.orderItemRemoved : m.orderItemReplaced) : (m[ITEM_KEY[item.status]] as string)}
                    </Badge>
                  </div>
                  <bdi className={cn('shrink-0 tabular-nums text-foreground', gone && 'text-ink-subtle line-through')}>{money(item.lineTotal)}</bdi>
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
        <dl className="space-y-2 text-body-s">
          <Row label={m.checkoutSubtotal} value={money(order.amounts.subtotal)} />
          <Row label={m.checkoutShipping} value={order.amounts.shippingFee === 0 ? m.checkoutFree : money(order.amounts.shippingFee)} />
          <div className="flex justify-between gap-3 border-t border-border pt-2">
            <dt className="text-label text-foreground">{m.orderCodNow}</dt>
            <dd className="text-price-l tabular-nums text-foreground">
              <bdi>{money(order.amounts.currentCodAmount)}</bdi>
            </dd>
          </div>
          {order.amounts.originalCodAmount !== order.amounts.currentCodAmount ? (
            <p className="text-caption text-ink-subtle">{fillMessage(m.orderCodWas, { amount: money(order.amounts.originalCodAmount) })}</p>
          ) : null}
        </dl>
      </Section>

      {steps.length ? (
        <Section title={m.orderTimeline}>
          <Steps items={steps} statusLabels={{ complete: m.orderStepComplete, current: m.orderStepCurrent, upcoming: m.orderStepUpcoming }} />
        </Section>
      ) : null}

      <Section title={m.orderAddress}>
        <p className="text-body-s text-foreground">{order.customerName}</p>
        <p className="text-body-s text-ink-soft">
          {[order.deliveryAddress.address, order.deliveryAddress.area, order.deliveryAddress.governorate].filter(Boolean).join('، ')}
        </p>
        {order.deliveryAddress.latitude && order.deliveryAddress.longitude ? (
          <div className="flex flex-wrap items-center gap-2 pt-1 text-caption text-ink-soft">
            <Icon name="pin" size={16} className="text-primary" />
            <span>{m.orderConfirmedLocation}:</span>
            <bdi>
              {order.deliveryAddress.latitude.toFixed(4)}, {order.deliveryAddress.longitude.toFixed(4)}
            </bdi>
            <Badge variant="success" className="px-1.5 py-0 text-caption">
              {m.checkoutMapConfirmed}
            </Badge>
          </div>
        ) : null}
      </Section>

      {order.resolutions.length ? (
        <Section title={m.orderResolutions}>
          <ul className="space-y-2 text-body-s">
            {order.resolutions.map((resolution, index) => (
              <li key={index} className="space-y-1">
                <Badge variant="neutral">{m[`orderResolutionStatus${resolution.status}` as keyof Messages] as string}</Badge>
                {resolution.refund ? (
                  <p className="text-ink-soft">
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
    <section aria-labelledby="decision-title" className="space-y-4 rounded-md border-[1.5px] border-attention-ink bg-attention-soft p-4">
      <h2 id="decision-title" className="flex items-center gap-2 text-heading text-attention-ink">
        <Icon name="alert" size={20} />
        {m.decisionTitle}
      </h2>
      {state === 'failed' ? <p role="alert" className="text-body-s text-destructive">{m.decisionFailed}</p> : null}
      {state === 'stale' ? <p role="status" className="text-body-s text-foreground">{m.decisionStale}</p> : null}
      {decisions.isPending ? <p className="text-body-s text-ink-soft">{m.decisionLoading}</p> : null}

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
            <legend className="text-body-s text-foreground">
              {fillMessage(m.decisionIntro, { qty: decision.unresolvedQuantity, name })}
            </legend>
            {options.map((option) => {
              const selected = choice?.decisionId === decision.id && choice.action === option.action && choice.skuId === option.skuId;
              return (
                <label
                  key={`${option.action}-${option.skuId ?? ''}`}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-sm border-[1.5px] bg-card p-3',
                    selected ? 'border-foreground' : 'border-border',
                  )}
                >
                  <input
                    type="radio"
                    name={`decision-${decision.id}`}
                    className="mt-1 size-4 accent-primary"
                    checked={selected}
                    onChange={() => setChoice({ decisionId: decision.id, action: option.action, skuId: option.skuId })}
                  />
                  <span className="space-y-0.5">
                    <span className={cn('block text-body-s text-foreground', selected && 'font-semibold')}>{option.label}</span>
                    <span className="block text-caption text-ink-soft">{option.detail}</span>
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
    <section className="space-y-2 rounded-md border border-border bg-card p-4">
      <h2 className="text-heading text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="tabular-nums text-foreground">
        <bdi>{value}</bdi>
      </dd>
    </div>
  );
}

function TrackingSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="mx-auto max-w-2xl space-y-4">
      <Skeleton shape="pill" className="h-4 w-40" />
      <Skeleton shape="pill" className="h-8 w-2/3" />
      <Skeleton className="h-32 w-full rounded-md" />
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
        <Badge variant="success">
          <Icon name="check" size={14} />
          <span>{m.buyAgainItemAdded}</span>
        </Badge>
        <Link href={routes.cart} className={buttonVariants({ size: 'sm', variant: 'ghost' })}>
          {m.buyAgainViewCart}
        </Link>
      </div>
    );
  }

  if (state === 'unavailable') {
    return (
      <Badge variant="neutral">
        <span>{m.buyAgainItemUnavailable}</span>
      </Badge>
    );
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      loading={state === 'pending'}
      onClick={handleReorder}
    >
      <Icon name="refresh" size={14} />
      <span>{m.buyAgainItem}</span>
    </Button>
  );
}

