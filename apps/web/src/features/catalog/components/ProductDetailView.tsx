'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { PageContainer } from '@/components/layout/page-container';
import { Section } from '@/components/layout/section';
import { AsyncButton, Button, buttonVariants } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card-variants';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { GlassBadge } from '@/components/ui/glass-badge';
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
import { compactImage, galleryImages } from '../lib/media-roles';
import { knownSkinTypes } from '../lib/product-facts';
import { skinTypeLabel } from './product-fact-labels';
import { HeroRating, ProductReviews } from './ProductReviews';
import { ProductAbout, ProductHighlights, ProductIngredients, ProductSuitability, ProductUsage, RelatedProducts, RoutinePlacement } from './ProductDetailSections';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type AddState = 'idle' | 'pending' | 'added' | 'error';
/** The async button shows the add cycle; «added» is rendered by the button's own label instead of its success state. */
const buttonState = (state: AddState) => (state === 'added' ? 'idle' : state);

/**
 * Product page over GET /products/:slug/detail, composed of Sahel `Section`s in the reference order: gallery + buy box,
 * at a glance, about, ingredients, how to use, routine placement, suitability, related products. Every section renders
 * only the reviewed catalog data it has; the selected variant lives in `?sku=` so a size switch reloads price,
 * availability, media and content together from the backend.
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
      <PageContainer>
        <section role="alert" className={cn(cardVariants(), 'mx-auto my-10 flex max-w-narrow flex-col items-center gap-4 px-6 py-10 text-center')}>
          <h1 className="m-0 font-display text-28 font-bold leading-36 text-ink">{missing ? m.pdpNotFoundTitle : m.pdpLoadError}</h1>
          {missing ? <p className="m-0 text-15 leading-25 text-stone">{m.pdpNotFoundBody}</p> : null}
          <div className="flex flex-wrap justify-center gap-3">
            {missing ? null : (
              <Button variant="ink" size="m" onClick={() => query.refetch()}>
                {m.tryAgain}
              </Button>
            )}
            <Link href={routes.products} className={buttonVariants({ variant: missing ? 'cobalt' : 'linen', size: 'm' })}>
              {m.pdpBackToProducts}
            </Link>
          </div>
        </section>
      </PageContainer>
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
    if (state === 'pending') return false;
    setState('pending');
    try {
      await addItem({ skuId: variant.id, quantity });
      setState('added');
      return true;
    } catch {
      setState('error');
      return false;
    }
  };
  return { state, setState, quantity, setQuantity, inCart, add };
}

type Buy = ReturnType<typeof useAddToCart>;

function Detail({ product, switching, onSelectVariant }: { product: ProductDetail; switching: boolean; onSelectVariant: (id: string) => void }) {
  const variant = product.selectedVariant;
  const name = variant.content?.name || product.name;
  const media = variant.media.length ? variant.media : product.media.filter((item) => item.skuId === variant.id);
  const buy = useAddToCart(variant);
  const buyRowRef = useRef<HTMLDivElement>(null);
  const [barVisible, setBarVisible] = useState(false);

  // The phone purchase bar appears only once the page's own buy buttons have scrolled away above the viewport.
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

  return (
    <article className="pb-28 lg:pb-10">
      <Section labelledBy="pdp-title" rhythm="compact" className="pt-2 lg:pt-4">
        <Breadcrumb product={product} name={name} />
        <div className="grid min-w-0 gap-4 lg:grid-cols-2 lg:items-start lg:gap-8">
          <Gallery media={media} name={name} />
          <div className="flex min-w-0 flex-col gap-3.5" aria-busy={switching || undefined}>
            <Identity product={product} variant={variant} name={name} />
            <PriceRow variant={variant} />
            <SizeOptions product={product} variant={variant} onSelect={onSelectVariant} />
            <div ref={buyRowRef}>
              <BuyRow product={product} variant={variant} buy={buy} disabled={switching} name={name} />
            </div>
            <DeliveryDisclosure />
          </div>
        </div>
      </Section>

      <ProductHighlights product={product} />
      <ProductAbout product={product} name={name} />
      <ProductIngredients product={product} />
      <ProductUsage product={product} />
      <RoutinePlacement product={product} />
      <ProductSuitability product={product} />
      <ProductReviews slug={product.slug} />
      <RelatedProducts product={product} />

      <MobilePurchaseBar product={product} variant={variant} buy={buy} visible={barVisible} onSelect={onSelectVariant} />
    </article>
  );
}

function Breadcrumb({ product, name }: { product: ProductDetail; name: string }) {
  const m = useMessages();
  const locale = useLocale();
  const tree = useCategoryTree();
  const category = product.category;
  const department = category ? tree.data?.find((root) => root.id === category.parentId || root.id === category.id) : undefined;
  const categoryName = category ? categoryLabel(category, locale) : null;
  return (
    <nav aria-label={m.plpBreadcrumb} className="hidden lg:block">
      <ol className="m-0 flex list-none flex-wrap items-center gap-2 p-0 text-13 leading-20 text-stone">
        <Crumb href={routes.home} label={m.plpHome} />
        {department ? <Crumb href={routes.productsByCategory(department.slug)} label={categoryLabel(department, locale) ?? department.name} /> : null}
        {category && categoryName && category.slug !== department?.slug ? <Crumb href={routes.productsByCategory(category.slug)} label={categoryName} /> : null}
        <li aria-current="page" dir="auto" className="font-semibold text-ink">
          {name}
        </li>
      </ol>
    </nav>
  );
}

function Crumb({ href, label }: { href: string; label: string }) {
  return (
    <li className="inline-flex items-center gap-2">
      <Link href={href} className="link-quiet font-medium text-stone hover:text-ink">
        {label}
      </Link>
      <Icon name="chevron-forward" size={12} strokeWidth={2} className="opacity-70" />
    </li>
  );
}

/**
 * Swipeable stage (scroll-snap, so touch, trackpad and keyboard scrolling all work) with a counter over the photo and
 * thumbnails beside it on desktop / under it on the phone. The counter follows the visible slide.
 */
