'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AsyncButton, Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { iconButtonVariants } from '@/components/ui/icon-button';
import { ProductTile } from '@/components/ui/product-tile';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Toast } from '@/components/ui/toast';
import { useCart } from '@/features/cart/hooks/useCart';
import { ApiError } from '@/lib/api-client';
import { MAX_LINE_QUANTITY } from '@/lib/cart';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { currencyLabel, formatAmount, formatEgp, formatNumber, formatPackSize } from '@/lib/i18n/format';
import { fillMessage } from '@/lib/i18n/messages';
import { routes, shellRoutes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { getProductDetail, type ProductDetail, type PublicMedia, type PublicVariant } from '../api/discovery';
import { categoryLabel } from '../lib/card-model';
import { useCategoryTree } from '../lib/listing';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type AddState = 'idle' | 'pending' | 'added' | 'error';

/**
 * Product page (boards PDP, PDPMobile, PDPMobileFirst/Scrolled, PDPStates) over GET /products/:slug/detail. The selected
 * variant lives in `?sku=` so a size switch reloads price, availability, media and reviewed content together from the
 * backend. Only catalog-provided content is shown: the boards' concern claims, texture, key ingredients, routine
 * placement and «قبله وبعده» need data the API does not have and are not rendered.
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

  if (query.status === 'pending') return <DetailSkeleton />;
  if (query.status === 'error') {
    const missing = query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 400);
    return (
      <section className="mx-auto my-10 flex max-w-narrow flex-col items-center gap-4 rounded-card bg-linen px-6 py-10 text-center shadow-outline-hairline">
        <h1 className="m-0 text-display-3">{missing ? m.pdpNotFoundTitle : m.pdpLoadError}</h1>
        {missing ? <p className="m-0 text-15 leading-25 text-ink-2">{m.pdpNotFoundBody}</p> : null}
        <div className="flex flex-wrap justify-center gap-3">
          {missing ? null : (
            <Button variant="light" size="m" onClick={() => query.refetch()}>
              {m.tryAgain}
            </Button>
          )}
          <Link href={routes.products} className={buttonVariants({ variant: missing ? 'blue' : 'light', size: 'm' })}>
            {m.pdpBackToProducts}
          </Link>
        </div>
      </section>
    );
  }

  const selectVariant = (id: string) => router.replace(`${pathname}?sku=${id}`, { scroll: false });
  return <Detail product={query.data} switching={query.isPlaceholderData} onSelectVariant={selectVariant} />;
}

function useAddToCart(variant: PublicVariant) {
  const { cart, addItem } = useCart();
  const [state, setState] = useState<AddState>('idle');
  const [quantity, setQuantity] = useState(1);
  useEffect(() => {
    setState('idle');
    setQuantity(1);
  }, [variant.id]);
  const inCart = cart?.items.find((item) => item.skuId === variant.id)?.quantity ?? 0;
  const add = async () => {
    if (state === 'pending') return;
    setState('pending');
    try {
      await addItem({ skuId: variant.id, quantity });
      setState('added');
    } catch {
      setState('error');
    }
  };
  return { state, setState, quantity, setQuantity, inCart, add };
}

function Detail({ product, switching, onSelectVariant }: { product: ProductDetail; switching: boolean; onSelectVariant: (id: string) => void }) {
  const m = useMessages();
  const locale = useLocale();
  const tree = useCategoryTree();
  const variant = product.selectedVariant;
  const content = variant.content;
  const name = content?.name || product.name;
  const media = variant.media.length ? variant.media : product.media.filter((item) => item.skuId === variant.id);
  const buy = useAddToCart(variant);
  const buyRowRef = useRef<HTMLDivElement>(null);
  const [barVisible, setBarVisible] = useState(false);

  // The phone purchase bar appears only once the page's own buy buttons scroll out of view (PDPMobileScrolled).
  useEffect(() => {
    const el = buyRowRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setBarVisible(!entry.isIntersecting && entry.boundingClientRect.top < 0));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    document.documentElement.toggleAttribute('data-pdp-bar', barVisible);
    return () => document.documentElement.removeAttribute('data-pdp-bar');
  }, [barVisible]);

  const department = product.category ? tree.data?.find((r) => r.id === product.category!.parentId || r.id === product.category!.id) : undefined;
  const categoryName = product.category ? categoryLabel(product.category, locale) : null;
  const sizes = [...new Set(product.skus.map((s) => formatPackSize(s.size, s.sizeUnit, locale)).filter(Boolean))].join(m.sizeOr);
  const sections: Array<{ key: string; title: string; body: string }> = [
    { key: 'usage', title: m.pdpUsage, body: (content?.usage ?? product.usage) || '' },
    { key: 'ingredients', title: m.pdpIngredients, body: content?.ingredients || '' },
    { key: 'warnings', title: m.pdpWarnings, body: (content?.warnings ?? product.warnings) || '' },
  ].filter((s) => s.body.trim());
  const description = (content?.description ?? product.description)?.trim() || null;

  return (
    <article className="flex flex-col gap-16 pb-10 lg:gap-24">
      <nav aria-label={m.plpBreadcrumb} className="hidden lg:block">
        <ol className="m-0 flex list-none flex-wrap items-center gap-2 p-0 text-13 leading-20">
          <Crumb href={routes.home} label={m.plpHome} />
          {department ? <Crumb href={routes.productsByCategory(department.slug)} label={categoryLabel(department, locale) ?? department.name} /> : null}
          {product.category && categoryName && product.category.slug !== department?.slug ? (
            <Crumb href={routes.productsByCategory(product.category.slug)} label={categoryName} />
          ) : null}
          <li aria-current="page" dir="auto" className="font-semibold">
            {name}
          </li>
        </ol>
      </nav>

      <div className="-mt-12 grid gap-6 lg:-mt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,600px)] lg:gap-16">
        <div className="lg:order-2">
          <Gallery media={media} name={name} />
        </div>

        <div className="flex flex-col gap-5 lg:order-1 lg:pt-6" aria-busy={switching || undefined}>
          <div className="flex flex-col gap-3">
            <Link
              href={`${routes.products}?brand=${encodeURIComponent(product.brand.slug)}`}
              lang="en"
              dir="ltr"
              className="self-end text-12 font-bold leading-17 tracking-brand text-night underline decoration-1 underline-offset-[5px]"
            >
              {product.brand.name.toUpperCase()}
            </Link>
            <h1 dir="auto" className="m-0 font-text text-32 font-bold leading-40 text-night text-match-parent lg:text-40 lg:leading-45">
              {name}
            </h1>
          </div>

          <SizeOptions product={product} variant={variant} onSelect={onSelectVariant} />

          <PriceRow variant={variant} />

          <div ref={buyRowRef}>
            <BuyRow product={product} variant={variant} buy={buy} disabled={switching} name={name} />
          </div>

          <DeliveryDisclosure />

          <Link href={shellRoutes.shina} className="flex items-center gap-3 self-start text-15 font-semibold text-night no-underline">
            <span aria-hidden="true" className="sun-orb size-6.5" />
            <span className="underline decoration-1 underline-offset-[6px]">{m.pdpAskShina}</span>
          </Link>
        </div>
      </div>

      {description || sections.length || sizes || categoryName ? (
        <section aria-labelledby="about-h" className="grid gap-10 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] lg:gap-20">
          <div className="flex flex-col gap-4">
            <span className="text-12 font-semibold leading-17 text-ink-2">{m.pdpAboutEyebrow}</span>
            <h2 id="about-h" className="m-0 text-display-1">
              {m.pdpBrandSays}
            </h2>
            {description ? (
              <blockquote dir="auto" className="m-0 whitespace-pre-line text-17 leading-30 text-night text-match-parent">
                «{description}»
              </blockquote>
            ) : null}
            <span className="flex items-center gap-2 text-13 text-ink-2">
              <span className="rounded-6 bg-saffron-tint px-2 py-0.5 text-12 font-semibold text-saffron-ink">{m.pdpBrandBadge}</span>
              <span>{fillMessage(m.pdpBrandDescription, { brand: product.brand.name })}</span>
            </span>
            <dl className="m-0 grid grid-cols-2 gap-x-6">
              {[
                { k: m.pdpSpecSize, v: sizes },
                { k: m.pdpSpecStep, v: categoryName },
                { k: m.pdpSpecLine, v: product.productLine?.name ?? null, latin: true },
                { k: m.pdpSpecCode, v: variant.code, latin: true },
              ]
                .filter((row) => row.v)
                .map((row) => (
                  <div key={row.k} className="flex flex-col gap-0.5 py-3 shadow-hairline-bottom">
                    <dt className="text-12 font-semibold leading-17 text-ink-2">{row.k}</dt>
                    <dd dir={row.latin ? 'ltr' : undefined} className="m-0 text-15 font-semibold leading-24 text-match-parent">
                      {row.v}
                    </dd>
                  </div>
                ))}
            </dl>
          </div>
          {sections.length ? (
            <div className="flex flex-col shadow-hairline-top">
              {sections.map((section, index) => (
                <details key={section.key} open={index === 0} className="group shadow-hairline-bottom">
                  <summary className="flex min-h-15 cursor-pointer list-none items-center justify-between gap-3 font-display text-21 font-bold leading-27 text-night [&::-webkit-details-marker]:hidden">
                    {section.title}
                    <Icon name="chevron-down" size={18} strokeWidth={2} className="transition-transform duration-fast group-open:rotate-180" />
                  </summary>
                  <p dir="auto" className="m-0 whitespace-pre-line pb-5 text-15 leading-27 text-ink-2 text-match-parent">
                    {section.body}
                  </p>
                </details>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="routine-h" className="flex flex-col gap-3 rounded-card bg-linen p-6 shadow-outline-hairline lg:max-w-[416px] lg:p-7">
        <h2 id="routine-h" className="m-0 text-display-3">
          {m.pdpRoutineTitle}
        </h2>
        <p className="m-0 text-14.5 leading-24 text-ink-2">{m.pdpRoutineBody}</p>
        <Link href={routes.routineBuilder} className="text-link self-start">
          {m.pdpRoutineCta}
        </Link>
      </section>

      <MobilePurchaseBar product={product} variant={variant} buy={buy} visible={barVisible} onSelect={onSelectVariant} name={name} />
    </article>
  );
}

function Crumb({ href, label }: { href: string; label: string }) {
  return (
    <li className="inline-flex items-center gap-2">
      <Link href={href} className="font-medium text-night underline decoration-1 underline-offset-[5px]">
        {label}
      </Link>
      <span aria-hidden="true" className="opacity-70">
        ›
      </span>
    </li>
  );
}

function Gallery({ media, name }: { media: PublicMedia[]; name: string }) {
  const m = useMessages();
  const images = media.filter((item) => item.type === 'image').sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.sortOrder - b.sortOrder);
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(false);
  useEffect(() => setIndex(0), [images[0]?.id]);
  const current = images[index] ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <ProductTile
          src={current?.url ?? null}
          alt={current?.altText?.trim() || name}
          name={name}
          priority
          sizes="(min-width: 1024px) 600px, 100vw"
          className="rounded-card shadow-elevation-3 lg:aspect-[600/750]"
        />
        {current ? (
          <button type="button" aria-label={m.pdpZoom} onClick={() => setZoom(true)} className={cn(iconButtonVariants({ variant: 'raised' }), 'absolute start-4 top-4 size-11')}>
            <Icon name="zoom" size={20} />
          </button>
        ) : null}
      </div>
      {images.length > 1 ? (
        <ul className="m-0 flex list-none gap-2 overflow-x-auto p-0 pb-1 scrollbar-none">
          {images.map((image, i) => (
            <li key={image.id} className="flex-none">
              <button
                type="button"
                aria-label={fillMessage(m.pdpShowImage, { i: i + 1 })}
                aria-current={i === index}
                onClick={() => setIndex(i)}
                className={cn('block rounded-image p-0.5', i === index ? 'shadow-outline-blue' : 'shadow-none')}
              >
                <ProductTile size="thumb" className="size-16" src={image.url} alt="" name={name} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent closeLabel={m.pdpCloseZoom} className="max-w-[720px] p-3">
          <DialogTitle className="sr-only">{name}</DialogTitle>
          <ProductTile src={current?.url ?? null} alt={current?.altText?.trim() || name} name={name} sizes="720px" />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** «الحجم: ٣٠ مل» + radio cards (size + price; unavailable sizes struck with «غير متوفر حاليًا»), PDPStates §١. */
function SizeOptions({ product, variant, onSelect, compact = false }: { product: ProductDetail; variant: PublicVariant; onSelect: (id: string) => void; compact?: boolean }) {
  const m = useMessages();
  const locale = useLocale();
  if (product.skus.length < 2) return null;
  const label = (s: PublicVariant) => formatPackSize(s.size, s.sizeUnit, locale) ?? s.variantName;
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-2 p-0 text-14 font-bold">
        {m.pdpSizeLabel} <span className="font-normal text-ink-2">{label(variant)}</span>
      </legend>
      <div role="radiogroup" aria-label={m.pdpSpecSize} className="grid grid-cols-2 gap-3">
        {product.skus.map((sku) => {
          const checked = sku.id === variant.id;
          const price = sku.price ? formatEgp(sku.price.amount, sku.price.currency, locale) : null;
          return (
            <button
              key={sku.id}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => !checked && onSelect(sku.id)}
              className={cn(
                'flex items-center gap-2.5 rounded-image px-3.5 text-start',
                compact ? 'h-12' : 'h-15',
                checked ? 'bg-blue-tint shadow-outline-blue' : sku.canOrder ? 'bg-linen shadow-outline-control' : 'bg-linen shadow-outline-hairline'
              )}
            >
              <span aria-hidden="true" className={cn('flex size-5 flex-none items-center justify-center rounded-full', checked ? 'bg-blue text-white' : 'shadow-outline-check')}>
                {checked ? <Icon name="check" size={13} strokeWidth={3} /> : null}
              </span>
              <span className={cn('text-16 font-bold', !sku.canOrder && 'text-ink-3 line-through')}>{label(sku)}</span>
              <span className={cn('ms-auto text-12.5', sku.canOrder ? 'text-ink-2' : 'font-medium text-err')}>
                {sku.canOrder ? price : m.pdpUnavailableNow}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function PriceRow({ variant }: { variant: PublicVariant }) {
  const m = useMessages();
  const locale = useLocale();
  const price = variant.price;
  // The reference price is shown only when the backend supplies one above the current price.
  const compareAt = price && price.compareAtAmount !== null && price.compareAtAmount > price.amount ? price.compareAtAmount : null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {price ? (
        <p className="m-0 flex items-baseline gap-2">
          <span className="text-32 font-bold leading-36 tabular-nums">
            <bdi>{formatAmount(price.amount, locale)}</bdi>
            <span className="ms-1.5 text-14 font-medium text-ink-2">{currencyLabel(locale)}</span>
          </span>
          {compareAt ? (
            <span className="text-15 text-ink-3 line-through">
              <span className="sr-only">{fillMessage(m.pdpWas, { price: formatEgp(compareAt, price.currency, locale) ?? '' })}</span>
              <bdi aria-hidden>{formatAmount(compareAt, locale)}</bdi>
            </span>
          ) : null}
        </p>
      ) : (
        <p className="m-0 text-15 text-ink-3">{m.productPriceUnavailable}</p>
      )}
      <p className={cn('m-0 flex items-center gap-2 text-15 font-semibold', variant.canOrder ? 'text-ok' : 'text-err')}>
        <span aria-hidden="true" className={cn('size-2 rounded-full', variant.canOrder ? 'bg-ok' : 'bg-err')} />
        {variant.canOrder ? m.pdpAvailable : m.pdpUnavailableNow}
      </p>
    </div>
  );
}

type Buy = ReturnType<typeof useAddToCart>;

function BuyRow({ product, variant, buy, disabled, name }: { product: ProductDetail; variant: PublicVariant; buy: Buy; disabled: boolean; name: string }) {
  const m = useMessages();
  const locale = useLocale();
  const router = useRouter();
  if (!variant.canOrder || !variant.price) {
    return (
      <div className="flex flex-col gap-3">
        <Button variant="blue" size="l" disabled className="w-full">
          {m.pdpUnavailableNow}
        </Button>
        {product.category ? (
          <Button asChild variant="light" size="l" className="w-full">
            <Link href={routes.productsByCategory(product.category.slug)}>{m.pdpAlternatives}</Link>
          </Button>
        ) : null}
      </div>
    );
  }
  const added = buy.state === 'added';
  return (
    <div className="relative flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <QuantityStepper
          value={buy.quantity}
          displayValue={formatNumber(buy.quantity, locale)}
          max={Math.max(1, MAX_LINE_QUANTITY - buy.inCart)}
          onChange={buy.setQuantity}
          disabled={disabled || buy.state === 'pending'}
          labels={{ group: m.pdpQuantity, decrease: m.pdpDecrease, increase: m.pdpIncrease }}
          className="h-control-l [&_button]:h-control-l [&_button]:w-11"
        />
        <AsyncButton
          state={buy.state === 'added' ? 'idle' : buy.state}
          variant="blue"
          size="l"
          className={cn('flex-1', added && 'bg-blue-deep hover:bg-blue-deep')}
          pendingLabel={m.pdpAdding}
          retryLabel={m.pdpAddCta}
          disabled={disabled}
          onClick={() => (added ? router.push(routes.cart) : buy.add())}
        >
          {added ? (
            <>
              <Icon name="check" size={18} strokeWidth={2.4} />
              {fillMessage(m.pdpAddedGo, { n: formatNumber(buy.inCart, locale) })}
            </>
          ) : (
            <>
              <Icon name="plus" size={18} strokeWidth={2.25} />
              {m.pdpAddCta}
            </>
          )}
        </AsyncButton>
      </div>
      {buy.state === 'error' ? (
        <p role="alert" className="m-0 flex items-start gap-2 text-13.5 leading-21 text-err">
          <span aria-hidden="true" className="mt-1.5 size-1.75 flex-none rounded-full bg-err" />
          {m.pdpAddFailed}
        </p>
      ) : null}
      {added ? <AddedPopover variant={variant} name={name} brand={product.brand.name} quantity={buy.inCart} onClose={() => buy.setState('idle')} /> : null}
    </div>
  );
}

/** Desktop confirmation (PDPStates «رسالة التأكيد»): stays while hovered or focused, never steals focus. */
function AddedPopover({ variant, name, brand, quantity, onClose }: { variant: PublicVariant; name: string; brand: string; quantity: number; onClose: () => void }) {
  const m = useMessages();
  const locale = useLocale();
  const image = variant.media.find((x) => x.type === 'image');
  const size = formatPackSize(variant.size, variant.sizeUnit, locale) ?? variant.variantName;
  return (
    <div role="status" className="absolute inset-x-0 top-full z-overlay mt-3 hidden flex-col gap-3 rounded-card bg-linen p-4 shadow-elevation-3 lg:flex">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-15 font-bold text-ok">
          <Icon name="check" size={18} strokeWidth={2.4} />
          {m.pdpAddedTitle}
        </span>
        <button type="button" aria-label={m.close} onClick={onClose} className={iconButtonVariants()}>
          <Icon name="close" size={18} strokeWidth={2} />
        </button>
      </div>
      <div className="flex items-center gap-3">
        <ProductTile size="thumb" className="size-14 flex-none" src={image?.url ?? null} alt="" name={name} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span lang="en" dir="ltr" className="text-brand text-ink-2 text-match-parent">
            {brand.toUpperCase()}
          </span>
          <span dir="auto" className="truncate text-14 font-semibold text-match-parent">
            {name}
          </span>
          <span className="text-12.5 text-ink-2">{fillMessage(m.pdpQtyLine, { size, n: formatNumber(quantity, locale) })}</span>
        </span>
      </div>
      <div className="flex gap-2.5">
        <Button asChild variant="blue" size="m" className="flex-1">
          <Link href={routes.cart}>{fillMessage(m.pdpGoToCart, { n: formatNumber(quantity, locale) })}</Link>
        </Button>
        <Button variant="light" size="m" onClick={onClose}>
          {m.pdpKeepShopping}
        </Button>
      </div>
    </div>
  );
}

function DeliveryDisclosure() {
  const m = useMessages();
  return (
    <details className="group rounded-input bg-linen shadow-outline-hairline">
      <summary className="flex min-h-13 cursor-pointer list-none items-center gap-2.5 px-4 [&::-webkit-details-marker]:hidden">
        <Icon name="truck" size={20} />
        <span className="text-15 font-semibold">{m.pdpDelivery}</span>
        <span className="ms-auto text-13 text-ink-3">{m.pdpNotConfirmed}</span>
        <Icon name="chevron-down" size={16} strokeWidth={2} className="transition-transform duration-fast group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-1 px-4 pb-4 text-14 leading-22 text-ink-2">
        <p className="m-0">{m.pdpDeliveryBody}</p>
        <p className="m-0">{m.pdpReturnsBody}</p>
      </div>
    </details>
  );
}

/**
 * Phone purchase bar (PDPMobileScrolled, PDPStates §٢): appears once the page's buy buttons scroll away — product
 * thumb, a size/price chip that opens the same size chooser, and «أضف للسلة» / «روح للسلة (١)». After adding, a dark
 * toast «اتضاف للسلة: ٣٠ مل · روح للسلة» sits above it. Bottom padding follows the device's real safe-area inset.
 */
function MobilePurchaseBar({ product, variant, buy, visible, onSelect, name }: { product: ProductDetail; variant: PublicVariant; buy: Buy; visible: boolean; onSelect: (id: string) => void; name: string }) {
  const m = useMessages();
  const locale = useLocale();
  const router = useRouter();
  const [sizeOpen, setSizeOpen] = useState(false);
  const image = variant.media.find((x) => x.type === 'image') ?? product.media.find((x) => x.type === 'image');
  const size = formatPackSize(variant.size, variant.sizeUnit, locale) ?? variant.variantName;
  const added = buy.state === 'added';
  const orderable = variant.canOrder && variant.price;

  return (
    <div
      className={cn(
        'pdp-bar fixed inset-x-0 bottom-0 z-nav flex flex-col gap-2 bg-bone/95 px-3 pt-2.5 shadow-hairline-top backdrop-blur-sm transition-transform duration-base ease-standard lg:hidden',
        visible ? 'translate-y-0' : 'pointer-events-none translate-y-full'
      )}
      aria-hidden={!visible}
    >
      {added ? (
        <Toast action={{ label: m.pdpToCart, onClick: () => router.push(routes.cart) }}>
          <span className="flex items-center gap-2">
            <Icon name="check" size={16} strokeWidth={2.4} />
            {fillMessage(m.pdpAddedToast, { size })}
          </span>
        </Toast>
      ) : null}
      <div className="flex items-center gap-2.5">
        <ProductTile size="thumb" className="h-12.5 w-10 flex-none rounded-8" src={image?.url ?? null} alt="" name={name} />
        <button
          type="button"
          onClick={() => product.skus.length > 1 && setSizeOpen(true)}
          aria-label={product.skus.length > 1 ? fillMessage(m.pdpBarSize, { size }) : undefined}
          className="flex h-12.5 flex-none flex-col items-start justify-center rounded-input bg-sand px-3 text-start"
        >
          <span className="flex items-center gap-1 text-12.5 font-semibold">
            {product.skus.length > 1 ? <Icon name="chevron-down" size={12} strokeWidth={2} /> : null}
            {size}
          </span>
          {variant.price ? (
            <span className="text-15 font-bold leading-20 tabular-nums">
              <bdi>{formatAmount(variant.price.amount, locale)}</bdi>
              <span className="ms-1 text-11 font-medium text-ink-2">{currencyLabel(locale)}</span>
            </span>
          ) : null}
        </button>
        {orderable ? (
          <AsyncButton
            state={buy.state === 'added' ? 'idle' : buy.state}
            variant="blue"
            size="m"
            className={cn('h-12.5 flex-1', added && 'bg-blue-deep hover:bg-blue-deep')}
            pendingLabel={m.cardAdding}
            retryLabel={m.pdpAddCta}
            tabIndex={visible ? 0 : -1}
            onClick={() => (added ? router.push(routes.cart) : buy.add())}
          >
            {added ? (
              <>
                <Icon name="check" size={16} strokeWidth={2.4} />
                {fillMessage(m.pdpGoToCart, { n: formatNumber(buy.inCart, locale) })}
              </>
            ) : (
              <>
                <Icon name="plus" size={16} strokeWidth={2.25} />
                {m.pdpAddCta}
              </>
            )}
          </AsyncButton>
        ) : (
          <Button asChild variant="light" size="m" className="h-12.5 flex-1">
            <Link href={product.category ? routes.productsByCategory(product.category.slug) : routes.products} tabIndex={visible ? 0 : -1}>
              {m.pdpSeeAlternatives}
            </Link>
          </Button>
        )}
      </div>
      <Sheet open={sizeOpen} onOpenChange={setSizeOpen}>
        <SheetContent side="bottom" closeLabel={m.close} className="rounded-t-24">
          <span aria-hidden="true" className="mt-2 h-1 w-10 self-center rounded-4 bg-dune" />
          <div className="px-4 pb-2 pt-1 shadow-hairline-bottom">
            <SheetTitle className="flex h-control-s items-center font-display text-22 font-bold leading-28">{m.pdpChooseSize}</SheetTitle>
          </div>
          <div className="flex flex-col gap-4 px-4 pb-5 pt-4">
            <SizeOptions
              product={product}
              variant={variant}
              compact
              onSelect={(id) => {
                onSelect(id);
              }}
            />
            <AsyncButton
              state={buy.state === 'added' ? 'idle' : buy.state}
              variant="blue"
              size="m"
              className="h-12.5 w-full"
              pendingLabel={m.cardAdding}
              disabled={!orderable}
              onClick={async () => {
                await buy.add();
                setSizeOpen(false);
              }}
            >
              {m.pdpAddCta}
              {variant.price ? (
                <>
                  <span aria-hidden="true" className="size-[3px] rounded-full bg-white/70" />
                  <bdi>{formatEgp(variant.price.amount, variant.price.currency, locale)}</bdi>
                </>
              ) : null}
            </AsyncButton>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" className="grid gap-6 pb-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,600px)] lg:gap-16">
      <Skeleton className="aspect-[4/5] w-full rounded-card lg:order-2" />
      <div className="flex flex-col gap-4 lg:order-1 lg:pt-6">
        <Skeleton className="h-4 w-28 rounded-4 bg-line" />
        <Skeleton className="h-10 w-4/5 rounded-6 bg-line" />
        <Skeleton className="h-15 w-full rounded-image bg-line" />
        <Skeleton className="h-9 w-40 rounded-6 bg-line" />
        <Skeleton className="h-control-l w-full rounded-pill bg-line" />
      </div>
    </div>
  );
}
