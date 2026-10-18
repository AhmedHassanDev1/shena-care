'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { MessageBox } from '@/components/ui/message-box';
import { Button, buttonVariants } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { TextAreaField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { ApiError } from '@/lib/api-client';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage, type Messages } from '@/lib/i18n/messages';
import { SUPPORT_TOPICS, orders, type OrderTracking, type ReorderResult, type SupportTopic } from '@/lib/orders';
import { routes } from '@/lib/routes';

/**
 * Customer self-service on the order (C0 W6): cancel while the server says it is still possible, and an
 * order-linked request to the team. Every action is re-checked by the API; nothing here decides policy.
 */
export function OrderActions({ order }: { order: OrderTracking }) {
  const m = useMessages();
  const queryClient = useQueryClient();
  const [reorderState, setReorderState] = useState<'idle' | 'pending' | 'done' | 'failed'>('idle');
  const [reorderResult, setReorderResult] = useState<ReorderResult | null>(null);
  const [cancelState, setCancelState] = useState<'idle' | 'pending' | 'done' | 'support' | 'failed'>('idle');
  const [topic, setTopic] = useState<SupportTopic>('other');
  const [message, setMessage] = useState('');
  const [supportState, setSupportState] = useState<'idle' | 'pending' | 'sent' | 'failed'>('idle');
  const closed = ['CANCELLED', 'DELIVERED'].includes(order.status);

  const buyAgain = async () => {
    setReorderState('pending');
    setReorderResult(null);
    try {
      const res = await orders.reorder(order.orderNumber);
      await queryClient.invalidateQueries({ queryKey: ['cart'] });
      setReorderResult(res);
      setReorderState('done');
    } catch {
      setReorderState('failed');
    }
  };

  const cancel = async () => {
    if (!window.confirm(m.orderCancelConfirm)) return;
    setCancelState('pending');
    try {
      await orders.cancel(order.orderNumber);
      setCancelState('done');
      await queryClient.invalidateQueries({ queryKey: ['order-tracking', order.orderNumber] });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setCancelState('support');
        setTopic('cancellation');
      } else setCancelState('failed');
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

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-card border border-line bg-linen p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-title text-night">{m.buyAgainOrder}</h2>
            <p className="text-14 text-ink-2">{m.buyAgainOrderPrompt}</p>
          </div>
          <Button
            variant="blue"
            loading={reorderState === 'pending'}
            onClick={buyAgain}
          >
            <Icon name="retry" size={16} />
            <span>{m.buyAgain}</span>
          </Button>
        </div>

        {reorderState === 'failed' ? (
          <MessageBox tone="err">
            <p className="text-14">{m.unexpectedErrorDescription}</p>
          </MessageBox>
        ) : reorderResult ? (
          reorderResult.summary.totalAdded > 0 ? (
            <MessageBox tone="ok">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <p className="text-14">
                  {reorderResult.summary.totalSkipped > 0
                    ? fillMessage(m.buyAgainPartial, {
                        added: reorderResult.summary.totalAdded,
                        skipped: reorderResult.summary.totalSkipped,
                      })
                    : fillMessage(m.buyAgainSuccess, {
                        n: reorderResult.summary.totalAdded,
                      })}
                </p>
                <Link href={routes.cart} className={buttonVariants({ size: 's', variant: 'light' })}>
                  {m.buyAgainViewCart}
                </Link>
              </div>
            </MessageBox>
          ) : (
            <MessageBox tone="warn">
              <p className="text-14">{m.buyAgainUnavailable}</p>
            </MessageBox>
          )
        ) : null}
      </section>

      {cancelState === 'done' ? <MessageBox tone="ok"><p className="text-14">{m.orderCancelDone}</p></MessageBox> : null}
      {order.canCancel && cancelState !== 'done' ? (
        <section className="space-y-2 rounded-card border border-line bg-linen p-4">
          <h2 className="text-title text-night">{m.orderCancelTitle}</h2>
          <p className="text-14 text-ink-2">{m.orderCancelBody}</p>
          {cancelState === 'failed' ? <MessageBox tone="err"><p className="text-14">{m.orderCancelFailed}</p></MessageBox> : null}
          <Button variant="light" loading={cancelState === 'pending'} onClick={cancel}>{m.orderCancelButton}</Button>
        </section>
      ) : null}
      {cancelState === 'support' ? <MessageBox tone="warn"><p className="text-14">{m.orderCancelNeedsSupport}</p></MessageBox> : null}

      {!closed || order.status === 'DELIVERED' ? (
        <form onSubmit={send} className="space-y-3 rounded-card border border-line bg-linen p-4">
          <h2 className="text-title text-night">{m.orderSupportTitle}</h2>
          <fieldset className="space-y-2">
            <legend className="text-14 text-ink-2">{m.orderSupportTopic}</legend>
            <div className="flex flex-wrap gap-2">
              {SUPPORT_TOPICS.map((value) => (
                <Chip key={value} selected={topic === value} onClick={() => setTopic(value)}>
                  {m[`orderSupportTopic${value}` as keyof Messages] as string}
                </Chip>
              ))}
            </div>
          </fieldset>
          <TextAreaField label={m.orderSupportMessage} hint={m.orderSupportHint} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} />
          {supportState === 'sent' ? <MessageBox tone="ok"><p className="text-14">{m.orderSupportSent}</p></MessageBox> : null}
          {supportState === 'failed' ? <MessageBox tone="err"><p className="text-14">{m.orderSupportFailed}</p></MessageBox> : null}
          <Button type="submit" variant="light" loading={supportState === 'pending'} disabled={message.trim().length < 5}>{m.orderSupportSend}</Button>
        </form>
      ) : null}
    </div>
  );
}
