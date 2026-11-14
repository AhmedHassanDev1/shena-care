'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Section, SectionHeader } from '@/components/layout/section';
import { ArrowLink } from '@/components/ui/arrow-link';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { ChipLink } from '@/components/ui/chip-link';
import { MessageBox } from '@/components/ui/message-box';
import { Skeleton } from '@/components/ui/skeleton';
import { ProductCard, ProductCardSkeleton } from '@/features/catalog/components/ProductCard';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { formatNumber } from '@/lib/i18n/format';
import { fillMessage, type Messages } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import {
  getConcernGuide, getConcernShelf, getReadyRoutines, getRecommendations, productTypeLabel,
  type KnowledgeView, type RecommendationRequest, type SkinType, type TriState,
} from '@/features/care/api/care-intelligence';
import { BasisLegend, MatchReasons } from '@/features/care/components/MatchReasons';
import { recommendationToCard } from '@/features/care/lib/recommendation-card';

const SKIN_TYPES: Array<{ value: SkinType; label: keyof Messages }> = [
  { value: 'oily', label: 'skinTypeOily' }, { value: 'dry', label: 'skinTypeDry' }, { value: 'combination', label: 'skinTypeCombination' },
  { value: 'sensitive', label: 'skinTypeSensitive' }, { value: 'normal', label: 'skinTypeNormal' },
];
type SafetyChoice = 'NO' | 'PREGNANT' | 'BREASTFEEDING';

/**
 * One concern in the Corner: what it is (sourced overview), the products the recommendation engine finds for it with
 * the reason each one fits, the ingredients the published guidance names, a ready routine when one is published, and
 * when to see a professional. Refinements live in the URL (shareable, survive Back); the safety answer does not: it is
 * personal, so it stays in this page only.
 */
