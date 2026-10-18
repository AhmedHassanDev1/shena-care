'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { MessageBox } from '@/components/ui/message-box';
import { StatusChip } from '@/components/ui/status-chip';
import { Button, buttonVariants } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Icon } from '@/components/ui/icon';
import { ProductTile } from '@/components/ui/product-tile';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { Skeleton } from '@/components/ui/skeleton';
import { useCart } from '@/features/cart/hooks/useCart';
import { ApiError } from '@/lib/api-client';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { formatEgp, formatNumber, formatPackSize } from '@/lib/i18n/format';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { getProductDetail, type ProductDetail, type PublicMedia, type PublicVariant } from '../api/discovery';

/** Backend cart limit per line (apps/api ordering/dto/cart.dto.ts). */
const MAX_LINE_QUANTITY = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AddStatus = 'idle' | 'pending' | 'added' | 'unavailable' | 'failed';

/**
 * Product page over GET /products/:slug/detail (GLO-183). The selected variant lives in `?sku=` so a
 * variant switch reloads price, availability and media together from the backend; nothing about
 * sellability is decided here. Content sections render only reviewed fields.
 */
export function ProductDetailView({ slug }: { slug: string }) {
  const m = useMessages();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const requested = params.get('sku');
  const skuId = requested && UUID.test(requested) ? requested : undefined;

  const query = useQuery({
    queryKey: ['product-detail', slug, skuId ?? null],
    queryFn: () => getProductDetail(slug, skuId),
    placeholderData: keepPreviousData,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });

  if (query.status === 'pending') return <DetailSkeleton label={m.loading} />;
  if (query.status === 'error') {
    const missing = query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 400);
    return (
      <section className="mx-auto max-w-xl rounded-card border border-line bg-linen px-5 py-8 text-center">
        <h1 className="text-title text-night">{missing ? m.pdpNotFoundTitle : m.pdpLoadError}</h1>
        {missing ? <p className="mt-2 text-14 text-ink-2">{m.pdpNotFoundBody}</p> : null}
        <div className="mt-5 flex justify-center gap-3">
          {missing ? null : (
            <Button variant="light" onClick={() => query.refetch()}>
              {m.tryAgain}
            </Button>
          )}
          <Link href={routes.products} className={buttonVariants({ variant: missing ? 'blue' : 'light' })}>
            {m.pdpBackToProducts}
          </Link>
        </div>
      </section>
    );
  }

  const product = query.data;
  const selectVariant = (id: string) => router.replace(`${pathname}?sku=${id}`, { scroll: false });
  return <Detail product={product} switching={query.isPlaceholderData} onSelectVariant={selectVariant} />;
}

