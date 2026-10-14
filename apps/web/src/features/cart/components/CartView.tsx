'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { ProductNiche } from '@/components/ui/product-niche';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { Skeleton } from '@/components/ui/skeleton';
import { ProductImage } from '@/features/home/components/ProductImage';
import type { CartItem } from '@/lib/cart';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { formatEgp, formatPackSize } from '@/lib/i18n/format';
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
      <Alert variant="destructive" className="items-center">
        <p className="flex-1 text-body-s">{m.cartLoadError}</p>
        <Button variant="secondary" size="sm" onClick={invalidate}>
          {m.tryAgain}
        </Button>
      </Alert>
    );
  }

  const items = cart?.items ?? [];
  const blocked = items.some((item) => !item.canOrder);
  const subtotal = formatEgp(cart?.total ?? 0, 'EGP', locale);

  return (
    <div className="space-y-4 lg:grid lg:grid-cols-[1fr_22rem] lg:items-start lg:gap-10 lg:space-y-0">
      <section aria-labelledby="cart-title" className="space-y-4">
        <header className="flex items-baseline justify-between gap-3">
          <h1 id="cart-title" className="text-display-m text-foreground">
            {m.cartTitle}
          </h1>
          {items.length ? (
            <p className="text-body-s text-ink-soft">{fillMessage(m.cartItemCount, { n: cart?.itemCount ?? 0 })}</p>
          ) : null}
        </header>

        {removed ? (
          <Alert variant="neutral" className="items-center">
            <p role="status" className="flex-1 text-body-s">
              {fillMessage(m.cartRemoved, { name: removed.name })}
            </p>
            <Button variant="secondary" size="sm" onClick={undo}>
              {m.cartUndo}
            </Button>
          </Alert>
        ) : null}

        {failed ? (
          <p role="alert" className="flex items-center gap-2 text-body-s text-destructive">
            <Icon name="alert" size={18} />
            {m.cartUpdateFailed}
          </p>
        ) : null}

        {items.length === 0 ? (
          <div className="rounded-md border border-border bg-card px-5 py-8 text-center">
            <Icon name="bag" size={32} className="mx-auto text-ink-subtle" />
            <h2 className="mt-3 text-heading text-foreground">{m.cartEmptyTitle}</h2>
            <p className="mt-1 text-body-s text-muted-foreground">{m.cartEmptyBody}</p>
            <Link href={routes.products} className={cn(buttonVariants(), 'mt-5')}>
              {m.pdpBackToProducts}
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
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
        <aside aria-labelledby="cart-summary" className="space-y-4 rounded-md border border-border bg-card p-4 lg:sticky lg:top-24">
          <h2 id="cart-summary" className="text-heading text-foreground">
            {m.cartSummary}
          </h2>
          <dl className="space-y-2 text-body-s">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-soft">{m.cartSubtotal}</dt>
              <dd className="text-price tabular-nums text-foreground">
                <bdi>{subtotal}</bdi>
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-soft">{m.cartShipping}</dt>
              <dd className="text-end text-ink-soft">{m.cartShippingLater}</dd>
            </div>
          </dl>
          <p className="flex items-center gap-2 text-body-s text-ink-soft">
            <Icon name="truck" size={18} />
            {m.cartPaymentNote}
          </p>
          {blocked ? (
            <p className="flex items-start gap-2 text-body-s text-attention-ink">
              <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
              {m.cartRemoveUnavailableFirst}
            </p>
          ) : null}
          {blocked ? (
            <Button size="lg" className="w-full" disabled>
              {m.cartCheckout}
            </Button>
          ) : (
            <Link href={routes.checkout} className={cn(buttonVariants({ size: 'lg' }), 'w-full')}>
              {m.cartCheckout}
            </Link>
          )}
          <Link href={routes.products} className={cn(buttonVariants({ variant: 'ghost' }), 'w-full')}>
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
        <ProductNiche>
          <ProductImage src={item.sku.image?.url ?? null} alt={item.sku.image?.alt || name} />
        </ProductNiche>
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-caption text-ink-soft">
          <bdi>{product.brand.name}</bdi>
        </p>
        <h3 dir="auto" className="text-body text-foreground [text-align:match-parent]">
          {product.slug ? <Link href={routes.productVariant(product.slug, item.skuId)}>{name}</Link> : name}
        </h3>
        <p className="text-body-s text-ink-subtle">
          <bdi>{size}</bdi>
          {unit ? (
            <>
              {' · '}
              <bdi>{fillMessage(m.cartUnitPrice, { price: unit })}</bdi>
            </>
          ) : null}
        </p>
        {oldPrice && unit ? (
          <p className="flex items-start gap-1.5 text-body-s text-attention-ink">
            <Icon name="info" size={16} className="mt-0.5 shrink-0" />
            {fillMessage(m.cartPriceChanged, { old: oldPrice, new: unit })}
          </p>
        ) : null}
        {!item.canOrder ? (
          <p className="flex items-start gap-1.5 text-body-s text-destructive">
            <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
            {m.cartLineUnavailable}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <QuantityStepper
            value={item.quantity}
            max={MAX_LINE_QUANTITY}
            onChange={onQuantity}
            disabled={busy || !item.canOrder}
            labels={{ group: m.pdpQuantity, decrease: m.pdpDecrease, increase: m.pdpIncrease }}
            className="h-control-m"
          />
          <div className="flex items-center gap-2">
            {item.canOrder && lineTotal ? (
              <p className="text-price tabular-nums text-foreground">
                <bdi>{lineTotal}</bdi>
              </p>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
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
      <Skeleton shape="pill" className="h-8 w-40" />
      {Array.from({ length: 2 }, (_, index) => (
        <div key={index} className="flex gap-3">
          <Skeleton shape="arch" className="aspect-[4/5] w-20" />
          <div className="flex-1 space-y-2">
            <Skeleton shape="pill" className="h-4 w-1/3" />
            <Skeleton shape="pill" className="h-5 w-2/3" />
            <Skeleton shape="pill" className="h-control-m w-32" />
          </div>
        </div>
      ))}
    </div>
  );
}
