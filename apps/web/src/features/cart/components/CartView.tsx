'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { MessageBox } from '@/components/ui/message-box';
import { Button, buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { ProductTile } from '@/components/ui/product-tile';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { Skeleton } from '@/components/ui/skeleton';
import type { CartItem } from '@/lib/cart';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { formatEgp, formatNumber, formatPackSize } from '@/lib/i18n/format';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { useCart } from '../hooks/useCart';

/** Backend cart limit per line (apps/api ordering/dto/cart.dto.ts). */
const MAX_LINE_QUANTITY = 20;

/**
 * Cart over the guest/authenticated cart API. Every number shown (line totals, subtotal, availability,
 * price changes) is the backend's; quantity changes and removals go to the API and the returned cart
 * replaces local state. Removal offers Undo by re-adding the same SKU and quantity.
 */
export function CartView() {
  const m = useMessages();
  const locale = useLocale();
  const { cart, isLoading, error, updateItem, removeItem, addItem, invalidate } = useCart();
  const [busySku, setBusySku] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [removed, setRemoved] = useState<{ skuId: string; quantity: number; name: string } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout>>();

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
      setRemoved({ skuId: item.skuId, quantity: item.quantity, name: item.sku.product.name });
      clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setRemoved(null), 8000);
    });

  const undo = () => {
    if (!removed) return;
    const { skuId, quantity } = removed;
    setRemoved(null);
    run(skuId, () => addItem({ skuId, quantity }));
  };

  if (isLoading) return <CartSkeleton label={m.loading} />;
  if (error && !cart) {
    return (
      <MessageBox tone="err" className="items-center">
        <p className="flex-1 text-14">{m.cartLoadError}</p>
        <Button variant="light" size="s" onClick={invalidate}>
          {m.tryAgain}
        </Button>
      </MessageBox>
    );
  }

  const items = cart?.items ?? [];
  const blocked = items.some((item) => !item.canOrder);
  const subtotal = formatEgp(cart?.total ?? 0, 'EGP', locale);

  return (
    <div className="space-y-4 lg:grid lg:grid-cols-[1fr_22rem] lg:items-start lg:gap-10 lg:space-y-0">
      <section aria-labelledby="cart-title" className="space-y-4">
        <header className="flex items-baseline justify-between gap-3">
          <h1 id="cart-title" className="text-display-3 text-night">
            {m.cartTitle}
          </h1>
          {items.length ? (
            <p className="text-14 text-ink-2">{fillMessage(m.cartItemCount, { n: cart?.itemCount ?? 0 })}</p>
          ) : null}
        </header>

        {removed ? (
          <MessageBox tone="info" className="items-center">
            <p role="status" className="flex-1 text-14">
              {fillMessage(m.cartRemoved, { name: removed.name })}
            </p>
            <Button variant="light" size="s" onClick={undo}>
              {m.cartUndo}
            </Button>
          </MessageBox>
        ) : null}

        {failed ? (
          <p role="alert" className="flex items-center gap-2 text-14 text-err">
            <Icon name="alert" size={18} />
            {m.cartUpdateFailed}
          </p>
        ) : null}

        {items.length === 0 ? (
          <div className="rounded-card border border-line bg-linen px-5 py-8 text-center">
            <Icon name="bag" size={32} className="mx-auto text-ink-3" />
            <h2 className="mt-3 text-title text-night">{m.cartEmptyTitle}</h2>
            <p className="mt-1 text-14 text-ink-2">{m.cartEmptyBody}</p>
            <Link href={routes.products} className={cn(buttonVariants(), 'mt-5')}>
              {m.pdpBackToProducts}
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {items.map((item) => (
              <CartLine
                key={item.skuId}
                item={item}
                busy={busySku === item.skuId}
                onQuantity={(quantity) => run(item.skuId, () => updateItem({ skuId: item.skuId, quantity }))}
                onRemove={() => remove(item)}
              />
            ))}
          </ul>
        )}
      </section>

      {items.length ? (
        <aside aria-labelledby="cart-summary" className="space-y-4 rounded-card border border-line bg-linen p-4 lg:sticky lg:top-24">
          <h2 id="cart-summary" className="text-title text-night">
            {m.cartSummary}
          </h2>
          <dl className="space-y-2 text-14">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-2">{m.cartSubtotal}</dt>
              <dd className="text-price tabular-nums text-night">
                <bdi>{subtotal}</bdi>
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-2">{m.cartShipping}</dt>
              <dd className="text-end text-ink-2">{m.cartShippingLater}</dd>
            </div>
          </dl>
          <p className="flex items-center gap-2 text-14 text-ink-2">
            <Icon name="truck" size={18} />
            {m.cartPaymentNote}
          </p>
          {blocked ? (
            <p className="flex items-start gap-2 text-14 text-saffron-ink">
              <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
              {m.cartRemoveUnavailableFirst}
            </p>
          ) : null}
          {blocked ? (
            <Button size="l" className="w-full" disabled>
              {m.cartCheckout}
            </Button>
          ) : (
            <Link href={routes.checkout} className={cn(buttonVariants({ size: 'l' }), 'w-full')}>
              {m.cartCheckout}
            </Link>
          )}
          <Link href={routes.products} className={cn(buttonVariants({ variant: 'light' }), 'w-full')}>
            {m.cartContinueShopping}
          </Link>
        </aside>
      ) : null}
    </div>
  );
}

