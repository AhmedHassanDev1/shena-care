'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { Section } from '@/components/layout/section';
import { EASE_STANDARD } from '@/components/motion/reveal';
import { ArrowLink } from '@/components/ui/arrow-link';
import { AsyncButton, Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { ProductTile } from '@/components/ui/product-tile';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/AuthContext';
import { useCart } from '@/features/cart/hooks/useCart';
import { ApiError } from '@/lib/api-client';
import { MAX_LINE_QUANTITY } from '@/lib/cart';
import { formatAmount, formatNumber, formatPercent } from '@/lib/i18n/format';
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
  usePdpContent,
} from './ProductDetailSections';
import { ProductGallery } from './ProductGallery';
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
        <div className="flex w-full flex-col gap-7">
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
  const buyRef = useRef<HTMLDivElement>(null);
  const [buyInView, setBuyInView] = useState(true);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    setSelectedSkuId(product.selectedSkuId || product.skus[0]?.id || '');
    setActiveImageIndex(0);
    setFailedUrls({});
    setQuantity(1);
    setAddState('idle');
    setAddError(null);
  }, [product.id, product.selectedSkuId, product.skus]);

  // The sticky phone bar shows only while the real buy panel is scrolled out of sight.
  useEffect(() => {
    const el = buyRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setBuyInView(entry.isIntersecting), { threshold: 0.4 });
    observer.observe(el);
    const onScroll = () => setScrolled(window.scrollY > 240);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

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
    availability: { isAvailable: false, isFresh: false, confirmedAt: null, observedAt: null, validUntil: null },
    media: product.media || [],
    content: null,
    promotions: null,
  };

  const variant =
    product.skus.find((s) => s.id === selectedSkuId) || product.selectedVariant || product.skus[0] || fallbackVariant;

  const rawImages = variant.media?.length ? variant.media : product.media ?? [];
  const uniqueImages = dedupeGalleryMedia(rawImages);
  const visibleImages = uniqueImages.filter((img) => !failedUrls[img.url]);
  const safeImageIndex = visibleImages.length > 0 ? Math.min(activeImageIndex, visibleImages.length - 1) : 0;
  const currentImage = visibleImages[safeImageIndex];
  const markImageFailed = (url: string) => {
    setFailedUrls((prev) => (prev[url] ? prev : { ...prev, [url]: true }));
  };

  const heroBadges = resolveHeroFeatureBadges(product, m);
  const content = usePdpContent(product, variant);
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
    withAuth(() => setLiked((prev) => !prev), {
      title: m.pdpAuthRequiredWishlistTitle,
      description: m.pdpAuthRequiredWishlistDesc,
      intent: 'wishlist',
    });
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
      setAddError(err instanceof ApiError && err.status === 409 ? m.pdpAddUnavailable : m.pdpAddFailed);
    }
  };

  const priceAmount = variant.price?.amount ?? 0;
  const compareAtAmount = variant.price?.compareAtAmount ?? 0;
  const hasDiscount = canPurchase && compareAtAmount > priceAmount;
  const discountPercent = hasDiscount ? Math.round(((compareAtAmount - priceAmount) / compareAtAmount) * 100) : 0;
  const asyncState = addState === 'pending' ? 'pending' : addState === 'added' ? 'success' : 'idle';

  const pending: string[] = [];
  if (!content.hasAbout) pending.push(m.vxPdpTabAbout);
  if (!content.hasIngredients) pending.push(m.vxPdpTabIngredients);
  if (!content.hasUsage) pending.push(m.vxPdpTabUsage);

  return (
    <article className="pb-32 lg:pb-12">
      <div className="bg-sand/40">
        <Section labelledBy="pdp-title" rhythm="compact" className="gap-4 pb-8 pt-2 lg:gap-6 lg:pb-14 lg:pt-5">
          <nav aria-label={m.plpBreadcrumb} className="text-13 font-medium text-stone">
            <ol className="m-0 flex list-none flex-wrap items-center gap-2 p-0">
              <li><Link href={routes.home} className="transition-colors hover:text-cobalt">{m.plpHome}</Link></li>
              <li aria-hidden="true" className="opacity-40">/</li>
              <li><Link href={routes.products} className="transition-colors hover:text-cobalt">{m.plpAllProducts}</Link></li>
              {product.category ? (
                <>
                  <li aria-hidden="true" className="opacity-40">/</li>
                  <li>
                    <Link href={`${routes.products}?category=${encodeURIComponent(product.category.slug)}`} className="transition-colors hover:text-cobalt">
                      {product.category.name}
                    </Link>
                  </li>
                </>
              ) : null}
            </ol>
          </nav>

          <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-12 lg:gap-14">
            <div className="min-w-0 lg:col-span-7">
              <ProductGallery
                images={visibleImages}
                index={safeImageIndex}
                onIndexChange={setActiveImageIndex}
                productName={product.name}
                liked={liked}
                onToggleLike={handleWishlist}
                onZoom={() => setZoomOpen(true)}
                onImageError={markImageFailed}
              />
            </div>

            <div className="flex min-w-0 flex-col gap-6 text-start lg:col-span-5">
              <div className="flex flex-col gap-3">
                {product.brand?.name ? (
                  <p className="m-0 flex flex-wrap items-baseline gap-x-3 font-serif text-26 italic text-cobalt">
                    <bdi>{product.brand.name}</bdi>
                    {product.productLine?.name ? <span className="font-display text-16 font-medium not-italic text-stone"><bdi>{product.productLine.name}</bdi></span> : null}
                  </p>
                ) : null}
                <h1 id="pdp-title" className="m-0 font-display text-display-1 font-extrabold tracking-tight text-ink lg:text-52 lg:leading-tight">
                  <bdi>{product.name}</bdi>
                </h1>
                {product.category || skus.length === 1 ? (
                  <p className="m-0 flex flex-wrap items-center gap-x-3 text-17 text-stone">
                    {product.category ? <span>{product.category.name}</span> : null}
                    {skus.length === 1 ? <bdi dir="ltr" className="font-semibold text-ink">{formatVariantLabel(skus[0])}</bdi> : null}
                  </p>
                ) : null}
                <HeroRating slug={product.slug} />
              </div>

              {heroBadges.length > 0 ? (
                <ul className="m-0 flex list-none flex-wrap gap-x-6 gap-y-2 p-0">
                  {heroBadges.map((badge) => (
                    <li key={badge.id} className="inline-flex items-center gap-2 text-16 font-medium text-ink">
                      <Icon name={badge.icon} size={18} className="shrink-0 text-cobalt" />
                      <span>{badge.label}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="flex flex-col gap-5 border-t border-ink/20 pt-6">
                {skus.length > 1 ? (
                  <div role="group" aria-label={m.pdpSizeLabel} className="flex flex-col gap-2">
                    <span className="text-15 font-semibold text-stone">{m.pdpSizeLabel}</span>
                    <div className="flex flex-wrap gap-2">
                      {skus.map((sku) => {
                        const isSelected = sku.id === variant.id;
                        return (
                          <button
                            key={sku.id}
                            type="button"
                            onClick={() => handleSelectVariant(sku.id)}
                            aria-pressed={isSelected}
                            className={cn(
                              'h-control-m min-w-20 cursor-pointer rounded-pill px-5 font-display text-16 transition-[background-color,color,box-shadow] duration-fast',
                              isSelected ? 'bg-ink font-bold text-chalk shadow-elevation-1' : 'bg-transparent font-medium text-ink shadow-outline-control hover:bg-chalk',
                              !(sku.canOrder && sku.price) && 'opacity-60',
                            )}
                          >
                            {formatVariantLabel(sku)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {canPurchase ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="relative inline-block">
                        <span className="relative z-10 font-display text-display-1 font-extrabold leading-none text-ink tabular-nums lg:text-64">
                          {formatAmount(priceAmount, locale)}
                        </span>
                        <span aria-hidden="true" className="absolute inset-x-0 bottom-0.5 z-0 h-3 rounded-4 bg-citron lg:bottom-1.5 lg:h-4" />
                      </span>
                      <span className="font-display text-20 font-bold text-ink">{m.pdpCurrencyEgp}</span>
                      {hasDiscount ? (
                        <>
                          <span className="text-17 text-stone line-through tabular-nums">{formatAmount(compareAtAmount, locale)}</span>
                          <span className="rounded-pill bg-tomato px-2.5 py-0.5 font-display text-14 font-bold text-ink tabular-nums">
                            {formatPercent(discountPercent, locale)}
                          </span>
                        </>
                      ) : null}
                    </div>
                    <p className="m-0 inline-flex items-center gap-2 text-15 font-medium text-ok">
                      <span aria-hidden="true" className="size-2 rounded-full bg-ok" />
                      {m.vxPdpStockLive}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-start gap-1.5">
                    <span className="inline-flex items-center gap-1.5 rounded-pill bg-sand px-4 py-2 font-display text-15 font-bold text-ink">
                      {m.pdpUnavailableNow}
                    </span>
                    {otherVariantAvailable ? <span className="text-14 text-stone">{m.pdpOtherSizeAvailable}</span> : null}
                  </div>
                )}

                <div className="flex flex-col gap-3">
                  <div ref={buyRef} className="flex items-stretch gap-3">
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
                      labels={{ group: m.pdpQuantity, decrease: m.pdpDecrease, increase: m.pdpIncrease }}
                      className="min-h-control-xl shrink-0 rounded-pill bg-transparent shadow-outline-control"
                    />
                    <AsyncButton
                      state={asyncState}
                      variant="cobalt"
                      size="l"
                      disabled={!canPurchase}
                      pendingLabel={m.pdpAdding}
                      successLabel={m.pdpAdded}
                      onClick={handleAddToCart}
                      className="min-h-control-xl min-w-0 flex-1 shadow-action"
                    >
                      <Icon name="cart" size={20} strokeWidth={2} />
                      <span className="truncate">{canPurchase ? m.pdpAddCta : m.pdpOutOfStock}</span>
                    </AsyncButton>
                  </div>

                  <AnimatePresence initial={false}>
                    {addState === 'added' ? (
                      <motion.div
                        key="added"
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3, ease: EASE_STANDARD }}
                        className="flex items-center justify-between gap-3 border-s-4 border-ok ps-3"
                        role="status"
                      >
                        <span className="inline-flex items-center gap-2 text-15 font-semibold text-ok">
                          <Icon name="check" size={16} strokeWidth={2.4} />
                          {fillMessage(m.pdpAddedToast, { size: formatVariantLabel(variant) })}
                        </span>
                        <button type="button" onClick={() => router.push(routes.cart)} className="cursor-pointer font-display text-15 font-bold text-cobalt hover:underline">
                          {m.pdpViewCart}
                        </button>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                  {addError ? <p role="alert" className="m-0 text-14 font-semibold text-tomato-ink">{addError}</p> : null}
                </div>

                <div className="flex flex-col gap-2 border-t border-ink/15 pt-4">
                  <p className="m-0 flex items-center gap-2 text-15 text-stone">
                    <Icon name="truck" size={18} className="shrink-0 text-ink" />
                    {m.vxPdpDeliveryLine}
                  </p>
                  <Link href={routes.shinaFor({ product: product.slug })} className="link-quiet inline-flex items-center gap-3 self-start font-display text-16 font-bold text-cobalt">
                    <span aria-hidden="true" className="sun sm" />
                    {m.vxPdpAskShina}
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </Section>
      </div>

      <ProductBenefitsStrip product={product} variant={variant} />

      <Section labelledBy="pdp-details-title" rhythm="default" className="pb-2 lg:pb-4">
        <h2 id="pdp-details-title" className="sr-only">{m.pdpDetails}</h2>
        <div className="mx-auto w-full max-w-4xl">
          <div className="border-t border-ink/20">
            {content.hasAbout ? <ProductAbout product={product} variant={variant} /> : null}
            {content.hasIngredients ? <ProductActiveIngredients product={product} variant={variant} /> : null}
            <RoutinePlacement product={product} variant={variant} />
            {content.hasUsage ? <ProductUsage product={product} variant={variant} /> : null}
          </div>
          {pending.length > 0 ? (
            <div className="mt-6 flex flex-col gap-1 border-s-4 border-cobalt ps-4">
              <p id="pdp-pending-title" className="m-0 font-display text-17 font-bold text-ink">{m.vxPdpPendingTitle}</p>
              <p className="m-0 text-15 text-stone">{fillMessage(m.vxPdpPendingBody, { items: pending.join(locale === 'ar' ? '، ' : ', ') })}</p>
              <ArrowLink href={routes.shinaFor({ product: product.slug })} className="self-start">{m.vxPdpAskShina}</ArrowLink>
            </div>
          ) : null}
        </div>
      </Section>

      <div id="pdp-reviews" className="scroll-mt-32"><ProductReviews slug={product.slug} skuId={variant?.id} /></div>

      <SimilarProducts product={product} />

      {/* Phone buy bar: appears when the buy panel has scrolled away; sits above the bottom dock. */}
      <AnimatePresence>
        {!buyInView && scrolled && canPurchase ? (
          <motion.div
            key="sticky-buy"
            className="fixed inset-x-0 z-nav flex items-center gap-3 border-t border-line bg-chalk px-4 py-3 lg:hidden"
            style={{ bottom: 'calc(var(--bottom-nav-height) + 1.75rem + env(safe-area-inset-bottom, 0px))' }}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.3, ease: EASE_STANDARD }}
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-13 text-stone"><bdi>{product.name}</bdi></span>
              <span className="font-display text-20 font-extrabold text-ink tabular-nums">
                {formatAmount(priceAmount * quantity, locale)} <span className="text-14 font-bold">{m.pdpCurrencyEgp}</span>
              </span>
            </div>
            <AsyncButton
              state={asyncState}
              variant="cobalt"
              size="m"
              pendingLabel={m.pdpAdding}
              successLabel={m.pdpAdded}
              onClick={handleAddToCart}
              className="shrink-0"
            >
              <Icon name="cart" size={18} strokeWidth={2} />
              <span>{m.pdpAddCta}</span>
            </AsyncButton>
          </motion.div>
        ) : null}
      </AnimatePresence>

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
