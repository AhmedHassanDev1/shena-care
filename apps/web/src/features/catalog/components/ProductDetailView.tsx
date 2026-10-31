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
import { getSavedCustomerRoutine } from '@/features/routine/lib/routineStorage';
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
          <Link href={routes.products} className={buttonVariants({ variant: missing ? 'bottle' : 'light', size: 'm' })}>
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
              className="-my-3.5 min-w-10 self-end py-3.5 font-serif italic text-14 text-stone hover:text-ink underline decoration-1 underline-offset-4"
            >
              {product.brand.name.toUpperCase()}
            </Link>
            <h1 dir="auto" className="m-0 font-display text-32 font-bold leading-40 text-ink text-match-parent lg:text-40 lg:leading-45">
              {name}
            </h1>
          </div>

          <SizeOptions product={product} variant={variant} onSelect={onSelectVariant} />

          <PriceRow variant={variant} />

          <div ref={buyRowRef}>
            <BuyRow product={product} variant={variant} buy={buy} disabled={switching} name={name} />
          </div>

          <DeliveryDisclosure />

          <Link href={shellRoutes.shina} className="flex min-h-10 items-center gap-2 self-start text-15 font-semibold text-ink hover:text-cobalt no-underline transition-colors">
            <span className="underline decoration-1 underline-offset-4">{m.pdpAskShina}</span>
          </Link>
        </div>
      </div>

      {description || sections.length || sizes || categoryName ? (
        <section aria-labelledby="about-h" className="grid gap-10 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] lg:gap-20">
          <div className="flex flex-col gap-4">
            <span className="text-12 font-semibold leading-17 text-stone">{m.pdpAboutEyebrow}</span>
            <h2 id="about-h" className="m-0 font-display text-32 font-bold leading-tight text-ink">
              {m.pdpBrandSays}
            </h2>
            {description ? (
              <blockquote dir="auto" className="m-0 whitespace-pre-line text-17 leading-30 text-ink text-match-parent">
                «{description}»
              </blockquote>
            ) : null}
            <span className="flex items-center gap-2 text-13 text-stone">
              <span className="rounded-image bg-sand px-2 py-0.5 text-12 font-semibold text-ink">{m.pdpBrandBadge}</span>
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
                    <dt className="text-12 font-semibold leading-17 text-stone">{row.k}</dt>
                    <dd dir={row.latin ? 'ltr' : undefined} className="m-0 text-15 font-semibold leading-24 text-match-parent text-ink">
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
                  <summary className="flex min-h-15 cursor-pointer list-none items-center justify-between gap-3 font-display text-21 font-bold leading-27 text-ink [&::-webkit-details-marker]:hidden">
                    {section.title}
                    <Icon name="chevron-down" size={18} strokeWidth={2} className="transition-transform duration-fast group-open:rotate-180" />
                  </summary>
                  <p dir="auto" className="m-0 whitespace-pre-line pb-5 text-15 leading-27 text-stone text-match-parent">
                    {section.body}
                  </p>
                </details>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <ClinicalSections product={product} variant={variant} />

      <MobilePurchaseBar product={product} variant={variant} buy={buy} visible={barVisible} onSelect={onSelectVariant} name={name} />
    </article>
  );
}

