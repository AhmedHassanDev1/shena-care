'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { MessageBox } from '@/components/ui/message-box';
import { Money } from '@/components/ui/money';
import { Skeleton } from '@/components/ui/skeleton';
import { Toast } from '@/components/ui/toast';
import { useAuth } from '@/features/auth/AuthContext';
import { signInHref } from '@/features/auth/lib/auth-helpers';
import { consumeAuthReturn } from '@/features/auth/lib/auth-return';
import type { CartItem } from '@/lib/cart';
import { formatNumber, formatProductCount } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { useCart } from '../hooks/useCart';
import { markPricesReviewed, needsPriceReview, pendingChanges, reviewedPrices } from '../lib/cart-review';
import { CartLine } from './CartLine';

/** How long «تراجع» stays offered after a removal (CommerceStates §١: until the toast closes or another action). */
const UNDO_MS = 8000;

/**
 * Cart (CartD, CommerceMobile ١, CommerceStates §١). Lines with the stepper and «شيل»; the order summary (sticky on
 * desktop, rows plus a sticky «إتمام الطلب» bar on the phone); changed prices and unavailable products are decided
 * on the line and must be seen before checkout starts. Totals are the server's; delivery is quoted at checkout.
 */
export function CartView() {
  const m = useMessages();
  const locale = useLocale();
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const { cart, isLoading, error, updateItem, removeItem, addItem, invalidate } = useCart();
  const [busySku, setBusySku] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [removed, setRemoved] = useState<{ skuId: string; quantity: number; name: string } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout>>();
  const [reviewed, setReviewed] = useState<Set<string>>(() => new Set());
  // Sign-in changed the cart (the account already held items): review it before checkout (Addendum §Return).
  const [merged, setMerged] = useState(false);

  useEffect(() => {
    setReviewed(reviewedPrices());
    if (consumeAuthReturn('cart-merged')) setMerged(true);
  }, []);
  useEffect(() => () => clearTimeout(undoTimer.current), []);

  const run = async (skuId: string, action: () => Promise<unknown>) => {
    setBusySku(skuId);
    setFailed(false);
    try {
      await action();
    } catch {
      setFailed(true);
      invalidate();
    } finally {
      setBusySku(null);
    }
  };

  const remove = (item: CartItem) =>
    run(item.skuId, async () => {
      await removeItem(item.skuId);
      setRemoved({ skuId: item.skuId, quantity: item.quantity, name: item.sku.product.name || item.sku.code });
      clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setRemoved(null), UNDO_MS);
    });

  const undo = () => {
    if (!removed) return;
    const { skuId, quantity } = removed;
    clearTimeout(undoTimer.current);
    setRemoved(null);
    run(skuId, () => addItem({ skuId, quantity }));
  };

  const act = (action: () => void) => {
    // Any other action closes the undo offer.
    if (removed) {
      clearTimeout(undoTimer.current);
      setRemoved(null);
    }
    action();
  };

  if (isLoading) return <CartSkeleton label={m.loading} />;
  if (error && !cart) {
    return (
      <MessageBox tone="err" role="alert" className="mt-6">
        <p className="m-0 text-14">{m.cartLoadError}</p>
        <Button variant="light" size="s" className="mt-2" onClick={invalidate}>
          {m.checkoutRetry}
        </Button>
      </MessageBox>
    );
  }

  const items = cart?.items ?? [];
  const count = cart?.itemCount ?? 0;
  const changes = pendingChanges(items, reviewed);
  const checkoutHref = isAuthenticated ? routes.checkout : signInHref(routes.checkout);

  const continueToCheckout = () => {
    if (changes.priceChanged.length) setReviewed(markPricesReviewed(changes.priceChanged));
    router.push(checkoutHref);
  };

  const toast = removed ? (
    <div className="pointer-events-none fixed inset-x-3 bottom-28 z-toast flex justify-center lg:bottom-8">
      <Toast className="pointer-events-auto w-full lg:w-[420px]" action={{ label: m.cartUndo, onClick: undo }}>
        {fillMessage(m.cartRemoved, { name: removed.name })}
      </Toast>
    </div>
  ) : null;

  if (items.length === 0) {
    return (
      <>
        <EmptyCart signedIn={isAuthenticated} />
        {toast}
      </>
    );
  }

  return (
    <div className="pb-28 lg:pb-0">
      <header className="hidden lg:block">
        <div className="flex items-baseline gap-3.5">
          <h1 className="m-0 font-display text-34 font-extrabold leading-44 text-ink">{m.cartStagingTitle}</h1>
          <span className="text-16 text-stone">{formatProductCount(count, locale)}</span>
        </div>
        <p className="m-0 mt-2 text-14 text-stone">{m.cartLead}</p>
      </header>

      {merged ? (
        <MessageBox tone="info" role="status" className="mt-4 lg:mt-6">
          {m.authCartMerged}
        </MessageBox>
      ) : null}

      <div className="lg:mt-6 lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-12">
        <section aria-label={m.cartTitle}>
          {failed ? (
            <p role="alert" className="m-0 mt-3 flex items-center gap-2 text-14 text-tomato-ink">
              <Icon name="alert" size={18} />
              {m.cartUpdateFailed}
            </p>
          ) : null}
          <ul className="m-0 list-none p-0 lg:shadow-hairline-top">
            {items.map((item) => (
              <CartLine
                key={item.skuId}
                item={item}
                busy={busySku === item.skuId}
                priceReview={needsPriceReview(item, reviewed)}
                onQuantity={(quantity) => act(() => run(item.skuId, () => updateItem({ skuId: item.skuId, quantity })))}
                onRemove={() => remove(item)}
                onPriceReviewed={() => act(() => setReviewed(markPricesReviewed([item])))}
              />
            ))}
          </ul>
        </section>

        <CartSummary
          count={count}
          total={cart?.total ?? 0}
          signedIn={isAuthenticated}
          changes={changes.count}
          blocked={changes.unavailable.length > 0}
          onCheckout={continueToCheckout}
        />
      </div>

      <MobileCheckoutBar total={cart?.total ?? 0} blocked={changes.unavailable.length > 0} onCheckout={continueToCheckout} />
      {toast}
    </div>
  );
}