export function ConcernView({ slug }: { slug: string }) {
  const m = useMessages();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [safety, setSafety] = useState<SafetyChoice | null>(null);

  const skinType = SKIN_TYPES.some((s) => s.value === params.get('skin')) ? (params.get('skin') as SkinType) : undefined;
  const productType = params.get('type') && /^[a-z-]{2,40}$/.test(params.get('type')!) ? params.get('type')! : undefined;
  const fragranceFree = params.get('ff') === '1';
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const shelf = useQuery({ queryKey: ['guidance', 'concerns'], queryFn: getConcernShelf, staleTime: 2 * 60 * 1000 });
  const concern = shelf.data?.find((c) => c.slug === slug);
  const guide = useQuery({ queryKey: ['guidance', 'guide', slug, locale], queryFn: () => getConcernGuide(slug, locale), staleTime: 10 * 60 * 1000 });
  const routines = useQuery({ queryKey: ['care', 'ready-routines', slug], queryFn: () => getReadyRoutines(slug), staleTime: 5 * 60 * 1000 });

  const safetyAnswers: RecommendationRequest['safety'] = useMemo(() => {
    if (!safety) return undefined;
    const tri = (yes: boolean): TriState => (yes ? 'YES' : 'NO');
    return { pregnant: tri(safety === 'PREGNANT'), breastfeeding: tri(safety === 'BREASTFEEDING') };
  }, [safety]);
  const request: RecommendationRequest = {
    careArea: concern?.careArea, concerns: [slug], productTypes: productType ? [productType] : undefined,
    skinType: concern?.careArea === 'hair' ? undefined : skinType, fragranceFree: fragranceFree || undefined, safety: safetyAnswers, limit: 12, locale,
  };
  const recs = useQuery({
    queryKey: ['guidance', 'recommendations', request],
    queryFn: ({ signal }) => getRecommendations(request, signal),
    enabled: Boolean(concern),
    placeholderData: keepPreviousData,
  });

  if (shelf.isSuccess && !concern) {
    return (
      <Section labelledBy="concern-missing" rhythm="tight">
        <MessageBox tone="info" title={<span id="concern-missing">{m.concernNotFound}</span>}>
          <ArrowLink href={routes.corner}>{m.concernBack}</ArrowLink>
        </MessageBox>
      </Section>
    );
  }

  const overview = guide.data?.overview ?? null;
  const items = recs.data?.items ?? [];
  const refined = Boolean(skinType || productType || fragranceFree);
  const excluded = (recs.data?.excluded ?? []).filter((e) => e.code !== 'UNAVAILABLE');

  return (
    <>
      <Section labelledBy="concern-title" rhythm="tight">
        <ArrowLink href={routes.corner} className="self-start">{m.concernBack}</ArrowLink>
        <div className="flex flex-col gap-3">
          {concern ? (
            <h1 id="concern-title" className="m-0 font-display text-30 font-extrabold tracking-tight text-ink lg:text-34">{concern.name}</h1>
          ) : (
            <Skeleton id="concern-title" className="h-10 w-64" />
          )}
          {overview ? <SourcedStatement entry={overview} lead /> : guide.isPending ? <Skeleton className="h-12 max-w-narrow" /> : null}
        </div>
      </Section>

      <Section labelledBy="concern-products" rhythm="tight">
        <SectionHeader title={m.concernProductsTitle} titleId="concern-products" lead={m.concernProductsLead} />

        <div role="group" aria-label={m.concernRefineTitle} className="flex flex-col gap-2">
          {concern?.careArea !== 'hair' ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-12.5 font-semibold text-stone">{m.concernSkinTypeLabel}</span>
              {SKIN_TYPES.map((s) => (
                <Chip key={s.value} selected={skinType === s.value} onClick={() => setParam('skin', skinType === s.value ? null : s.value)}>
                  {m[s.label]}
                </Chip>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {concern && concern.productTypes.length > 1 ? (
              <>
                <span className="text-12.5 font-semibold text-stone">{m.concernTypeLabel}</span>
                <Chip selected={!productType} onClick={() => setParam('type', null)}>{m.concernAllTypes}</Chip>
                {concern.productTypes.map((type) => (
                  <Chip key={type} selected={productType === type} onClick={() => setParam('type', productType === type ? null : type)}>
                    {productTypeLabel(type, locale)}
                  </Chip>
                ))}
              </>
            ) : null}
            <Chip selected={fragranceFree} onClick={() => setParam('ff', fragranceFree ? null : '1')}>{m.concernFragranceFree}</Chip>
          </div>
        </div>

        {recs.data && recs.data.needsSafetyAnswer.length > 0 && !safety ? (
          <MessageBox tone="warn" title={m.concernSafetyQuestion}>
            <p className="m-0">{m.concernSafetyHeld}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Chip onClick={() => setSafety('NO')}>{m.concernSafetyNo}</Chip>
              <Chip onClick={() => setSafety('PREGNANT')}>{m.concernSafetyPregnant}</Chip>
              <Chip onClick={() => setSafety('BREASTFEEDING')}>{m.concernSafetyBreastfeeding}</Chip>
            </div>
          </MessageBox>
        ) : null}

        {recs.isPending || !concern ? (
          <div className="grid grid-cols-1 gap-x-3 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-x-6">
            {Array.from({ length: 3 }, (_, i) => <ProductCardSkeleton key={i} />)}
          </div>
        ) : recs.isError ? (
          <MessageBox tone="err" title={m.concernLoadError}>
            <Button variant="ghost" size="s" onClick={() => recs.refetch()}>{m.tryAgain}</Button>
          </MessageBox>
        ) : items.length === 0 ? (
          <MessageBox tone="info" title={m.concernNoMatch}>
            {refined ? (
              <Button variant="ghost" size="s" onClick={() => router.replace(pathname, { scroll: false })}>{m.concernClearRefine}</Button>
            ) : (
              <ArrowLink href={routes.corner}>{m.concernBack}</ArrowLink>
            )}
          </MessageBox>
        ) : (
          <>
            <BasisLegend />
            <ul aria-busy={recs.isFetching} className="m-0 grid list-none grid-cols-1 gap-x-3 gap-y-8 p-0 sm:grid-cols-2 lg:grid-cols-3 lg:gap-x-6 lg:gap-y-12">
              {items.map((item, index) => (
                <li key={item.productId} className="flex flex-col gap-3">
                  <ProductCard product={recommendationToCard(item, locale)} priority={index < 3} />
                  <MatchReasons item={item} />
                </li>
              ))}
            </ul>
          </>
        )}

        {excluded.length > 0 ? (
          <details className="text-12.5 text-stone">
            <summary className="cursor-pointer font-semibold text-ink">
              {fillMessage(m.concernExcludedSummary, { n: formatNumber(excluded.length, locale) })}
            </summary>
            <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
              {excluded.map((e) => (
                <li key={`${e.productId}-${e.code}`}><bdi className="font-semibold text-ink">{e.name}</bdi>: {e.text}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </Section>

      {routines.data && routines.data.length > 0 ? (
        <Section labelledBy="concern-routines" band rhythm="tight">
          <SectionHeader title={m.concernRoutinesTitle} titleId="concern-routines" />
          <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
            {routines.data.slice(0, 2).map((routine) => (
              <li key={routine.id} className="flex flex-col gap-2 rounded-card border border-line bg-chalk p-4">
                <span className="font-display text-18 font-bold text-ink">{locale === 'en' && routine.titleEn ? routine.titleEn : routine.title}</span>
                {routine.description ? <p className="m-0 text-13 text-stone">{routine.description}</p> : null}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-12.5 text-stone">{fillMessage(m.concernRoutineSteps, { n: formatNumber(routine.steps, locale) })}</span>
                  <ArrowLink href={routes.routine(routine.id)}>{m.concernRoutineOpen}</ArrowLink>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {guide.data && (guide.data.ingredients.length > 0 || guide.data.whenToSeeAProfessional.length > 0 || guide.data.goodToKnow.length > 0) ? (
        <Section labelledBy="concern-knowledge" rhythm="tight">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-10">
            {guide.data.ingredients.length > 0 ? (
              <div className="flex flex-col gap-3">
                <h2 id="concern-knowledge" className="m-0 font-display text-22 font-bold text-ink">{m.concernIngredientsTitle}</h2>
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                  {guide.data.ingredients.map((entry) => <li key={entry.id}><SourcedStatement entry={entry} /></li>)}
                </ul>
              </div>
            ) : (
              <h2 id="concern-knowledge" className="sr-only">{m.concernProfessionalTitle}</h2>
            )}
            <div className="flex flex-col gap-6">
              {guide.data.whenToSeeAProfessional.length > 0 ? (
                <div className="flex flex-col gap-3">
                  <h3 className="m-0 font-display text-18 font-bold text-ink">{m.concernProfessionalTitle}</h3>
                  {guide.data.whenToSeeAProfessional.map((entry) => (
                    <MessageBox key={entry.id} tone="warn"><SourcedStatement entry={entry} /></MessageBox>
                  ))}
                </div>
              ) : null}
              {guide.data.goodToKnow.length > 0 ? (
                <div className="flex flex-col gap-3">
                  <h3 className="m-0 font-display text-18 font-bold text-ink">{m.concernGoodToKnow}</h3>
                  {guide.data.goodToKnow.map((entry) => <SourcedStatement key={entry.id} entry={entry} />)}
                </div>
              ) : null}
            </div>
          </div>
          <p className="m-0 text-12 text-stone">{m.concernSourcesNote}</p>
        </Section>
      ) : null}

      <Section labelledBy="concern-shina" band rhythm="tight">
        <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
          <div className="flex flex-col gap-1">
            <h2 id="concern-shina" className="m-0 font-display text-22 font-bold text-ink">{m.cornerAskShinaTitle}</h2>
            <p className="m-0 max-w-narrow text-body text-stone">{m.cornerAskShinaLead}</p>
          </div>
          <ChipLink href={routes.shinaFor({ concern: slug })} icon="sparkles">{m.concernAskShina}</ChipLink>
        </div>
      </Section>
    </>
  );
}

/** One knowledge statement with its source, and an honest note when no professional has reviewed it yet. */
function SourcedStatement({ entry, lead }: { entry: KnowledgeView; lead?: boolean }) {
  const m = useMessages();
  return (
    <div className="flex flex-col gap-1">
      <p className={lead ? 'm-0 max-w-narrow text-body text-ink' : 'm-0 text-14 leading-relaxed text-ink'}>{entry.statement}</p>
      <p className="m-0 text-12 text-stone">
        {entry.source.url ? (
          <Link href={entry.source.url} target="_blank" rel="noopener noreferrer" className="underline decoration-1 underline-offset-2 hover:text-cobalt">
            {fillMessage(m.concernOverviewSource, { source: entry.source.title })}
          </Link>
        ) : (
          fillMessage(m.concernOverviewSource, { source: entry.source.title })
        )}
        {' · '}
        {entry.professionallyReviewed ? m.concernReviewed : m.concernGeneralGuidance}
      </p>
    </div>
  );
}
