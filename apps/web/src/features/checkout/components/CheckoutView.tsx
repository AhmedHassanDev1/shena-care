'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Alert } from '@/components/ui/alert';
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
 * input is never cleared on any error.
 */
export function CheckoutView() {
  const m = useMessages();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { cart, isLoading } = useCart();
  const [step, setStep] = useState<'delivery' | 'review'>('delivery');
  const [delivery, setDelivery] = useState<Delivery>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Delivery, string>>>({});
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [changedFrom, setChangedFrom] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const idempotencyKey = useRef<string | null>(null);

  if (isLoading) return <Skeleton shape="pill" className="h-control-l w-full" />;
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
    setErrors(next);
    return Object.keys(next).length === 0;
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
    } catch {
      setProblem('quote');
    } finally {
      setPending(false);
    }
  };

  const placeOrder = async () => {
    if (!quote || !idempotencyKey.current) return;
    setPending(true);
    setProblem(null);
    try {
      const order = await orders.checkout({
        customerName: delivery.customerName.trim(),
        customerPhone: delivery.customerPhone.replace(/\s+/g, ''),
        governorate: delivery.governorate.trim(),
        area: delivery.area.trim(),
        shippingAddress: delivery.shippingAddress.trim(),
        ...(delivery.notes.trim() ? { notes: delivery.notes.trim() } : {}),
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
      } else if (error instanceof ApiError && error.type === 'VALIDATION') {
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
        <p className="text-caption text-ink-soft">{fillMessage(m.checkoutStepOf, { i: step === 'delivery' ? 1 : 2, n: 2 })}</p>
        <h1 className="text-display-m text-foreground">{step === 'delivery' ? m.checkoutStepDelivery : m.checkoutStepReview}</h1>
      </header>

      {problem ? (
        <Alert variant="destructive">
          <p className="text-body-s">
            {problem === 'quote' ? m.checkoutQuoteFailed : problem === 'validation' ? m.checkoutValidationFailed : m.checkoutSubmitFailed}
          </p>
        </Alert>
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
          <TextField label={m.checkoutName} autoComplete="name" required {...field('customerName')} />
          <PhoneField
            label={m.checkoutPhone}
            hint={errors.customerPhone ? undefined : m.checkoutPhoneHint}
            placeholder="01012345678"
            required
            {...field('customerPhone')}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label={m.checkoutGovernorate} autoComplete="address-level1" required {...field('governorate')} />
            <TextField label={m.checkoutArea} autoComplete="address-level2" required {...field('area')} />
          </div>
          <TextField
            label={m.checkoutAddress}
            hint={errors.shippingAddress ? undefined : m.checkoutAddressHint}
            autoComplete="street-address"
            required
            {...field('shippingAddress')}
          />
          <TextField label={m.checkoutNotes} optionalLabel={m.checkoutOptional} {...field('notes')} />
          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-between">
            <Link href={routes.cart} className={buttonVariants({ variant: 'ghost' })}>
              {m.checkoutBackToCart}
            </Link>
            <Button type="submit" size="lg" loading={pending}>
              {m.checkoutContinue}
            </Button>
          </div>
        </form>
      ) : quote ? (
        <Review
          quote={quote}
          delivery={delivery}
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
  changedFrom,
  pending,
  onEditDelivery,
  onPlaceOrder,
}: {
  quote: CheckoutQuote;
  delivery: Delivery;
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
        <Alert variant="warning">
          <div className="text-body-s">
            <p className="font-semibold">{m.checkoutChangedTitle}</p>
            <p>
              {changedFrom !== quote.totalAmount
                ? fillMessage(m.checkoutChangedTotal, { old: money(changedFrom), new: money(quote.totalAmount) })
                : m.checkoutChangedSame}
            </p>
          </div>
        </Alert>
      ) : null}

      <ReviewGroup title={m.checkoutItems} edit={<Link href={routes.cart} className={buttonVariants({ variant: 'link' })}>{m.checkoutEdit}</Link>}>
        <ul className="space-y-2">
          {quote.items.map((item) => (
            <li key={item.skuId} className="flex justify-between gap-3 text-body-s">
              <span dir="auto" className="min-w-0 [text-align:match-parent]">
                {item.productName}
                {item.variantName ? <span className="text-ink-subtle"> · <bdi>{item.variantName}</bdi></span> : null}
                <span className="text-ink-subtle"> × <bdi>{item.quantity}</bdi></span>
              </span>
              <bdi className="shrink-0 tabular-nums text-foreground">{money(item.lineTotal)}</bdi>
            </li>
          ))}
        </ul>
      </ReviewGroup>

      <ReviewGroup title={m.checkoutDeliveryTo} edit={<Button variant="link" onClick={onEditDelivery}>{m.checkoutEdit}</Button>}>
        <p className="text-body-s text-foreground">{delivery.customerName}</p>
        <p className="text-body-s text-ink-soft">
          <bdi dir="ltr">{delivery.customerPhone}</bdi>
        </p>
        <p className="text-body-s text-ink-soft">
          {[delivery.shippingAddress, delivery.area, delivery.governorate].filter(Boolean).join('، ')}
        </p>
        {delivery.notes ? <p className="text-body-s text-ink-subtle">{delivery.notes}</p> : null}
      </ReviewGroup>

      <ReviewGroup title={m.checkoutPayment}>
        <p className="text-body-s text-foreground">{m.checkoutPaymentCod}</p>
      </ReviewGroup>

      <section aria-labelledby="checkout-totals" className="space-y-2 rounded-md border border-border bg-card p-4">
        <h2 id="checkout-totals" className="sr-only">
          {m.cartSummary}
        </h2>
        <dl className="space-y-2 text-body-s">
          <Row label={m.checkoutSubtotal} value={money(quote.subtotal)} />
          {discount > 0 ? <Row label={m.checkoutDiscount} value={`− ${money(discount)}`} /> : null}
          <Row label={m.checkoutShipping} value={quote.shippingFee === 0 ? m.checkoutFree : money(quote.shippingFee)} />
          <div className="flex justify-between gap-3 border-t border-border pt-2">
            <dt className="text-label text-foreground">{m.checkoutCodTotal}</dt>
            <dd className="text-price-l tabular-nums text-foreground">
              <bdi>{money(quote.codAmount)}</bdi>
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="checkout-confidence" className="space-y-2 rounded-md bg-sand p-4">
        <h2 id="checkout-confidence" className="text-heading text-foreground">
          {m.checkoutConfidenceTitle}
        </h2>
        <p className="flex items-start gap-2 text-body-s text-ink-soft">
          <Icon name="pin" size={18} className="mt-0.5 shrink-0" />
          <span>
            <bdi>{quote.area}</bdi>، <bdi>{quote.governorate}</bdi>
          </span>
        </p>
        <p className="flex items-start gap-2 text-body-s text-ink-soft">
          <Icon name="clock" size={18} className="mt-0.5 shrink-0" />
          {m.checkoutPromise}
        </p>
        <p className="flex items-start gap-2 text-body-s text-ink-soft">
          <Icon name="info" size={18} className="mt-0.5 shrink-0" />
          {m.checkoutAvailabilityCaveat}
        </p>
      </section>

      <Button size="lg" className="w-full" loading={pending} onClick={onPlaceOrder}>
        {m.checkoutPlaceOrder}
      </Button>
    </div>
  );
}

function ReviewGroup({ title, edit, children }: { title: string; edit?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-md border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-heading text-foreground">{title}</h2>
        {edit}
      </div>
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

function Notice({ message, action }: { message: string; action: React.ReactNode }) {
  return (
    <div className={cn('mx-auto max-w-xl rounded-md border border-border bg-card px-5 py-8 text-center')}>
      <p className="text-body text-foreground">{message}</p>
      <div className="mt-5 flex justify-center">{action}</div>
    </div>
  );
}