function CartSummary({
  count,
  total,
  signedIn,
  changes,
  blocked,
  onCheckout,
}: {
  count: number;
  total: number;
  signedIn: boolean;
  changes: number;
  blocked: boolean;
  onCheckout: () => void;
}) {
  const m = useMessages();
  const locale = useLocale();
  const changedCopy =
    changes === 1 ? m.cartChangedOne : changes === 2 ? m.cartChangedTwo : fillMessage(m.cartChangedMany, { n: formatNumber(changes, locale) });

  return (
    <aside
      aria-labelledby="cart-summary"
      className="mt-5 flex flex-col gap-3.5 lg:sticky lg:top-6 lg:mt-0 lg:rounded-sheet lg:bg-linen lg:p-7 lg:shadow-elevation-3 lg:outline lg:outline-1 lg:outline-line"
    >
      <h2 id="cart-summary" className="m-0 hidden font-display text-26 font-extrabold leading-32 text-ink lg:block">
        {m.cartSummary}
      </h2>

      <SummaryRow label={fillMessage(m.cartSubtotalCount, { count: formatProductCount(count, locale) })}>
        <Money amount={total} />
      </SummaryRow>
      <SummaryRow label={m.cartShipping}>
        <span className="text-stone">{m.cartShippingLater}</span>
      </SummaryRow>
      <div aria-hidden="true" className="my-1.5 h-px bg-line" />
      <SummaryRow label={m.cartTotalNoDelivery} strong>
        <Money amount={total} />
      </SummaryRow>

      {changes > 0 ? (
        <MessageBox tone="warn" role="status">
          <p className="m-0 text-14 leading-22">{blocked ? m.cartRemoveUnavailableFirst : changedCopy}</p>
        </MessageBox>
      ) : null}

      <div className="hidden lg:block">
        {changes > 0 ? (
          <Button size="l" className="w-full" disabled={blocked} onClick={onCheckout}>
            {m.cartReviewed}
          </Button>
        ) : (
          <Button size="l" className="w-full" onClick={onCheckout}>
            {m.cartCheckout}
          </Button>
        )}
      </div>

      <ul className="m-0 flex list-disc flex-col gap-0.5 ps-4.5 text-13 leading-21 text-stone">
        {signedIn ? null : <li>{m.cartNoteSignIn}</li>}
        <li>{m.cartNoteDelivery}</li>
        <li>{m.cartNotePayment}</li>
      </ul>
    </aside>
  );
}

