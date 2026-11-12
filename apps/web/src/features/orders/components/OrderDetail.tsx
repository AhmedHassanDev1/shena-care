'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AsyncButton, Button, buttonVariants } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TextAreaField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { MessageBox } from '@/components/ui/message-box';
import { Money } from '@/components/ui/money';
import { ProductTile } from '@/components/ui/product-tile';
import { StatusChip } from '@/components/ui/status-chip';
import { Timeline } from '@/components/ui/timeline';
import { ApiError } from '@/lib/api-client';
import { createIdempotencyKey } from '@/lib/idempotency';
import { formatDate, formatEgp, formatNumber, formatPackSize, formatProductCount, isolateLtr } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage, type Messages } from '@/lib/i18n/messages';
import {
  SUPPORT_TOPICS,
  orders,
  type AvailabilityAction,
  type AvailabilityDecision,
  type CustomerStage,
  type OrderTracking,
  type ReorderResult,
  type SupportTopic,
} from '@/lib/orders';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { useSkuCatalog } from '../hooks/useSkuCatalog';
import { addressLine, stageLabel, stageTone, trackingSteps } from '../lib/order-stages';
import { ReportProblem } from './ReportProblem';

/**
 * Editorial Order Detail & Live Tracking (OrdersD, CommerceMobile ٧, CommerceStates §٥):
 * - Visual live stage progression ribbon with pulse indicator
 * - Dynamic Action Required decision atelier
 * - Itemized product cards with packshot stage, quantities, and line totals
 * - Courier delivery and cash-on-delivery inspection reassurance
 * - Self-service cancellation, reorder, and customer care ticket filing
 */
