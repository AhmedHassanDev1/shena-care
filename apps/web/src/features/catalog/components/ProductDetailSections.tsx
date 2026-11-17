'use client';

import { useState, type ReactNode } from 'react';
import { Section } from '@/components/layout/section';
import { Icon } from '@/components/ui/icon';
import type { IconName } from '@/components/ui/icon-paths';
import { ProductTile } from '@/components/ui/product-tile';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { cn } from '@/lib/utils';
import type { ProductDetail, PublicVariant } from '../api/discovery';
import {
  formatReadableCopy,
  resolveFullInciList,
  resolveKeyIngredients,
  resolveLocalizedProductContent,
  resolveRoutinePosition,
  resolveTextDirection,
  resolveUsageGuide,
  splitSteps,
} from '../lib/product-facts';

const BENEFIT_ICONS: readonly IconName[] = ['layers', 'droplet', 'shield'];

/** Content the page actually has for this variant; sections without content are not rendered at all. */
export function usePdpContent(product: ProductDetail, variant: PublicVariant) {
  const locale = useLocale();
  const m = useMessages();
  const localized = resolveLocalizedProductContent(product, variant, locale);
  const hasAbout = formatReadableCopy(localized.description).length > 0;
  const hasIngredients =
    resolveKeyIngredients(product, variant).length > 0 ||
    resolveFullInciList(product, variant, locale).length > 0 ||
    Boolean(variant.content?.ingredients?.trim());
  const guide = resolveUsageGuide(product, variant, locale, m);
  const hasUsage = (guide.instructionsText ? splitSteps(guide.instructionsText).length > 0 : false) || Boolean(guide.warningsText);
  return { hasAbout, hasIngredients, hasUsage };
}

/** One information block: the title on the start side, the content beside it on desktop, stacked on phones. */
function PdpBlock({ id, title, children }: { id: string; title: string; icon?: IconName; children: ReactNode }) {
  return (
    <details open className="group border-b border-ink/20">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-3">
          <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-citron shadow-outline-hairline" />
          <h2 id={id} className="m-0 font-display text-display-3 font-bold text-ink">
            {title}
          </h2>
        </span>
        <Icon name="chevron-down" size={20} className="shrink-0 text-stone transition-transform duration-fast group-open:rotate-180" />
      </summary>
      <div className="pb-7 text-start">{children}</div>
    </details>
  );
}


/**
 * Stitch Section B — Three Key Benefits Strip.
 * Renders strictly when the backend has reviewed (`APPLIED`) manufacturer-stated benefit claims.
 */