function Detail({
  product,
  switching,
  onSelectVariant,
}: {
  product: ProductDetail;
  switching: boolean;
  onSelectVariant: (id: string) => void;
}) {
  const m = useMessages();
  const locale = useLocale();
  const variant = product.selectedVariant;
  const content = variant.content;
  const name = content?.name || product.name;
  const media = variant.media.length ? variant.media : product.media.filter((item) => item.skuId === variant.id);

  const sections: Array<{ key: string; title: string; body: string | null }> = [
    { key: 'description', title: m.pdpDescription, body: content?.description ?? product.description },
    { key: 'usage', title: m.pdpUsage, body: content?.usage ?? product.usage },
    { key: 'ingredients', title: m.pdpIngredients, body: content?.ingredients ?? null },
    { key: 'warnings', title: m.pdpWarnings, body: content?.warnings ?? product.warnings },
  ].filter((section) => !!section.body?.trim());

  return (
    <article className="grid gap-6 pb-28 lg:grid-cols-2 lg:gap-12 lg:pb-0">
      <Gallery media={media} name={name} />

      <div className="space-y-5" aria-busy={switching}>
        <header className="space-y-1">
          <p className="text-14 font-semibold text-ink-2">
            <bdi>{product.brand.name}</bdi>
          </p>
          <h1 dir="auto" className="text-display-3 text-night text-match-parent">
            {name}
          </h1>
        </header>

        {product.skus.length > 1 ? (
          <fieldset className="space-y-2">
            <legend className="text-14 font-semibold text-night">{m.pdpSize}</legend>
            <div className="flex flex-wrap gap-2">
              {product.skus.map((sku) => (
                <Chip key={sku.id} selected={sku.id === variant.id} onClick={() => sku.id !== variant.id && onSelectVariant(sku.id)}>
                  <bdi>{formatPackSize(sku.size, sku.sizeUnit, locale) ?? sku.variantName}</bdi>
                </Chip>
              ))}
            </div>
          </fieldset>
        ) : null}

        <PriceBlock variant={variant} />

        <Availability variant={variant} siblings={product.skus} />

        <p className="flex items-start gap-2 text-14 text-ink-2">
          <Icon name="truck" size={20} className="mt-0.5 shrink-0" />
          {m.pdpDeliveryNote}
        </p>

        <div className="hidden lg:block">
          <BuyBox variant={variant} name={name} disabled={switching} />
        </div>

        <section className="divide-y divide-line border-y border-line">
          {sections.length === 0 ? (
            <p className="py-4 text-14 text-ink-2">{m.pdpContentPending}</p>
          ) : (
            sections.map((section, index) => (
              <details key={section.key} open={index === 0} className="group py-1">
                <summary className="flex min-h-control-s cursor-pointer list-none items-center justify-between gap-3 text-title text-night">
                  {section.title}
                  <Icon name="chevron-down" size={20} className="shrink-0 transition-transform duration-fast group-open:rotate-180" />
                </summary>
                <p dir="auto" className="whitespace-pre-line pb-4 text-body text-ink-2 text-match-parent">
                  {section.body}
                </p>
              </details>
            ))
          )}
        </section>
      </div>

      {/* Phones/tablets: the purchase bar stays reachable while reading. */}
      <div className="fixed inset-x-0 bottom-0 z-sticky border-t border-line bg-linen px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 shadow-elevation-2 lg:hidden">
        <BuyBox variant={variant} name={name} disabled={switching} compact />
      </div>
    </article>
  );
}