function SummaryRow({ label, strong, children }: { label: string; strong?: boolean; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'flex min-h-7.5 items-center justify-between gap-3',
        strong ? 'text-17 font-bold text-ink' : 'text-14.5 font-medium text-ink'
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums">{children}</span>
    </div>
  );
}

/** Phone: «إتمام الطلب» fixed above the safe area with the subtotal «من غير التوصيل» (CommerceMobile ١). */
function MobileCheckoutBar({ total, blocked, onCheckout }: { total: number; blocked: boolean; onCheckout: () => void }) {
  const m = useMessages();
  return (
    <div className="fixed inset-x-0 bottom-0 z-nav flex items-center gap-3 bg-chalk/95 px-4 pt-3 shadow-hairline-top backdrop-blur-sm lg:hidden pdp-bar">
      <span className="flex flex-col">
        <span className="text-12 leading-17 text-stone">{m.cartWithoutDelivery}</span>
        <Money amount={total} className="text-17 font-bold leading-24 text-ink" />
      </span>
      <Button size="l" className="flex-1" disabled={blocked} onClick={onCheckout}>
        {m.cartCheckout}
      </Button>
    </div>
  );
}

function EmptyCart({ signedIn }: { signedIn: boolean }) {
  const m = useMessages();
  return (
    <section className="mx-auto mt-10 flex max-w-narrow flex-col items-center gap-3 rounded-card bg-linen px-6 py-10 text-center shadow-outline-hairline lg:mt-16">
      <span className="grid size-14 place-items-center rounded-pill bg-sand text-ink">
        <Icon name="bag" size={26} />
      </span>
      <h2 className="m-0 font-display text-28 font-extrabold leading-34 text-ink lg:hidden">{m.cartEmptyTitle}</h2>
      <h1 className="m-0 hidden font-display text-28 font-extrabold leading-34 text-ink lg:block">{m.cartEmptyTitle}</h1>
      <p className="m-0 text-14 leading-22 text-stone">{m.cartEmptyBody}</p>
      <span className="mt-2 flex flex-wrap justify-center gap-2.5">
        <Link href={routes.products} className={buttonVariants({ variant: 'ink' })}>
          {m.cartShop}
        </Link>
        {signedIn ? null : (
          <Link href={signInHref(routes.cart)} className={buttonVariants({ variant: 'light' })}>
            {m.cartSignIn}
          </Link>
        )}
      </span>
    </section>
  );
}

function CartSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="mt-4 flex flex-col gap-4 lg:mt-6">
      <Skeleton className="hidden h-12.5 w-48 lg:block" />
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="flex gap-3.5 py-2">
          <Skeleton className="h-22.5 w-18 rounded-image lg:h-32.5 lg:w-26" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-control-s w-32 rounded-pill" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Phone header title «السلة (٤)» (CommerceMobile ١). */
export function CartHeaderTitle() {
  const m = useMessages();
  const locale = useLocale();
  const { cart } = useCart();
  const count = cart?.itemCount ?? 0;
  return (
    <>
      {m.cartTitle}
      {count ? <span className="ms-1.5 text-15 font-medium text-stone">({formatNumber(count, locale)})</span> : null}
    </>
  );
}