export function ProductBenefitsStrip({
  product,
  variant,
}: {
  product: ProductDetail;
  variant: PublicVariant;
}) {
  const locale = useLocale();
  const benefits = resolveLocalizedProductContent(product, variant, locale).benefits.slice(0, 3);

  if (benefits.length === 0) return null;

  return (
    <Section labelledBy={`pdp-benefits-${product.id}`} rhythm="compact" className="py-4 lg:py-8">
      <h2 id={`pdp-benefits-${product.id}`} className="sr-only">
        {benefits.join(' · ')}
      </h2>
      <ul
        className={cn(
          'm-0 grid list-none grid-cols-1 gap-5 border-y border-line p-0 py-5 sm:gap-0',
          benefits.length === 2 && 'sm:grid-cols-2',
          benefits.length >= 3 && 'sm:grid-cols-3',
        )}
      >
        {benefits.map((text, idx) => (
          <li key={`${idx}-${text}`} className={cn('flex items-center gap-4 sm:px-6', idx > 0 && 'sm:border-s sm:border-line')}>
            <Icon name={BENEFIT_ICONS[idx % BENEFIT_ICONS.length]} size={28} strokeWidth={1.6} className="shrink-0 text-cobalt" />
            <span className="font-display text-17 font-bold leading-snug text-ink">
              <span dir="auto">{text}</span>
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * Stitch Section C — About Product (`عن المنتج`): compact 3-line editorial summary + Read More toggle.
 */
export function ProductAbout({
  product,
  variant,
}: {
  product: ProductDetail;
  variant: PublicVariant;
}) {
  const m = useMessages();
  const [expanded, setExpanded] = useState(false);

  const locale = useLocale();
  const description = resolveLocalizedProductContent(product, variant, locale).description;
  const paragraphs = formatReadableCopy(description);
  const collapsedCopy = paragraphs.join(' ');
  const isExpandable = paragraphs.length > 1 || collapsedCopy.length > 165;
  const copyDir = resolveTextDirection(description) || (locale === 'ar' ? 'rtl' : 'ltr');

  if (paragraphs.length === 0) return null;

  return (
    <PdpBlock id={`pdp-about-${product.id}`} title={m.pdpAboutEyebrow} icon="package">
      <div dir={copyDir} className="flex flex-col gap-3 text-start">
        {(expanded ? paragraphs : [collapsedCopy]).map((paragraph, idx) => (
          <p
            key={`${idx}-${paragraph.slice(0, 24)}`}
            className={cn('m-0 text-start text-body text-ink', !expanded && isExpandable && 'line-clamp-4')}
          >
            {paragraph}
          </p>
        ))}
      </div>
      {isExpandable ? (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          className="mt-3 inline-flex min-h-control-s cursor-pointer items-center gap-1 font-display text-16 font-bold text-cobalt hover:underline"
        >
          <span>{expanded ? m.pdpShowLess : m.pdpReadMore}</span>
          <Icon name="chevron-down" size={16} className={cn('transition-transform duration-fast', expanded && 'rotate-180')} />
        </button>
      ) : null}
    </PdpBlock>
  );
}

/**
 * Stitch Section D — Active Ingredients (`المكونات الفعالة`) & expandable INCI list.
 * Seamless horizontal editorial strip on desktop and compact hairline rows on mobile; never invents missing images.
 */
export function ProductActiveIngredients({
  product,
  variant,
}: {
  product: ProductDetail;
  variant: PublicVariant;
}) {
  const locale = useLocale();
  const m = useMessages();

  const keyIngredients = resolveKeyIngredients(product, variant);
  const inciList = resolveFullInciList(product, variant, locale);
  const rawIngredientsText = variant.content?.ingredients?.trim() || null;
  const hasInci = inciList.length > 0 || Boolean(rawIngredientsText);

  const [inciOpen, setInciOpen] = useState(keyIngredients.length === 0 && hasInci);
  const [failedVisuals, setFailedVisuals] = useState<Record<string, true>>({});
  const markVisualFailed = (url: string) => {
    setFailedVisuals((prev) => (prev[url] ? prev : { ...prev, [url]: true }));
  };

  const visibleKeyIngredients = keyIngredients.slice(0, 3);

  if (!hasInci && visibleKeyIngredients.length === 0) return null;

  return (
    <PdpBlock id={`pdp-ingredients-${product.id}`} title={m.pdpActiveIngredientsTitle} icon="science">
      <div className="flex flex-col gap-5">
        {/* Key Ingredients: Seamless editorial columns on desktop, hairline-divided rows on mobile */}
        {visibleKeyIngredients.length > 0 ? (
          <div
            className={cn(
              'flex flex-col md:grid md:gap-0',
              visibleKeyIngredients.length === 1 && 'md:grid-cols-1',
              visibleKeyIngredients.length === 2 && 'md:grid-cols-2',
              visibleKeyIngredients.length >= 3 && 'md:grid-cols-3'
            )}
          >
            {visibleKeyIngredients.map((ing, idx) => {
              const title = locale === 'ar' ? ing.nameAr || ing.name : ing.name;
              const rawDesc =
                locale === 'ar'
                  ? ing.descriptionAr || ing.function || ing.descriptionEn
                  : ing.descriptionEn || ing.function;
              const formattedDesc = rawDesc ? formatReadableCopy(rawDesc).join(' ') : null;
              const sublineText = formattedDesc || (ing.inciName && ing.inciName !== title ? ing.inciName : null);
              const blockDir = resolveTextDirection(sublineText || title) ?? resolveTextDirection(title);
              const hasVisual = Boolean(ing.visualUrl && !failedVisuals[ing.visualUrl]);

              return (
                <div
                  key={ing.name}
                  className={cn(
                    'flex items-start gap-3 py-2.5 first:pt-0 last:pb-0 md:py-0.5',
                    idx > 0 && 'border-t border-line md:border-t-0 md:border-s md:border-line md:ps-6',
                    idx < visibleKeyIngredients.length - 1 && 'md:pe-6'
                  )}
                >
                  {hasVisual && ing.visualUrl ? (
                    <div className="relative flex size-12 md:size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-linen">
                      <ProductTile
                        src={ing.visualUrl}
                        alt={title}
                        name={title}
                        size="thumb"
                        sizes="64px"
                        onImageError={() => ing.visualUrl && markVisualFailed(ing.visualUrl)}
                        className="size-full rounded-none bg-linen"
                      />
                    </div>
                  ) : null}

                  <div dir={blockDir} className="min-w-0 flex-1 text-start">
                    <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                      {!hasVisual ? (
                        <span
                          aria-hidden="true"
                          className="inline-block size-1.5 shrink-0 rounded-full bg-cobalt"
                        />
                      ) : null}
                      <h3 className="m-0 text-15 sm:text-16 font-bold text-ink leading-22">
                        <bdi>{title}</bdi>
                      </h3>
                      {ing.concentration ? (
                        <span className="rounded-pill bg-cobalt/10 px-2 py-0.5 text-12 font-bold text-cobalt tabular-nums">
                          {ing.concentration}
                        </span>
                      ) : null}
                    </div>
                    {formattedDesc ? (
                      <p
                        dir={resolveTextDirection(formattedDesc)}
                        className="m-0 text-start text-13 leading-20 text-stone line-clamp-2"
                      >
                        {formattedDesc}
                      </p>
                    ) : sublineText ? (
                      <p
                        dir={resolveTextDirection(sublineText)}
                        className="m-0 text-start text-12 leading-20 text-stone"
                      >
                        {sublineText}
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {/* Full INCI List Toggle & Expandable Hairline Block */}
        {hasInci ? (
          <div className="flex flex-col gap-2.5">
            <div>
              <button
                type="button"
                onClick={() => setInciOpen((prev) => !prev)}
                aria-expanded={inciOpen}
                className="inline-flex min-h-[36px] items-center gap-1 text-14 font-bold text-cobalt hover:underline cursor-pointer"
              >
                <span>{inciOpen ? m.pdpHideFullInci : m.pdpShowFullInci}</span>
                <Icon
                  name="chevron-down"
                  size={16}
                  className={cn('transition-transform duration-200', inciOpen && 'rotate-180')}
                />
              </button>
            </div>

            {inciOpen ? (
              <div className="border-s-2 border-cobalt/30 ps-3.5 py-0.5">
                {inciList.length > 0 ? (
                  <ol className="m-0 flex flex-wrap gap-1.5 list-none p-0">
                    {inciList.map((entry, idx) => (
                      <li
                        key={`${idx}-${entry}`}
                        className="rounded-pill border border-line bg-chalk px-2.5 py-0.5 text-12 font-medium text-stone"
                      >
                        <bdi dir="ltr">{entry}</bdi>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="m-0 text-13 leading-22 text-stone">
                    <bdi>{rawIngredientsText}</bdi>
                  </p>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </PdpBlock>
  );
}

/**
 * Where the product sits in a routine, and how to use it: the routine sequence, morning/evening timing, the numbered
 * usage steps and the safety warning, all from the product's own data. Nothing is shown when the catalog has none of it.
 */
export function RoutinePlacement({
  product,
  variant,
}: {
  product: ProductDetail;
  variant: PublicVariant;
}) {
  const locale = useLocale();
  const m = useMessages();
  const resolved = resolveRoutinePosition(product, variant, m);
  const guide = resolveUsageGuide(product, variant, locale, m);

  const usageStepsList = guide.instructionsText ? splitSteps(guide.instructionsText) : [];
  const hasUsageSteps = usageStepsList.length > 0;
  const hasWarnings = Boolean(guide.warningsText);
  const warningParagraphs = formatReadableCopy(guide.warningsText);
  const warningsDir = resolveTextDirection(guide.warningsText);
  const steps = resolved.confirmed && resolved.steps.length > 0 ? resolved.steps : [];
  const hasTiming = guide.showMorning || guide.showEvening || guide.frequencyChips.length > 0;

  if (steps.length === 0 && !hasUsageSteps && !hasWarnings) return null;

  return (
    <PdpBlock id={`pdp-routine-${product.id}`} title={m.pdpRoutineStepTitle} icon="layers">
      <div className="flex flex-col gap-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 max-w-narrow text-body text-stone">{resolved.summaryLine}</p>
          {hasTiming ? (
            <div className="flex flex-wrap items-center gap-2">
              {guide.showMorning ? (
                <span className="inline-flex items-center gap-1.5 rounded-pill bg-citron px-3 py-1 text-13 font-bold text-ink">
                  <Icon name="sun" size={14} className="shrink-0" />
                  <span>{m.pdpRoutinePeriodMorning}</span>
                </span>
              ) : null}
              {guide.showEvening ? (
                <span className="inline-flex items-center gap-1.5 rounded-pill bg-ink px-3 py-1 text-13 font-bold text-chalk">
                  <Icon name="evening" size={14} className="shrink-0" />
                  <span>{m.pdpRoutinePeriodEvening}</span>
                </span>
              ) : null}
              {guide.frequencyChips.map((chip) => (
                <span key={chip} className="rounded-pill px-3 py-1 text-12 font-semibold text-stone shadow-outline-hairline">
                  {chip}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {steps.length > 0 ? (
          <div className="relative flex w-full max-w-4xl items-start justify-between px-1 pt-6 sm:px-2">
            <div aria-hidden="true" className="absolute inset-x-10 top-[48px] z-0 h-px bg-line-2 sm:inset-x-12 md:top-[52px]" />
            {steps.map((step) => (
              <div
                key={`${step.number}-${step.label}`}
                aria-current={step.isCurrent ? 'step' : undefined}
                className="relative z-10 flex flex-1 flex-col items-center text-center"
              >
                {step.isCurrent ? (
                  <div className="absolute -top-6 flex flex-col items-center">
                    <span className="whitespace-nowrap rounded-pill bg-ink px-2.5 py-0.5 text-12 font-bold text-citron">
                      {m.pdpRoutineBadgeThisProduct}
                    </span>
                    <span aria-hidden="true" className="-mt-1 h-1.5 w-1.5 rotate-45 bg-ink" />
                  </div>
                ) : null}
                <div
                  className={cn(
                    'flex items-center justify-center rounded-full transition-all',
                    step.isCurrent
                      ? 'size-12 bg-citron text-ink ring-4 ring-citron/30 md:size-14'
                      : 'size-12 border border-line-2 bg-transparent text-stone md:size-14',
                  )}
                >
                  <Icon name={step.icon} size={step.isCurrent ? 20 : 18} strokeWidth={1.8} />
                </div>
                <span className={cn('mt-2 font-display text-15 leading-tight md:text-17', step.isCurrent ? 'font-bold text-ink' : 'font-semibold text-ink')}>
                  {step.label}
                </span>
                <span className={cn('text-12 tabular-nums', step.isCurrent ? 'font-bold text-ink' : 'text-stone')}>{step.number}</span>
              </div>
            ))}
          </div>
        ) : null}

        {hasUsageSteps ? (
          <div
            className={cn(
              'grid gap-5 border-t border-line/70 pt-5 md:gap-0',
              usageStepsList.length === 1 && 'grid-cols-1',
              usageStepsList.length === 2 && 'grid-cols-1 md:grid-cols-2',
              usageStepsList.length >= 3 && 'grid-cols-1 md:grid-cols-3',
            )}
          >
            {usageStepsList.slice(0, 3).map((stepText, idx) => {
              const stepTitle = idx === 0 ? m.pdpUsageAmountTitle : idx === 1 ? m.pdpUsageMethodTitle : m.pdpUsageFrequencyTitle;
              const stepIcon: IconName = idx === 0 ? 'droplet' : idx === 1 ? 'sparkles' : 'sun';
              return (
                <div
                  key={`${idx}-${stepText.slice(0, 16)}`}
                  className={cn(
                    'flex flex-col gap-1.5 text-start',
                    idx === 0 && 'md:pe-6',
                    idx === 1 && 'md:border-s md:border-line/70 md:px-6',
                    idx === 2 && 'md:border-s md:border-line/70 md:ps-6',
                  )}
                >
                  <div className="flex items-center gap-2 text-16 font-bold text-ink">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-citron text-12 font-black tabular-nums text-ink">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <Icon name={stepIcon} size={16} strokeWidth={2} />
                    <span>{stepTitle}</span>
                  </div>
                  <p className="m-0 ps-8 text-15 leading-24 text-stone md:ps-0">{stepText}</p>
                </div>
              );
            })}
          </div>
        ) : null}

        {hasWarnings ? (
          <div className="border-s-4 border-tomato ps-4 text-start">
            <div className="mb-1 flex items-center gap-1.5 text-tomato-ink">
              <Icon name="alert" size={16} strokeWidth={2} />
              <h3 className="m-0 text-14 font-bold">{m.pdpWarningTitle}</h3>
            </div>
            <div dir={warningsDir} className="flex flex-col gap-1">
              {warningParagraphs.map((p, idx) => (
                <p key={idx} className="m-0 text-14 leading-22 text-ink/80">
                  {p}
                </p>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </PdpBlock>
  );
}