function Gallery({ media, name }: { media: PublicMedia[]; name: string }) {
  const m = useMessages();
  const images = media.filter((item) => item.type === 'image').sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.sortOrder - b.sortOrder);
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [images[0]?.id]);
  const current = images[index] ?? null;

  return (
    <div className="space-y-3">
      <ProductTile src={current?.url ?? null} alt={current?.altText?.trim() || name} name={name} priority sizes="(min-width: 1024px) 560px, 100vw">
        {images.length > 1 ? (
          <span className="absolute bottom-3 end-3 rounded-pill bg-linen px-2 py-0.5 text-12 tabular-nums text-night">
            <bdi>{fillMessage(m.pdpImageCount, { i: index + 1, n: images.length })}</bdi>
          </span>
        ) : null}
      </ProductTile>
      {images.length > 1 ? (
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {images.map((image, i) => (
            <li key={image.id} className="w-16 shrink-0">
              <button
                type="button"
                aria-label={fillMessage(m.pdpShowImage, { i: i + 1 })}
                aria-current={i === index}
                onClick={() => setIndex(i)}
                className={cn('block w-full rounded-input border', i === index ? 'border-night' : 'border-transparent')}
              >
                <ProductTile size="thumb" className="size-16" src={image.url} alt="" name={name} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function PriceBlock({ variant }: { variant: PublicVariant }) {
  const m = useMessages();
  const locale = useLocale();
  const price = variant.price;
  const amount = price ? formatEgp(price.amount, price.currency, locale) : null;
  if (!price || !amount) return <p className="text-body text-ink-3">{m.productPriceUnavailable}</p>;

  // The reference price is shown only when the backend supplies one above the current price.
  const compareAt = price.compareAtAmount !== null && price.compareAtAmount > price.amount ? price.compareAtAmount : null;
  const discount = variant.promotions?.orderDiscountAmount ?? 0;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-price tabular-nums text-night">
          <bdi>{amount}</bdi>
        </p>
        {compareAt ? (
          <>
            <p className="text-14 text-ink-3 line-through">
              <span className="sr-only">{fillMessage(m.pdpWas, { price: formatEgp(compareAt, price.currency, locale) ?? '' })}</span>
              <bdi aria-hidden>{formatEgp(compareAt, price.currency, locale)}</bdi>
            </p>
            <StatusChip tone="err">{fillMessage(m.pdpSave, { amount: formatEgp(compareAt - price.amount, price.currency, locale) ?? '' })}</StatusChip>
          </>
        ) : null}
      </div>
      {discount > 0 ? (
        <p className="text-14 text-ink-2">
          {fillMessage(m.pdpOrderDiscount, { amount: formatEgp(discount, price.currency, locale) ?? '' })}
        </p>
      ) : null}
    </div>
  );
}

function Availability({ variant, siblings }: { variant: PublicVariant; siblings: PublicVariant[] }) {
  const m = useMessages();
  if (variant.canOrder) {
    return (
      <p className="flex items-center gap-2 text-14 text-blue-deep">
        <Icon name="check" size={18} />
        {m.pdpInStock}
      </p>
    );
  }
  const alternative = siblings.some((sku) => sku.id !== variant.id && sku.canOrder);
  return (
    <MessageBox tone="warn">
      <div className="text-14">
        <p className="font-semibold">{m.pdpOutOfStock}</p>
        {alternative ? <p>{m.pdpOtherSizeAvailable}</p> : null}
      </div>
    </MessageBox>
  );
}

function BuyBox({ variant, name, disabled, compact = false }: { variant: PublicVariant; name: string; disabled: boolean; compact?: boolean }) {
  const m = useMessages();
  const locale = useLocale();
  const { addItem } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [status, setStatus] = useState<AddStatus>('idle');
  useEffect(() => {
    setQuantity(1);
    setStatus('idle');
  }, [variant.id]);

  const orderable = variant.canOrder && !!variant.price;
  const add = async () => {
    setStatus('pending');
    try {
      await addItem({ skuId: variant.id, quantity });
      setStatus('added');
    } catch (error) {
      const gone = error instanceof ApiError && (error.type === 'UNAVAILABLE' || error.status === 404 || error.status === 400);
      setStatus(gone ? 'unavailable' : 'failed');
    }
  };

  return (
    <div className={cn('space-y-2', compact ? '' : 'rounded-card border border-line bg-linen p-4')}>
      <div className="flex items-center gap-3">
        <QuantityStepper
          value={quantity}
          displayValue={formatNumber(quantity, locale)}
          max={MAX_LINE_QUANTITY}
          onChange={(next) => {
            setQuantity(next);
            if (status !== 'pending') setStatus('idle');
          }}
          disabled={!orderable || disabled}
          labels={{ group: m.pdpQuantity, decrease: m.pdpDecrease, increase: m.pdpIncrease }}
        />
        {status === 'added' ? (
          <Link href={routes.cart} className={cn(buttonVariants({ variant: 'light', size: 'l' }), 'flex-1')}>
            <Icon name="check" size={20} />
            {m.pdpViewCart}
          </Link>
        ) : (
          <Button
            size="l"
            className="flex-1"
            disabled={!orderable || disabled}
            loading={status === 'pending'}
            onClick={add}
            aria-label={`${m.pdpAddToCart}: ${name}`}
          >
            <Icon name="bag" size={20} />
            {m.pdpAddToCart}
          </Button>
        )}
      </div>
      <p role="status" className={cn('text-14', status === 'failed' || status === 'unavailable' ? 'flex items-center gap-2 text-err' : 'sr-only')}>
        {status === 'added' ? m.pdpAdded : null}
        {status === 'failed' || status === 'unavailable' ? (
          <>
            <Icon name="alert" size={18} />
            {status === 'unavailable' ? m.pdpAddUnavailable : m.pdpAddFailed}
          </>
        ) : null}
      </p>
    </div>
  );
}

function DetailSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="grid gap-6 lg:grid-cols-2 lg:gap-12">
      <Skeleton className="aspect-[4/5] w-full" />
      <div className="space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-control-s w-48" />
        <Skeleton className="h-8 w-32" />
      </div>
    </div>
  );
}