function Gallery({ media, name }: { media: PublicMedia[]; name: string }) {
  const m = useMessages();
  const locale = useLocale();
  const images = galleryImages(media);
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<Array<HTMLLIElement | null>>([]);
  const firstId = images[0]?.id;

  useEffect(() => {
    setIndex(0);
    const track = trackRef.current;
    if (!track) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setIndex(Number((entry.target as HTMLElement).dataset.index));
      },
      { root: track, threshold: 0.6 }
    );
    slideRefs.current.forEach((slide) => slide && io.observe(slide));
    return () => io.disconnect();
  }, [firstId, images.length]);

  const show = (i: number) => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    slideRefs.current[i]?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest', inline: 'start' });
    setIndex(i);
  };
  const current = images[index] ?? null;

  return (
    <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:gap-4">
      <div className="relative min-w-0 flex-1">
        {images.length ? (
          <div ref={trackRef} role="group" aria-label={m.pdpGalleryLabel} className="flex snap-x snap-mandatory overflow-x-auto rounded-image bg-linen shadow-outline-hairline scrollbar-none">
            <ul className="m-0 flex w-full list-none p-0">
              {images.map((image, i) => (
                <li
                  key={image.id}
                  ref={(el) => {
                    slideRefs.current[i] = el;
                  }}
                  data-index={i}
                  aria-label={fillMessage(m.pdpImageCount, { i: formatNumber(i + 1, locale), n: formatNumber(images.length, locale) })}
                  className="w-full flex-none snap-start"
                >
                  <ProductTile
                    src={image.url}
                    alt={image.altText?.trim() || name}
                    name={name}
                    priority={i === 0}
                    sizes="(min-width: 1024px) 560px, 100vw"
                    className="bg-linen [&_img]:object-contain [&_img]:p-6 lg:[&_img]:p-10"
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ProductTile src={null} alt={name} name={name} className="bg-linen shadow-outline-hairline" />
        )}
        {images.length > 1 ? (
          <GlassBadge tone="photo" dot="bg-citron" className="pointer-events-none absolute bottom-3 start-3" aria-hidden="true">
            {fillMessage(m.pdpGalleryCount, { i: formatNumber(index + 1, locale), n: formatNumber(images.length, locale) })}
          </GlassBadge>
        ) : null}
        {current ? (
          <button type="button" aria-label={m.pdpZoom} onClick={() => setZoom(true)} className={cn(iconButtonVariants({ variant: 'raised' }), 'absolute end-3 top-3')}>
            <Icon name="zoom" size={20} />
          </button>
        ) : null}
      </div>

      {images.length > 1 ? (
        <ul className="m-0 flex list-none gap-2 overflow-x-auto p-0 pb-1 scrollbar-none lg:order-first lg:flex-col lg:overflow-visible lg:pb-0">
          {images.map((image, i) => (
            <li key={image.id} className="flex-none">
              <button
                type="button"
                aria-label={fillMessage(m.pdpShowImage, { i: formatNumber(i + 1, locale) })}
                aria-current={i === index}
                onClick={() => show(i)}
                className={cn(
                  'block rounded-image p-0.5 transition-shadow duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt',
                  i === index ? 'ring-2 ring-cobalt' : 'shadow-outline-hairline hover:shadow-outline-control'
                )}
              >
                <ProductTile size="thumb" className="size-16 bg-linen lg:size-20 [&_img]:object-contain [&_img]:p-1" src={image.url} alt="" name={name} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent closeLabel={m.pdpCloseZoom} className="max-w-narrow p-3">
          <DialogTitle className="sr-only">{name}</DialogTitle>
          <ProductTile src={current?.url ?? null} alt={current?.altText?.trim() || name} name={name} sizes="720px" className="bg-linen [&_img]:object-contain" />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Brand (Latin names in the serif campaign voice), availability, title, the brand's own short description and tags. */
function Identity({ product, variant, name }: { product: ProductDetail; variant: PublicVariant; name: string }) {
  const m = useMessages();
  const locale = useLocale();
  const brandIsArabic = /[؀-ۿ]/.test(product.brand.name);
  const description = (variant.content?.description ?? product.description)?.trim() || null;
  const tags = [
    product.category ? categoryLabel(product.category, locale) : null,
    product.productLine?.name ?? null,
    ...knownSkinTypes(product.suitableSkinTypes).map((type) => fillMessage(m.pdpSuitableSkin, { type: skinTypeLabel(m, type) })),
  ].filter((tag): tag is string => Boolean(tag));

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Link
          href={`${routes.products}?brand=${encodeURIComponent(product.brand.slug)}`}
          dir="auto"
          className={cn('link-quiet text-cobalt', brandIsArabic ? 'font-display text-20 font-bold' : 'font-serif text-24 italic')}
        >
          {product.brand.name}
        </Link>
        <GlassBadge dot={variant.canOrder ? 'bg-ok' : 'bg-tomato'}>{variant.canOrder ? m.pdpAvailable : m.pdpUnavailableNow}</GlassBadge>
      </div>
      <h1 id="pdp-title" dir="auto" className="m-0 font-display text-32 font-bold leading-36 text-ink text-match-parent lg:text-40 lg:leading-45">
        {name}
      </h1>
      {description ? (
        <p dir="auto" className="m-0 line-clamp-3 max-w-prose text-15 leading-25 text-stone text-match-parent">
          {description}
        </p>
      ) : null}
      <HeroRating slug={product.slug} />
      {tags.length ? (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {tags.map((tag, i) => (
            <li key={tag}>
              <GlassBadge tone={i === 0 ? 'accent' : 'quiet'}>
                <bdi>{tag}</bdi>
              </GlassBadge>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function PriceRow({ variant }: { variant: PublicVariant }) {
  const m = useMessages();
  const locale = useLocale();
  const price = variant.price;
  // A reference price is shown only when the backend supplies one above the current price.
  const compareAt = price && price.compareAtAmount !== null && price.compareAtAmount > price.amount ? price.compareAtAmount : null;
  const discount = variant.promotions?.orderDiscountAmount ?? 0;
  if (!price) return <p className="m-0 text-15 text-stone">{m.productPriceUnavailable}</p>;
  return (
    <div className="flex flex-col gap-1">
      <p className="m-0 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-display text-40 font-bold leading-45 tabular-nums text-ink">
          <bdi>{formatAmount(price.amount, locale)}</bdi>
          <span className="ms-1.5 text-16 font-medium text-stone">{currencyLabel(locale)}</span>
        </span>
        {compareAt ? (
          <span className="text-16 text-stone line-through">
            <span className="sr-only">{fillMessage(m.pdpWas, { price: formatEgp(compareAt, price.currency, locale) ?? '' })}</span>
            <bdi aria-hidden>{formatAmount(compareAt, locale)}</bdi>
          </span>
        ) : null}
      </p>
      {discount > 0 ? (
        <p className="m-0 text-13 leading-20 text-ok">{fillMessage(m.pdpOrderDiscount, { amount: formatEgp(discount, price.currency, locale) ?? '' })}</p>
      ) : null}
    </div>
  );
}

/** Size choice as pill radios (size + price, unavailable sizes struck through). A single size is stated, not offered. */
function SizeOptions({ product, variant, onSelect, compact = false }: { product: ProductDetail; variant: PublicVariant; onSelect: (id: string) => void; compact?: boolean }) {
  const m = useMessages();
  const locale = useLocale();
  const label = (s: PublicVariant) => formatPackSize(s.size, s.sizeUnit, locale) ?? s.variantName;
  if (product.skus.length < 2) {
    const size = formatPackSize(variant.size, variant.sizeUnit, locale);
    return size ? (
      <p className="m-0 text-14 font-bold text-ink">
        {m.pdpSizeLabel} <span className="font-normal text-stone">{size}</span>
      </p>
    ) : null;
  }
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-2 p-0 text-14 font-bold text-ink">
        {m.pdpSizeLabel} <span className="font-normal text-stone">{label(variant)}</span>
      </legend>
      <div role="radiogroup" aria-label={m.pdpSpecSize} className="grid grid-cols-2 gap-2">
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
                'flex min-w-0 items-center gap-2 rounded-pill px-4 text-start transition-[background-color,box-shadow] duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt focus-visible:ring-offset-2',
                compact ? 'h-12' : 'h-14',
                checked ? 'bg-cobalt text-chalk shadow-elevation-1' : sku.canOrder ? 'bg-linen text-ink shadow-outline-control hover:bg-chalk' : 'bg-linen text-stone opacity-70 shadow-outline-hairline'
              )}
            >
              {checked ? <Icon name="check" size={16} strokeWidth={2.4} /> : null}
              <span className={cn('min-w-0 truncate text-15 font-bold', !sku.canOrder && 'line-through')}>{label(sku)}</span>
              <span className={cn('ms-auto flex-none text-12.5', checked ? 'text-chalk' : sku.canOrder ? 'text-stone' : 'font-medium text-tomato-ink')}>
                {sku.canOrder ? price : m.pdpUnavailableNow}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function BuyRow({ product, variant, buy, disabled, name }: { product: ProductDetail; variant: PublicVariant; buy: Buy; disabled: boolean; name: string }) {
  const m = useMessages();
  const locale = useLocale();
  const router = useRouter();
  const [buying, setBuying] = useState(false);
  if (!variant.canOrder || !variant.price) {
    return (
      <div className="flex flex-col gap-3">
        <Button variant="ink" size="l" disabled className="w-full">
          {m.pdpUnavailableNow}
        </Button>
        {product.category ? (
          <Button asChild variant="linen" size="l" className="w-full">
            <Link href={routes.productsByCategory(product.category.slug)}>{m.pdpAlternatives}</Link>
          </Button>
        ) : null}
      </div>
    );
  }
  const added = buy.state === 'added';
  const buyNow = async () => {
    setBuying(true);
    const ok = await buy.add();
    if (ok) router.push(routes.checkout);
    else setBuying(false);
  };
  return (
    <div className="relative flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
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
          state={buying ? 'idle' : buttonState(buy.state)}
          variant="cobalt"
          size="l"
          className="min-w-0 flex-1"
          pendingLabel={m.pdpAdding}
          retryLabel={m.pdpAddCta}
          disabled={disabled || buying}
          onClick={() => (added ? router.push(routes.cart) : buy.add())}
        >
          <Icon name={added ? 'check' : 'bag'} size={18} strokeWidth={2.2} />
          {added ? fillMessage(m.pdpAddedGo, { n: formatNumber(buy.inCart, locale) }) : m.pdpAddCta}
        </AsyncButton>
        <AsyncButton
          state={buying ? 'pending' : 'idle'}
          variant="ink"
          size="l"
          className="w-full md:w-auto"
          pendingLabel={m.pdpAdding}
          disabled={disabled || buy.state === 'pending'}
          onClick={buyNow}
        >
          {m.pdpBuyNow}
        </AsyncButton>
      </div>
      {buy.state === 'error' ? (
        <p role="alert" className="m-0 flex items-start gap-2 text-13.5 leading-21 text-tomato-ink">
          <Icon name="alert" size={16} className="mt-0.5 flex-none" />
          {m.pdpAddFailed}
        </p>
      ) : null}
      {added ? <AddedPopover variant={variant} name={name} brand={product.brand.name} quantity={buy.inCart} onClose={() => buy.setState('idle')} /> : null}
      <Link href={shellRoutes.shina} className="link-quiet flex min-h-control-s items-center gap-2 self-start text-14 font-semibold text-stone hover:text-cobalt">
        <Icon name="sparkles" size={16} />
        {m.pdpAskShina}
      </Link>
    </div>
  );
}

/** Desktop confirmation after adding: stays while hovered or focused, never steals focus. */
function AddedPopover({ variant, name, brand, quantity, onClose }: { variant: PublicVariant; name: string; brand: string; quantity: number; onClose: () => void }) {
  const m = useMessages();
  const locale = useLocale();
  const image = compactImage(variant.media);
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
          <span dir="auto" className="font-serif text-14 italic text-stone text-match-parent">
            {brand}
          </span>
          <span dir="auto" className="truncate text-14 font-semibold text-ink text-match-parent">
            {name}
          </span>
          <span className="text-12.5 text-stone">{fillMessage(m.pdpQtyLine, { size, n: formatNumber(quantity, locale) })}</span>
        </span>
      </div>
      <div className="flex gap-2.5">
        <Button asChild variant="ink" size="m" className="flex-1">
          <Link href={routes.cart}>{fillMessage(m.pdpGoToCart, { n: formatNumber(quantity, locale) })}</Link>
        </Button>
        <Button variant="linen" size="m" onClick={onClose}>
          {m.pdpKeepShopping}
        </Button>
      </div>
    </div>
  );
}

function DeliveryDisclosure() {
  const m = useMessages();
  return (
    <details className="group shadow-hairline-top">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2.5 text-ink [&::-webkit-details-marker]:hidden">
        <Icon name="truck" size={20} />
        <span className="text-15 font-semibold">{m.pdpDelivery}</span>
        <Icon name="chevron-down" size={16} strokeWidth={2} className="ms-auto transition-transform duration-fast group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-1 pb-4 text-14 leading-22 text-stone">
        <p className="m-0">{m.pdpDeliveryBody}</p>
        <p className="m-0">{m.pdpReturnsBody}</p>
      </div>
    </details>
  );
}

/**
 * Phone purchase bar: appears once the page's buy buttons scroll away — the line total (price × quantity) and
 * «أضف للسلة»; with several sizes the total opens the same size chooser. After adding, a toast sits above it.
 */
function MobilePurchaseBar({ product, variant, buy, visible, onSelect }: { product: ProductDetail; variant: PublicVariant; buy: Buy; visible: boolean; onSelect: (id: string) => void }) {
  const m = useMessages();
  const locale = useLocale();
  const router = useRouter();
  const [sizeOpen, setSizeOpen] = useState(false);
  const size = formatPackSize(variant.size, variant.sizeUnit, locale) ?? variant.variantName;
  const added = buy.state === 'added';
  const orderable = variant.canOrder && variant.price;
  const multi = product.skus.length > 1;
  const tab = visible ? 0 : -1;

  return (
    <div
      className={cn(
        'pdp-bar fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] z-nav flex flex-col gap-2 bg-chalk/95 px-4 pt-2.5 shadow-hairline-top backdrop-blur-sm transition-transform duration-base ease-standard motion-reduce:transition-none lg:hidden',
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
      <div className="flex items-center gap-3">
        <button
          type="button"
          tabIndex={tab}
          disabled={!multi}
          onClick={() => setSizeOpen(true)}
          aria-label={multi ? fillMessage(m.pdpBarSize, { size }) : undefined}
          className="flex min-h-control-l flex-none flex-col items-start justify-center rounded-input px-1 text-start disabled:cursor-default"
        >
          <span className="flex items-center gap-1 text-12.5 font-semibold text-stone">
            {multi ? <Icon name="chevron-down" size={12} strokeWidth={2} /> : null}
            {multi ? size : m.pdpTotal}
          </span>
          {variant.price ? (
            <span className="font-display text-20 font-bold leading-24 tabular-nums text-ink">
              <bdi>{formatAmount(variant.price.amount * buy.quantity, locale)}</bdi>
              <span className="ms-1 text-12 font-medium text-stone">{currencyLabel(locale)}</span>
            </span>
          ) : null}
        </button>
        {orderable ? (
          <AsyncButton
            state={buttonState(buy.state)}
            variant="cobalt"
            size="l"
            className="min-w-0 flex-1"
            pendingLabel={m.cardAdding}
            retryLabel={m.pdpAddCta}
            tabIndex={tab}
            onClick={() => (added ? router.push(routes.cart) : buy.add())}
          >
            <Icon name={added ? 'check' : 'bag'} size={18} strokeWidth={2.2} />
            {added ? fillMessage(m.pdpGoToCart, { n: formatNumber(buy.inCart, locale) }) : m.pdpAddCta}
          </AsyncButton>
        ) : (
          <Button asChild variant="linen" size="l" className="min-w-0 flex-1">
            <Link href={product.category ? routes.productsByCategory(product.category.slug) : routes.products} tabIndex={tab}>
              {m.pdpSeeAlternatives}
            </Link>
          </Button>
        )}
      </div>
      <Sheet open={sizeOpen} onOpenChange={setSizeOpen}>
        <SheetContent side="bottom" closeLabel={m.close} className="rounded-t-sheet">
          <div className="px-4 pb-2 pt-3 shadow-hairline-bottom">
            <SheetTitle className="flex h-10 items-center font-display text-22 font-bold leading-28 text-ink">{m.pdpChooseSize}</SheetTitle>
          </div>
          <div className="flex flex-col gap-4 px-4 pb-5 pt-4">
            <SizeOptions product={product} variant={variant} compact onSelect={onSelect} />
            <AsyncButton
              state={buttonState(buy.state)}
              variant="cobalt"
              size="l"
              className="w-full"
              pendingLabel={m.cardAdding}
              disabled={!orderable}
              onClick={async () => {
                if (await buy.add()) setSizeOpen(false);
              }}
            >
              {m.pdpAddCta}
            </AsyncButton>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <PageContainer className="py-6 lg:py-10">
      <div aria-busy="true" className="grid gap-6 lg:grid-cols-2 lg:gap-12">
        <Skeleton className="aspect-square w-full rounded-image" />
        <div className="flex flex-col gap-4 lg:pt-4">
          <Skeleton className="h-6 w-36 rounded-pill" />
          <Skeleton className="h-10 w-4/5 rounded-image" />
          <Skeleton className="h-12 w-full rounded-image" />
          <Skeleton className="h-10 w-40 rounded-image" />
          <Skeleton className="h-14 w-full rounded-pill" />
        </div>
      </div>
    </PageContainer>
  );
}
