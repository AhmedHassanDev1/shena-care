'use client';

import type { ReactNode } from 'react';
import { AsyncButton, Button, type AsyncState } from '@/components/ui/button';
import { PhoneField, TextField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { MessageBox } from '@/components/ui/message-box';
import { Money } from '@/components/ui/money';
import { displayMobile } from '@/features/auth/lib/auth-helpers';
import type { CustomerAddress } from '@/lib/addresses';
import { formatEgp, formatNumber } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import type { CheckoutQuote } from '@/lib/orders';
import { cn } from '@/lib/utils';
import { CAIRO_GIZA_AREAS } from '../lib/service-area';
import { toGovernorate, type Governorate, type NewAddressDraft } from '../lib/checkout-draft';
import { DeliveryLocationPicker, type LocationPin } from './DeliveryLocationPicker';

/* ── Section frame ─────────────────────────────────────────────────────── */

/**
 * One checkout section (CheckoutD): linen card, radius 24, hairline; a 30px step badge (night with the number, or ok
 * green with a check once the section is complete) and the Beiruti title; an optional action at the reading end.
 */
export function CheckoutSection({
  id,
  step,
  done,
  title,
  action,
  children,
}: {
  id: string;
  step: number;
  done?: boolean;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const locale = useLocale();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 rounded-24 bg-linen p-4.5 shadow-outline-hairline lg:p-6">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={cn(
            'grid size-7.5 flex-none place-items-center rounded-pill text-14 font-bold',
            done ? 'bg-ok text-white' : 'bg-ink text-linen'
          )}
        >
          {done ? <Icon name="check" size={18} strokeWidth={2.6} /> : formatNumber(step, locale)}
        </span>
        <h2 id={id} className="m-0 font-display text-22 font-bold leading-29 text-ink">
          {title}
        </h2>
        {action ? <span className="ms-auto">{action}</span> : null}
      </div>
      {children}
    </section>
  );
}

/* ── ١ المستلم ─────────────────────────────────────────────────────────── */

export interface Recipient {
  name: string;
  phone: string;
}

export function RecipientSection({
  recipient,
  fromAccount,
  editing,
  errors,
  onEdit,
  onChange,
  onDone,
}: {
  recipient: Recipient;
  fromAccount: boolean;
  editing: boolean;
  errors: Partial<Record<keyof Recipient, string>>;
  onEdit: () => void;
  onChange: (next: Recipient) => void;
  onDone: () => void;
}) {
  const m = useMessages();
  const complete = !editing && Boolean(recipient.name.trim() && recipient.phone.trim());
  return (
    <CheckoutSection
      id="co-recipient"
      step={1}
      done={complete}
      title={m.checkoutRecipient}
      action={
        editing ? null : (
          <button type="button" onClick={onEdit} className="text-link">
            {m.checkoutEdit}
          </button>
        )
      }
    >
      {editing ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <TextField
            label={m.checkoutName}
            autoComplete="name"
            value={recipient.name}
            error={errors.name}
            onChange={(event) => onChange({ ...recipient, name: event.target.value })}
          />
          <PhoneField
            label={m.checkoutPhone}
            hint={m.checkoutPhoneHint}
            placeholder="01x xxxx xxxx"
            value={recipient.phone}
            error={errors.phone}
            maxLength={16}
            onChange={(event) => onChange({ ...recipient, phone: event.target.value.replace(/[^\d٠-٩۰-۹\s+-]/g, '') })}
          />
          <span className="lg:col-span-2">
            <Button variant="light" size="s" onClick={onDone}>
              {m.checkoutDone}
            </Button>
          </span>
        </div>
      ) : (
        <p className="m-0 flex flex-wrap items-baseline gap-x-3.5 gap-y-1.5 text-15">
          <strong className="font-bold text-ink">{recipient.name}</strong>
          <bdi dir="ltr" className="tabular-nums text-stone">
            {displayMobile(recipient.phone)}
          </bdi>
          {fromAccount ? <span className="text-13 text-stone">{m.checkoutFromAccount}</span> : null}
        </p>
      )}
    </CheckoutSection>
  );
}

/* ── ٢ عنوان التوصيل ───────────────────────────────────────────────────── */

