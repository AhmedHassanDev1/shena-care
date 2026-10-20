'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AsyncButton, Button, buttonVariants } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TextAreaField } from '@/components/ui/field';
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
 * Order detail and tracking (OrdersD detail panel, CommerceMobile ٧, CommerceStates §٥). Stage, timeline, line states
 * and amounts are rendered as the API reports them. When the API reports ACTION_REQUIRED, the decision panel sits at
 * the top. Self-service follows the server: cancel only while `canCancel`, order-linked support, problem reports on
 * delivered products, and order again at today's prices.
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
    <article className="flex flex-col gap-5 lg:rounded-sheet lg:bg-linen lg:p-7 lg:shadow-elevation-3 lg:outline lg:outline-1 lg:outline-line">
      <header className="flex items-start justify-between gap-3">
        <span className="flex flex-col gap-1">
          <span className="text-13 text-ink-2">
            {fillMessage(m.orderPlacedOnLong, { date: formatDate(order.createdAt, locale) })} · {formatProductCount(count, locale)}
          </span>
          {/* Phone: the number is the header title (CommerceMobile ٧); desktop: the panel heading (OrdersD). */}
          <h2 className="m-0 hidden text-match-parent lg:block">
            <bdi dir="ltr" className="text-24 font-bold tabular-nums leading-30 text-night lg:text-28 lg:leading-34">
              {order.orderNumber}
            </bdi>
          </h2>
        </span>
        <StatusChip tone={stageTone(order.status)}>{stageLabel(order.status, m)}</StatusChip>
      </header>

      {receipt ? (
        <MessageBox tone="ok" role="status">
          {fillMessage(m.decisionReceipt, {
            before: formatEgp(receipt.amounts.codBefore, receipt.amounts.currency, locale) ?? '',
            after: formatEgp(receipt.amounts.codAfter, receipt.amounts.currency, locale) ?? '',
          })}
        </MessageBox>
      ) : null}
      {problemSent ? (
        <MessageBox tone="ok" role="status">
          {m.problemSent}
        </MessageBox>
      ) : null}
      {order.actionRequired ? <DecisionPanel orderNumber={order.orderNumber} onResolved={setReceipt} /> : null}

      <Timeline items={trackingSteps(order, m, locale)} label={m.orderTimeline} />

      <section aria-labelledby="od-items" className="flex flex-col gap-3 pt-5 shadow-hairline-top">
        <h2 id="od-items" className="m-0 text-17 font-bold text-night">
          {m.orderItems}
        </h2>
        <ul className="m-0 flex list-none flex-col p-0">
          {order.items.map((item) => {
            const gone = item.lineState === 'removed' || item.lineState === 'replaced';
            const entry = catalog[item.skuId];
            const size = (entry ? formatPackSize(entry.size, entry.sizeUnit, locale) : null) ?? item.variantName ?? '';
            const name = item.productName ?? '';
            return (
              <li key={item.id} className="flex flex-col gap-2 py-3 shadow-hairline-bottom last:shadow-none">
                <span className="flex items-center gap-3">
                  <ProductTile size="thumb" className={cn('h-15 w-12 flex-none rounded-10', gone && 'opacity-50')} src={entry?.image?.url ?? null} alt="" name={name} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span dir="auto" className={cn('text-match-parent text-14.5 font-semibold text-night', gone && 'text-ink-3 line-through')}>
                      {name}
                    </span>
                    <span className="text-12.5 text-ink-2">
                      {fillMessage(m.checkoutLineMeta, { size, qty: formatNumber(item.quantity, locale) })}
                    </span>
                    {gone || item.status === 'action-required' ? (
                      <StatusChip tone={gone ? 'gray' : 'warn'} className="mt-1 self-start">
                        {gone ? (item.lineState === 'removed' ? m.orderItemRemoved : m.orderItemReplaced) : m.orderItemactionRequired}
                      </StatusChip>
                    ) : null}
                  </span>
                  <Money amount={item.lineTotal} className={cn('text-14 font-bold text-night', gone && 'text-ink-3 line-through')} />
                </span>
                {finished && !gone ? (
                  <span className="flex flex-wrap items-center gap-2 ps-15">
                    <BuyAgainItem orderNumber={order.orderNumber} skuId={item.skuId} />
                    {delivered ? (
                      <ReportProblem orderNumber={order.orderNumber} itemId={item.id} maxQuantity={item.quantity} onSent={() => setProblemSent(true)} />
                    ) : null}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label={m.confirmTotal} className="flex flex-col gap-1 pt-4 shadow-hairline-top">
        <Row label={fillMessage(m.checkoutSubtotalCount, { count: formatProductCount(count, locale) })}>
          <Money amount={order.amounts.subtotal} />
        </Row>
        <Row label={m.checkoutShipping}>
          {order.amounts.shippingFee === 0 ? m.checkoutFree : <Money amount={order.amounts.shippingFee} />}
        </Row>
        <div aria-hidden="true" className="my-1.5 h-px bg-line" />
        <Row label={m.checkoutTotal} strong>
          <Money amount={order.amounts.currentCodAmount} />
        </Row>
        {order.amounts.originalCodAmount !== order.amounts.currentCodAmount ? (
          <p className="m-0 text-12.5 text-ink-3">
            {fillMessage(m.orderCodWas, { amount: formatEgp(order.amounts.originalCodAmount, order.amounts.currency, locale) ?? '' })}
          </p>
        ) : null}
        <p className="m-0 text-13 text-ink-2">{m.orderPaymentLine}</p>
      </section>

      <section aria-labelledby="od-delivery" className="flex flex-col gap-1">
        <h2 id="od-delivery" className="m-0 text-17 font-bold text-night">
          {m.orderDeliveryTitle}
        </h2>
        <p className="m-0 text-14 leading-22 text-night">
          {order.customerName} · {address}
        </p>
        <p className="m-0 text-13 text-ink-2">{promise}</p>
      </section>

      {order.resolutions.length ? (
        <section aria-labelledby="od-resolutions" className="flex flex-col gap-2">
          <h2 id="od-resolutions" className="m-0 text-17 font-bold text-night">
            {m.orderResolutions}
          </h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-14">
            {order.resolutions.map((resolution, index) => (
              <li key={index} className="flex flex-col gap-1">
                <StatusChip tone={resolution.status === 'resolved' ? 'ok' : resolution.status === 'rejected' ? 'err' : 'gray'} className="self-start">
                  {m[`orderResolutionStatus${resolution.status}` as keyof Messages] as string}
                </StatusChip>
                {resolution.refund ? (
                  <span className="text-ink-2">
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

      <OrderSelfService order={order} />
    </article>
  );
}

function Row({ label, strong, children }: { label: string; strong?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn('flex min-h-7.5 items-center justify-between gap-3 text-night', strong ? 'text-17 font-bold' : 'text-14.5 font-medium')}>
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
    <section className="flex flex-col gap-3">
      {cancelState === 'done' ? (
        <MessageBox tone="ok" role="status">
          {m.orderCancelDone}
        </MessageBox>
      ) : null}
      {cancelState === 'support' ? (
        <MessageBox tone="warn" role="status">
          {m.orderCancelNeedsSupport}
        </MessageBox>
      ) : null}
      {cancelState === 'failed' ? (
        <MessageBox tone="err" role="alert">
          {m.orderCancelFailed}
        </MessageBox>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {order.canCancel && cancelState !== 'done' ? (
          <Button variant="light" onClick={() => setCancelOpen(true)}>
            {m.orderCancelButton}
          </Button>
        ) : null}
        {finished ? (
          <AsyncButton variant="light" state={reorder.state === 'pending' ? 'pending' : 'idle'} pendingLabel={m.buyAgainAdding} onClick={orderAgain}>
            {m.buyAgainOrder}
          </AsyncButton>
        ) : null}
        <button
          type="button"
          aria-expanded={supportOpen}
          onClick={() => setSupportOpen((open) => !open)}
          className="text-link"
        >
          {m.orderContactSupport}
        </button>
      </div>
      {order.canCancel && cancelState !== 'done' ? <p className="m-0 text-12.5 text-ink-3">{m.orderCancelNote}</p> : null}

      {reorder.state === 'failed' ? (
        <MessageBox tone="err" role="alert">
          {m.unexpectedErrorDescription}
        </MessageBox>
      ) : reorder.result ? (
        reorder.result.summary.totalAdded > 0 ? (
          <MessageBox tone="ok" role="status">
            <p className="m-0">
              {reorder.result.summary.totalSkipped > 0
                ? fillMessage(m.buyAgainPartial, { added: reorder.result.summary.totalAdded, skipped: reorder.result.summary.totalSkipped })
                : fillMessage(m.buyAgainSuccess, { n: reorder.result.summary.totalAdded })}
            </p>
            <Link href={routes.cart} className="text-link text-13.5">
              {m.buyAgainViewCart}
            </Link>
          </MessageBox>
        ) : (
          <MessageBox tone="warn" role="status">
            {m.buyAgainUnavailable}
          </MessageBox>
        )
      ) : null}

      {supportOpen ? (
        <form onSubmit={send} className="flex flex-col gap-3 rounded-card bg-bone p-4 shadow-outline-hairline">
          <h2 className="m-0 text-16 font-bold text-night">{m.orderSupportTitle}</h2>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-2 text-14 text-ink-2">{m.orderSupportTopic}</legend>
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
            <MessageBox tone="ok" role="status">
              {m.orderSupportSent}
            </MessageBox>
          ) : null}
          {supportState === 'failed' ? (
            <MessageBox tone="err" role="alert">
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
  if (state === 'unavailable') return <span className="text-13 text-ink-3">{m.buyAgainItemUnavailable}</span>;
  return (
    <AsyncButton variant="light" size="s" state={state === 'pending' ? 'pending' : state === 'error' ? 'error' : 'idle'} pendingLabel={m.buyAgainAdding} onClick={add}>
      {m.buyAgainItem}
    </AsyncButton>
  );
}

/* ── Availability decisions (GLO-190) ──────────────────────────────── */

/** Every option shows the server's own preview of the new amount due; one idempotency key per decision and choice. */
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
    <section aria-labelledby="decision-title" className="flex flex-col gap-4 rounded-card bg-saffron-tint p-4 shadow-outline-warn">
      <h2 id="decision-title" className="m-0 text-16 font-bold text-saffron-ink">
        {m.decisionTitle}
      </h2>
      {state === 'failed' ? <p role="alert" className="m-0 text-14 text-err">{m.decisionFailed}</p> : null}
      {state === 'stale' ? <p role="status" className="m-0 text-14 text-night">{m.decisionStale}</p> : null}
      {query.isPending ? <p className="m-0 text-14 text-ink-2">{m.decisionLoading}</p> : null}

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
          <fieldset key={decision.id} className="m-0 flex flex-col gap-2.5 border-0 p-0">
            <legend className="mb-2 text-14 text-night">{fillMessage(m.decisionIntro, { qty: formatNumber(decision.unresolvedQuantity, locale), name })}</legend>
            {options.map((option) => {
              const selected = choice?.decisionId === decision.id && choice.action === option.action && choice.skuId === option.skuId;
              return (
                <label
                  key={`${option.action}-${option.skuId ?? ''}`}
                  className={cn('flex cursor-pointer items-start gap-3 rounded-16 bg-linen px-4 py-3', selected ? 'shadow-outline-blue' : 'shadow-outline-control')}
                >
                  <input
                    type="radio"
                    name={`decision-${decision.id}`}
                    className="mt-1 size-4 accent-blue"
                    checked={selected}
                    onChange={() => setChoice({ decisionId: decision.id, action: option.action, skuId: option.skuId })}
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className={cn('text-14 text-night', selected && 'font-bold')}>{option.label}</span>
                    <span className="text-12.5 text-ink-2">{option.detail}</span>
                  </span>
                </label>
              );
            })}
            <AsyncButton
              variant="ink"
              className="w-full"
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
