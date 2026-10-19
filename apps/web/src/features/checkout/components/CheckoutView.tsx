'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { AsyncButton, buttonVariants, type AsyncState } from '@/components/ui/button';
import { MessageBox } from '@/components/ui/message-box';
import { Skeleton } from '@/components/ui/skeleton';
import { useAddresses } from '@/features/account/hooks/useAddresses';
import { useAuth } from '@/features/auth/AuthContext';
import { apiErrorCode, signInHref, toLatinDigits } from '@/features/auth/lib/auth-helpers';
import { CART_QUERY_KEY, useCart } from '@/features/cart/hooks/useCart';
import type { CustomerAddress } from '@/lib/addresses';
import { ApiError } from '@/lib/api-client';
import { createIdempotencyKey } from '@/lib/idempotency';
import { formatEgp } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { orders, type CheckoutQuote } from '@/lib/orders';
import { routes } from '@/lib/routes';
import {
  EGYPT_MOBILE,
  EMPTY_ADDRESS,
  clearDraft,
  forgetPlacedOrder,
  placedOrder,
  readDraft,
  rememberPlacedOrder,
  saveDraft,
  toGovernorate,
  type NewAddressDraft,
} from '../lib/checkout-draft';
import { isDefaultCentre, isInsideServiceArea } from '../lib/service-area';
import {
  AddressSection,
  DeliverySection,
  PaymentSection,
  RecipientSection,
  type AddressErrors,
  type QuoteStatus,
  type Recipient,
} from './CheckoutSections';
import { CheckoutSummary, type CouponStatus } from './CheckoutSummary';
import type { LocationPin } from './DeliveryLocationPicker';

const pinOf = (address: CustomerAddress): LocationPin => ({
  latitude: address.latitude,
  longitude: address.longitude,
  locationSource: address.locationSource,
  confirmed: true,
});

/** Errors are announced (role=alert); focus follows to the first field to fix once it is on screen. */
function focusFirstInvalid(sectionId: string) {
  window.requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(`section[aria-labelledby="${sectionId}"] [aria-invalid="true"]`)?.focus();
  });
}

const normalisePhone = (value: string) => toLatinDigits(value).replace(/[\s-]/g, '');

/** Problems with the place-order request the customer must act on (CommerceStates §١ «خلص وقت التأكيد», §٣). */
type PlaceProblem = 'changed' | 'stock' | 'fields' | null;

/**
 * Checkout, one page (CheckoutD, CommerceMobile ٣/٣ب, CommerceStates §٢–§٣): ١ المستلم · ٢ عنوان التوصيل (map pin
 * required) · ٣ التوصيل · ٤ طريقة الدفع (cash on delivery), with «طلبك» beside (desktop) or below (phone).
 *
 * - Every total comes from the server quote, requested whenever the address, pin or code changes; «أكد الطلب» is
 *   disabled until it returns and carries its total.
 * - One idempotency key per quote: a retry after a lost response replays the same order; a changed quote (409) is
 *   shown before the customer confirms again.
 * - Entered details are kept as a draft for this tab (sign-in round trip, refresh) and cleared once the order exists;
 *   the checkout history entry is replaced by the order, and landing here again resumes that order.
 * - Signed out → phone sign-in and back; a session that expires at placement returns with «دخولك خلص وقته…».
 */