export function OrderDetail({ order }: { order: OrderTracking }) {
  const m = useMessages();
  const locale = useLocale();
  const [receipt, setReceipt] = useState<AvailabilityDecision['receipt']>(null);
  const [problemSent, setProblemSent] = useState(false);
  const catalog = useSkuCatalog(order.items.map((item) => item.skuId));
  const delivered = order.status === 'DELIVERED';
  const finished = delivered || order.status === 'CANCELLED';
  const count = order.items.filter((item) => item.lineState !== 'removed').reduce((sum, item) => sum + item.quantity, 0);
  const address = addressLine(order.deliveryAddress, m);
  const promise = order.delivery.deliveredAt
    ? fillMessage(m.orderDeliveredOn, { date: formatDate(order.delivery.deliveredAt, locale) })
    : order.delivery.estimatedDate
      ? fillMessage(m.orderEstimated, { date: formatDate(order.delivery.estimatedDate, locale) })
      : m.checkoutDeliveryPromise;

  return (
    <article className="flex flex-col gap-6 rounded-24 bg-linen p-5 shadow-elevation-1 lg:rounded-sheet lg:p-7 lg:shadow-elevation-2">
      {/* Header bar */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-13 font-medium text-stone">
            <span>{fillMessage(m.orderPlacedOnLong, { date: formatDate(order.createdAt, locale) })}</span>
            <span>·</span>
            <span>{formatProductCount(count, locale)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-14 font-medium text-stone">{m.orderNumber}:</span>
            <bdi dir="ltr" className="font-display text-24 font-extrabold tabular-nums text-ink lg:text-28">
              {order.orderNumber}
            </bdi>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <StatusChip tone={stageTone(order.status)} className="px-3.5 py-1 text-13 font-bold">
            {stageLabel(order.status, m)}
          </StatusChip>
        </div>
      </header>

      {receipt ? (
        <MessageBox tone="ok" role="status" className="rounded-16">
          {fillMessage(m.decisionReceipt, {
            before: formatEgp(receipt.amounts.codBefore, receipt.amounts.currency, locale) ?? '',
            after: formatEgp(receipt.amounts.codAfter, receipt.amounts.currency, locale) ?? '',
          })}
        </MessageBox>
      ) : null}

      {problemSent ? (
        <MessageBox tone="ok" role="status" className="rounded-16">
          {m.problemSent}
        </MessageBox>
      ) : null}

      {/* Decision panel when warehouse items need customer selection */}
      {order.actionRequired ? <DecisionPanel orderNumber={order.orderNumber} onResolved={setReceipt} /> : null}

      {/* Live Visual Stage Stepper */}
      <OrderVisualProgress order={order} />

      {/* Detailed tracking timestamps timeline */}
      <div className="rounded-24 bg-chalk/50 p-4.5">
        <h3 className="m-0 mb-3 font-display text-16 font-bold text-ink">{m.orderTimeline}</h3>
        <Timeline items={trackingSteps(order, m, locale)} label={m.orderTimeline} />
      </div>

      {/* Ordered items breakdown */}
      <section aria-labelledby="od-items" className="flex flex-col gap-3.5 border-t border-line pt-5">
        <div className="flex items-center justify-between">
          <h2 id="od-items" className="m-0 font-display text-20 font-bold text-ink">
            {m.orderItems}
          </h2>
          <span className="rounded-pill bg-sand/70 px-2.5 py-0.5 text-12 font-bold text-ink">
            {formatProductCount(count, locale)}
          </span>
        </div>

        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {order.items.map((item) => {
            const gone = item.lineState === 'removed' || item.lineState === 'replaced';
            const entry = catalog[item.skuId];
            const size = (entry ? formatPackSize(entry.size, entry.sizeUnit, locale) : null) ?? item.variantName ?? '';
            const name = item.productName ?? '';

            return (
              <li
                key={item.id}
                className={cn(
                  'flex flex-col gap-3 rounded-24 bg-chalk/40 p-3.5 transition-all lg:p-4',
                  gone && 'opacity-60'
                )}
              >
                <div className="flex items-center gap-3.5">
                  <ProductTile
                    size="thumb"
                    className={cn('h-16 w-13 flex-none rounded-image shadow-hairline-bottom', gone && 'opacity-50')}
                    src={entry?.image?.url ?? null}
                    alt=""
                    name={name}
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span dir="auto" className={cn('text-match-parent text-15 font-bold text-ink', gone && 'text-stone line-through')}>
                      {name}
                    </span>
                    <span className="text-12.5 text-stone">
                      {fillMessage(m.checkoutLineMeta, { size, qty: formatNumber(item.quantity, locale) })}
                    </span>
                    {gone || item.status === 'action-required' ? (
                      <StatusChip tone={gone ? 'gray' : 'warn'} className="mt-0.5 self-start text-11">
                        {gone ? (item.lineState === 'removed' ? m.orderItemRemoved : m.orderItemReplaced) : m.orderItemactionRequired}
                      </StatusChip>
                    ) : null}
                  </div>
                  <Money amount={item.lineTotal} className={cn('font-display text-16 font-bold text-ink', gone && 'text-stone line-through')} />
                </div>

                {finished && !gone ? (
                  <div className="flex flex-wrap items-center gap-2 border-t border-line/60 pt-2.5 ps-16">
                    <BuyAgainItem orderNumber={order.orderNumber} skuId={item.skuId} />
                    {delivered ? (
                      <ReportProblem orderNumber={order.orderNumber} itemId={item.id} maxQuantity={item.quantity} onSent={() => setProblemSent(true)} />
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Financial breakdown card */}
      <section aria-label={m.confirmTotal} className="flex flex-col gap-2 rounded-24 bg-chalk/40 p-4 border-t border-line">
        <Row label={fillMessage(m.checkoutSubtotalCount, { count: formatProductCount(count, locale) })}>
          <Money amount={order.amounts.subtotal} />
        </Row>
        <Row label={m.checkoutShipping}>
          {order.amounts.shippingFee === 0 ? (
            <span className="rounded-pill bg-ok-tint px-2 py-0.5 text-12 font-bold text-ok">{m.checkoutFree}</span>
          ) : (
            <Money amount={order.amounts.shippingFee} />
          )}
        </Row>
        <div aria-hidden="true" className="my-1 h-px bg-line" />
        <Row label={m.checkoutTotal} strong>
          <Money amount={order.amounts.currentCodAmount} className="font-display text-22 font-extrabold text-ink" />
        </Row>
        {order.amounts.originalCodAmount !== order.amounts.currentCodAmount ? (
          <p className="m-0 text-12 text-stone">
            {fillMessage(m.orderCodWas, { amount: formatEgp(order.amounts.originalCodAmount, order.amounts.currency, locale) ?? '' })}
          </p>
        ) : null}
        <p className="m-0 text-12.5 text-stone">{m.orderPaymentLine}</p>
      </section>

      {/* Delivery address & courier notes */}
      <section aria-labelledby="od-delivery" className="flex flex-col gap-2 rounded-24 bg-chalk/40 p-4.5">
        <div className="flex items-center gap-2">
          <Icon name="truck" size={18} className="text-cobalt" />
          <h2 id="od-delivery" className="m-0 font-display text-17 font-bold text-ink">
            {m.orderDeliveryTitle}
          </h2>
        </div>
        <p className="m-0 text-14 font-medium leading-22 text-ink">
          {order.customerName} · {address}
        </p>
        <p className="m-0 text-13 text-stone">{promise}</p>
      </section>

      {/* Order resolutions (if applicable) */}
      {order.resolutions.length ? (
        <section aria-labelledby="od-resolutions" className="flex flex-col gap-2.5 rounded-24 bg-chalk/40 p-4.5">
          <h2 id="od-resolutions" className="m-0 font-display text-17 font-bold text-ink">
            {m.orderResolutions}
          </h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-14">
            {order.resolutions.map((resolution, index) => (
              <li key={index} className="flex flex-col gap-1">
                <StatusChip tone={resolution.status === 'resolved' ? 'ok' : resolution.status === 'rejected' ? 'err' : 'gray'} className="self-start text-12">
                  {m[`orderResolutionStatus${resolution.status}` as keyof Messages] as string}
                </StatusChip>
                {resolution.refund ? (
                  <span className="text-stone">
                    {fillMessage(m.orderRefund, {
                      amount: formatEgp(resolution.refund.amount, resolution.refund.currency, locale) ?? '',
                      status: resolution.refund.status,
                    })}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Self-service controls */}
      <OrderSelfService order={order} />
    </article>
  );
}

/** Visual stage stepper ribbon with connected milestones */
function OrderVisualProgress({ order }: { order: OrderTracking }) {
  const m = useMessages();
  const stages: Array<{ id: CustomerStage; label: string; icon: 'check' | 'package' | 'truck' | 'cash' }> = [
    { id: 'RECEIVED', label: m.stageRegistered, icon: 'check' },
    { id: 'CONFIRMED', label: m.stageConfirmed, icon: 'check' },
    { id: 'PREPARING', label: m.stagePreparing, icon: 'package' },
    { id: 'OUT_FOR_DELIVERY', label: m.stageOutForDelivery, icon: 'truck' },
    { id: 'DELIVERED', label: m.stageDelivered, icon: 'check' },
  ];

  const LADDER: Record<CustomerStage, number> = {
    RECEIVED: 0,
    CONFIRMING_PRODUCTS: 0,
    ACTION_REQUIRED: 0,
    CONFIRMED: 1,
    PREPARING: 2,
    OUT_FOR_DELIVERY: 3,
    DELIVERY_ISSUE: 3,
    DELIVERED: 4,
    CANCELLATION_REQUESTED: -1,
    CANCELLED: -1,
  };

  const currentLevel = LADDER[order.status] ?? 0;

  return (
    <div className="rounded-24 bg-chalk/60 p-4 shadow-hairline-bottom">
      <div className="flex items-center justify-between">
        {stages.map((stage, idx) => {
          const reached = currentLevel >= idx;
          const isCurrent = currentLevel === idx && order.status !== 'DELIVERED';
          const isLast = idx === stages.length - 1;

          return (
            <div key={stage.id} className="flex flex-1 items-center">
              <div className="flex flex-col items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid size-8 place-items-center rounded-pill font-display text-13 font-bold transition-all',
                    reached
                      ? 'bg-ok text-white shadow-elevation-1'
                      : isCurrent
                        ? 'bg-cobalt text-chalk ring-4 ring-cobalt/25'
                        : 'bg-sand/60 text-stone'
                  )}
                >
                  <Icon name={stage.icon} size={15} strokeWidth={2.4} />
                </span>
                <span
                  className={cn(
                    'hidden text-center text-12 sm:block',
                    isCurrent ? 'font-bold text-ink' : reached ? 'font-semibold text-ink' : 'text-stone'
                  )}
                >
                  {stage.label}
                </span>
              </div>
              {!isLast ? (
                <div
                  aria-hidden="true"
                  className={cn(
                    'mx-2 h-0.5 flex-1 transition-colors',
                    currentLevel > idx ? 'bg-ok' : 'bg-line'
                  )}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Row({ label, strong, children }: { label: string; strong?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn('flex min-h-7.5 items-center justify-between gap-3 text-ink', strong ? 'text-17 font-bold' : 'text-14.5 font-medium')}>
      <span>{label}</span>
      <span className="tabular-nums">{children}</span>
    </div>
  );
}

/* ── Cancel, support, order again ──────────────────────────────────── */

function OrderSelfService({ order }: { order: OrderTracking }) {
  const m = useMessages();
  const queryClient = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelState, setCancelState] = useState<'idle' | 'pending' | 'done' | 'support' | 'failed'>('idle');
  const [supportOpen, setSupportOpen] = useState(false);
  const [topic, setTopic] = useState<SupportTopic>('other');
  const [message, setMessage] = useState('');
  const [supportState, setSupportState] = useState<'idle' | 'pending' | 'sent' | 'failed'>('idle');
  const [reorder, setReorder] = useState<{ state: 'idle' | 'pending' | 'failed'; result?: ReorderResult }>({ state: 'idle' });
  const finished = order.status === 'DELIVERED' || order.status === 'CANCELLED';

  const cancel = async () => {
    setCancelState('pending');
    try {
      await orders.cancel(order.orderNumber);
      setCancelState('done');
      setCancelOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['order-tracking', order.orderNumber] }),
        queryClient.invalidateQueries({ queryKey: ['my-orders'] }),
      ]);
    } catch (error) {
      setCancelOpen(false);
      if (error instanceof ApiError && error.status === 409) {
        setCancelState('support');
        setTopic('cancellation');
        setSupportOpen(true);
      } else {
        setCancelState('failed');
      }
    }
  };

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    setSupportState('pending');
    try {
      await orders.requestSupport(order.orderNumber, { message: message.trim(), topic });
      setSupportState('sent');
      setMessage('');
    } catch {
      setSupportState('failed');
    }
  };

  const orderAgain = async () => {
    setReorder({ state: 'pending' });
    try {
      const result = await orders.reorder(order.orderNumber);
      await queryClient.invalidateQueries({ queryKey: ['cart'] });
      setReorder({ state: 'idle', result });
    } catch {
      setReorder({ state: 'failed' });
    }
  };

  return (
    <section className="flex flex-col gap-3.5 border-t border-line pt-4">
      {cancelState === 'done' ? (
        <MessageBox tone="ok" role="status" className="rounded-16">
          {m.orderCancelDone}
        </MessageBox>
      ) : null}
      {cancelState === 'support' ? (
        <MessageBox tone="warn" role="status" className="rounded-16">
          {m.orderCancelNeedsSupport}
        </MessageBox>
      ) : null}
      {cancelState === 'failed' ? (
        <MessageBox tone="err" role="alert" className="rounded-16">
          {m.orderCancelFailed}
        </MessageBox>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {order.canCancel && cancelState !== 'done' ? (
          <Button variant="light" onClick={() => setCancelOpen(true)}>
            {m.orderCancelButton}
          </Button>
        ) : null}
        {finished ? (
          <AsyncButton variant="ink" state={reorder.state === 'pending' ? 'pending' : 'idle'} pendingLabel={m.buyAgainAdding} onClick={orderAgain}>
            <Icon name="shop" size={17} />
            <span>{m.buyAgainOrder}</span>
          </AsyncButton>
        ) : null}
        <button
          type="button"
          aria-expanded={supportOpen}
          onClick={() => setSupportOpen((open) => !open)}
          className="rounded-pill px-3 py-1.5 text-14 font-semibold text-cobalt transition-colors hover:bg-sand/40 hover:text-cobalt-deep"
        >
          {m.orderContactSupport}
        </button>
      </div>

      {order.canCancel && cancelState !== 'done' ? <p className="m-0 text-12 text-stone">{m.orderCancelNote}</p> : null}

      {reorder.state === 'failed' ? (
        <MessageBox tone="err" role="alert" className="rounded-16">
          {m.unexpectedErrorDescription}
        </MessageBox>
      ) : reorder.result ? (
        reorder.result.summary.totalAdded > 0 ? (
          <MessageBox tone="ok" role="status" className="rounded-16">
            <p className="m-0 font-medium">
              {reorder.result.summary.totalSkipped > 0
                ? fillMessage(m.buyAgainPartial, { added: reorder.result.summary.totalAdded, skipped: reorder.result.summary.totalSkipped })
                : fillMessage(m.buyAgainSuccess, { n: reorder.result.summary.totalAdded })}
            </p>
            <Link href={routes.cart} className="text-link text-13.5 mt-2">
              {m.buyAgainViewCart}
            </Link>
          </MessageBox>
        ) : (
          <MessageBox tone="warn" role="status" className="rounded-16">
            {m.buyAgainUnavailable}
          </MessageBox>
        )
      ) : null}

      {/* Support ticket submission drawer/card */}
      {supportOpen ? (
        <form onSubmit={send} className="flex flex-col gap-4 rounded-24 bg-chalk/70 p-5 shadow-elevation-1">
          <div className="flex items-center justify-between">
            <h3 className="m-0 font-display text-17 font-bold text-ink">{m.orderSupportTitle}</h3>
            <button
              type="button"
              onClick={() => setSupportOpen(false)}
              className="grid size-8 place-items-center rounded-pill text-stone hover:bg-sand/50"
            >
              <Icon name="close" size={16} />
            </button>
          </div>

          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-2 text-13.5 font-semibold text-stone">{m.orderSupportTopic}</legend>
            <div className="flex flex-wrap gap-2">
              {SUPPORT_TOPICS.map((value) => (
                <Chip key={value} selected={topic === value} onClick={() => setTopic(value)}>
                  {m[`orderSupportTopic${value}` as keyof Messages] as string}
                </Chip>
              ))}
            </div>
          </fieldset>

          <TextAreaField
            label={m.orderSupportMessage}
            hint={m.orderSupportHint}
            rows={3}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={1000}
          />

          {supportState === 'sent' ? (
            <MessageBox tone="ok" role="status" className="rounded-16">
              {m.orderSupportSent}
            </MessageBox>
          ) : null}

          {supportState === 'failed' ? (
            <MessageBox tone="err" role="alert" className="rounded-16">
              {m.orderSupportFailed}
            </MessageBox>
          ) : null}

          <AsyncButton
            type="submit"
            variant="ink"
            className="self-start"
            state={supportState === 'pending' ? 'pending' : 'idle'}
            pendingLabel={m.orderSupportSend}
            disabled={message.trim().length < 5}
          >
            {m.orderSupportSend}
          </AsyncButton>
        </form>
      ) : null}

      {/* Cancel Order Dialog */}
      <Dialog open={cancelOpen} onOpenChange={(open) => cancelState !== 'pending' && setCancelOpen(open)}>
        <DialogContent closeLabel={m.close}>
          <DialogHeader>
            <DialogTitle>{fillMessage(m.orderCancelDialogTitle, { n: isolateLtr(order.orderNumber) })}</DialogTitle>
            <DialogDescription>{m.orderCancelDialogBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <AsyncButton variant="ink" state={cancelState === 'pending' ? 'pending' : 'idle'} pendingLabel={m.orderCancelling} onClick={cancel}>
              {m.orderCancelYes}
            </AsyncButton>
            <Button variant="light" onClick={() => setCancelOpen(false)} disabled={cancelState === 'pending'}>
              {m.orderCancelNo}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function BuyAgainItem({ orderNumber, skuId }: { orderNumber: string; skuId: string }) {
  const m = useMessages();
  const queryClient = useQueryClient();
  const [state, setState] = useState<'idle' | 'pending' | 'added' | 'unavailable' | 'error'>('idle');

  const add = async () => {
    setState('pending');
    try {
      const result = await orders.reorder(orderNumber, [skuId]);
      await queryClient.invalidateQueries({ queryKey: ['cart'] });
      setState(result.summary.totalAdded > 0 ? 'added' : 'unavailable');
    } catch {
      setState('error');
    }
  };

  if (state === 'added') {
    return (
      <Link href={routes.cart} className={buttonVariants({ variant: 'light', size: 's' })}>
        {m.buyAgainItemAdded} · {m.buyAgainViewCart}
      </Link>
    );
  }
  if (state === 'unavailable') return <span className="text-12.5 text-stone">{m.buyAgainItemUnavailable}</span>;
  return (
    <AsyncButton variant="light" size="s" state={state === 'pending' ? 'pending' : state === 'error' ? 'error' : 'idle'} pendingLabel={m.buyAgainAdding} onClick={add}>
      {m.buyAgainItem}
    </AsyncButton>
  );
}

/* ── Availability decisions (GLO-190) ──────────────────────────────── */

function DecisionPanel({ orderNumber, onResolved }: { orderNumber: string; onResolved: (receipt: AvailabilityDecision['receipt']) => void }) {
  const m = useMessages();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const keys = useRef(new Map<string, string>());
  const [choice, setChoice] = useState<{ decisionId: string; action: AvailabilityAction; skuId?: string } | null>(null);
  const [state, setState] = useState<'idle' | 'pending' | 'failed' | 'stale'>('idle');
  const query = useQuery({ queryKey: ['order-decisions', orderNumber], queryFn: () => orders.listDecisions(orderNumber) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['order-decisions', orderNumber] });

  const pending = query.data?.filter((decision) => decision.status === 'pending') ?? [];
  const money = (value: number, currency: string) => formatEgp(value, currency, locale) ?? '';

  const confirm = async (decision: AvailabilityDecision) => {
    if (!choice || choice.decisionId !== decision.id) return;
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
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ['order-tracking', orderNumber] })]);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setState('stale');
        setChoice(null);
        await refresh();
      } else {
        setState('failed');
      }
    }
  };

  return (
    <section aria-labelledby="decision-title" className="flex flex-col gap-4 rounded-24 bg-citron/25 p-5 border border-warn/40">
      <div className="flex items-center gap-2">
        <Icon name="alert" size={20} className="text-warn" />
        <h2 id="decision-title" className="m-0 font-display text-18 font-bold text-ink">
          {m.decisionTitle}
        </h2>
      </div>
      {state === 'failed' ? <p role="alert" className="m-0 text-14 text-tomato-ink">{m.decisionFailed}</p> : null}
      {state === 'stale' ? <p role="status" className="m-0 text-14 text-ink">{m.decisionStale}</p> : null}
      {query.isPending ? <p className="m-0 text-14 text-stone">{m.decisionLoading}</p> : null}

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
          <fieldset key={decision.id} className="m-0 flex flex-col gap-3 border-0 p-0">
            <legend className="mb-2 text-14 font-semibold text-ink">{fillMessage(m.decisionIntro, { qty: formatNumber(decision.unresolvedQuantity, locale), name })}</legend>
            {options.map((option) => {
              const selected = choice?.decisionId === decision.id && choice.action === option.action && choice.skuId === option.skuId;
              return (
                <label
                  key={`${option.action}-${option.skuId ?? ''}`}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-16 bg-linen p-3.5 transition-all',
                    selected ? 'border border-cobalt shadow-outline-cobalt' : 'border border-line/70 hover:bg-sand/20'
                  )}
                >
                  <input
                    type="radio"
                    name={`decision-${decision.id}`}
                    className="mt-1 size-4 accent-cobalt"
                    checked={selected}
                    onChange={() => setChoice({ decisionId: decision.id, action: option.action, skuId: option.skuId })}
                  />
                  <div className="flex flex-col gap-0.5">
                    <span className={cn('text-14 text-ink', selected ? 'font-bold' : 'font-medium')}>{option.label}</span>
                    <span className="text-12.5 text-stone">{option.detail}</span>
                  </div>
                </label>
              );
            })}
            <AsyncButton
              variant="ink"
              className="w-full mt-1"
              disabled={choice?.decisionId !== decision.id}
              state={state === 'pending' && choice?.decisionId === decision.id ? 'pending' : 'idle'}
              pendingLabel={m.decisionConfirm}
              onClick={() => confirm(decision)}
            >
              {m.decisionConfirm}
            </AsyncButton>
          </fieldset>
        );
      })}
    </section>
  );
}