export type AddressErrors = Partial<Record<'governorate' | 'area' | 'shippingAddress' | 'pin', string>>;

export function AddressSection({
  addresses,
  selectedId,
  onSelect,
  draft,
  onDraft,
  errors,
  saveState,
  onSaveNew,
  onCancelNew,
  pin,
  pinError,
  onPinChange,
}: {
  addresses: CustomerAddress[];
  selectedId: string | 'new' | null;
  onSelect: (id: string | 'new') => void;
  draft: NewAddressDraft;
  onDraft: (next: NewAddressDraft) => void;
  errors: AddressErrors;
  saveState: AsyncState;
  onSaveNew: () => void;
  onCancelNew: () => void;
  /** Pin of the selected saved address (editable here). */
  pin: LocationPin | null;
  pinError?: string;
  onPinChange: (pin: LocationPin | null) => void;
}) {
  const m = useMessages();
  const adding = selectedId === 'new';
  const selected = addresses.find((address) => address.id === selectedId) ?? null;
  const done = Boolean(selected && pin?.confirmed);
  const governorateName = (value: string) => {
    const g = toGovernorate(value);
    return g === 'Cairo' ? m.checkoutCairo : g === 'Giza' ? m.checkoutGiza : value;
  };
  const otherAddress = addresses.find((address) => address.id !== selectedId);
  const areaCentre = (area: string) => {
    const match = CAIRO_GIZA_AREAS.find((a) => a.nameAr === area.trim() || a.nameEn.toLowerCase() === area.trim().toLowerCase());
    return match ? { lat: match.lat, lng: match.lng } : undefined;
  };

  return (
    <CheckoutSection id="co-address" step={2} done={done} title={m.checkoutAddressTitle}>
      {addresses.length ? (
        <div role="radiogroup" aria-labelledby="co-address" className="grid gap-2.5 lg:grid-cols-2">
          {addresses.map((address) => {
            const checked = address.id === selectedId;
            return (
              <label
                key={address.id}
                className={cn(
                  'relative flex cursor-pointer items-start gap-3 rounded-16 px-4 py-3.5',
                  checked ? 'bg-cobalt/10 shadow-outline-cobalt' : 'bg-linen shadow-outline-control'
                )}
              >
                <input
                  type="radio"
                  name="co-address"
                  className="sr-only"
                  checked={checked}
                  onChange={() => onSelect(address.id)}
                />
                <RadioMark checked={checked} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-15 font-bold text-ink">{address.label || address.area}</span>
                  <span className="text-14 leading-22 text-ink">
                    {[address.shippingAddress, address.area, governorateName(address.governorate)].filter(Boolean).join('، ')}
                  </span>
                  {address.notes ? <span className="text-13 leading-20 text-stone">{address.notes}</span> : null}
                  <span className="mt-0.5 inline-flex items-center gap-1.5 text-12.5 font-semibold text-ok">
                    <span aria-hidden="true" className="size-1.75 rounded-full bg-ok" />
                    {fillMessage(m.checkoutAddressDeliverable, { governorate: governorateName(address.governorate) })}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      ) : null}

      {addresses.length && !adding ? (
        <button
          type="button"
          onClick={() => onSelect('new')}
          className="inline-flex min-h-control-s items-center gap-2 self-start px-1 text-14.5 font-semibold text-cobalt underline underline-offset-[6px]"
        >
          <Icon name="plus" size={18} />
          {m.checkoutNewAddress}
        </button>
      ) : null}

      {adding ? (
        <div className="flex flex-col gap-4">
          <TextField
            label={m.checkoutAddressLabel}
            optionalLabel={m.checkoutOptional}
            placeholder={m.checkoutAddressLabelHint}
            value={draft.label}
            onChange={(event) => onDraft({ ...draft, label: event.target.value })}
          />
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend id="co-governorate-label" className="mb-2 text-14 font-semibold text-ink">{m.checkoutGovernorate}</legend>
            <span role="radiogroup" aria-labelledby="co-governorate-label" aria-invalid={errors.governorate ? true : undefined} aria-describedby={errors.governorate ? 'co-governorate-error' : undefined} tabIndex={errors.governorate ? -1 : undefined} className="flex gap-2">
              {(['Cairo', 'Giza'] as Governorate[]).map((g) => {
                const checked = draft.governorate === g;
                return (
                  <label
                    key={g}
                    className={cn(
                      'inline-flex min-h-control-s cursor-pointer items-center gap-2 rounded-pill px-4.5 text-14.5 font-semibold',
                      checked ? 'bg-cobalt/10 text-cobalt-deep shadow-outline-cobalt' : 'bg-linen text-ink shadow-outline-control'
                    )}
                  >
                    <input type="radio" name="co-governorate" className="sr-only" checked={checked} onChange={() => onDraft({ ...draft, governorate: g })} />
                    {g === 'Cairo' ? m.checkoutCairo : m.checkoutGiza}
                  </label>
                );
              })}
            </span>
            {errors.governorate ? <InlineError id="co-governorate-error">{errors.governorate}</InlineError> : null}
          </fieldset>
          <div className="grid gap-4 lg:grid-cols-2">
            <TextField
              label={m.checkoutArea}
              placeholder={m.checkoutAreaHint}
              autoComplete="address-level2"
              value={draft.area}
              error={errors.area}
              onChange={(event) => onDraft({ ...draft, area: event.target.value })}
            />
            <TextField
              label={m.checkoutAddress}
              placeholder={m.checkoutAddressHint}
              autoComplete="street-address"
              value={draft.shippingAddress}
              error={errors.shippingAddress}
              onChange={(event) => onDraft({ ...draft, shippingAddress: event.target.value })}
            />
          </div>
          <TextField
            label={m.checkoutNotes}
            optionalLabel={m.checkoutOptional}
            value={draft.notes}
            onChange={(event) => onDraft({ ...draft, notes: event.target.value })}
          />
          <PinBlock>
            <DeliveryLocationPicker
              value={draft.pin}
              onChange={(next) => onDraft({ ...draft, pin: next })}
              error={errors.pin}
              initialCenter={areaCentre(draft.area)}
            />
          </PinBlock>
          <span className="flex flex-wrap items-center gap-2.5">
            <AsyncButton
              variant="ink"
              state={saveState}
              pendingLabel={m.checkoutSavingAddress}
              successLabel={m.checkoutAddressSaved}
              onClick={onSaveNew}
            >
              {m.checkoutSaveAddress}
            </AsyncButton>
            {addresses.length ? (
              <Button variant="text" onClick={onCancelNew}>
                {m.checkoutCancel}
              </Button>
            ) : null}
          </span>
          {saveState === 'error' ? (
            <MessageBox tone="err" role="alert">
              {m.checkoutAddressSaveFailed}
            </MessageBox>
          ) : null}
        </div>
      ) : selected ? (
        <PinBlock>
          <DeliveryLocationPicker
            value={pin}
            onChange={onPinChange}
            error={pinError}
            onChooseOther={otherAddress ? () => onSelect(otherAddress.id) : () => onSelect('new')}
          />
        </PinBlock>
      ) : null}
    </CheckoutSection>
  );
}

function PinBlock({ children }: { children: ReactNode }) {
  const m = useMessages();
  return (
    <div className="flex flex-col gap-2.5">
      <p className="m-0 flex items-center gap-1.5 text-14 font-semibold text-ink">
        <Icon name="pin" size={18} />
        {m.checkoutPinTitle}
        <span className="text-13 font-normal text-stone">{m.checkoutPinRequired}</span>
      </p>
      {children}
    </div>
  );
}

function RadioMark({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'mt-0.5 grid size-5 flex-none place-items-center rounded-pill',
        checked ? 'bg-cobalt text-white' : 'bg-linen shadow-outline-check'
      )}
    >
      {checked ? <Icon name="check" size={13} strokeWidth={3} /> : null}
    </span>
  );
}

export function InlineError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="m-0 flex items-start gap-2 text-13.5 leading-22 text-tomato-ink">
      <span aria-hidden="true" className="mt-2 size-1.75 flex-none rounded-full bg-tomato-ink" />
      {children}
    </p>
  );
}

