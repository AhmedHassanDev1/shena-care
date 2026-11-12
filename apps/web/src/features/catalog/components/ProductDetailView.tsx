'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Section } from '@/components/layout/section';
import { AsyncButton, Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { ProductTile } from '@/components/ui/product-tile';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { Skeleton } from '@/components/ui/skeleton';
import { Toast } from '@/components/ui/toast';
import { useAuth } from '@/features/auth/AuthContext';
import { useCart } from '@/features/cart/hooks/useCart';
import { ApiError } from '@/lib/api-client';
import { MAX_LINE_QUANTITY } from '@/lib/cart';
import { formatAmount, formatNumber } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import type { ProductDetail, PublicVariant } from '../api/discovery';
import { useProductDetail } from '../hooks/useProductDetail';
import { dedupeGalleryMedia, resolveHeroFeatureBadges } from '../lib/product-facts';
import {
  ProductAbout,
  ProductActiveIngredients,
  ProductBenefitsStrip,
  ProductUsage,
  RoutinePlacement,
} from './ProductDetailSections';
import { HeroRating, ProductReviews } from './ProductReviews';
import { SimilarProducts } from './SimilarProducts';

/**
 * Loading skeleton matching the approved 7-section Stitch PDP layout.
 */
export function ProductDetailSkeleton() {
  const m = useMessages();
  return (
    <article aria-busy="true" aria-label={m.loading} className="pb-24 lg:pb-14">
      <Section labelledBy="pdp-skeleton-title" rhythm="compact" className="pt-3 lg:pt-5">
        <div className="mx-auto w-full max-w-[1140px] flex flex-col gap-7">
          <span id="pdp-skeleton-title" className="sr-only">
            {m.loading}
          </span>

          {/* Hero Grid Skeleton */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10 items-start">
            <div className="lg:col-span-7 flex flex-col items-center gap-3">
              <div className="flex items-start gap-3 w-full">
                <Skeleton className="flex-1 aspect-[4/3.6] lg:aspect-square rounded-24" />
                <div className="hidden lg:flex flex-col gap-2.5 w-[80px] shrink-0">
                  {Array.from({ length: 4 }, (_, i) => (
                    <Skeleton key={i} className="aspect-square w-full rounded-14" />
                  ))}
                </div>
              </div>
              <Skeleton className="h-2.5 w-16 rounded-pill" />
            </div>

            <div className="lg:col-span-5 flex flex-col gap-3">
              <Skeleton className="h-7 w-24 rounded-pill" />
              <Skeleton className="h-10 w-4/5 rounded-14" />
              <Skeleton className="h-5 w-2/3 rounded-14" />
              <Skeleton className="h-5 w-40 rounded-pill" />
              <div className="flex gap-3 py-3 border-b border-line">
                <Skeleton className="h-5 w-20 rounded-pill" />
                <Skeleton className="h-5 w-24 rounded-pill" />
                <Skeleton className="h-5 w-20 rounded-pill" />
              </div>
              <div className="flex justify-between items-center pt-1">
                <Skeleton className="h-5 w-14 rounded-pill" />
                <div className="flex gap-2">
                  <Skeleton className="h-11 w-24 rounded-14" />
                  <Skeleton className="h-11 w-24 rounded-14" />
                </div>
              </div>
              <Skeleton className="h-10 w-32 rounded-14 my-2" />
              <div className="flex gap-3">
                <Skeleton className="h-12 flex-1 rounded-14" />
                <Skeleton className="h-12 w-28 rounded-14" />
              </div>
            </div>
          </div>

          <Skeleton className="h-24 w-full rounded-24" />
          <Skeleton className="h-36 w-full rounded-24" />
        </div>
      </Section>
    </article>
  );
}

export function ProductDetailView({ slug }: { slug: string }) {
  const m = useMessages();
  const query = useProductDetail(slug);

  if (query.isPending) {
    return <ProductDetailSkeleton />;
  }

  if (query.isError || !query.data) {
    const isNotFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <Section labelledBy="pdp-error-title" rhythm="compact" className="py-12">
        <div
          role="alert"
          className="mx-auto flex max-w-narrow flex-col items-center gap-4 rounded-24 border border-line bg-linen p-8 text-center shadow-elevation-1"
        >
          <div className="grid size-14 place-items-center rounded-pill bg-sand text-ink">
            <Icon name="package" size={26} />
          </div>
          <h1 id="pdp-error-title" className="m-0 font-display text-22 font-bold text-ink">
            {isNotFound ? m.pdpNotFoundTitle : m.pdpLoadError}
          </h1>
          <p className="m-0 max-w-sm text-14 leading-22 text-stone">
            {isNotFound ? m.pdpNotFoundBody : m.pdpLoadError}
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-3">
            {!isNotFound ? (
              <Button variant="cobalt" size="m" onClick={() => void query.refetch()}>
                {m.plpRetry}
              </Button>
            ) : null}
            <Link href={routes.products} className={buttonVariants({ variant: 'ink', size: 'm' })}>
              {m.pdpBackToProducts}
            </Link>
          </div>
        </div>
      </Section>
    );
  }

  return <Detail key={query.data.id} product={query.data} />;
}

function formatVariantLabel(variant: PublicVariant): string {
  if (variant.size != null && variant.sizeUnit) {
    return `${variant.size} ${variant.sizeUnit}`;
  }
  return variant.variantName;
}

function Detail({ product }: { product: ProductDetail }) {
  const router = useRouter();
  const locale = useLocale();
  const m = useMessages();
  const { withAuth } = useAuth();
  const { addItem } = useCart();

  const initialSkuId = product.selectedSkuId || product.skus[0]?.id || '';
  const [selectedSkuId, setSelectedSkuId] = useState(initialSkuId);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [failedUrls, setFailedUrls] = useState<Record<string, true>>({});
  const [zoomOpen, setZoomOpen] = useState(false);
  const [liked, setLiked] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [addState, setAddState] = useState<'idle' | 'pending' | 'added'>('idle');
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedSkuId(product.selectedSkuId || product.skus[0]?.id || '');
    setActiveImageIndex(0);
    setFailedUrls({});
    setQuantity(1);
    setAddState('idle');
    setAddError(null);
  }, [product.id, product.selectedSkuId, product.skus]);

  const fallbackVariant: PublicVariant = {
    id: product.id,
    code: product.slug,
    barcode: null,
    variantName: product.name,
    size: null,
    sizeUnit: null,
    price: null,
    isAvailable: false,
    canOrder: false,
    availability: {
      isAvailable: false,
      isFresh: false,
      confirmedAt: null,
      observedAt: null,
      validUntil: null,
    },
    media: product.media || [],
    content: null,
    promotions: null,
  };

  const variant =
    product.skus.find((s) => s.id === selectedSkuId) ||
    product.selectedVariant ||
    product.skus[0] ||
    fallbackVariant;

  const rawImages = variant.media?.length ? variant.media : product.media ?? [];
  const uniqueImages = dedupeGalleryMedia(rawImages);
  const visibleImages = uniqueImages.filter((img) => !failedUrls[img.url]);
  const safeImageIndex = visibleImages.length > 0 ? Math.min(activeImageIndex, visibleImages.length - 1) : 0;
  const currentImage = visibleImages[safeImageIndex];
  const markImageFailed = (url: string) => {
    setFailedUrls((prev) => (prev[url] ? prev : { ...prev, [url]: true }));
  };
  const showPrevImage = () => {
    if (visibleImages.length <= 1) return;
    setActiveImageIndex((prev) => (prev - 1 + visibleImages.length) % visibleImages.length);
  };
  const showNextImage = () => {
    if (visibleImages.length <= 1) return;
    setActiveImageIndex((prev) => (prev + 1) % visibleImages.length);
  };

  const heroBadges = resolveHeroFeatureBadges(product, m);
  const skus = product.skus ?? [];
  const canPurchase = Boolean(variant.canOrder && variant.price && variant.price.amount > 0);
  const otherVariantAvailable = !canPurchase && skus.some((s) => s.id !== variant.id && s.canOrder && s.price);

  const handleSelectVariant = (skuId: string) => {
    setSelectedSkuId(skuId);
    setActiveImageIndex(0);
    setFailedUrls({});
    setAddError(null);
    setAddState('idle');
  };

  const handleWishlist = () => {
    withAuth(
      () => {
        setLiked((prev) => !prev);
      },
      {
        title: m.pdpAuthRequiredWishlistTitle,
        description: m.pdpAuthRequiredWishlistDesc,
        intent: 'wishlist',
      }
    );
  };

  const handleAddToCart = async () => {
    if (!canPurchase || addState === 'pending' || !variant.id) return;
    setAddState('pending');
    setAddError(null);
    try {
      await addItem({ skuId: variant.id, quantity });
      setAddState('added');
      setTimeout(() => setAddState('idle'), 2500);
    } catch (err) {
      setAddState('idle');
      if (err instanceof ApiError && err.status === 409) {
        setAddError(m.pdpAddUnavailable);
      } else {
        setAddError(m.pdpAddFailed);
      }
    }
  };

  const priceAmount = variant.price?.amount ?? 0;
  const compareAtAmount = variant.price?.compareAtAmount ?? 0;
  const hasDiscount = canPurchase && compareAtAmount > priceAmount;

  return (
    <article className="pb-12 lg:pb-10">
      {/* Stitch Section A — Product Hero & Gallery */}
      <Section labelledBy="pdp-title" rhythm="compact" className="pt-2 pb-2.5 lg:pt-4 lg:pb-3">
        <div className="mx-auto w-full max-w-[1140px] flex flex-col gap-3 lg:gap-4">
          {/* Breadcrumb */}
          <nav aria-label={m.plpBreadcrumb} className="text-12 text-stone font-medium">
            <ol className="m-0 flex list-none flex-wrap items-center gap-2 p-0">
              <li>
                <Link href={routes.home} className="hover:text-cobalt transition-colors">
                  {m.plpHome}
                </Link>
              </li>
              <li aria-hidden="true" className="opacity-40">/</li>
              <li>
                <Link href={routes.products} className="hover:text-cobalt transition-colors">
                  {m.plpAllProducts}
                </Link>
              </li>
              {product.category ? (
                <>
                  <li aria-hidden="true" className="opacity-40">/</li>
                  <li>
                    <Link
                      href={`${routes.products}?category=${encodeURIComponent(product.category.slug)}`}
                      className="hover:text-cobalt transition-colors"
                    >
                      {product.category.name}
                    </Link>
                  </li>
                </>
              ) : null}
              <li aria-hidden="true" className="opacity-40">/</li>
              <li aria-current="page" className="font-bold text-ink truncate max-w-[260px]">
                {product.name}
              </li>
            </ol>
          </nav>

          {/* 12-Col Hero Grid: Gallery (col-span-7) + Info (col-span-5) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-8 items-start">
            {/* Gallery Column */}
            <div className="lg:col-span-7 flex flex-col items-center">
              <div className="flex items-start gap-3 w-full">
                {/* Main Hero Image */}
                <div className="relative flex-1 aspect-[5/4] lg:aspect-square rounded-24 overflow-hidden bg-linen border border-line shadow-elevation-1 group">
                  <ProductTile
                    key={currentImage?.id || currentImage?.url || 'empty'}
                    src={currentImage?.url ?? null}
                    alt={currentImage?.altText || product.name}
                    name={product.name}
                    priority
                    sizes="(min-width: 1024px) 580px, 100vw"
                    onImageError={() => currentImage && markImageFailed(currentImage.url)}
                    className="size-full rounded-none bg-linen"
                    imageClassName="transition-transform duration-500 ease-out group-hover:scale-105"
                  />

                  {visibleImages.length > 1 ? (
                    <>
                      <button
                        type="button"
                        onClick={showPrevImage}
                        aria-label={fillMessage(m.pdpShowImage, {
                          i: formatNumber(
                            ((safeImageIndex - 1 + visibleImages.length) % visibleImages.length) + 1,
                            locale
                          ),
                        })}
                        className="hidden lg:flex absolute top-1/2 -translate-y-1/2 start-3 z-10 size-9 items-center justify-center rounded-full bg-chalk/90 border border-line text-ink shadow-elevation-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-chalk cursor-pointer"
                      >
                        <Icon name="chevron-back" size={18} />
                      </button>
                      <button
                        type="button"
                        onClick={showNextImage}
                        aria-label={fillMessage(m.pdpShowImage, {
                          i: formatNumber(((safeImageIndex + 1) % visibleImages.length) + 1, locale),
                        })}
                        className="hidden lg:flex absolute top-1/2 -translate-y-1/2 end-3 z-10 size-9 items-center justify-center rounded-full bg-chalk/90 border border-line text-ink shadow-elevation-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-chalk cursor-pointer"
                      >
                        <Icon name="chevron-forward" size={18} />
                      </button>
                    </>
                  ) : null}

                  {/* Top-End Wishlist Button */}
                  <button
                    type="button"
                    aria-label={liked ? m.wishlistRemove : m.wishlistAdd}
                    aria-pressed={liked}
                    onClick={handleWishlist}
                    className={cn(
                      'absolute top-3.5 end-3.5 z-10 flex size-10 items-center justify-center rounded-full bg-chalk/90 border border-line shadow-elevation-1 transition active:scale-90 cursor-pointer',
                      liked ? 'text-tomato-ink' : 'text-ink hover:text-tomato-ink'
                    )}
                  >
                    <Icon name="heart" size={19} strokeWidth={2} fill={liked ? 'currentColor' : 'none'} />
                  </button>

                  {/* Bottom-End Expand Zoom Button */}
                  {currentImage ? (
                    <button
                      type="button"
                      aria-label={m.pdpZoom}
                      onClick={() => setZoomOpen(true)}
                      className="absolute bottom-3.5 end-3.5 z-10 flex size-9 items-center justify-center rounded-full bg-chalk/90 border border-line text-ink shadow-elevation-1 transition hover:scale-105 active:scale-95 cursor-pointer"
                    >
                      <Icon name="expand" size={16} strokeWidth={2} />
                    </button>
                  ) : null}
                </div>

                {/* Desktop Vertical Thumbnail Strip */}
                {visibleImages.length > 1 ? (
                  <div className="hidden lg:flex flex-col gap-2.5 w-[80px] shrink-0">
                    {visibleImages.slice(0, 4).map((img, idx) => {
                      const isActive = idx === safeImageIndex;
                      return (
                        <button
                          key={img.id || img.url}
                          type="button"
                          onClick={() => setActiveImageIndex(idx)}
                          aria-label={fillMessage(m.pdpShowImage, { i: formatNumber(idx + 1, locale) })}
                          aria-current={isActive ? 'true' : undefined}
                          className={cn(
                            'relative w-full aspect-square rounded-14 overflow-hidden bg-linen transition-all cursor-pointer',
                            isActive
                              ? 'border-2 border-cobalt shadow-elevation-1'
                              : 'border border-line hover:border-cobalt/50 opacity-85 hover:opacity-100'
                          )}
                        >
                          <ProductTile
                            src={img.url}
                            alt={img.altText || `${product.name} ${idx + 1}`}
                            name={product.name}
                            size="thumb"
                            sizes="80px"
                            onImageError={() => markImageFailed(img.url)}
                            className="size-full rounded-none bg-linen"
                          />
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              {/* Gallery Dots Indicator */}
              {visibleImages.length > 1 ? (
                <div
                  role="tablist"
                  aria-label={m.pdpGalleryLabel}
                  className="flex items-center justify-center gap-1.5 mt-2 lg:mt-3"
                >
                  {visibleImages.map((img, idx) => {
                    const isActive = idx === safeImageIndex;
                    return (
                      <button
                        key={img.id || img.url}
                        type="button"
                        onClick={() => setActiveImageIndex(idx)}
                        aria-label={fillMessage(m.pdpShowImage, { i: formatNumber(idx + 1, locale) })}
                        aria-current={isActive ? 'true' : undefined}
                        className={cn(
                          'rounded-full transition-all cursor-pointer',
                          isActive ? 'size-2.5 bg-cobalt' : 'size-2 bg-line-2 hover:bg-stone/60'
                        )}
                      />
                    );
                  })}
                </div>
              ) : null}
            </div>

            {/* Product Info Column */}
            <div className="lg:col-span-5 flex flex-col text-start pt-0.5">
              {/* Brand Badge */}
              {product.brand?.name ? (
                <div className="mb-1.5 lg:mb-2">
                  <span className="inline-block rounded-pill bg-cobalt/10 px-3.5 py-1 text-12 sm:text-13 font-bold text-cobalt">
                    {product.brand.name}
                  </span>
                </div>
              ) : null}

              {/* Product Title */}
              <h1
                id="pdp-title"
                className="m-0 font-display text-28 sm:text-32 lg:text-34 font-bold leading-34 sm:leading-38 lg:leading-40 text-ink mb-1 lg:mb-2"
              >
                {product.name}
              </h1>

              {/* Product Line Subtitle (when available) */}
              {product.productLine?.name ? (
                <p className="m-0 text-15 font-medium text-stone mb-2 lg:mb-2.5">
                  {product.productLine.name}
                </p>
              ) : null}

              {/* Rating Summary */}
              <div className="mb-2.5 lg:mb-3.5">
                <HeroRating slug={product.slug} />
              </div>

              {/* Mini Feature Badges Row (max 3 reviewed facts) */}
              {heroBadges.length > 0 ? (
                <div className="flex items-center flex-wrap gap-3 sm:gap-4 text-13 text-stone pb-3 mb-3 lg:pb-4 lg:mb-4 border-b border-line">
                  {heroBadges.map((badge) => (
                    <div key={badge.id} className="flex items-center gap-1.5">
                      <Icon name={badge.icon} size={16} className="text-cobalt shrink-0" />
                      <span>{badge.label}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="border-b border-line mb-3 lg:mb-4" />
              )}

              {/* Size Selector */}
              {skus.length > 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3 lg:mb-4">
                  <span className="text-15 font-medium text-stone shrink-0">{m.pdpSizeLabel}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {skus.map((sku) => {
                      const isSelected = sku.id === variant.id;
                      const skuAvailable = Boolean(sku.canOrder && sku.price);
                      return (
                        <button
                          key={sku.id}
                          type="button"
                          onClick={() => handleSelectVariant(sku.id)}
                          aria-pressed={isSelected}
                          className={cn(
                            'min-h-[44px] min-w-[76px] rounded-14 px-4 py-2 text-14 transition-all cursor-pointer flex items-center justify-center',
                            isSelected
                              ? 'border-2 border-cobalt bg-chalk font-bold text-ink shadow-elevation-1'
                              : 'border border-line-2 bg-linen/70 hover:bg-chalk text-stone hover:text-ink',
                            !skuAvailable && 'opacity-65'
                          )}
                        >
                          <span>{formatVariantLabel(sku)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* Price Display / Availability State */}
              <div className="mb-3.5 lg:mb-5">
                {canPurchase ? (
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-display text-32 lg:text-40 font-bold text-cobalt tabular-nums leading-none">
                      {formatAmount(priceAmount, locale)}
                    </span>
                    <span className="text-16 font-bold text-cobalt">{m.pdpCurrencyEgp}</span>
                    {hasDiscount ? (
                      <span className="text-15 text-stone line-through tabular-nums ms-1">
                        {formatAmount(compareAtAmount, locale)} {m.pdpCurrencyEgp}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5 items-start">
                    <span className="inline-flex items-center gap-1.5 rounded-pill bg-sand px-3.5 py-1.5 text-13 font-bold text-ink">
                      {m.pdpUnavailableNow}
                    </span>
                    {otherVariantAvailable ? (
                      <span className="text-12 text-stone">{m.pdpOtherSizeAvailable}</span>
                    ) : null}
                  </div>
                )}
              </div>

              {/* Cart Actions Row: Add to Cart CTA + Quantity Stepper */}
              <div className="flex items-center gap-2.5 sm:gap-3">
                <AsyncButton
                  state={addState === 'pending' ? 'pending' : 'idle'}
                  variant="cobalt"
                  size="l"
                  disabled={!canPurchase || addState === 'pending'}
                  pendingLabel={m.pdpAdding}
                  onClick={handleAddToCart}
                  className="min-h-[52px] flex-1 min-w-0 rounded-14 px-5 font-bold text-16 shadow-elevation-2"
                >
                  <Icon name={addState === 'added' ? 'check' : 'cart'} size={20} strokeWidth={2} />
                  <span className="truncate">
                    {!canPurchase
                      ? m.pdpOutOfStock
                      : addState === 'added'
                        ? m.pdpAdded
                        : m.pdpAddCta}
                  </span>
                </AsyncButton>

                <QuantityStepper
                  value={quantity}
                  displayValue={formatNumber(quantity, locale)}
                  min={1}
                  max={MAX_LINE_QUANTITY}
                  disabled={!canPurchase || addState === 'pending'}
                  onChange={(next) => {
                    setQuantity(next);
                    setAddError(null);
                  }}
                  labels={{
                    group: m.pdpQuantity,
                    decrease: m.pdpDecrease,
                    increase: m.pdpIncrease,
                  }}
                  className="min-h-[52px] min-w-[104px] rounded-14 border border-line-2 bg-chalk shadow-elevation-1"
                />
              </div>

              {/* Add-to-cart error feedback */}
              {addError ? (
                <p role="alert" className="mt-2.5 m-0 text-13 font-semibold text-tomato-ink">
                  {addError}
                </p>
              ) : null}

              {/* Add-to-cart success toast */}
              {addState === 'added' ? (
                <div className="mt-3">
                  <Toast action={{ label: m.pdpViewCart, onClick: () => router.push(routes.cart) }}>
                    <span className="flex items-center gap-2 text-ok font-bold">
                      <Icon name="check" size={16} strokeWidth={2.4} />
                      {fillMessage(m.pdpAddedToast, { size: formatVariantLabel(variant) })}
                    </span>
                  </Toast>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </Section>

      {/* Stitch Section B — Three Key Benefits (shown only when reviewed benefits exist) */}
      <ProductBenefitsStrip product={product} variant={variant} />

      {/* Stitch Section C — About Product */}
      <ProductAbout product={product} variant={variant} />

      {/* Stitch Section D — Active Ingredients & INCI */}
      <ProductActiveIngredients product={product} variant={variant} />

      {/* Stitch Section E — Routine Position */}
      <RoutinePlacement product={product} variant={variant} />

      {/* Stitch Section F — Usage Instructions & Warnings */}
      <ProductUsage product={product} variant={variant} />

      {/* Stitch Section G — Customer Reviews */}
      <ProductReviews slug={product.slug} skuId={variant?.id} />

      {/* Storefront Section — Similar Products (منتجات مشابهة) */}
      <SimilarProducts product={product} />

      {/* Gallery Image Zoom Dialog */}
      {currentImage ? (
        <Dialog open={zoomOpen} onOpenChange={setZoomOpen}>
          <DialogContent closeLabel={m.pdpCloseZoom} className="max-w-lg p-4">
            <DialogTitle className="sr-only">{product.name}</DialogTitle>
            <div className="relative aspect-square w-full overflow-hidden rounded-16 bg-chalk">
              <ProductTile
                key={`zoom-${currentImage.id || currentImage.url}`}
                src={currentImage.url}
                alt={currentImage.altText || product.name}
                name={product.name}
                fit="contain"
                sizes="600px"
                className="size-full rounded-none bg-chalk"
                imageClassName="p-4"
              />
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </article>
  );
}