function CartLine({
  item,
  busy,
  onQuantity,
  onRemove,
}: {
  item: CartItem;
  busy: boolean;
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
}) {
  const m = useMessages();
  const locale = useLocale();
  const { product } = item.sku;
  const name = product.name || item.sku.code;
  const unit = item.price ? formatEgp(item.price.amount, item.price.currency, locale) : null;
  const lineTotal = item.subtotal !== null ? formatEgp(item.subtotal, item.price?.currency ?? 'EGP', locale) : null;
  const size = formatPackSize(item.sku.size, item.sku.sizeUnit, locale) ?? item.sku.variantName;
  const oldPrice = item.priceChangedSinceAdd && item.priceAtAdd !== null ? formatEgp(item.priceAtAdd, item.price?.currency ?? 'EGP', locale) : null;

  return (
    <li className="flex gap-3 py-4" aria-busy={busy}>
      <div className="w-20 shrink-0 sm:w-24">
        <ProductTile size="thumb" className="h-24" src={item.sku.image?.url ?? null} alt={item.sku.image?.alt || name} name={name} />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-12 text-ink-2">
          <bdi>{product.brand.name}</bdi>
        </p>
        <h3 dir="auto" className="text-body text-night text-match-parent">
          {product.slug ? <Link href={routes.productVariant(product.slug, item.skuId)}>{name}</Link> : name}
        </h3>
        <p className="text-14 text-ink-3">
          <bdi>{size}</bdi>
          {unit ? (
            <>
              {' · '}
              <bdi>{fillMessage(m.cartUnitPrice, { price: unit })}</bdi>
            </>
          ) : null}
        </p>
        {oldPrice && unit ? (
          <p className="flex items-start gap-1.5 text-14 text-saffron-ink">
            <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
            {fillMessage(m.cartPriceChanged, { old: oldPrice, new: unit })}
          </p>
        ) : null}
        {!item.canOrder ? (
          <p className="flex items-start gap-1.5 text-14 text-err">
            <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
            {m.cartLineUnavailable}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <QuantityStepper
            value={item.quantity}
            displayValue={formatNumber(item.quantity, locale)}
            max={MAX_LINE_QUANTITY}
            onChange={onQuantity}
            disabled={busy || !item.canOrder}
            labels={{ group: m.pdpQuantity, decrease: m.pdpDecrease, increase: m.pdpIncrease }}
            className="h-control-s"
          />
          <div className="flex items-center gap-2">
            {item.canOrder && lineTotal ? (
              <p className="text-price tabular-nums text-night">
                <bdi>{lineTotal}</bdi>
              </p>
            ) : null}
            <Button
              variant="light"
              size="s"
              onClick={onRemove}
              disabled={busy}
              aria-label={fillMessage(m.cartRemoveItem, { name })}
            >
              <Icon name="trash" size={18} />
              <span className="sr-only sm:not-sr-only">{m.cartRemove}</span>
            </Button>
          </div>
        </div>
      </div>
    </li>
  );
}

function CartSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="space-y-4">
      <Skeleton className="h-8 w-40" />
      {Array.from({ length: 2 }, (_, index) => (
        <div key={index} className="flex gap-3">
          <Skeleton className="aspect-[4/5] w-20" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-control-s w-32" />
          </div>
        </div>
      ))}
    </div>
  );
}