export function CheckoutView() {
  const m = useMessages();
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { cart, isLoading: cartLoading } = useCart();
  const { addresses, defaultAddress, isLoading: addressesLoading, createAddress, updateAddress } = useAddresses();

  const [ready, setReady] = useState(false);
  const [recipient, setRecipient] = useState<Recipient>({ name: '', phone: '' });
  const [recipientFromAccount, setRecipientFromAccount] = useState(false);
  const [editingRecipient, setEditingRecipient] = useState(false);
  const [recipientErrors, setRecipientErrors] = useState<Partial<Record<keyof Recipient, string>>>({});
  const [selectedId, setSelectedId] = useState<string | 'new' | null>(null);
  const [draftAddress, setDraftAddress] = useState<NewAddressDraft>(EMPTY_ADDRESS);
  const [addressErrors, setAddressErrors] = useState<AddressErrors>({});
  const [saveState, setSaveState] = useState<AsyncState>('idle');
  const [pins, setPins] = useState<Record<string, LocationPin | null>>({});
  const [pinError, setPinError] = useState<string | undefined>();

  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [quoteStatus, setQuoteStatus] = useState<QuoteStatus>('waiting');
  const [previousFee, setPreviousFee] = useState<number | null>(null);
  const [coupon, setCoupon] = useState<{ code: string; status: CouponStatus }>({ code: '', status: 'idle' });
  const baselinePromotions = useRef(0);
  const quoteSeq = useRef(0);

  const [placeState, setPlaceState] = useState<AsyncState>('idle');
  const [problem, setProblem] = useState<PlaceProblem>(null);
  const [changedFrom, setChangedFrom] = useState<number | null>(null);
  const keyRef = useRef<{ quoteVersion: string; key: string } | null>(null);
  const placingRef = useRef(false);

  /* ── Access, resume, restore ─────────────────────────────────────── */

  // An order needs a signed-in customer (server-enforced): signed out, checkout goes through phone sign-in and back.
  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.replace(signInHref(routes.checkout));
  }, [authLoading, isAuthenticated, router]);

  // The order this checkout already created: show it instead of an empty, submittable page.
  useEffect(() => {
    if (cartLoading || !cart) return;
    const placed = placedOrder();
    if (cart.items.length === 0 && placed) router.replace(routes.order(placed));
    else if (cart.items.length > 0 && placed) forgetPlacedOrder();
  }, [cart, cartLoading, router]);

  // Restore the draft once the account and its addresses are known; otherwise start from the account.
  useEffect(() => {
    if (ready || authLoading || !isAuthenticated || addressesLoading) return;
    const draft = readDraft();
    const accountRecipient = { name: user?.name ?? '', phone: user?.phoneNumber ? `0${user.phoneNumber.replace(/^\+20/, '')}` : '' };
    const fallback = defaultAddress ? { name: accountRecipient.name || defaultAddress.customerName, phone: accountRecipient.phone || defaultAddress.customerPhone } : accountRecipient;
    const initial = draft.recipient ?? fallback;
    setRecipient(initial);
    setRecipientFromAccount(!draft.recipient && Boolean(initial.name && initial.phone));
    setEditingRecipient(!(initial.name.trim() && EGYPT_MOBILE.test(normalisePhone(initial.phone))));
    const draftId = draft.addressId && (draft.addressId === 'new' || addresses.some((a) => a.id === draft.addressId)) ? draft.addressId : null;
    setSelectedId(draftId ?? defaultAddress?.id ?? 'new');
    if (draft.newAddress) setDraftAddress(draft.newAddress);
    if (draft.couponCode) setCoupon({ code: draft.couponCode, status: 'applying' });
    setReady(true);
  }, [ready, authLoading, isAuthenticated, addressesLoading, user, addresses, defaultAddress]);

  // Keep the draft current (this tab only; no prices).
  useEffect(() => {
    if (!ready) return;
    saveDraft({
      recipient,
      addressId: selectedId,
      newAddress: selectedId === 'new' ? draftAddress : undefined,
      couponCode: coupon.status === 'applied' || coupon.status === 'applying' ? coupon.code : undefined,
    });
  }, [ready, recipient, selectedId, draftAddress, coupon]);

  /* ── Delivery address and pin ─────────────────────────────────────── */

  const selected = useMemo(() => addresses.find((a) => a.id === selectedId) ?? null, [addresses, selectedId]);
  const selectedPin = selected ? (selected.id in pins ? pins[selected.id] : pinOf(selected)) : null;
  const deliverable = Boolean(
    selected &&
      selectedPin?.confirmed &&
      toGovernorate(selected.governorate) &&
      isInsideServiceArea(selectedPin.latitude, selectedPin.longitude) &&
      !isDefaultCentre(selectedPin.latitude, selectedPin.longitude)
  );

  const onSavedPinChange = async (next: LocationPin | null) => {
    if (!selected) return;
    setPins((current) => ({ ...current, [selected.id]: next }));
    setPinError(undefined);
    // A confirmed move is saved on the address itself, so the next order starts from the right door.
    if (next?.confirmed) {
      try {
        await updateAddress({ id: selected.id, data: { latitude: next.latitude, longitude: next.longitude, locationSource: next.locationSource } });
      } catch {
        // The order still uses the confirmed pin; the address book keeps its previous one.
      }
    }
  };

  const validateRecipient = () => {
    const errors: Partial<Record<keyof Recipient, string>> = {};
    if (!recipient.name.trim()) errors.name = m.checkoutRequired;
    const phone = normalisePhone(recipient.phone);
    if (!phone) errors.phone = m.checkoutRequired;
    else if (!EGYPT_MOBILE.test(phone)) errors.phone = m.checkoutPhoneInvalid;
    setRecipientErrors(errors);
    if (Object.keys(errors).length) {
      setEditingRecipient(true);
      focusFirstInvalid('co-recipient');
    }
    return Object.keys(errors).length === 0;
  };

  const saveNewAddress = async () => {
    const errors: AddressErrors = {};
    if (!draftAddress.governorate) errors.governorate = m.checkoutRequired;
    if (!draftAddress.area.trim()) errors.area = m.checkoutRequired;
    if (!draftAddress.shippingAddress.trim()) errors.shippingAddress = m.checkoutRequired;
    if (!draftAddress.pin?.confirmed) errors.pin = m.checkoutPinMissing;
    setAddressErrors(errors);
    const recipientOk = validateRecipient();
    if (!recipientOk) return;
    if (Object.keys(errors).length) focusFirstInvalid('co-address');
    if (Object.keys(errors).length || !recipientOk || saveState === 'pending') return;
    const pin = draftAddress.pin as LocationPin;
    setSaveState('pending');
    try {
      const created = await createAddress({
        label: draftAddress.label.trim() || undefined,
        customerName: recipient.name.trim(),
        customerPhone: normalisePhone(recipient.phone),
        governorate: draftAddress.governorate,
        area: draftAddress.area.trim(),
        shippingAddress: draftAddress.shippingAddress.trim(),
        notes: draftAddress.notes.trim() || undefined,
        latitude: pin.latitude,
        longitude: pin.longitude,
        locationSource: pin.locationSource,
      });
      setSaveState('success');
      window.setTimeout(() => {
        setSelectedId(created.id);
        setDraftAddress(EMPTY_ADDRESS);
        setSaveState('idle');
      }, 900);
    } catch {
      setSaveState('error');
    }
  };

  /* ── Quote ────────────────────────────────────────────────────────── */

  const requestQuote = useCallback(
    async (couponCode?: string) => {
      if (!selected || !deliverable) return null;
      const seq = ++quoteSeq.current;
      setQuoteStatus('loading');
      try {
        const fresh = await orders.getQuote({
          governorate: toGovernorate(selected.governorate),
          area: selected.area,
          ...(couponCode ? { couponCode } : {}),
        });
        if (seq !== quoteSeq.current) return null;
        setQuote(fresh);
        setQuoteStatus('ready');
        return fresh;
      } catch (error) {
        if (seq !== quoteSeq.current) return null;
        if (error instanceof ApiError && error.status === 401) {
          router.replace(signInHref(routes.checkout, 'expired'));
          return null;
        }
        if (error instanceof ApiError && error.status === 409) {
          // The cart itself changed (unavailable product, price): nothing can be quoted until it is reviewed.
          setProblem('stock');
        }
        setQuoteStatus('error');
        return null;
      }
    },
    [selected, deliverable, router]
  );

  const activeCode = coupon.status === 'applied' || coupon.status === 'applying' ? coupon.code : undefined;
  const quoteKey = selected && deliverable ? `${selected.id}|${selected.governorate}|${selected.area}|${selectedPin?.latitude}|${selectedPin?.longitude}|${cart?.revision}` : null;
  const lastQuoteKey = useRef<string | null>(null);

  // A new address or pin (or cart revision) asks the server again; the fee row shows «بنحسبه…» meanwhile.
  useEffect(() => {
    if (!ready) return;
    if (!quoteKey) {
      quoteSeq.current++;
      setQuoteStatus('waiting');
      setQuote(null);
      return;
    }
    if (lastQuoteKey.current === quoteKey) return;
    // The fee is compared only when the address or pin changed (not for a first quote or a cart edit).
    const place = (key: string) => key.split('|').slice(0, 5).join('|');
    const addressChanged = lastQuoteKey.current !== null && place(lastQuoteKey.current) !== place(quoteKey);
    setPreviousFee(addressChanged && quote ? quote.shippingFee : null);
    lastQuoteKey.current = quoteKey;
    void (async () => {
      const base = await requestQuote();
      if (!base) return;
      baselinePromotions.current = base.appliedPromotions?.length ?? 0;
      if (activeCode) await applyCode(activeCode);
    })();
    // Re-quote only when what the fee depends on changes.
  }, [ready, quoteKey]);

  const applyCode = async (code: string) => {
    setCoupon({ code, status: 'applying' });
    const withCode = await requestQuote(code);
    if (!withCode) {
      setCoupon({ code, status: 'idle' });
      return;
    }
    // The quote does not say which code matched; a code counts as applied when it adds a promotion.
    const applied = (withCode.appliedPromotions?.length ?? 0) > baselinePromotions.current;
    setCoupon({ code, status: applied ? 'applied' : 'not-applied' });
    if (!applied) await requestQuote();
  };

  const removeCode = async () => {
    setCoupon({ code: '', status: 'idle' });
    await requestQuote();
  };

  /* ── Place order ──────────────────────────────────────────────────── */

  // Pending is the AsyncButton's own guard (same box, shutter); disabled is only for a missing precondition.
  const canPlace = quoteStatus === 'ready' && Boolean(quote) && deliverable;
  const placeLabel =
    quoteStatus === 'ready' && quote
      ? fillMessage(m.checkoutPlaceOrder, { total: formatEgp(quote.totalAmount, quote.currency, locale) ?? '' })
      : m.checkoutPlaceOrderShort;

  const placeOrder = async () => {
    if (placingRef.current || !quote || !selected || !selectedPin) return;
    setProblem(null);
    if (!validateRecipient()) {
      setProblem('fields');
      return;
    }
    if (!deliverable) {
      setPinError(m.checkoutPinMissing);
      return;
    }
    // One key per quote: a retry of the same quote replays the same order.
    if (!keyRef.current || keyRef.current.quoteVersion !== quote.quoteVersion) {
      keyRef.current = { quoteVersion: quote.quoteVersion, key: createIdempotencyKey() };
    }
    placingRef.current = true;
    setPlaceState('pending');
    try {
      const order = await orders.checkout({
        customerName: recipient.name.trim(),
        customerPhone: normalisePhone(recipient.phone),
        governorate: toGovernorate(selected.governorate),
        area: selected.area,
        shippingAddress: selected.shippingAddress,
        ...(selected.notes ? { notes: selected.notes } : {}),
        latitude: selectedPin.latitude,
        longitude: selectedPin.longitude,
        locationSource: selectedPin.locationSource,
        locationConfirmed: true,
        paymentMethod: 'COD',
        ...(coupon.status === 'applied' ? { couponCode: coupon.code } : {}),
        quoteVersion: quote.quoteVersion,
        cartRevision: quote.cartRevision,
        idempotencyKey: keyRef.current.key,
      });
      rememberPlacedOrder(order.orderNumber);
      clearDraft();
      queryClient.removeQueries({ queryKey: CART_QUERY_KEY });
      // Replace checkout in history: Back must not return to a submittable checkout.
      router.replace(`${routes.order(order.orderNumber)}?placed=1`);
    } catch (error) {
      placingRef.current = false;
      const code = apiErrorCode(error);
      if (error instanceof ApiError && error.status === 401) {
        // The session ran out: sign in again and come back; the draft keeps everything entered.
        router.replace(signInHref(routes.checkout, 'expired'));
        return;
      }
      if (error instanceof ApiError && error.status === 409 && code !== 'IDEMPOTENCY_KEY_REUSED') {
        // Terms changed since the quote: show the new total before the customer confirms again.
        setPlaceState('idle');
        const previous = quote.totalAmount;
        const fresh = await requestQuote(coupon.status === 'applied' ? coupon.code : undefined);
        if (fresh) {
          setChangedFrom(previous);
          setProblem('changed');
        }
        return;
      }
      if (error instanceof ApiError && (error.status === 422 || error.status === 400)) {
        setPlaceState('idle');
        if (code === 'OUT_OF_SERVICE_AREA' || code?.startsWith('LOCATION_PIN')) {
          setPinError(code === 'LOCATION_PIN_IMPROBABLE' ? m.checkoutMapImprobablePin : code === 'OUT_OF_SERVICE_AREA' ? m.checkoutOutOfArea : m.checkoutPinMissing);
          setPins((current) => ({ ...current, [selected.id]: selectedPin ? { ...selectedPin, confirmed: false } : null }));
        } else {
          setProblem('fields');
        }
        return;
      }
      // Network or server: «جرّب تاني» repeats the same request with the same key.
      setPlaceState('error');
    }
  };

  /* ── Render ───────────────────────────────────────────────────────── */

  if (authLoading || cartLoading || !isAuthenticated || !ready) return <CheckoutSkeleton label={m.loading} />;
  if (!cart || cart.items.length === 0) {
    return (
      <section className="mx-auto mt-10 flex max-w-narrow flex-col items-center gap-4 rounded-card bg-linen px-6 py-10 text-center shadow-outline-hairline">
        <p className="m-0 text-body text-night">{m.checkoutEmptyCart}</p>
        <Link href={routes.products} className={buttonVariants({ variant: 'ink' })}>
          {m.cartShop}
        </Link>
      </section>
    );
  }

  return (
    <div className="pb-28 lg:pb-0">
      <header className="mb-6 hidden lg:block">
        <h1 className="m-0 font-display text-44 font-extrabold leading-50 text-night">{m.checkoutTitle}</h1>
        <p className="m-0 mt-1.5 text-14 text-ink-2">{m.checkoutLead}</p>
      </header>

      {problem ? (
        <div className="mb-4">
          {problem === 'stock' ? (
            <MessageBox tone="err" role="alert">
              <p className="m-0 text-14 font-semibold">{m.checkoutStockLostTitle}</p>
              <p className="m-0 text-14 leading-22">{m.checkoutStockLostBody}</p>
              <Link href={routes.cart} className={buttonVariants({ variant: 'ink', size: 's', className: 'mt-2' })}>
                {m.checkoutBackToCart}
              </Link>
            </MessageBox>
          ) : problem === 'changed' && quote && changedFrom !== null ? (
            <MessageBox tone="warn" role="alert">
              {changedFrom !== quote.totalAmount
                ? fillMessage(m.checkoutChangedTotal, {
                    old: formatEgp(changedFrom, quote.currency, locale) ?? '',
                    new: formatEgp(quote.totalAmount, quote.currency, locale) ?? '',
                  })
                : m.checkoutChangedSame}
            </MessageBox>
          ) : problem === 'fields' ? (
            <MessageBox tone="err" role="alert">
              {m.checkoutFixFields}
            </MessageBox>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start lg:gap-10">
        <div className="flex flex-col gap-4 lg:gap-5">
          <RecipientSection
            recipient={recipient}
            fromAccount={recipientFromAccount}
            editing={editingRecipient}
            errors={recipientErrors}
            onEdit={() => setEditingRecipient(true)}
            onChange={(next) => {
              setRecipient(next);
              setRecipientFromAccount(false);
              setRecipientErrors({});
            }}
            onDone={() => {
              if (validateRecipient()) setEditingRecipient(false);
            }}
          />
          <AddressSection
            addresses={addresses}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              setPinError(undefined);
              setAddressErrors({});
              setProblem(null);
            }}
            draft={draftAddress}
            onDraft={(next) => {
              setDraftAddress(next);
              if (Object.keys(addressErrors).length) setAddressErrors({});
            }}
            errors={addressErrors}
            saveState={saveState}
            onSaveNew={saveNewAddress}
            onCancelNew={() => setSelectedId(defaultAddress?.id ?? addresses[0]?.id ?? 'new')}
            pin={selectedPin}
            pinError={pinError}
            onPinChange={onSavedPinChange}
          />
          <DeliverySection
            area={selected?.area ?? null}
            status={quoteStatus}
            quote={quote}
            previousFee={previousFee}
            onRetry={() => void requestQuote(activeCode)}
          />
          <PaymentSection />
        </div>

        <CheckoutSummary
          cart={cart}
          quote={quote}
          quoteStatus={quoteStatus}
          coupon={coupon}
          onApplyCoupon={(code) => void applyCode(code)}
          onRemoveCoupon={() => void removeCode()}
          placeState={placeState}
          placeLabel={placeLabel}
          canPlace={canPlace}
          onPlace={placeOrder}
        />
      </div>

      {placeState === 'error' ? (
        <MessageBox tone="err" role="alert" className="mt-4">
          {m.checkoutSubmitFailed}
        </MessageBox>
      ) : null}

      {/* Phone: «أكد الطلب · total» in the sticky action area where the nav would be (CommerceMobile ٣ب). */}
      <div className="pdp-bar fixed inset-x-0 bottom-0 z-nav bg-bone/95 px-4 pt-3 shadow-hairline-top backdrop-blur-sm lg:hidden">
        <AsyncButton size="l" className="w-full" state={placeState} pendingLabel={m.checkoutPlacing} retryLabel={placeLabel} disabled={!canPlace} onClick={placeOrder}>
          {placeLabel}
        </AsyncButton>
      </div>
    </div>
  );
}

function CheckoutSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-10">
      <div className="flex flex-col gap-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-32 w-full rounded-24" />
        ))}
      </div>
      <Skeleton className="h-96 w-full rounded-sheet" />
    </div>
  );
}
