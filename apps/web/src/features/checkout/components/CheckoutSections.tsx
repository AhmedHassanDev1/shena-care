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

/* ── Checkout Stepper Progress Ribbon ─────────────────────────────────── */

export function CheckoutProgressRibbon({ currentStep, doneSteps }: { currentStep: number; doneSteps: number[] }) {
  const m = useMessages();
  const locale = useLocale();

  const steps = [
    { num: 1, label: m.checkoutStepRecipient },
    { num: 2, label: m.checkoutStepAddress },
    { num: 3, label: m.checkoutStepDelivery },
    { num: 4, label: m.checkoutStepPayment },
  ];

  return (
    <nav aria-label="مراحل إتمام الطلب" className="mb-6 rounded-24 bg-linen p-4 shadow-elevation-1">
      <ol className="m-0 flex list-none items-center justify-between p-0">
        {steps.map((step, idx) => {
          const isDone = doneSteps.includes(step.num);
          const isCurrent = currentStep === step.num;
          const isLast = idx === steps.length - 1;

          return (
            <li key={step.num} className="flex flex-1 items-center">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid size-8 flex-none place-items-center rounded-pill font-display text-13 font-bold transition-all duration-base',
                    isDone
                      ? 'bg-ok text-white shadow-elevation-1'
                      : isCurrent
                        ? 'bg-cobalt text-chalk shadow-elevation-1 ring-4 ring-cobalt/20'
                        : 'bg-sand/60 text-stone'
                  )}
                >
                  {isDone ? <Icon name="check" size={16} strokeWidth={2.8} /> : formatNumber(step.num, locale)}
                </span>
                <span
                  className={cn(
                    'hidden text-13 font-semibold sm:inline',
                    isCurrent ? 'font-bold text-ink' : isDone ? 'text-ink' : 'text-stone'
                  )}
                >
                  {step.label}
                </span>
              </div>
              {!isLast ? (
                <div
                  aria-hidden="true"
                  className={cn(
                    'mx-2 h-0.5 flex-1 transition-colors duration-base',
                    isDone ? 'bg-ok' : 'bg-line'
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ── Section frame ─────────────────────────────────────────────────────── */

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
    <section
      aria-labelledby={id}
      className={cn(
        'flex flex-col gap-4 rounded-24 bg-linen p-5 shadow-elevation-1 transition-all duration-base hover:shadow-elevation-2 lg:p-7',
        done && 'border border-ok/20'
      )}
    >
      <div className="flex items-center gap-3.5 pb-1">
        <span
          aria-hidden="true"
          className={cn(
            'grid size-8 flex-none place-items-center rounded-pill font-display text-14 font-bold transition-colors duration-fast',
            done ? 'bg-ok text-white shadow-elevation-1' : 'bg-ink text-linen'
          )}
        >
          {done ? <Icon name="check" size={17} strokeWidth={2.6} /> : formatNumber(step, locale)}
        </span>
        <h2 id={id} className="m-0 font-display text-22 font-bold leading-28 text-ink lg:text-24">
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
          <button
            type="button"
            onClick={onEdit}
            className="rounded-pill px-3 py-1 text-13 font-semibold text-cobalt transition-colors hover:bg-sand/40 hover:text-cobalt-deep"
          >
            {m.checkoutEdit}
          </button>
        )
      }
    >
      {editing ? (
        <div className="flex flex-col gap-4">
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
          </div>
          <div className="flex items-center gap-3 pt-1">
            <Button variant="ink" size="s" onClick={onDone}>
              {m.checkoutDone}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-16 bg-chalk/60 px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1 text-15">
            <span className="font-bold text-ink">{recipient.name}</span>
            <span className="text-stone">·</span>
            <bdi dir="ltr" className="tabular-nums font-semibold text-ink">
              {displayMobile(recipient.phone)}
            </bdi>
            {fromAccount ? (
              <span className="rounded-pill bg-sand/60 px-2 py-0.5 text-12 font-medium text-stone">
                {m.checkoutFromAccount}
              </span>
            ) : null}
          </div>
        </div>
      )}
    </CheckoutSection>
  );
}

/* ── ٢ عنوان التوصيل ───────────────────────────────────────────────────── */

export type AddressErrors = Partial<Record<'governorate' | 'area' | 'shippingAddress' | 'pin', string>>;

export type DraftUpdater = NewAddressDraft | ((prev: NewAddressDraft) => NewAddressDraft);

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
  isEditingSelected = false,
  onStartEditSelected,
}: {
  addresses: CustomerAddress[];
  selectedId: string | 'new' | null;
  onSelect: (id: string | 'new') => void;
  draft: NewAddressDraft;
  onDraft: (updater: DraftUpdater) => void;
  errors: AddressErrors;
  saveState: AsyncState;
  onSaveNew: () => void;
  onCancelNew: () => void;
  pin: LocationPin | null;
  pinError?: string;
  onPinChange: (pin: LocationPin | null) => void;
  isEditingSelected?: boolean;
  onStartEditSelected?: () => void;
}) {
  const m = useMessages();
  const adding = selectedId === 'new' || isEditingSelected;
  const selected = addresses.find((address) => address.id === selectedId) ?? null;
  const done = Boolean(selected && pin?.confirmed && !isEditingSelected);

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
      {addresses.length && !adding ? (
        <div role="radiogroup" aria-labelledby="co-address" className="grid gap-3 lg:grid-cols-2">
          {addresses.map((address) => {
            const checked = address.id === selectedId;
            return (
              <label
                key={address.id}
                className={cn(
                  'relative flex cursor-pointer items-start gap-3.5 rounded-24 p-4 transition-all duration-fast',
                  checked
                    ? 'bg-cobalt/5 shadow-outline-cobalt ring-2 ring-cobalt/15'
                    : 'bg-linen shadow-outline-control hover:bg-sand/20'
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
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-16 font-bold text-ink">{address.label || address.area}</span>
                    <span className="inline-flex items-center gap-1.5 rounded-pill bg-ok-tint px-2 py-0.5 text-11 font-semibold text-ok">
                      <span aria-hidden="true" className="size-1.5 rounded-full bg-ok" />
                      {fillMessage(m.checkoutAddressDeliverable, { governorate: governorateName(address.governorate) })}
                    </span>
                  </div>
                  <p className="m-0 text-13.5 leading-20 text-stone">
                    {[address.shippingAddress, address.area, governorateName(address.governorate)].filter(Boolean).join('، ')}
                  </p>
                  {address.notes ? <p className="m-0 text-12 text-stone/80">{address.notes}</p> : null}
                  {checked && onStartEditSelected ? (
                    <div className="pt-1.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          onStartEditSelected();
                        }}
                        className="text-12 font-semibold text-cobalt hover:underline"
                      >
                        {m.checkoutEditAddress}
                      </button>
                    </div>
                  ) : null}
                </div>
              </label>
            );
          })}
        </div>
      ) : null}

      {addresses.length && !adding ? (
        <button
          type="button"
          onClick={() => onSelect('new')}
          className="inline-flex min-h-control-s items-center gap-2 self-start rounded-pill px-3 py-1 text-14 font-semibold text-cobalt transition-colors hover:bg-sand/40 hover:text-cobalt-deep"
        >
          <Icon name="plus" size={17} />
          <span>{m.checkoutNewAddress}</span>
        </button>
      ) : null}

      {adding ? (
        <div className="flex flex-col gap-4 rounded-24 bg-chalk/40 p-4">
          <PinBlock>
            <DeliveryLocationPicker
              value={draft.pin}
              onChange={(next) => onDraft((prev) => ({ ...prev, pin: next }))}
              onAddressResolved={(sugg) => {
                onDraft((prev) => ({
                  ...prev,
                  governorate: sugg.governorate,
                  area: prev.area.trim() ? prev.area : sugg.area,
                  shippingAddress: prev.shippingAddress.trim() ? prev.shippingAddress : sugg.streetAddress,
                  building: prev.building || sugg.building || '',
                }));
              }}
              error={errors.pin}
              initialCenter={areaCentre(draft.area)}
            />
          </PinBlock>

          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend id="co-governorate-label" className="mb-1.5 text-13.5 font-semibold text-ink">
              {m.checkoutGovernorate}
            </legend>
            <div
              role="radiogroup"
              aria-labelledby="co-governorate-label"
              aria-invalid={errors.governorate ? true : undefined}
              className="flex gap-2.5"
            >
              {(['Cairo', 'Giza'] as Governorate[]).map((g) => {
                const checked = draft.governorate === g;
                return (
                  <label
                    key={g}
                    className={cn(
                      'inline-flex min-h-control-s cursor-pointer items-center gap-2 rounded-pill px-5 text-14 font-semibold transition-all',
                      checked
                        ? 'bg-ink text-chalk shadow-elevation-1'
                        : 'bg-linen text-ink shadow-outline-control hover:bg-sand/40'
                    )}
                  >
                    <input
                      type="radio"
                      name="co-governorate"
                      className="sr-only"
                      checked={checked}
                      onChange={() => onDraft((prev) => ({ ...prev, governorate: g }))}
                    />
                    {g === 'Cairo' ? m.checkoutCairo : m.checkoutGiza}
                  </label>
                );
              })}
            </div>
            {errors.governorate ? <InlineError id="co-governorate-error">{errors.governorate}</InlineError> : null}
          </fieldset>

          <div className="grid gap-4 lg:grid-cols-2">
            <TextField
              label={m.checkoutArea}
              placeholder={m.checkoutAreaHint}
              autoComplete="address-level2"
              value={draft.area}
              error={errors.area}
              onChange={(event) => onDraft((prev) => ({ ...prev, area: event.target.value }))}
            />
            <TextField
              label={m.checkoutAddress}
              placeholder={m.checkoutAddressHint}
              autoComplete="street-address"
              value={draft.shippingAddress}
              error={errors.shippingAddress}
              onChange={(event) => onDraft((prev) => ({ ...prev, shippingAddress: event.target.value }))}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <TextField
              label={m.checkoutBuilding}
              optionalLabel={m.checkoutOptional}
              placeholder={m.checkoutBuildingHint}
              value={draft.building ?? ''}
              onChange={(event) => onDraft((prev) => ({ ...prev, building: event.target.value }))}
            />
            <TextField
              label={m.checkoutFloor}
              optionalLabel={m.checkoutOptional}
              placeholder={m.checkoutFloorHint}
              value={draft.floor ?? ''}
              onChange={(event) => onDraft((prev) => ({ ...prev, floor: event.target.value }))}
            />
            <TextField
              label={m.checkoutApartment}
              optionalLabel={m.checkoutOptional}
              placeholder={m.checkoutApartmentHint}
              value={draft.apartment ?? ''}
              onChange={(event) => onDraft((prev) => ({ ...prev, apartment: event.target.value }))}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <TextField
              label={m.checkoutLandmark}
              optionalLabel={m.checkoutOptional}
              placeholder={m.checkoutLandmarkHint}
              value={draft.notes}
              onChange={(event) => onDraft((prev) => ({ ...prev, notes: event.target.value }))}
            />
            <TextField
              label={m.checkoutAddressLabel}
              optionalLabel={m.checkoutOptional}
              placeholder={m.checkoutAddressLabelHint}
              value={draft.label}
              onChange={(event) => onDraft((prev) => ({ ...prev, label: event.target.value }))}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
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
              <Button variant="light" onClick={onCancelNew}>
                {m.checkoutCancel}
              </Button>
            ) : null}
          </div>

          {saveState === 'error' ? (
            <MessageBox tone="err" role="alert" className="rounded-16">
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
    <div className="flex flex-col gap-2.5 pt-1">
      <div className="flex items-center gap-2 text-14 font-semibold text-ink">
        <Icon name="pin" size={17} className="text-cobalt" />
        <span>{m.checkoutPinTitle}</span>
        <span className="text-12 font-normal text-stone">{m.checkoutPinRequired}</span>
      </div>
      {children}
    </div>
  );
}

function RadioMark({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'mt-0.5 grid size-5 flex-none place-items-center rounded-pill transition-colors',
        checked ? 'bg-cobalt text-white' : 'bg-linen shadow-outline-check'
      )}
    >
      {checked ? <Icon name="check" size={12} strokeWidth={3} /> : null}
    </span>
  );
}

export function InlineError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="m-0 flex items-start gap-2 text-13.5 leading-20 text-tomato-ink">
      <span aria-hidden="true" className="mt-1.5 size-1.5 flex-none rounded-full bg-tomato-ink" />
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
      <div className="flex items-center justify-between gap-4 rounded-24 bg-chalk/70 p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-pill bg-sand text-ink shadow-elevation-1">
            <Icon name="truck" size={20} />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-display text-16 font-bold text-ink">
              {area ? fillMessage(m.checkoutDeliveryTo, { area }) : m.checkoutDeliveryTitle}
            </span>
            <span className="text-13 leading-20 text-stone">{m.checkoutDeliveryPromise}</span>
          </div>
        </div>

        <div className="flex-none font-display text-16 font-bold text-ink">
          {status === 'waiting' ? (
            <span className="text-13 text-stone">{m.cartShippingLater}</span>
          ) : status === 'loading' ? (
            <span role="status" className="flex items-center gap-2 text-13 text-stone">
              <span className="size-2 rounded-full bg-cobalt animate-pulse" />
              {m.checkoutFeeCalculating}
            </span>
          ) : status === 'error' ? (
            <span className="text-13 font-semibold text-tomato-ink">{m.checkoutFeeFailed}</span>
          ) : ready ? (
            <div className="flex items-center gap-2">
              {feeChanged ? <Money amount={previousFee as number} struck className="text-13 font-medium text-stone" /> : null}
              {quote.shippingFee === 0 ? (
                <span className="rounded-pill bg-ok-tint px-2.5 py-0.5 text-13 font-bold text-ok">
                  {m.checkoutFree}
                </span>
              ) : (
                <Money amount={quote.shippingFee} className="font-display text-17 font-bold text-ink" />
              )}
            </div>
          ) : null}
        </div>
      </div>

      {status === 'error' ? (
        <MessageBox tone="err" role="alert" className="rounded-16">
          <p className="m-0 text-14 leading-22">{m.checkoutFeeFailedBody}</p>
          <Button variant="light" size="s" className="mt-2.5" onClick={onRetry}>
            <Icon name="retry" size={16} />
            {m.checkoutRecalculate}
          </Button>
        </MessageBox>
      ) : feeChanged ? (
        <MessageBox tone="warn" role="status" className="rounded-16">
          {fillMessage(m.checkoutFeeChanged, {
            old: formatEgp(previousFee as number, quote.currency, locale) ?? '',
            new: formatEgp(quote.shippingFee, quote.currency, locale) ?? '',
            total: formatEgp(quote.totalAmount, quote.currency, locale) ?? '',
          })}
        </MessageBox>
      ) : feeSame ? (
        <MessageBox tone="ok" role="status" className="rounded-16">
          {m.checkoutFeeSame}
        </MessageBox>
      ) : null}

      <p className="m-0 text-13 leading-20 text-stone">{m.checkoutFeeNote}</p>
    </CheckoutSection>
  );
}

/* ── ٤ طريقة الدفع ─────────────────────────────────────────────────────── */

export function PaymentSection() {
  const m = useMessages();
  return (
    <CheckoutSection id="co-payment" step={4} done title={m.checkoutPaymentTitle}>
      <div role="radiogroup" aria-labelledby="co-payment">
        <label className="flex cursor-pointer items-start gap-4 rounded-24 bg-cobalt/5 p-4.5 shadow-outline-cobalt ring-2 ring-cobalt/15">
          <input type="radio" name="co-payment" value="COD" className="sr-only" checked readOnly />
          <RadioMark checked />
          <div className="grid size-11 flex-none place-items-center rounded-pill bg-sand text-ink shadow-elevation-1">
            <Icon name="cash" size={22} />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="font-display text-16 font-bold text-ink">{m.checkoutCod}</span>
              <span className="rounded-pill bg-ok-tint px-2 py-0.5 text-11 font-semibold text-ok">
                {m.checkoutDone}
              </span>
            </div>
            <span className="text-13 leading-21 text-stone">{m.checkoutCodBody}</span>
          </div>
        </label>
      </div>
    </CheckoutSection>
  );
}
