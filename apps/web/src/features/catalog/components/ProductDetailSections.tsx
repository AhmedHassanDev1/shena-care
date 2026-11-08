'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Section, SectionHeader } from '@/components/layout/section';
import { ArrowLink } from '@/components/ui/arrow-link';
import { Button, buttonVariants } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card-variants';
import { Icon } from '@/components/ui/icon';
import { iconButtonVariants } from '@/components/ui/icon-button';
import { ProductTile } from '@/components/ui/product-tile';
import { getSavedCustomerRoutine } from '@/features/routine/lib/routineStorage';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { formatNumber, formatPackSize } from '@/lib/i18n/format';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { discoverProducts, type ProductDetail } from '../api/discovery';
import { categoryLabel, toCardModel } from '../lib/card-model';
import { galleryImages } from '../lib/media-roles';
import { featuredIngredientIndex, knownSkinTypes, productHighlights, splitIngredients, splitSteps } from '../lib/product-facts';
import { selectRelatedProducts } from '../lib/related-products';
import { ROUTINE_ORDER, routineStepFor } from '../lib/routine-order';
import { highlightCopy, skinTypeLabel } from './product-fact-labels';
import { ProductCard, ProductCardSkeleton } from './ProductCard';

/**
 * The product page below the buy box. Each section is a Sahel `Section` and renders only when the reviewed catalog
 * carries its data (GET /products/:slug/detail); «عن المنتج» always renders and names what is still under review, so
 * a missing section is explained in one place instead of as a row of empty cards.
 */

const contentOf = (product: ProductDetail) => {
  const content = product.selectedVariant.content;
  return {
    description: (content?.description ?? product.description)?.trim() || null,
    ingredients: content?.ingredients?.trim() || null,
    usage: (content?.usage ?? product.usage)?.trim() || null,
    warnings: (content?.warnings ?? product.warnings)?.trim() || null,
  };
};

