'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
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
 * Editorial Cart Page (CartD, CommerceMobile ١, CommerceStates §١):
 * - Refined boutique header with reassuring service pillars
 * - Distinct, tactile cart product cards with smooth animation
 * - Clear subtotal & line total calculations
 * - Inline alerts for price changes and stock availability
 * - Reassuring summary panel with one-tap checkout and authentication integration
 */
export function CartView() {
  const m = useMessages();
  const locale = useLocale();
  const router = useRouter();
  const { isAuthenticated, openAuthModal } = useAuth();
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
    if (removed) {
      clearTimeout(undoTimer.current);
      setRemoved(null);
    }
    action();
  };

  if (isLoading) return <CartSkeleton label={m.loading} />;
  if (error && !cart) {
    return (
      <MessageBox tone="err" role="alert" className="mt-6 rounded-24">
        <p className="m-0 text-14">{m.cartLoadError}</p>
        <Button variant="light" size="s" className="mt-3" onClick={invalidate}>
          {m.checkoutRetry}
        </Button>
      </MessageBox>
    );
  }

  const items = cart?.items ?? [];
  const count = cart?.itemCount ?? 0;
  const changes = pendingChanges(items, reviewed);

  const continueToCheckout = () => {
    if (changes.priceChanged.length) setReviewed(markPricesReviewed(changes.priceChanged));
    if (!isAuthenticated) {
      openAuthModal({
        intent: 'checkout',
        onAuthenticated: () => {
          router.push(routes.checkout);
        },
      });
      return;
    }
    router.push(routes.checkout);
  };

  const toast = removed ? (
    <div className="pointer-events-none fixed inset-x-3 bottom-28 z-toast flex justify-center lg:bottom-8">
      <Toast className="pointer-events-auto w-full lg:w-96" action={{ label: m.cartUndo, onClick: undo }}>
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
    <div className="pb-32 lg:pb-0">
      {/* Header and trust pillars */}
      <header className="mb-6 hidden lg:block">
        <div className="flex items-baseline justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="m-0 font-display text-34 font-extrabold leading-44 text-ink">{m.cartStagingTitle}</h1>
            <span className="rounded-pill bg-sand px-3 py-1 font-display text-15 font-bold text-ink">
              {formatProductCount(count, locale)}
            </span>
          </div>
          <p className="m-0 text-14 text-stone">{m.cartLead}</p>
        </div>

        {/* Editorial reassurance ribbon */}
        <div className="mt-4 flex items-center justify-between rounded-24 bg-linen px-5 py-3 shadow-elevation-1">
          <span className="inline-flex items-center gap-2 text-13 font-medium text-ink">
            <Icon name="truck" size={17} className="text-cobalt" />
            <span>{m.cartPerksDelivery}</span>
          </span>
          <span className="h-4 w-px bg-line" aria-hidden="true" />
          <span className="inline-flex items-center gap-2 text-13 font-medium text-ink">
            <Icon name="cash" size={17} className="text-ok" />
            <span>{m.cartPerksCod}</span>
          </span>
          <span className="h-4 w-px bg-line" aria-hidden="true" />
          <span className="inline-flex items-center gap-2 text-13 font-medium text-ink">
            <Icon name="shield" size={17} className="text-stone" />
            <span>{m.cartPerksAuthentic}</span>
          </span>
        </div>
      </header>

      {merged ? (
        <MessageBox tone="info" role="status" className="mb-5 rounded-24">
          {m.authCartMerged}
        </MessageBox>
      ) : null}

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_390px] lg:items-start lg:gap-10">
        <section aria-label={m.cartTitle}>
          {failed ? (
            <p role="alert" className="m-0 mb-3 flex items-center gap-2 text-14 text-tomato-ink">
              <Icon name="alert" size={18} />
              {m.cartUpdateFailed}
            </p>
          ) : null}

          <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
            <AnimatePresence initial={false}>
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
            </AnimatePresence>
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
      className="mt-6 flex flex-col gap-4 rounded-24 bg-linen p-5 shadow-elevation-1 lg:sticky lg:top-6 lg:mt-0 lg:rounded-sheet lg:p-7 lg:shadow-elevation-2"
    >
      <div className="flex items-center justify-between pb-1">
        <h2 id="cart-summary" className="m-0 font-display text-24 font-extrabold leading-30 text-ink">
          {m.cartSummary}
        </h2>
        <span className="text-13 text-stone">{formatProductCount(count, locale)}</span>
      </div>

      <div className="flex flex-col gap-2.5">
        <SummaryRow label={fillMessage(m.cartSubtotalCount, { count: formatProductCount(count, locale) })}>
          <Money amount={total} />
        </SummaryRow>
        <SummaryRow label={m.cartShipping}>
          <span className="text-13.5 text-stone">{m.cartShippingLater}</span>
        </SummaryRow>
        <div aria-hidden="true" className="my-1 h-px bg-line" />
        <SummaryRow label={m.cartTotalNoDelivery} strong>
          <Money amount={total} className="font-display text-22 font-extrabold text-ink" />
        </SummaryRow>
      </div>

      {changes > 0 ? (
        <MessageBox tone="warn" role="status" className="rounded-16">
          <p className="m-0 text-13.5 leading-21">{blocked ? m.cartRemoveUnavailableFirst : changedCopy}</p>
        </MessageBox>
      ) : null}

      <div className="hidden lg:block pt-1">
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

      {/* Trust guarantees list */}
      <div className="rounded-16 bg-sand/30 p-3.5">
        <ul className="m-0 flex list-none flex-col gap-2 p-0 text-13 leading-20 text-stone">
          {signedIn ? null : (
            <li className="flex items-center gap-2">
              <Icon name="user" size={15} className="text-stone flex-none" />
              <span>{m.cartNoteSignIn}</span>
            </li>
          )}
          <li className="flex items-center gap-2">
            <Icon name="truck" size={15} className="text-stone flex-none" />
            <span>{m.cartNoteDelivery}</span>
          </li>
          <li className="flex items-center gap-2">
            <Icon name="cash" size={15} className="text-stone flex-none" />
            <span>{m.cartNotePayment}</span>
          </li>
        </ul>
      </div>
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
    <div className="fixed inset-x-0 bottom-0 z-nav flex items-center gap-3 bg-chalk/95 px-4 pt-3 pb-3 shadow-elevation-3 backdrop-blur-md lg:hidden pdp-bar">
      <div className="flex flex-col">
        <span className="text-11 leading-15 text-stone">{m.cartWithoutDelivery}</span>
        <Money amount={total} className="font-display text-18 font-extrabold leading-24 text-ink" />
      </div>
      <Button size="l" className="flex-1" disabled={blocked} onClick={onCheckout}>
        {m.cartCheckout}
      </Button>
    </div>
  );
}

