'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageBox } from '@/components/ui/message-box';
import { Button } from '@/components/ui/button';
import { TextAreaField, TextField } from '@/components/ui/field';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { ApiError } from '@/lib/api-client';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { formatNumber } from '@/lib/i18n/format';
import type { Messages } from '@/lib/i18n/messages';
import { orders, type ProblemReason } from '@/lib/orders';
import { cn } from '@/lib/utils';

/**
 * "Problem with this item?" on one order line (W6 / GLO-215 / GLO-216). Which reasons are offered, and
 * whether reporting is possible at all, comes from the server's eligibility projection; no return window
 * or policy is decided here. A possible skin reaction is routed by the server to a human safety review.
 */
export function ReportProblem({
  orderNumber,
  itemId,
  maxQuantity,
  onSent,
}: {
  orderNumber: string;
  itemId: string;
  maxQuantity: number;
  onSent: () => void;
}) {
  const m = useMessages();
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="text" size="s" className="text-12" onClick={() => setOpen(true)}>
        {m.problemOpen}
      </Button>
    );
  }
  return (
    <ProblemForm
      orderNumber={orderNumber}
      itemId={itemId}
      maxQuantity={maxQuantity}
      onClose={() => setOpen(false)}
      onSent={() => {
        setOpen(false);
        onSent();
      }}
    />
  );
}

function ProblemForm({
  orderNumber,
  itemId,
  maxQuantity,
  onClose,
  onSent,
}: {
  orderNumber: string;
  itemId: string;
  maxQuantity: number;
  onClose: () => void;
  onSent: () => void;
}) {
  const m = useMessages();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState<ProblemReason | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [description, setDescription] = useState('');
  const [batch, setBatch] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'failed' | 'conflict'>('idle');
  const eligibility = useQuery({
    queryKey: ['item-eligibility', orderNumber, itemId],
    queryFn: () => orders.getItemEligibility(orderNumber, itemId),
    retry: false,
  });

  const reaction = reason === 'POSSIBLE_ADVERSE_EVENT';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reason || state === 'sending') return;
    setState('sending');
    try {
      await orders.reportItemProblem(orderNumber, itemId, {
        reasonCode: reason,
        quantity,
        description: description.trim() || undefined,
        batchOrLot: reaction ? batch.trim() || undefined : undefined,
      });
      // The line now has an open request: drop the cached eligibility and refresh the order.
      queryClient.removeQueries({ queryKey: ['item-eligibility', orderNumber, itemId] });
      await queryClient.invalidateQueries({ queryKey: ['order-tracking', orderNumber] });
      onSent();
    } catch (error) {
      // The server refuses a second open claim on the same line; anything else is safe to retry.
      setState(error instanceof ApiError && [400, 409].includes(error.status) ? 'conflict' : 'failed');
    }
  };

  return (
    <form onSubmit={submit} aria-labelledby={`problem-${itemId}`} className="mt-2 space-y-4 rounded-card border border-line bg-linen p-4">
      <h3 id={`problem-${itemId}`} className="text-14 font-semibold text-night">
        {m.problemTitle}
      </h3>

      {eligibility.isPending ? <p className="text-14 text-ink-2">{m.problemLoading}</p> : null}
      {eligibility.isError || (eligibility.data && !eligibility.data.isEligible) ? (
        <MessageBox tone="info">
          <p className="text-14">{m.problemUnavailable}</p>
        </MessageBox>
      ) : null}

      {eligibility.data?.isEligible ? (
        <>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-14 text-night">{m.problemReason}</legend>
            {eligibility.data.allowedReasons.map((code) => (
              <label
                key={code}
                className={cn(
                  'flex min-h-control-s cursor-pointer items-center gap-3 rounded-input border bg-linen px-3',
                  reason === code ? 'border-night' : 'border-line',
                )}
              >
                <input
                  type="radio"
                  name={`reason-${itemId}`}
                  className="size-4 accent-bottle"
                  checked={reason === code}
                  onChange={() => setReason(code)}
                />
                <span className={cn('text-14 text-night', reason === code && 'font-semibold')}>
                  {m[`problemReason${code}` as keyof Messages] as string}
                </span>
              </label>
            ))}
          </fieldset>

          {reaction ? (
            <MessageBox tone="warn">
              <div className="space-y-1 text-14">
                <p className="font-semibold">{m.problemSafetyNote}</p>
                <p>{m.problemSafetyReview}</p>
              </div>
            </MessageBox>
          ) : null}

          {maxQuantity > 1 ? (
            <div className="space-y-2">
              <p className="text-14 text-night">{m.problemQuantity}</p>
              <QuantityStepper
                value={quantity}
                displayValue={formatNumber(quantity, locale)}
                max={maxQuantity}
                onChange={setQuantity}
                labels={{ group: m.problemQuantity, decrease: m.problemDecrease, increase: m.problemIncrease }}
              />
            </div>
          ) : null}

          <TextAreaField
            label={m.problemDescription}
            optionalLabel={m.checkoutOptional}
            value={description}
            maxLength={1000}
            onChange={(event) => setDescription(event.target.value)}
          />
          {reaction ? (
            <TextField
              label={m.problemBatch}
              optionalLabel={m.checkoutOptional}
              hint={m.problemBatchHint}
              dir="ltr"
              value={batch}
              maxLength={64}
              onChange={(event) => setBatch(event.target.value)}
            />
          ) : null}

          {state === 'failed' ? <p role="alert" className="text-14 text-err">{m.problemFailed}</p> : null}
          {state === 'conflict' ? <p role="status" className="text-14 text-night">{m.problemConflict}</p> : null}
        </>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="light" onClick={onClose} disabled={state === 'sending'}>
          {m.problemCancel}
        </Button>
        {eligibility.data?.isEligible ? (
          <Button type="submit" disabled={!reason || state === 'conflict'} loading={state === 'sending'}>
            {m.problemSubmit}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