function ClinicalSections({ product, variant }: { product: ProductDetail; variant: PublicVariant }) {
  const m = useMessages();
  const [savedRoutine, setSavedRoutine] = useState<any>(null);

  useEffect(() => {
    setSavedRoutine(getSavedCustomerRoutine());
  }, []);

  const categorySlug = product.category?.slug ?? '';
  const categoryName = product.category?.name ?? '';

  const matchedSavedStep = savedRoutine
    ? [...(savedRoutine.morningSteps || []), ...(savedRoutine.eveningSteps || [])].find(
        (st: any) => st.productSlug === product.slug || (categoryName && st.stepName && st.stepName.includes(categoryName))
      )
    : null;

  const isCleanser = categorySlug.includes('cleanser') || categoryName.includes('غسول') || categoryName.includes('منظف');
  const isSunscreen = categorySlug.includes('sun') || categoryName.includes('شمس') || categoryName.includes('واقي');
  const isSerum = categorySlug.includes('serum') || categorySlug.includes('treat') || categoryName.includes('سيروم') || categoryName.includes('علاج');
  const activeStep = isCleanser ? 1 : isSerum ? 2 : isSunscreen ? 4 : 3;

  const steps = [
    { num: 1, label: m.pdpStepCleanser },
    { num: 2, label: m.pdpStepTreat },
    { num: 3, label: m.pdpStepMoisturize },
    { num: 4, label: m.pdpStepProtect },
  ];

  const rawIngredients = variant.content?.ingredients?.trim() || null;
  const ingredientsList = rawIngredients
    ? rawIngredients.split(/[،,•\n]+/).map((s) => s.trim()).filter(Boolean).slice(0, 6)
    : null;

  const rawUsage = (variant.content?.usage ?? product.usage)?.trim() || null;
  const usageSteps = rawUsage
    ? rawUsage.split(/[.\n]+/).map((s) => s.trim()).filter((s) => s.length > 5).slice(0, 3)
    : [m.pdpProtocolStep1, m.pdpProtocolStep2, m.pdpProtocolStep3];

  return (
    <div className="flex flex-col gap-8">
      {/* Key Ingredients from verified catalog data */}
      {ingredientsList && ingredientsList.length > 0 ? (
        <section aria-labelledby="actives-h" className="flex flex-col gap-4 rounded-card bg-linen p-6 shadow-outline-hairline lg:p-7">
          <div className="flex items-center gap-3">
            <span className="flex size-10 flex-none items-center justify-center rounded-full bg-sand text-ink">
              <Icon name="science" size={20} />
            </span>
            <div className="flex flex-col">
              <h2 id="actives-h" className="m-0 font-display text-20 font-bold leading-26 text-ink">
                {m.pdpClinicalActivesTitle}
              </h2>
              <p className="m-0 text-13 leading-20 text-stone">{m.pdpClinicalActivesLead}</p>
            </div>
          </div>
          <ul className="m-0 grid list-none grid-cols-1 gap-2.5 p-0 sm:grid-cols-2">
            {ingredientsList.map((ing) => (
              <li key={ing} className="flex items-center gap-2 rounded-image bg-chalk p-3 text-13 font-semibold text-ink shadow-e1">
                <span className="flex size-5 flex-none items-center justify-center rounded-full bg-cobalt text-chalk">
                  <Icon name="check" size={12} />
                </span>
                <span>{ing}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Routine Placement Stepper */}
      <section aria-labelledby="routine-placement-h" className="flex flex-col gap-4 rounded-card bg-sand/60 p-6 shadow-outline-hairline lg:p-7">
        <div className="flex items-center gap-3">
          <span className="flex size-10 flex-none items-center justify-center rounded-full bg-sand text-ink">
            <Icon name="sparkles" size={20} />
          </span>
          <div className="flex flex-col">
            <h2 id="routine-placement-h" className="m-0 font-display text-20 font-bold leading-26 text-ink">
              {m.pdpRoutineStepTitle}
            </h2>
            <p className="m-0 text-13 leading-20 text-stone">{m.pdpRoutineStepLead}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {steps.map((st) => {
            const isCurrent = st.num === activeStep;
            return (
              <div
                key={st.num}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-card p-3 text-center transition-all',
                  isCurrent
                    ? 'bg-cobalt text-chalk shadow-e2'
                    : 'bg-linen text-ink shadow-outline-hairline opacity-80'
                )}
              >
                <span className={cn('text-11 font-bold', isCurrent ? 'text-chalk/80' : 'text-stone')}>
                  خطوة ٠{st.num}
                </span>
                <span className="text-14 font-bold">{st.label}</span>
                {isCurrent ? (
                  <span className="rounded-full bg-chalk/20 px-2 py-0.5 text-10.5 font-bold text-chalk">
                    هذا المنتج
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      {/* Recommended Application Protocol */}
      <section aria-labelledby="protocol-h" className="flex flex-col gap-4 rounded-card bg-linen p-6 shadow-outline-hairline lg:p-7">
        <h2 id="protocol-h" className="m-0 font-display text-20 font-bold leading-26 text-ink">
          {m.pdpProtocolTitle}
        </h2>
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {usageSteps.map((stepText, idx) => (
            <li key={idx} className="flex items-start gap-3">
              <span className="flex size-7 flex-none items-center justify-center rounded-full bg-sand font-display text-13 font-bold text-ink">
                ٠{idx + 1}
              </span>
              <p className="m-0 pt-0.5 text-14 leading-24 text-ink">{stepText}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Routine Section with Contextual Matching and Link to Builder */}
      <section aria-labelledby="routine-h" className="flex flex-col gap-4 rounded-card bg-linen p-6 shadow-e1 lg:p-7">
        <div className="flex items-center gap-3">
          <span className="flex size-10 flex-none items-center justify-center rounded-full bg-sand text-cobalt">
            <Icon name="routine" size={20} />
          </span>
          <div className="flex flex-col">
            <h2 id="routine-h" className="m-0 font-display text-20 font-bold leading-26 text-ink">
              موقع المستحضر في روتين العناية
            </h2>
            <span className="text-12 text-stone">إرشاد مبني على الكتالوج وتناسق الخطوات</span>
          </div>
        </div>

        {matchedSavedStep ? (
          <div className="flex items-center gap-2 rounded-card bg-sand/50 p-3.5 text-13 font-bold text-cobalt">
            <Icon name="check" size={16} />
            <span>يناسب روتينك اليومي المحفوظ: خطوة {matchedSavedStep.stepName}</span>
          </div>
        ) : (
          <p className="m-0 text-14 leading-24 text-stone">
            مكان هذا المستحضر النموذجي في تسلسل العناية هو خطوة <strong>{steps.find((s) => s.num === activeStep)?.label ?? categoryName}</strong> لدعم التوازن والحماية دون إجهاد حاجز البشرة.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Link
            href={`${routes.routineBuilder}?product=${encodeURIComponent(product.slug)}`}
            className={cn(buttonVariants({ variant: 'cobalt', size: 'm' }), 'font-bold shadow-e1')}
          >
            <Icon name="sparkles" size={16} />
            <span>ابني روتينك مع هذا المنتج</span>
          </Link>

          <Link
            href={routes.routines}
            className={cn(buttonVariants({ variant: 'linen', size: 'm' }), 'font-semibold')}
          >
            دليل الروتينات الجاهزة
          </Link>

          {categorySlug ? (
            <Link
              href={`${routes.products}?category=${encodeURIComponent(categorySlug)}`}
              className={cn(buttonVariants({ variant: 'linen', size: 'm' }))}
            >
              {m.pdpAlternativesTitle}
            </Link>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function Crumb({ href, label }: { href: string; label: string }) {
  return (
    <li className="inline-flex items-center gap-2">
      <Link href={href} className="font-medium text-stone hover:text-ink underline decoration-1 underline-offset-4">
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
          className="rounded-card shadow-e3 lg:aspect-[600/750]"
        />
        <div className="pointer-events-none absolute bottom-4 inset-x-4 flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ink/85 px-3 py-1 text-12 font-semibold text-chalk backdrop-blur-sm shadow-e1">
            <Icon name="shield" size={14} className="text-citron" />
            <span>{m.pdpAuthenticRibbon}</span>
          </span>
        </div>
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
                className={cn('block rounded-image p-0.5', i === index ? 'ring-2 ring-cobalt shadow-e1' : 'shadow-none')}
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
      <legend className="mb-2 p-0 text-14 font-bold text-ink">
        {m.pdpSizeLabel} <span className="font-normal text-stone">{label(variant)}</span>
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
                'flex items-center gap-2.5 rounded-image px-3.5 text-start transition-all',
                compact ? 'h-12' : 'h-15',
                checked ? 'bg-sand shadow-outline-hairline ring-2 ring-cobalt' : sku.canOrder ? 'bg-linen shadow-outline-hairline hover:bg-sand/30' : 'bg-linen opacity-50 shadow-outline-hairline'
              )}
            >
              <span aria-hidden="true" className={cn('flex size-5 flex-none items-center justify-center rounded-full', checked ? 'bg-cobalt text-chalk' : 'shadow-outline-check')}>
                {checked ? <Icon name="check" size={13} strokeWidth={3} /> : null}
              </span>
              <span className={cn('text-16 font-bold text-ink', !sku.canOrder && 'text-stone line-through')}>{label(sku)}</span>
              <span className={cn('ms-auto text-12.5', sku.canOrder ? 'text-stone' : 'font-medium text-tomato-ink')}>
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
          <span className="text-32 font-bold leading-36 tabular-nums text-ink">
            <bdi>{formatAmount(price.amount, locale)}</bdi>
            <span className="ms-1.5 text-14 font-medium text-stone">{currencyLabel(locale)}</span>
          </span>
          {compareAt ? (
            <span className="text-15 text-stone line-through">
              <span className="sr-only">{fillMessage(m.pdpWas, { price: formatEgp(compareAt, price.currency, locale) ?? '' })}</span>
              <bdi aria-hidden>{formatAmount(compareAt, locale)}</bdi>
            </span>
          ) : null}
        </p>
      ) : (
        <p className="m-0 text-15 text-stone">{m.productPriceUnavailable}</p>
      )}
      <p className={cn('m-0 flex items-center gap-2 text-15 font-semibold', variant.canOrder ? 'text-ok' : 'text-tomato-ink')}>
        <span aria-hidden="true" className={cn('size-2 rounded-full', variant.canOrder ? 'bg-ok' : 'bg-tomato')} />
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
          className="h-14 [&_button]:h-14 [&_button]:w-11"
        />
        <AsyncButton
          state={buy.state === 'added' ? 'idle' : buy.state}
          variant="ink"
          size="l"
          className={cn('flex-1', added && 'bg-cobalt hover:bg-cobalt-deep text-chalk')}
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
        <p role="alert" className="m-0 flex items-start gap-2 text-13.5 leading-21 text-tomato-ink">
          <span aria-hidden="true" className="mt-1.5 size-1.75 flex-none rounded-full bg-tomato" />
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
          <span lang="en" dir="ltr" className="font-serif italic text-14 text-stone text-match-parent">
            {brand.toUpperCase()}
          </span>
          <span dir="auto" className="truncate text-14 font-semibold text-match-parent text-ink">
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
    <details className="group rounded-input bg-linen shadow-outline-hairline">
      <summary className="flex min-h-13 cursor-pointer list-none items-center gap-2.5 px-4 [&::-webkit-details-marker]:hidden text-ink">
        <Icon name="truck" size={20} />
        <span className="text-15 font-semibold">{m.pdpDelivery}</span>
        <span className="ms-auto text-13 text-stone">{m.pdpNotConfirmed}</span>
        <Icon name="chevron-down" size={16} strokeWidth={2} className="transition-transform duration-fast group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-1 px-4 pb-4 text-14 leading-22 text-stone">
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
        'pdp-bar fixed inset-x-0 bottom-0 z-nav flex flex-col gap-2 bg-chalk/95 px-3 pt-2.5 shadow-hairline-top backdrop-blur-sm transition-transform duration-base ease-standard lg:hidden',
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
        <ProductTile size="thumb" className="h-12.5 w-10 flex-none rounded-image" src={image?.url ?? null} alt="" name={name} />
        <button
          type="button"
          onClick={() => product.skus.length > 1 && setSizeOpen(true)}
          aria-label={product.skus.length > 1 ? fillMessage(m.pdpBarSize, { size }) : undefined}
          className="flex h-12.5 flex-none flex-col items-start justify-center rounded-input bg-sand px-3 text-start"
        >
          <span className="flex items-center gap-1 text-12.5 font-semibold text-ink">
            {product.skus.length > 1 ? <Icon name="chevron-down" size={12} strokeWidth={2} /> : null}
            {size}
          </span>
          {variant.price ? (
            <span className="text-15 font-bold leading-20 tabular-nums text-ink">
              <bdi>{formatAmount(variant.price.amount, locale)}</bdi>
              <span className="ms-1 text-11 font-medium text-stone">{currencyLabel(locale)}</span>
            </span>
          ) : null}
        </button>
        {orderable ? (
          <AsyncButton
            state={buy.state === 'added' ? 'idle' : buy.state}
            variant="ink"
            size="m"
            className={cn('h-12.5 flex-1', added && 'bg-cobalt hover:bg-cobalt-deep text-chalk')}
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
          <Button asChild variant="linen" size="m" className="h-12.5 flex-1">
            <Link href={product.category ? routes.productsByCategory(product.category.slug) : routes.products} tabIndex={visible ? 0 : -1}>
              {m.pdpSeeAlternatives}
            </Link>
          </Button>
        )}
      </div>
      <Sheet open={sizeOpen} onOpenChange={setSizeOpen}>
        <SheetContent side="bottom" closeLabel={m.close} className="rounded-t-sheet">
          <span aria-hidden="true" className="mt-2 h-1 w-10 self-center rounded-image bg-sand" />
          <div className="px-4 pb-2 pt-1 shadow-hairline-bottom">
            <SheetTitle className="flex h-10 items-center font-display text-22 font-bold leading-28 text-ink">{m.pdpChooseSize}</SheetTitle>
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
              variant="ink"
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
                  <span aria-hidden="true" className="size-1 rounded-full bg-chalk/70" />
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
        <Skeleton className="h-4 w-28 rounded-image bg-line" />
        <Skeleton className="h-10 w-4/5 rounded-card bg-line" />
        <Skeleton className="h-15 w-full rounded-image bg-line" />
        <Skeleton className="h-9 w-40 rounded-card bg-line" />
        <Skeleton className="h-14 w-full rounded-pill bg-line" />
      </div>
    </div>
  );
}