function EmptyCart({ signedIn }: { signedIn: boolean }) {
  const m = useMessages();
  const { openAuthModal } = useAuth();
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="mx-auto mt-10 flex max-w-narrow flex-col items-center gap-4 rounded-sheet bg-linen px-6 py-14 text-center shadow-elevation-1 lg:mt-16 lg:px-12 lg:py-20"
    >
      <div className="relative mb-2 grid size-20 place-items-center rounded-pill bg-sand text-ink shadow-elevation-1">
        <span aria-hidden="true" className="sun sm think absolute -top-1 -end-1" />
        <Icon name="bag" size={32} />
      </div>
      <h1 className="m-0 font-display text-32 font-extrabold leading-38 text-ink lg:text-40 lg:leading-44">{m.cartEmptyTitle}</h1>
      <p className="m-0 max-w-md text-15 leading-24 text-stone">{m.cartEmptyBody}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-3">
        <Link href={routes.products} className={buttonVariants({ variant: 'ink', size: 'l' })}>
          {m.cartShop}
        </Link>
        {signedIn ? null : (
          <Link
            href={signInHref(routes.cart)}
            onClick={(e) => {
              e.preventDefault();
              openAuthModal();
            }}
            className={buttonVariants({ variant: 'light', size: 'l' })}
          >
            {m.cartSignIn}
          </Link>
        )}
      </div>
    </motion.section>
  );
}

function CartSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="mt-4 flex flex-col gap-4 lg:mt-6">
      <Skeleton className="hidden h-12 w-56 rounded-pill lg:block" />
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="flex gap-4 rounded-24 bg-linen p-4 lg:p-5">
          <Skeleton className="h-26 w-22 rounded-image lg:h-32 lg:w-26" />
          <div className="flex flex-1 flex-col justify-between py-1">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-28 rounded-pill" />
              <Skeleton className="h-5 w-2/3 rounded-pill" />
              <Skeleton className="h-3.5 w-20 rounded-pill" />
            </div>
            <Skeleton className="h-control-s w-36 rounded-pill" />
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
