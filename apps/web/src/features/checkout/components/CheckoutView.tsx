'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/AuthContext';
import { useAddresses } from '@/features/account/hooks/useAddresses';
import { type CustomerAddress } from '@/lib/addresses';
import { MessageBox } from '@/components/ui/message-box';
import { StatusChip } from '@/components/ui/status-chip';
import { Button, buttonVariants } from '@/components/ui/button';
import { PhoneField, TextField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { CART_QUERY_KEY, useCart } from '@/features/cart/hooks/useCart';
import { ApiError } from '@/lib/api-client';
import { createIdempotencyKey } from '@/lib/idempotency';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { formatEgp } from '@/lib/i18n/format';
import { fillMessage } from '@/lib/i18n/messages';
import { orders, type CheckoutQuote } from '@/lib/orders';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import {
  DeliveryLocationPicker,
  type LocationPin,
  isInsideServiceArea,
  isDefaultCentre,
} from './DeliveryLocationPicker';

interface Delivery {
  customerName: string;
  customerPhone: string;
  governorate: string;
  area: string;
  shippingAddress: string;
  notes: string;
}

const EMPTY: Delivery = { customerName: '', customerPhone: '', governorate: '', area: '', shippingAddress: '', notes: '' };
/** Same pattern the API validates (apps/api ordering/dto/order.dto.ts); checked here only to explain the fix early. */
const EGYPT_MOBILE = /^(\+201|01)[0-9]{9}$/;
const REQUIRED: Array<keyof Delivery> = ['customerName', 'customerPhone', 'governorate', 'area', 'shippingAddress'];

type Problem = 'quote' | 'submit' | 'validation' | null;

/**
 * Focused checkout: Delivery details → Review & place order (COD is the only live method, so there is
 * no payment step). The backend quote is the only source of totals; the idempotency key is created once
 * per reviewed quote, so retries after a lost response replay the same order instead of duplicating it.
 * A changed quote (409 CHECKOUT_REVIEW_REQUIRED) is re-fetched and shown as a change receipt; delivery
 * input and confirmed location pins are never cleared on any error.
 */
export function CheckoutView() {
  const m = useMessages();
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { cart, isLoading } = useCart();
  const [step, setStep] = useState<'delivery' | 'review'>('delivery');
  const [delivery, setDelivery] = useState<Delivery>(EMPTY);
  const [location, setLocation] = useState<LocationPin | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof Delivery, string>>>({});
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [changedFrom, setChangedFrom] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const idempotencyKey = useRef<string | null>(null);

  const { isAuthenticated } = useAuth();
  const { addresses, defaultAddress, createAddress } = useAddresses();
  const [selectedAddressId, setSelectedAddressId] = useState<string | 'new' | null>(null);
  const [saveToBook, setSaveToBook] = useState(false);
  const [newAddressLabel, setNewAddressLabel] = useState('');
  const initializedFromSaved = useRef(false);

  const applySavedAddress = (addr: CustomerAddress) => {
    setDelivery({
      customerName: addr.customerName,
      customerPhone: addr.customerPhone,
      governorate: addr.governorate,
      area: addr.area,
      shippingAddress: addr.shippingAddress,
      notes: addr.notes ?? '',
    });
    setLocation({
      latitude: addr.latitude,
      longitude: addr.longitude,
      locationSource: addr.locationSource,
      confirmed: true,
    });
    setLocationError(null);
    setErrors({});
  };

  useEffect(() => {
    if (isAuthenticated && addresses.length > 0 && !initializedFromSaved.current) {
      const initial = defaultAddress ?? addresses[0];
      if (initial) {
        initializedFromSaved.current = true;
        setSelectedAddressId(initial.id);
        applySavedAddress(initial);
      }
    }
  }, [isAuthenticated, addresses, defaultAddress]);

  const handleSelectSaved = (addr: CustomerAddress) => {
    setSelectedAddressId(addr.id);
    applySavedAddress(addr);
  };

  const handleSelectNew = () => {
    setSelectedAddressId('new');
    setDelivery(EMPTY);
    setLocation(null);
    setLocationError(null);
    setErrors({});
  };

  if (isLoading) return <Skeleton className="h-control-l w-full" />;
  if (!cart || cart.items.length === 0) {
    return (
      <Notice message={m.checkoutEmptyCart} action={<Link href={routes.products} className={buttonVariants()}>{m.pdpBackToProducts}</Link>} />
    );
  }
  if (cart.items.some((item) => !item.canOrder)) {
    return <Notice message={m.checkoutUnavailableItems} action={<Link href={routes.cart} className={buttonVariants()}>{m.checkoutBackToCart}</Link>} />;
  }

  const validate = () => {
    const next: Partial<Record<keyof Delivery, string>> = {};
    for (const key of REQUIRED) if (!delivery[key].trim()) next[key] = m.checkoutRequired;
    const phone = delivery.customerPhone.replace(/\s+/g, '');
    if (phone && !EGYPT_MOBILE.test(phone)) next.customerPhone = m.checkoutPhoneInvalid;

    // Validate service area for governorate (Cairo/Giza)
    const gov = delivery.governorate.trim().toLowerCase();
    if (gov && gov !== 'cairo' && gov !== 'giza' && gov !== 'القاهرة' && gov !== 'الجيزة') {
      next.governorate = m.checkoutMapOutOfService;
    }
    setErrors(next);

    // Validate mandatory customer-confirmed delivery pin
    let locErr: string | null = null;
    if (!location) {
      locErr = m.checkoutMapPinRequired;
    } else if (!location.confirmed) {
      locErr = m.checkoutMapConfirmRequired;
    } else if (!isInsideServiceArea(location.latitude, location.longitude)) {
      locErr = m.checkoutMapOutOfService;
    } else if (isDefaultCentre(location.latitude, location.longitude)) {
      locErr = m.checkoutMapImprobablePin;
    }
    setLocationError(locErr);

    return Object.keys(next).length === 0 && !locErr;
  };

  const requestQuote = async () => {
    const fresh = await orders.getQuote({ governorate: delivery.governorate.trim(), area: delivery.area.trim() });
    idempotencyKey.current = createIdempotencyKey();
    setQuote(fresh);
    return fresh;
  };

  const toReview = async () => {
    if (!validate()) return;
    setPending(true);
    setProblem(null);
    setChangedFrom(null);
    try {
      await requestQuote();
      setStep('review');
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        setErrors((prev) => ({ ...prev, governorate: m.checkoutQuoteOutOfArea }));
        setProblem('validation');
      } else {
        setProblem('quote');
      }
    } finally {
      setPending(false);
    }
  };

  const placeOrder = async () => {
    if (!quote || !idempotencyKey.current || !location || !location.confirmed) return;
    setPending(true);
    setProblem(null);
    try {
      if (isAuthenticated && selectedAddressId === 'new' && saveToBook) {
        try {
          await createAddress({
            label: newAddressLabel.trim() || undefined,
            customerName: delivery.customerName.trim(),
            customerPhone: delivery.customerPhone.replace(/\s+/g, ''),
            governorate: delivery.governorate.trim(),
            area: delivery.area.trim(),
            shippingAddress: delivery.shippingAddress.trim(),
            notes: delivery.notes.trim() || undefined,
            latitude: location.latitude,
            longitude: location.longitude,
            locationSource: location.locationSource,
          });
        } catch {
          // Do not block checkout if background address saving encounters an issue
        }
      }

      const order = await orders.checkout({
        customerName: delivery.customerName.trim(),
        customerPhone: delivery.customerPhone.replace(/\s+/g, ''),
        governorate: delivery.governorate.trim(),
        area: delivery.area.trim(),
        shippingAddress: delivery.shippingAddress.trim(),
        ...(delivery.notes.trim() ? { notes: delivery.notes.trim() } : {}),
        latitude: location.latitude,
        longitude: location.longitude,
        locationSource: location.locationSource,
        locationConfirmed: true,
        paymentMethod: 'COD',
        quoteVersion: quote.quoteVersion,
        cartRevision: quote.cartRevision,
        idempotencyKey: idempotencyKey.current,
      });
      queryClient.removeQueries({ queryKey: CART_QUERY_KEY });
      router.replace(`${routes.order(order.orderNumber)}?placed=1`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // Terms changed or the quote expired: show what changed and ask again; keep everything typed.
        const previous = quote.totalAmount;
        try {
          await requestQuote();
          setChangedFrom(previous);
        } catch {
          setProblem('quote');
        }
      } else if (error instanceof ApiError && (error.type === 'VALIDATION' || error.status === 422)) {
        if (error.status === 422) {
          const errData = error.data as { code?: string; message?: { code?: string } } | undefined;
          const code = errData?.code || errData?.message?.code;
          if (code === 'OUT_OF_SERVICE_AREA') {
            setLocationError(m.checkoutMapOutOfService);
          } else if (code === 'LOCATION_PIN_IMPROBABLE') {
            setLocationError(m.checkoutMapImprobablePin);
          } else {
            setLocationError(error.message);
          }
        }
        setProblem('validation');
        setStep('delivery');
      } else {
        // Network/server: the same key is kept so a retry cannot create a second order.
        setProblem('submit');
      }
      setPending(false);
    }
  };

  const field = (key: keyof Delivery) => ({
    value: delivery[key],
    error: errors[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      setDelivery({ ...delivery, [key]: event.target.value });
      if (errors[key]) setErrors({ ...errors, [key]: undefined });
    },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header className="space-y-1">
        <p className="text-12 text-ink-2">{fillMessage(m.checkoutStepOf, { i: step === 'delivery' ? 1 : 2, n: 2 })}</p>
        <h1 className="text-display-3 text-night">{step === 'delivery' ? m.checkoutStepDelivery : m.checkoutStepReview}</h1>
      </header>

      {problem ? (
        <MessageBox tone="err">
          <p className="text-14">
            {problem === 'quote' ? m.checkoutQuoteFailed : problem === 'validation' ? m.checkoutValidationFailed : m.checkoutSubmitFailed}
          </p>
        </MessageBox>
      ) : null}

      {step === 'delivery' ? (
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            toReview();
          }}
        >
          {/* Saved Addresses Section (when authenticated and has saved addresses) */}
          {isAuthenticated && addresses.length > 0 && (
            <div className="space-y-3 rounded-card border border-line bg-linen p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Icon name="pin" size={18} className="text-blue" />
                  <span className="text-title text-night">{m.checkoutUseSavedAddress}</span>
                </div>
                <Link
                  href={routes.accountAddresses}
                  target="_blank"
                  className="text-12 text-blue hover:underline"
                >
                  {m.addressBookManageInAccount}
                </Link>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {addresses.map((addr) => {
                  const isSelected = selectedAddressId === addr.id;
                  return (
                    <button
                      key={addr.id}
                      type="button"
                      onClick={() => handleSelectSaved(addr)}
                      className={cn(
                        'flex flex-col items-start gap-1.5 rounded-input border p-3 text-start transition-all',
                        isSelected
                          ? 'border-blue bg-blue-tint/30 shadow-elevation-1 ring-1 ring-blue'
                          : 'border-line bg-linen hover:border-line-2/40',
                      )}
                    >
                      <div className="flex w-full items-center justify-between gap-2">
                        <span className="text-14 font-semibold text-night font-medium">
                          {addr.label || addr.customerName}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {addr.isDefault && (
                            <StatusChip tone="gray" className="text-12 py-0 text-blue border-blue">
                              {m.addressBookDefaultBadge}
                            </StatusChip>
                          )}
                          {isSelected ? (
                            <Icon name="check" size={18} className="text-blue" />
                          ) : (
                            <span className="h-4 w-4 rounded-full border border-line" />
                          )}
                        </div>
                      </div>
                      <p className="text-12 text-ink-2">
                        {addr.shippingAddress}, {addr.area}, {addr.governorate}
                      </p>
                      <p dir="ltr" className="text-12 text-ink-3">
                        <bdi>{addr.customerPhone}</bdi>
                      </p>
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={handleSelectNew}
                  className={cn(
                    'flex flex-col items-center justify-center gap-1.5 rounded-input border border-dashed p-3 text-center transition-all min-h-[90px]',
                    selectedAddressId === 'new'
                      ? 'border-blue bg-blue-tint/30 shadow-elevation-1 ring-1 ring-blue'
                      : 'border-line bg-linen hover:border-line-2/40 text-ink-2',
                  )}
                >
                  <div className="flex items-center gap-1.5 text-14 font-semibold text-night">
                    <Icon name="plus" size={16} />
                    <span>{m.checkoutUseDifferentAddress}</span>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Form fields: shown if selectedAddressId === 'new' or not authenticated or no saved addresses */}
          {selectedAddressId === 'new' || !isAuthenticated || addresses.length === 0 ? (
            <>
              <TextField label={m.checkoutName} autoComplete="name" required {...field('customerName')} />
              <PhoneField
                label={m.checkoutPhone}
                hint={errors.customerPhone ? undefined : m.checkoutPhoneHint}
                placeholder="01012345678"
                required
                {...field('customerPhone')}
              />
              <div className="space-y-2">
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField label={m.checkoutGovernorate} autoComplete="address-level1" required {...field('governorate')} />
                  <TextField label={m.checkoutArea} autoComplete="address-level2" required {...field('area')} />
                </div>
                {/* Quick Governorate Buttons (Cairo / Giza) */}
                <div className="flex items-center gap-2">
                  <span className="text-12 text-ink-3">{m.checkoutGovernorate}:</span>
                  <button
                    type="button"
                    onClick={() => {
                      const val = locale === 'ar' ? 'القاهرة' : 'Cairo';
                      setDelivery((prev) => ({ ...prev, governorate: val }));
                      if (errors.governorate) setErrors((prev) => ({ ...prev, governorate: undefined }));
                    }}
                    className={cn(
                      'rounded-pill border px-2.5 py-1 text-12 transition-colors',
                      delivery.governorate.toLowerCase() === 'cairo' || delivery.governorate === 'القاهرة'
                        ? 'border-blue bg-blue-tint text-blue'
                        : 'border-line bg-linen text-ink-2 hover:bg-sand',
                    )}
                  >
                    <bdi>{locale === 'ar' ? 'القاهرة' : 'Cairo'}</bdi>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const val = locale === 'ar' ? 'الجيزة' : 'Giza';
                      setDelivery((prev) => ({ ...prev, governorate: val }));
                      if (errors.governorate) setErrors((prev) => ({ ...prev, governorate: undefined }));
                    }}
                    className={cn(
                      'rounded-pill border px-2.5 py-1 text-12 transition-colors',
                      delivery.governorate.toLowerCase() === 'giza' || delivery.governorate === 'الجيزة'
                        ? 'border-blue bg-blue-tint text-blue'
                        : 'border-line bg-linen text-ink-2 hover:bg-sand',
                    )}
                  >
                    <bdi>{locale === 'ar' ? 'الجيزة' : 'Giza'}</bdi>
                  </button>
                </div>
              </div>

              <TextField
                label={m.checkoutAddress}
                hint={errors.shippingAddress ? undefined : m.checkoutAddressHint}
                autoComplete="street-address"
                required
                {...field('shippingAddress')}
              />

              {/* Mandatory Map Location Picker with Customer Confirmation */}
              <DeliveryLocationPicker
                value={location}
                onChange={(next) => {
                  setLocation(next);
                  if (next?.confirmed) setLocationError(null);
                }}
                error={locationError ?? undefined}
              />

              <TextField label={m.checkoutNotes} optionalLabel={m.checkoutOptional} {...field('notes')} />

              {/* Save to address book option for authenticated customers */}
              {isAuthenticated && (
                <div className="space-y-2 rounded-input border border-line bg-linen p-3">
                  <label className="flex cursor-pointer items-center gap-2 text-14">
                    <input
                      type="checkbox"
                      checked={saveToBook}
                      onChange={(e) => setSaveToBook(e.target.checked)}
                      className="rounded border-line text-blue focus:ring-blue"
                    />
                    <span>{m.checkoutSaveThisAddress}</span>
                  </label>
                  {saveToBook && (
                    <TextField
                      label={m.addressBookLabelOptional}
                      placeholder={locale === 'ar' ? 'مثال: البيت، المكتب' : 'e.g. Home, Office'}
                      value={newAddressLabel}
                      onChange={(e) => setNewAddressLabel(e.target.value)}
                    />
                  )}
                </div>
              )}
            </>
          ) : (
            /* Selected Saved Address Preview Card */
            <div className="space-y-3 rounded-card border border-blue/40 bg-linen p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-title text-night">
                  {m.checkoutDeliveryTo}: {delivery.customerName}
                </span>
                <StatusChip tone="gray" className="border-blue text-blue text-12">
                  <Icon name="check" size={14} className="me-1" />
                  {m.checkoutDeliverToThisAddress}
                </StatusChip>
              </div>
              <p className="text-14 text-ink-2">
                {[delivery.shippingAddress, delivery.area, delivery.governorate].filter(Boolean).join('، ')}
              </p>
              <p dir="ltr" className="text-14 text-ink-2 text-start">
                <bdi>{delivery.customerPhone}</bdi>
              </p>
              {location && (
                <div className="flex flex-wrap items-center gap-2 pt-1 text-12 text-ink-2">
                  <Icon name="pin" size={16} className="text-blue" />
                  <span>{m.orderConfirmedLocation}:</span>
                  <bdi>
                    {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
                  </bdi>
                  <StatusChip tone="ok" className="px-1.5 py-0 text-12">
                    {m.checkoutMapConfirmed}
                  </StatusChip>
                </div>
              )}
              <TextField label={m.checkoutNotes} optionalLabel={m.checkoutOptional} {...field('notes')} />
            </div>
          )}

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-between">
            <Link href={routes.cart} className={buttonVariants({ variant: 'light' })}>
              {m.checkoutBackToCart}
            </Link>
            <Button type="submit" size="l" loading={pending}>
              {m.checkoutContinue}
            </Button>
          </div>
        </form>
      ) : quote ? (
        <Review
          quote={quote}
          delivery={delivery}
          location={location}
          changedFrom={changedFrom}
          pending={pending}
          onEditDelivery={() => setStep('delivery')}
          onPlaceOrder={placeOrder}
        />
      ) : null}
    </div>
  );
}

function Review({
  quote,
  delivery,
  location,
  changedFrom,
  pending,
  onEditDelivery,
  onPlaceOrder,
}: {
  quote: CheckoutQuote;
  delivery: Delivery;
  location: LocationPin | null;
  changedFrom: number | null;
  pending: boolean;
  onEditDelivery: () => void;
  onPlaceOrder: () => void;
}) {
  const m = useMessages();
  const locale = useLocale();
  const money = (value: number) => formatEgp(value, quote.currency, locale) ?? '';
  const discount = Math.round((quote.subtotal + quote.shippingFee - quote.totalAmount) * 100) / 100;

  return (
    <div className="space-y-4">
      {changedFrom !== null ? (
        <MessageBox tone="warn">
          <div className="text-14">
            <p className="font-semibold">{m.checkoutChangedTitle}</p>
            <p>
              {changedFrom !== quote.totalAmount
                ? fillMessage(m.checkoutChangedTotal, { old: money(changedFrom), new: money(quote.totalAmount) })
                : m.checkoutChangedSame}
            </p>
          </div>
        </MessageBox>
      ) : null}

      <ReviewGroup title={m.checkoutItems} edit={<Link href={routes.cart} className={buttonVariants({ variant: 'text' })}>{m.checkoutEdit}</Link>}>
        <ul className="space-y-2">
          {quote.items.map((item) => (
            <li key={item.skuId} className="flex justify-between gap-3 text-14">
              <span dir="auto" className="min-w-0 text-match-parent">
                {item.productName}
                {item.variantName ? <span className="text-ink-3"> · <bdi>{item.variantName}</bdi></span> : null}
                <span className="text-ink-3"> × <bdi>{item.quantity}</bdi></span>
              </span>
              <bdi className="shrink-0 tabular-nums text-night">{money(item.lineTotal)}</bdi>
            </li>
          ))}
        </ul>
      </ReviewGroup>

      <ReviewGroup title={m.checkoutDeliveryTo} edit={<Button variant="text" onClick={onEditDelivery}>{m.checkoutEdit}</Button>}>
        <p className="text-14 text-night">{delivery.customerName}</p>
        <p className="text-14 text-ink-2">
          <bdi dir="ltr">{delivery.customerPhone}</bdi>
        </p>
        <p className="text-14 text-ink-2">
          {[delivery.shippingAddress, delivery.area, delivery.governorate].filter(Boolean).join('، ')}
        </p>
        {location ? (
          <div className="flex flex-wrap items-center gap-2 pt-1 text-12 text-ink-2">
            <Icon name="pin" size={16} className="text-blue" />
            <span>{m.orderConfirmedLocation}:</span>
            <bdi>
              {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
            </bdi>
            <StatusChip tone="ok" className="px-1.5 py-0 text-12">
              {m.checkoutMapConfirmed}
            </StatusChip>
          </div>
        ) : null}
        {delivery.notes ? <p className="text-14 text-ink-3">{delivery.notes}</p> : null}
      </ReviewGroup>

      <ReviewGroup title={m.checkoutPayment}>
        <p className="text-14 text-night">{m.checkoutPaymentCod}</p>
      </ReviewGroup>

      <section aria-labelledby="checkout-totals" className="space-y-2 rounded-card border border-line bg-linen p-4">
        <h2 id="checkout-totals" className="sr-only">
          {m.cartSummary}
        </h2>
        <dl className="space-y-2 text-14">
          <Row label={m.checkoutSubtotal} value={money(quote.subtotal)} />
          {discount > 0 ? <Row label={m.checkoutDiscount} value={`− ${money(discount)}`} /> : null}
          <Row label={m.checkoutShipping} value={quote.shippingFee === 0 ? m.checkoutFree : money(quote.shippingFee)} />
          <div className="flex justify-between gap-3 border-t border-line pt-2">
            <dt className="text-14 font-semibold text-night">{m.checkoutCodTotal}</dt>
            <dd className="text-price tabular-nums text-night">
              <bdi>{money(quote.codAmount)}</bdi>
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="checkout-confidence" className="space-y-2 rounded-card bg-sand p-4">
        <h2 id="checkout-confidence" className="text-title text-night">
          {m.checkoutConfidenceTitle}
        </h2>
        <p className="flex items-start gap-2 text-14 text-ink-2">
          <Icon name="pin" size={18} className="mt-0.5 shrink-0" />
          <span>
            <bdi>{quote.area}</bdi>، <bdi>{quote.governorate}</bdi>
          </span>
        </p>
        <p className="flex items-start gap-2 text-14 text-ink-2">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
          {m.checkoutPromise}
        </p>
        <p className="flex items-start gap-2 text-14 text-ink-2">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
          {m.checkoutAvailabilityCaveat}
        </p>
      </section>

      <Button size="l" className="w-full" loading={pending} onClick={onPlaceOrder}>
        {m.checkoutPlaceOrder}
      </Button>
    </div>
  );
}

function ReviewGroup({ title, edit, children }: { title: string; edit?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-card border border-line bg-linen p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-title text-night">{title}</h2>
        {edit}
      </div>
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

function Notice({ message, action }: { message: string; action: React.ReactNode }) {
  return (
    <div className={cn('mx-auto max-w-xl rounded-card border border-line bg-linen px-5 py-8 text-center')}>
      <p className="text-body text-night">{message}</p>
      <div className="mt-5 flex justify-center">{action}</div>
    </div>
  );
}