/** «نظرة سريعة»: SPF, texture, where to apply, fragrance-free, non-comedogenic, water resistance, as the catalog states them. */
export function ProductHighlights({ product }: { product: ProductDetail }) {
  const m = useMessages();
  const locale = useLocale();
  const highlights = productHighlights(product);
  if (!highlights.length) return null;
  return (
    <Section labelledBy="pdp-highlights" rhythm="compact">
      <h2 id="pdp-highlights" className="sr-only">
        {m.pdpHighlightsTitle}
      </h2>
      <ul className="m-0 grid list-none grid-cols-2 gap-2.5 p-0 lg:grid-cols-4 lg:gap-3">
        {highlights.slice(0, 4).map((highlight) => {
          const copy = highlightCopy(m, highlight, (n) => formatNumber(n, locale));
          return (
            <li key={highlight.kind} className={cn(cardVariants(), 'flex flex-col items-center gap-1.5 px-3 py-3.5 text-center lg:py-4')}>
              <span className="flex size-9 items-center justify-center rounded-pill bg-sand text-cobalt">
                <Icon name={copy.icon} size={18} />
              </span>
              <span className="font-display text-15 font-bold leading-22 text-ink">
                <bdi>{copy.title}</bdi>
              </span>
              <span className="text-12.5 leading-18 text-stone">{copy.body}</span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/** «عن المنتج»: the brand's description as written, the product facts, a second packshot, and what is still under review. */
export function ProductAbout({ product, name }: { product: ProductDetail; name: string }) {
  const m = useMessages();
  const locale = useLocale();
  const variant = product.selectedVariant;
  const { description, ingredients, usage, warnings } = contentOf(product);
  const sizes = [...new Set(product.skus.map((s) => formatPackSize(s.size, s.sizeUnit, locale)).filter(Boolean))].join(m.sizeOr);
  // Only a photo that adds something (texture, ingredients, editorial); a second packshot would repeat the gallery.
  const image = galleryImages(variant.media.length ? variant.media : product.media)
    .slice(1)
    .find((item) => item.role === 'TEXTURE_SENSORY' || item.role === 'INGREDIENT_STORY' || item.role === 'CATEGORY_EDITORIAL');
  const pending: string[] = [];
  for (const [has, label] of [[description, m.pdpDescription], [ingredients, m.pdpIngredients], [usage, m.pdpUsage], [warnings, m.pdpWarnings]] as const) if (!has) pending.push(label);
  const specs = [
    { k: m.pdpSpecSize, v: sizes || null },
    { k: m.pdpSpecStep, v: product.category ? categoryLabel(product.category, locale) : null },
    { k: m.pdpSpecLine, v: product.productLine?.name ?? null, latin: true },
    { k: m.pdpSpecCode, v: variant.code, latin: true },
  ].filter((row) => row.v);

  return (
    <Section labelledBy="pdp-about" rhythm="compact">
      <SectionHeader title={m.pdpAboutEyebrow} titleId="pdp-about" />
      <div className={cn(cardVariants(), 'grid gap-4 p-4 lg:p-6', image && 'lg:grid-cols-3 lg:items-center lg:gap-8')}>
        <div className="flex flex-col gap-3 lg:col-span-2">
          {description ? (
            <figure className="m-0 flex flex-col gap-2">
              <blockquote dir="auto" className="m-0 max-w-prose whitespace-pre-line text-16 leading-27 text-ink text-match-parent">
                {description}
              </blockquote>
              <figcaption className="text-13 text-stone">{fillMessage(m.pdpBrandDescription, { brand: product.brand.name })}</figcaption>
            </figure>
          ) : null}
          {specs.length ? (
            <dl className={cn('m-0 grid grid-cols-2 gap-x-6', !description && 'lg:grid-cols-4')}>
              {specs.map((row) => (
                <div key={row.k} className="flex flex-col gap-0.5 py-2 shadow-hairline-bottom">
                  <dt className="text-12 font-semibold leading-17 text-stone">{row.k}</dt>
                  <dd dir={row.latin ? 'ltr' : undefined} className="m-0 text-14 font-semibold leading-22 text-ink text-match-parent">
                    {row.v}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {pending.length ? (
            <p className="m-0 flex items-start gap-2 text-13.5 leading-21 text-stone">
              <Icon name="history" size={16} className="mt-0.5 flex-none" />
              {fillMessage(m.pdpPendingList, { items: pending.join(m.pdpPendingSep) })}
            </p>
          ) : null}
        </div>
        {image ? (
          <ProductTile
            src={image.url}
            alt={image.altText?.trim() || name}
            name={name}
            sizes="(min-width: 1024px) 320px, 60vw"
            className="mx-auto w-full max-w-44 bg-chalk lg:max-w-none [&_img]:object-contain [&_img]:p-3"
          />
        ) : null}
      </div>
    </Section>
  );
}

/**
 * «المكونات»: one neutral card per INCI entry, numbered in the label's order (which is by concentration). The entry the
 * product title itself names is lifted into the single cobalt card; nothing here claims what an ingredient does.
 * Text that is not a list (prose) stays as written.
 */
export function ProductIngredients({ product }: { product: ProductDetail }) {
  const m = useMessages();
  const locale = useLocale();
  const { ingredients } = contentOf(product);
  if (!ingredients) return null;
  const list = splitIngredients(ingredients);
  const featured = list ? featuredIngredientIndex(list, product.name) : -1;
  const ordered = list
    ? list.map((name, index) => ({ name, index })).sort((x, y) => Number(y.index === featured) - Number(x.index === featured) || x.index - y.index)
    : [];
  return (
    <Section labelledBy="pdp-ingredients" rhythm="compact">
      <SectionHeader title={m.pdpKeyIngredients} titleId="pdp-ingredients" lead={list ? fillMessage(m.pdpIngredientsCount, { n: formatNumber(list.length, locale) }) : undefined} />
      {list ? (
        <ol className="m-0 grid list-none grid-cols-2 gap-2 p-0 md:grid-cols-4 lg:grid-cols-6 lg:gap-2.5">
          {ordered.map(({ name, index }) =>
            index === featured ? (
              <li key={`${name}-${index}`} className="col-span-2 flex flex-col justify-between gap-2 rounded-card bg-cobalt p-4 text-chalk shadow-elevation-2">
                <span className="flex items-center gap-2 text-12.5 font-semibold">
                  <span aria-hidden="true" className="size-2 rounded-pill bg-citron" />
                  {m.pdpIngredientMain}
                </span>
                <bdi className="font-display text-18 font-bold leading-24">{name}</bdi>
              </li>
            ) : (
              <li key={`${name}-${index}`} className={cn(cardVariants(), 'flex min-h-11 items-center gap-2 px-3 py-2 lg:min-h-14 lg:flex-col lg:items-start lg:justify-between lg:gap-1 lg:py-2.5')}>
                <span className="font-display text-12 font-bold tabular-nums text-stone">{formatNumber(index + 1, locale)}</span>
                <bdi className="min-w-0 text-13.5 font-semibold leading-20 text-ink">{name}</bdi>
              </li>
            )
          )}
        </ol>
      ) : (
        <div className={cn(cardVariants(), 'p-4')}>
          <p dir="auto" className="m-0 whitespace-pre-line text-15 leading-27 text-ink text-match-parent">
            {ingredients}
          </p>
        </div>
      )}
    </Section>
  );
}

const STEP_COLUMNS: Record<number, string> = { 0: '', 1: '', 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-2 lg:grid-cols-4' };

/** «طريقة الاستخدام»: the author's own steps in order, then any reviewer-confirmed directions with their source. */
export function ProductUsage({ product }: { product: ProductDetail }) {
  const m = useMessages();
  const locale = useLocale();
  const steps = splitSteps(contentOf(product).usage);
  const rules = product.selectedVariant.usageRules?.filter((rule) => rule.evidenceText.trim()) ?? [];
  if (!steps.length && !rules.length) return null;
  return (
    <Section labelledBy="pdp-use" rhythm="compact">
      <SectionHeader title={m.pdpUsage} titleId="pdp-use" />
      {steps.length ? (
        <ol className={cn('m-0 grid list-none gap-2.5 p-0', STEP_COLUMNS[Math.min(steps.length, 4)])}>
          {steps.map((step, i) => (
            <li key={`${i}-${step}`} className={cn(cardVariants(), 'flex items-center gap-3 p-3.5 lg:flex-col lg:items-start lg:p-4')}>
              {steps.length > 1 ? (
                <span className="flex size-8 flex-none items-center justify-center rounded-pill bg-sand font-display text-14 font-bold text-cobalt">
                  <span className="sr-only">{fillMessage(m.pdpUsageStep, { n: formatNumber(i + 1, locale) })}</span>
                  <span aria-hidden="true">{formatNumber(i + 1, locale)}</span>
                </span>
              ) : null}
              <p dir="auto" className="m-0 text-14.5 leading-24 text-ink text-match-parent">
                {step}
              </p>
            </li>
          ))}
        </ol>
      ) : null}
      {rules.length ? (
        <div className={cn(cardVariants(), 'p-4')}>
          <h3 className="m-0 flex items-center gap-2 text-16 font-bold text-ink">
            <Icon name="check" size={18} className="text-ok" />
            {m.pdpReviewedDirections}
          </h3>
          <ul className="m-0 mt-3 flex list-disc flex-col gap-2 ps-5 text-14 leading-24 text-stone">
            {rules.map((rule, index) => (
              <li key={`${rule.reviewedAt}-${index}`} dir="auto">
                {rule.evidenceText}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}

/**
 * «مكانه في الروتين»: a reviewed routine placement when the care module has one, otherwise the storefront's routine
 * outline for the product's category (features/catalog/lib/routine-order) with this step lit.
 */
export function RoutinePlacement({ product }: { product: ProductDetail }) {
  const m = useMessages();
  const locale = useLocale();
  const [inSavedRoutine, setInSavedRoutine] = useState(false);

  useEffect(() => {
    const saved = getSavedCustomerRoutine();
    setInSavedRoutine(Boolean(saved && [...saved.morningSteps, ...saved.eveningSteps].some((step) => step.productSlug === product.slug)));
  }, [product.slug]);

  const builder = `${routes.routineBuilder}?product=${encodeURIComponent(product.slug)}`;
  const reviewed = product.routinePlacements?.[0];
  const placement = routineStepFor(product.category?.slug);
  if (!reviewed && (!placement || !product.category)) return null;

  const outline = placement ? ROUTINE_ORDER[placement.kind] : null;
  const department = outline ? categoryLabel({ slug: outline.department, name: outline.department }, locale) ?? outline.department : '';

  return (
    <Section labelledBy="pdp-routine" band rhythm="compact">
      <SectionHeader
        title={m.pdpRoutineStepTitle}
        titleId="pdp-routine"
        lead={
          !reviewed && placement && outline
            ? fillMessage(m.pdpRoutineStepLead, { n: formatNumber(placement.index + 1, locale), total: formatNumber(outline.steps.length, locale), department })
            : undefined
        }
      />
      {reviewed ? (
        <div className={cn(cardVariants(), 'bg-chalk p-4')}>
          <p dir="auto" className="m-0 text-13 text-stone text-match-parent">
            {reviewed.routine.title}
          </p>
          <h3 dir="auto" className="m-0 mt-2 text-20 font-bold text-ink text-match-parent">
            {reviewed.step.title}
          </h3>
          {reviewed.step.instructions ? (
            <p dir="auto" className="m-0 mt-2 whitespace-pre-line text-15 leading-25 text-stone text-match-parent">
              {reviewed.step.instructions}
            </p>
          ) : null}
        </div>
      ) : placement && outline ? (
        <ol className="-mx-4 m-0 flex list-none snap-x gap-2.5 overflow-x-auto px-4 pb-1 scrollbar-none lg:mx-0 lg:grid lg:grid-cols-4 lg:gap-4 lg:overflow-visible lg:px-0">
          {outline.steps.map((step, index) => {
            const current = index === placement.index;
            return (
              <li
                key={step.slug}
                aria-current={current ? 'step' : undefined}
                className={cn(
                  'relative flex min-h-20 w-32 flex-none snap-start flex-col justify-between gap-2 rounded-card p-3.5 lg:w-auto',
                  current ? 'bg-cobalt text-chalk shadow-elevation-2' : 'bg-chalk text-ink shadow-outline-hairline'
                )}
              >
                <span className={cn('flex items-center gap-2 font-display text-13 font-bold tabular-nums', current ? 'text-chalk' : 'text-stone')}>
                  {current ? <span aria-hidden="true" className="size-2 rounded-pill bg-citron" /> : null}
                  {fillMessage(m.pdpUsageStep, { n: formatNumber(index + 1, locale) })}
                </span>
                <span className="font-display text-16 font-bold leading-22">{categoryLabel(step, locale)}</span>
                {current ? <span className="text-12.5 text-chalk">{m.pdpRoutineThisProduct}</span> : null}
                {index < outline.steps.length - 1 ? (
                  <Icon name="chevron-forward" size={14} strokeWidth={2} className="absolute -end-3 top-1/2 hidden -translate-y-1/2 text-stone lg:block" />
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      {inSavedRoutine ? (
        <p className="m-0 flex items-center gap-2 text-14 font-semibold text-ok">
          <Icon name="check" size={16} />
          {m.pdpRoutineInSaved}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Link href={builder} className={buttonVariants({ variant: 'ink', size: 'm' })}>
          {m.pdpRoutineBuild}
        </Link>
        {product.category ? (
          <ArrowLink href={routes.productsByCategory(product.category.slug)}>
            {fillMessage(m.pdpMoreInCategory, { category: categoryLabel(product.category, locale) ?? product.category.name })}
          </ArrowLink>
        ) : null}
      </div>
    </Section>
  );
}

/** «مناسب لمين وإيه الاحتياطات»: reviewed skin types beside the brand's warnings, each card only when it has content. */
export function ProductSuitability({ product }: { product: ProductDetail }) {
  const m = useMessages();
  const skinTypes = knownSkinTypes(product.suitableSkinTypes);
  const warnings = splitSteps(contentOf(product).warnings);
  if (!skinTypes.length && !warnings.length) return null;
  return (
    <Section labelledBy="pdp-suitability" rhythm="compact">
      <SectionHeader title={m.pdpSuitabilityTitle} titleId="pdp-suitability" />
      <div className={cn('grid gap-2.5 lg:gap-3', skinTypes.length && warnings.length && 'md:grid-cols-2')}>
        {skinTypes.length ? (
          <div className="flex flex-col gap-2 rounded-card bg-ok-tint p-4 shadow-outline-ok">
            <h3 className="m-0 flex items-center gap-2 text-16 font-bold text-ink">
              <Icon name="check" size={18} className="text-ok" />
              {m.pdpSuitableFor}
            </h3>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-14 leading-22 text-ink">
              {skinTypes.map((type) => (
                <li key={type} className="flex items-center gap-2">
                  <span aria-hidden="true" className="size-1.5 rounded-pill bg-ok" />
                  {fillMessage(m.pdpSuitableSkin, { type: skinTypeLabel(m, type) })}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {warnings.length ? (
          <div className="flex flex-col gap-2 rounded-card bg-conflict p-4 shadow-outline-tomato">
            <h3 className="m-0 flex items-center gap-2 text-16 font-bold text-ink">
              <Icon name="alert" size={18} className="text-tomato-ink" />
              {m.pdpWarnings}
            </h3>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-14 leading-22 text-ink">
              {warnings.map((line, i) => (
                <li key={`${i}-${line}`} dir="auto" className="flex items-start gap-2 text-match-parent">
                  <span aria-hidden="true" className="mt-2 size-1.5 flex-none rounded-pill bg-tomato-ink" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Section>
  );
}

const RELATED_MAX = 8;

/** «منتجات مشابهة»: same category first, topped up from the same brand; a swipe carousel, ~four cards visible on desktop. */
export function RelatedProducts({ product }: { product: ProductDetail }) {
  const m = useMessages();
  const locale = useLocale();
  const filters = product.category ? { category: product.category.slug } : { brand: product.brand.slug };
  const query = useQuery({
    queryKey: ['pdp-related', filters, product.id],
    queryFn: async () => {
      const primary = await discoverProducts(filters, undefined, 12);
      if (!product.category || selectRelatedProducts(primary.items, product.id, RELATED_MAX).length >= RELATED_MAX) return primary.items;
      try {
        const sameBrand = await discoverProducts({ brand: product.brand.slug }, undefined, 12);
        return [...primary.items, ...sameBrand.items];
      } catch {
        return primary.items;
      }
    },
    staleTime: 60_000,
  });
  const related = selectRelatedProducts(query.data ?? [], product.id, RELATED_MAX);
  const trackRef = useRef<HTMLUListElement>(null);
  // Swipeable on every width; the arrows only exist on desktop and only when more than four cards overflow the row.
  const scrollTrack = (direction: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    const reading = getComputedStyle(track).direction === 'rtl' ? -1 : 1;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.scrollBy({ left: direction * reading * track.clientWidth * 0.9, behavior: reduce ? 'auto' : 'smooth' });
  };
  const row = '-mx-4 grid snap-x auto-cols-[46%] grid-flow-col gap-3 overflow-x-auto px-4 pb-1 scrollbar-none md:auto-cols-[31%] lg:mx-0 lg:auto-cols-[23.5%] lg:gap-4 lg:px-0';
  const arrows =
    related.length > 4 ? (
      <span className="hidden items-center gap-1 lg:flex">
        <button type="button" aria-label={m.pdpCarouselPrev} onClick={() => scrollTrack(-1)} className={iconButtonVariants({ variant: 'raised' })}>
          <Icon name="chevron-back" size={20} strokeWidth={2} />
        </button>
        <button type="button" aria-label={m.pdpCarouselNext} onClick={() => scrollTrack(1)} className={iconButtonVariants({ variant: 'raised' })}>
          <Icon name="chevron-forward" size={20} strokeWidth={2} />
        </button>
      </span>
    ) : undefined;

  return (
    <Section labelledBy="pdp-related" rhythm="compact">
      <SectionHeader
        title={m.pdpRelatedTitle}
        titleId="pdp-related"
        aside={
          <span className="flex items-center gap-3">
            {product.category ? <ArrowLink href={routes.productsByCategory(product.category.slug)}>{m.picksSeeAll}</ArrowLink> : null}
            {arrows}
          </span>
        }
      />
      {query.isPending ? (
        <div aria-busy="true" className={row}>
          {Array.from({ length: 4 }, (_, index) => (
            <ProductCardSkeleton key={index} />
          ))}
        </div>
      ) : query.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-15 text-ink">
          <span>{m.pdpRelatedError}</span>
          <Button variant="linen" size="m" onClick={() => query.refetch()}>
            {m.tryAgain}
          </Button>
        </div>
      ) : related.length ? (
        <ul ref={trackRef} className={cn('m-0 list-none', row)}>
          {related.map((item) => (
            <li key={item.id} className="min-w-0 snap-start">
              <ProductCard product={toCardModel(item, locale, m.sizeOr)} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-15 text-stone">{m.pdpRelatedEmpty}</p>
      )}
    </Section>
  );
}