/* ── ٣ التوصيل ─────────────────────────────────────────────────────────── */

export type QuoteStatus = 'waiting' | 'loading' | 'ready' | 'error';

export function DeliverySection({
  area,
  status,
  quote,
  previousFee,
  onRetry,
}: {
  area: string | null;
  status: QuoteStatus;
  quote: CheckoutQuote | null;
  /** Fee of the quote before the address or pin changed; shows «اتغيّرت» / «زي ما هي». */
  previousFee: number | null;
  onRetry: () => void;
}) {
  const m = useMessages();
  const locale = useLocale();
  const ready = status === 'ready' && quote;
  const feeChanged = ready && previousFee !== null && previousFee !== quote.shippingFee;
  const feeSame = ready && previousFee !== null && previousFee === quote.shippingFee;

  return (
    <CheckoutSection id="co-delivery" step={3} done={Boolean(ready)} title={m.checkoutDeliveryTitle}>
      <div className="flex items-center justify-between gap-3 rounded-16 bg-chalk px-4 py-3.5">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-15 font-bold text-ink">
            {area ? fillMessage(m.checkoutDeliveryTo, { area }) : m.checkoutDeliveryTitle}
          </span>
          <span className="text-13 leading-20 text-stone">{m.checkoutDeliveryPromise}</span>
        </span>
        <span className="flex-none text-15 font-bold text-ink">
          {status === 'waiting' ? (
            <span className="text-13.5 font-medium text-stone">{m.cartShippingLater}</span>
          ) : status === 'loading' ? (
            <span role="status" className="text-13.5 font-medium text-stone">
              {m.checkoutFeeCalculating}
            </span>
          ) : status === 'error' ? (
            <span className="text-13.5 font-semibold text-tomato-ink">{m.checkoutFeeFailed}</span>
          ) : ready ? (
            <span className="flex items-center gap-2">
              {feeChanged ? <Money amount={previousFee as number} struck className="text-13 font-medium text-stone" /> : null}
              {quote.shippingFee === 0 ? m.checkoutFree : <Money amount={quote.shippingFee} />}
            </span>
          ) : null}
        </span>
      </div>

      {status === 'error' ? (
        <MessageBox tone="err" role="alert">
          <p className="m-0 text-14 leading-22">{m.checkoutFeeFailedBody}</p>
          <Button variant="light" size="s" className="mt-2" onClick={onRetry}>
            <Icon name="retry" size={16} />
            {m.checkoutRecalculate}
          </Button>
        </MessageBox>
      ) : feeChanged ? (
        <MessageBox tone="warn" role="status">
          {fillMessage(m.checkoutFeeChanged, {
            old: formatEgp(previousFee as number, quote.currency, locale) ?? '',
            new: formatEgp(quote.shippingFee, quote.currency, locale) ?? '',
            total: formatEgp(quote.totalAmount, quote.currency, locale) ?? '',
          })}
        </MessageBox>
      ) : feeSame ? (
        <MessageBox tone="ok" role="status">
          {m.checkoutFeeSame}
        </MessageBox>
      ) : null}

      <p className="m-0 text-13 leading-20 text-stone">{m.checkoutFeeNote}</p>
    </CheckoutSection>
  );
}

/* ── ٤ طريقة الدفع ─────────────────────────────────────────────────────── */

/**
 * Cash on delivery is the only method offered for now (owner decision 2026-10-18): one selected option, no disabled
 * card or wallet rows. The API keeps CARD / MOBILE_WALLET for when a provider is connected.
 */
export function PaymentSection() {
  const m = useMessages();
  return (
    <CheckoutSection id="co-payment" step={4} done title={m.checkoutPaymentTitle}>
      <div role="radiogroup" aria-labelledby="co-payment">
        <label className="flex cursor-pointer items-center gap-3 rounded-16 bg-cobalt/10 px-4 py-3.5 shadow-outline-cobalt">
          <input type="radio" name="co-payment" value="COD" className="sr-only" checked readOnly />
          <RadioMark checked />
          <Icon name="cash" size={22} className="flex-none text-ink" />
          <span className="flex flex-col gap-0.5">
            <span className="text-15 font-bold text-ink">{m.checkoutCod}</span>
            <span className="text-13 leading-20 text-stone">{m.checkoutCodBody}</span>
          </span>
        </label>
      </div>
    </CheckoutSection>
  );
}
