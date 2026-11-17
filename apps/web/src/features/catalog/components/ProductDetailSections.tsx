'use client';

import { useState } from 'react';
import { Section } from '@/components/layout/section';
import { Icon } from '@/components/ui/icon';
import type { IconName } from '@/components/ui/icon-paths';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import type { Messages } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';
import type { ProductDetail, PublicKeyIngredient, PublicVariant } from '../api/discovery';
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

export const BENEFIT_ICONS: readonly IconName[] = ['layers', 'droplet', 'shield'];

/**
 * Three Key Benefits Strip (Unboxed, open hairline design).
 */
export function ProductBenefitsStrip({
  product,
  variant,
}: {
  product: ProductDetail;
  variant: PublicVariant;
}) {
  const locale = useLocale();
  const localized = resolveLocalizedProductContent(product, variant, locale);
  const benefits = localized.benefits.slice(0, 3);

  if (benefits.length === 0) return null;

  return (
    <Section labelledBy={`pdp-benefits-${product.id}`} rhythm="compact" className="py-2">
      <div className="mx-auto w-full max-w-[1140px] border-y border-line py-3.5">
        <h2 id={`pdp-benefits-${product.id}`} className="sr-only">
          {benefits.join(' · ')}
        </h2>
        <div
          className={cn(
            'grid text-center',
            benefits.length === 1 && 'grid-cols-1',
            benefits.length === 2 && 'grid-cols-2',
            benefits.length >= 3 && 'grid-cols-3'
          )}
        >
          {benefits.map((text, idx) => (
            <div
              key={`${idx}-${text}`}
              className={cn(
                'flex flex-col items-center justify-center gap-1.5 px-3 sm:px-6',
                idx > 0 && 'border-s border-line'
              )}
            >
              <div className="flex size-7 sm:size-8 items-center justify-center text-cobalt">
                <Icon name={BENEFIT_ICONS[idx % BENEFIT_ICONS.length]} size={22} strokeWidth={1.8} />
              </div>
              <span className="font-display text-13 sm:text-15 font-bold text-ink leading-20">
                <span dir="auto">{text}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

/**
 * About Product (`عن المنتج`): Unboxed, open editorial copy + Read More toggle.
 */
export function ProductAbout({
  product,
  variant,
}: {
  product: ProductDetail;
  variant: PublicVariant;
}) {
  const locale = useLocale();
  const m = useMessages();
  const [expanded, setExpanded] = useState(false);

  const localized = resolveLocalizedProductContent(product, variant, locale);
  const description = localized.description;
  const paragraphs = formatReadableCopy(description);
  const collapsedCopy = paragraphs.join(' ');
  const isExpandable = paragraphs.length > 1 || collapsedCopy.length > 165;
  const copyDir = resolveTextDirection(description) || (locale === 'ar' ? 'rtl' : 'ltr');

  return (
    <Section labelledBy={`pdp-about-${product.id}`} rhythm="compact" className="py-2 lg:py-3">
      <div className="mx-auto flex w-full max-w-[1140px] flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-full bg-cobalt/10 text-cobalt shrink-0">
              <Icon name="package" size={16} strokeWidth={1.8} />
            </div>
            <h2
              id={`pdp-about-${product.id}`}
              className="m-0 font-display text-17 sm:text-19 font-bold text-ink"
            >
              {m.pdpAboutEyebrow}
            </h2>
          </div>

          {isExpandable ? (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              aria-expanded={expanded}
              className="inline-flex min-h-[36px] items-center gap-1 text-13 sm:text-14 font-bold text-cobalt hover:underline cursor-pointer"
            >
              <span>{expanded ? m.pdpShowLess : m.pdpReadMore}</span>
              <Icon
                name="chevron-down"
                size={15}
                className={cn('transition-transform duration-200', expanded && 'rotate-180')}
              />
            </button>
          ) : null}
        </div>

        {paragraphs.length > 0 ? (
          expanded ? (
            <div dir={copyDir} className="flex w-full flex-col gap-2 text-start">
              {paragraphs.map((paragraph, idx) => (
                <p
                  key={`${idx}-${paragraph.slice(0, 24)}`}
                  className="m-0 text-start text-14 sm:text-15 leading-22 sm:leading-24 text-stone"
                >
                  {paragraph}
                </p>
              ))}
            </div>
          ) : (
            <p
              dir={copyDir}
              className={cn(
                'm-0 w-full text-start text-14 sm:text-15 leading-22 sm:leading-24 text-stone',
                isExpandable && 'line-clamp-3'
              )}
            >
              {collapsedCopy}
            </p>
          )
        ) : (
          <p className="m-0 text-start text-14 leading-22 text-stone">
            {m.pdpContentPending}
          </p>
        )}
      </div>
    </Section>
  );
}

/**
 * Section 3 — Active Ingredients (`المكونات الفعالة والنشطة`):
 * COMPLETELY UNBOXED: Seamless editorial columns with delicate hairline borders.
 * Renders verified key ingredients and INCI lists from product data only;
 * does not fabricate formulas or active ingredients.
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

  const activeIngredients = resolveKeyIngredients(product, variant);
  const inciList = resolveFullInciList(product, variant, locale);
  const rawIngredientsText = variant.content?.ingredients?.trim() || null;
  const hasInci = inciList.length > 0 || Boolean(rawIngredientsText);

  const [inciOpen, setInciOpen] = useState(false);
  const visibleKeyIngredients = activeIngredients.slice(0, 3);

  if (visibleKeyIngredients.length === 0 && !hasInci) {
    return null;
  }

  return (
    <Section labelledBy={`pdp-ingredients-${product.id}`} rhythm="compact" className="py-2.5 lg:py-3.5">
      <div className="mx-auto flex w-full max-w-[1140px] flex-col gap-4 border-t border-line pt-5 lg:pt-6">
        {/* Section Header: Minimalist Icon + Title & Subtitle + Full INCI Toggle */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-cobalt/10 text-cobalt shrink-0">
              <Icon name="science" size={19} strokeWidth={1.8} />
            </div>
            <div>
              <h2
                id={`pdp-ingredients-${product.id}`}
                className="m-0 font-display text-18 sm:text-20 font-bold text-ink"
              >
                {m.pdpActiveIngredientsTitle}
              </h2>
              <p className="m-0 text-12 sm:text-13 text-stone">
                {m.pdpActiveIngredientsSubtitle}
              </p>
            </div>
          </div>

          {hasInci ? (
            <button
              type="button"
              onClick={() => setInciOpen((prev) => !prev)}
              aria-expanded={inciOpen}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-pill border border-line bg-chalk px-3.5 py-1 text-12 sm:text-13 font-bold text-cobalt hover:bg-linen transition-colors cursor-pointer shrink-0 self-start sm:self-auto"
            >
              <span>{inciOpen ? m.pdpHideFullInci : m.pdpShowFullInci}</span>
              <Icon
                name="chevron-down"
                size={14}
                className={cn('transition-transform duration-200', inciOpen && 'rotate-180')}
              />
            </button>
          ) : null}
        </div>

        {/* Seamless Editorial Columns (NO BOXES / NO CARDS) */}
        {visibleKeyIngredients.length > 0 ? (
          <div
            className={cn(
              'flex flex-col md:grid md:gap-0 pt-1',
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
              const sublineText = ing.inciName && ing.inciName !== title ? ing.inciName : null;
              const blockDir = resolveTextDirection(formattedDesc || title);

              return (
                <div
                  key={ing.name}
                  className={cn(
                    'flex flex-col gap-1 py-3 first:pt-0 last:pb-0 md:py-0',
                    idx > 0 && 'border-t border-line md:border-t-0 md:border-s md:border-line md:ps-7',
                    idx < visibleKeyIngredients.length - 1 && 'md:pe-7'
                  )}
                >
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-cobalt shrink-0" />
                    <h3 className="m-0 text-15 sm:text-16 font-bold text-ink leading-tight">
                      <bdi>{title}</bdi>
                    </h3>
                    {ing.concentration ? (
                      <span className="rounded-pill bg-cobalt/10 px-2 py-0.5 text-11 font-bold text-cobalt tabular-nums">
                        {ing.concentration}
                      </span>
                    ) : null}
                  </div>

                  {sublineText ? (
                    <span className="block text-12 text-stone">
                      {sublineText}
                    </span>
                  ) : null}

                  {formattedDesc ? (
                    <p
                      dir={blockDir}
                      className="m-0 text-start text-13 leading-20 text-stone"
                    >
                      {formattedDesc}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {/* Expandable Full INCI Cloud (Unboxed, clean tag cloud) */}
        {inciOpen && hasInci ? (
          <div className="mt-2 border-s-2 border-cobalt/30 ps-4 py-1">
            <h3 className="m-0 text-12 font-bold text-ink mb-2">
              {m.pdpShowFullInci}
            </h3>
            {inciList.length > 0 ? (
              <ol className="m-0 flex flex-wrap gap-1.5 list-none p-0">
                {inciList.map((entry, idx) => (
                  <li
                    key={`${idx}-${entry}`}
                    className="rounded-pill border border-line bg-chalk px-2.5 py-0.5 text-11 font-medium text-stone"
                  >
                    <bdi dir="ltr">{entry}</bdi>
                  </li>
                ))}
              </ol>
            ) : rawIngredientsText ? (
              <p className="m-0 text-13 leading-22 text-stone">
                <bdi>{rawIngredientsText}</bdi>
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </Section>
  );
}

/**
 * Section 2 — Routine Placement (`استخدامه في روتينك`):
 * COMPLETELY UNBOXED: Seamless timeline directly on the ground + open numbered usage steps.
 * Renders routine sequencing and usage steps only when genuine routine data exists.
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

  const showMorning = guide.showMorning;
  const showEvening = guide.showEvening;

  const steps = resolved.confirmed && resolved.steps.length > 0 ? resolved.steps : [];

  if (steps.length === 0 && !hasUsageSteps && !hasWarnings) {
    return null;
  }

  return (
    <Section labelledBy={`pdp-routine-${product.id}`} rhythm="compact" className="py-2.5 lg:py-3.5">
      <div className="mx-auto w-full max-w-[1140px] border-t border-line pt-5 lg:pt-6">
        {/* Section Header: Minimalist Icon + Title & Subtitle + Timing Badges */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-cobalt/10 text-cobalt shrink-0">
              <Icon name="layers" size={19} strokeWidth={1.8} />
            </div>
            <div>
              <h2
                id={`pdp-routine-${product.id}`}
                className="m-0 font-display text-18 sm:text-20 font-bold text-ink"
              >
                {m.pdpRoutineStepTitle}
              </h2>
              <p className="m-0 text-12 sm:text-13 text-stone">
                {m.pdpRoutineUsageSubtitle}
              </p>
            </div>
          </div>

          {/* Morning / Evening Timing Badges */}
          <div className="flex items-center gap-2">
            {showMorning ? (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-pill text-12 font-bold bg-citron/35 text-ink">
                <Icon name="sun" size={13} className="text-ink shrink-0" />
                <span>{m.pdpRoutinePeriodMorning}</span>
              </span>
            ) : null}
            {showEvening ? (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-pill text-12 font-bold bg-cobalt/10 text-cobalt">
                <Icon name="evening" size={13} className="text-cobalt shrink-0" />
                <span>{m.pdpRoutinePeriodEvening}</span>
              </span>
            ) : null}
            {guide.frequencyChips.map((chip) => (
              <span
                key={chip}
                className="rounded-pill border border-line bg-chalk px-3 py-0.5 text-11 font-semibold text-stone"
              >
                {chip}
              </span>
            ))}
          </div>
        </div>

        {/* 4-Step Horizontal Connected Routine Sequence (Directly on ground, NO BOX) */}
        {steps.length > 0 ? (
          <div className="relative w-full px-2 sm:px-6 pt-5 pb-6">
            <div
              aria-hidden="true"
              className="absolute inset-x-8 sm:inset-x-14 top-[42px] sm:top-[44px] h-px bg-line-2 z-0"
            />

            <div className="relative z-10 flex w-full items-start justify-between">
              {steps.map((step) => (
                <div
                  key={`${step.number}-${step.label}`}
                  aria-current={step.isCurrent ? 'step' : undefined}
                  className="relative flex flex-1 flex-col items-center text-center"
                >
                  {step.isCurrent ? (
                    <div className="absolute -top-6 flex flex-col items-center">
                      <span className="whitespace-nowrap rounded-pill bg-cobalt px-2.5 py-0.5 text-11 font-bold text-chalk shadow-elevation-1">
                        {m.pdpRoutineBadgeThisProduct}
                      </span>
                      <span aria-hidden="true" className="h-1.5 w-1.5 -mt-1 rotate-45 bg-cobalt" />
                    </div>
                  ) : null}

                  <div
                    className={cn(
                      'flex items-center justify-center rounded-full transition-all',
                      step.isCurrent
                        ? 'size-11 sm:size-12 bg-cobalt text-chalk ring-4 ring-cobalt/15 shadow-elevation-1'
                        : 'size-10 sm:size-11 bg-chalk border border-line-2 text-stone'
                    )}
                  >
                    <Icon name={step.icon} size={step.isCurrent ? 20 : 18} strokeWidth={1.8} />
                  </div>

                  <span
                    className={cn(
                      'mt-2 font-display text-13 sm:text-14 leading-tight',
                      step.isCurrent ? 'font-bold text-cobalt' : 'font-semibold text-ink'
                    )}
                  >
                    {step.label}
                  </span>
                  <span
                    className={cn(
                      'text-11 sm:text-12 tabular-nums',
                      step.isCurrent ? 'font-bold text-cobalt' : 'text-stone'
                    )}
                  >
                    {step.number}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Structured Usage Steps (Open editorial flow with concise numbered steps) */}
        {hasUsageSteps ? (
          <div
            className={cn(
              'grid gap-4 md:gap-0 border-t border-line/70 pt-4',
              usageStepsList.length === 1 && 'grid-cols-1',
              usageStepsList.length === 2 && 'grid-cols-1 md:grid-cols-2',
              usageStepsList.length >= 3 && 'grid-cols-1 md:grid-cols-3'
            )}
          >
            {usageStepsList.slice(0, 3).map((stepText, idx) => {
              const stepNumber = String(idx + 1).padStart(2, '0');
              const stepTitle =
                idx === 0
                  ? m.pdpUsageAmountTitle
                  : idx === 1
                    ? m.pdpUsageMethodTitle
                    : m.pdpUsageFrequencyTitle;
              const stepIcon: IconName = idx === 0 ? 'droplet' : idx === 1 ? 'sparkles' : 'sun';
              return (
                <div
                  key={`${idx}-${stepText.slice(0, 16)}`}
                  className={cn(
                    'flex flex-col gap-1.5 text-start',
                    idx === 0 && 'md:pe-6',
                    idx === 1 && 'md:border-s md:border-line/70 md:px-6',
                    idx === 2 && 'md:border-s md:border-line/70 md:ps-6'
                  )}
                >
                  <div className="flex items-center gap-2 text-cobalt font-bold text-14">
                    <span className="flex size-6 items-center justify-center rounded-full bg-cobalt/10 text-11 font-black text-cobalt tabular-nums shrink-0">
                      {stepNumber}
                    </span>
                    <Icon name={stepIcon} size={15} strokeWidth={2} />
                    <span>{stepTitle}</span>
                  </div>
                  <p className="m-0 text-13 leading-20 text-stone ps-8 md:ps-0">
                    {stepText}
                  </p>
                </div>
              );
            })}
          </div>
        ) : null}

        {/* Safety Warning (Delicate hairline alert if any) */}
        {hasWarnings ? (
          <div className="mt-4 border-s-2 border-tomato ps-4 py-1 text-start">
            <div className="flex items-center gap-1.5 text-tomato-ink mb-1">
              <Icon name="alert" size={15} strokeWidth={2} />
              <h3 className="m-0 text-13 font-bold">{m.pdpWarningTitle}</h3>
            </div>
            <div dir={warningsDir} className="flex flex-col gap-1">
              {warningParagraphs.map((p, idx) => (
                <p key={idx} className="m-0 text-13 leading-20 text-ink/80">
                  {p}
                </p>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Section>
  );
}

export function ProductUsage({
  product: _product,
  variant: _variant,
}: {
  product: ProductDetail;
  variant: PublicVariant;
}) {
  return null;
}
