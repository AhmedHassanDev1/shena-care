'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Button, buttonVariants } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Icon } from '@/components/ui/icon';
import { ProductTile } from '@/components/ui/product-tile';
import { Skeleton } from '@/components/ui/skeleton';
import { formatEgp, formatNumber } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { CURATED_ROUTINES, type CuratedRoutine } from '../data/curatedRoutines';
import { useRoutineProducts, type RoutineProducts } from '../hooks/useRoutineProducts';
import { getSavedCustomerRoutine, type CustomerSavedRoutine } from '../lib/routineStorage';

type Group = 'all' | CuratedRoutine['category'];

/**
 * Routine discovery. Each card shows the routine's real products (photo, live price) in step order; the routine file
 * only says which product sits in which step. The builder entry is a plain invitation: the questions and the engine
 * live in the builder, so nothing here promises a result.
 */
export function RoutineHubView() {
  const m = useMessages();
  const locale = useLocale();
  const [group, setGroup] = useState<Group>('all');
  const [saved, setSaved] = useState<CustomerSavedRoutine | null>(null);
  const products = useRoutineProducts(CURATED_ROUTINES);

  useEffect(() => setSaved(getSavedCustomerRoutine()), []);

  const visible = useMemo(() => (group === 'all' ? CURATED_ROUTINES : CURATED_ROUTINES.filter((r) => r.category === group)), [group]);
  const count = (g: Group) => formatNumber(g === 'all' ? CURATED_ROUTINES.length : CURATED_ROUTINES.filter((r) => r.category === g).length, locale);

  return (
    <PageContainer className="flex flex-col gap-8 pb-16 pt-6 lg:gap-10 lg:pt-10">
      <header className="flex flex-col gap-3 lg:max-w-narrow">
        <h1 className="m-0 text-balance font-display text-40 font-extrabold leading-tight text-ink lg:text-52">{m.routinesPageTitle}</h1>
        <p className="m-0 text-pretty text-16 leading-28 text-stone lg:text-18 lg:leading-32">{m.routinesLead}</p>
      </header>

      {saved ? (
        <section aria-labelledby="saved-routine-title" className="flex flex-col gap-4 rounded-card bg-linen p-5 shadow-outline-hairline sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex flex-col gap-0.5">
            <h2 id="saved-routine-title" className="m-0 font-display text-18 font-bold text-ink">
              {m.routinesSavedTitle}
            </h2>
            <p className="m-0 text-14 text-stone">
              {saved.title} · {fillMessage(m.routinesSavedMeta, { n: formatNumber(saved.morningSteps.length + saved.eveningSteps.length, locale) })}
            </p>
          </div>
          <Link href={routes.myRoutine} className={cn(buttonVariants({ variant: 'ink', size: 'm' }), 'self-start sm:self-auto')}>
            {m.routinesSavedCta}
          </Link>
        </section>
      ) : null}

      <div role="group" aria-label={m.routinesGroupLabel} className="-mx-4 flex gap-2 overflow-x-auto px-4 py-1 scrollbar-none lg:mx-0 lg:px-0">
        <Chip selected={group === 'all'} count={count('all')} onClick={() => setGroup('all')}>
          {m.plpAll}
        </Chip>
        <Chip selected={group === 'skin'} count={count('skin')} onClick={() => setGroup('skin')}>
          {m.navSkin}
        </Chip>
        <Chip selected={group === 'hair'} count={count('hair')} onClick={() => setGroup('hair')}>
          {m.navHair}
        </Chip>
      </div>

      {visible.length === 0 ? (
        <p role="status" className="m-0 rounded-card bg-linen px-6 py-10 text-center text-15 text-stone shadow-outline-hairline">
          {m.routinesEmpty}
        </p>
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-2 lg:grid-cols-3 lg:gap-6">
          {visible.map((routine) => (
            <li key={routine.slug} className="flex">
              <RoutineCard routine={routine} resolved={products.get(routine.slug)} />
            </li>
          ))}
        </ul>
      )}

      <section aria-labelledby="builder-title" className="flex flex-col gap-5 rounded-card bg-ink p-6 text-chalk sm:p-8 lg:flex-row lg:items-center lg:justify-between lg:p-10">
        <div className="flex max-w-xl flex-col gap-2">
          <h2 id="builder-title" className="m-0 font-display text-28 font-extrabold leading-tight text-chalk lg:text-34">
            {m.routinesBuildTitle}
          </h2>
          <p className="m-0 text-15 leading-26 text-chalk/80 lg:text-16">{m.routinesBuildBody}</p>
        </div>
        <Link href={routes.routineBuilder} className={cn(buttonVariants({ variant: 'onDark', size: 'l' }), 'self-start lg:self-auto')}>
          <span>{m.routinesBuildCta}</span>
          <Icon name="arrow-forward" size={18} />
        </Link>
      </section>
    </PageContainer>
  );
}

function RoutineCard({ routine, resolved }: { routine: CuratedRoutine; resolved: RoutineProducts | undefined }) {
  const m = useMessages();
  const locale = useLocale();
  const title = locale === 'ar' ? routine.titleAr : routine.titleEn;
  const steps = resolved?.steps ?? [];
  const total = resolved?.total ?? null;
  const failed = steps.find((s) => s.state === 'error');

  return (
    <article className="flex w-full flex-col gap-4 rounded-card bg-linen p-4 shadow-outline-hairline transition-shadow duration-base ease-standard hover:shadow-elevation-2 sm:p-5">
      {/* The routine's products in step order: real packshots, or a labelled placeholder */}
      <ol className="m-0 grid list-none gap-2 p-0" style={{ gridTemplateColumns: `repeat(${routine.steps.length}, minmax(0, 1fr))` }}>
        {routine.steps.map((step, index) => {
          const entry = steps[index];
          return (
            <li key={step.id} className="min-w-0">
              {entry?.state === 'loading' || !entry ? (
                <Skeleton className="aspect-square w-full rounded-image" />
              ) : (
                <ProductTile
                  src={entry.imageUrl}
                  alt={entry.imageAlt}
                  name={step.productName}
                  size="thumb"
                  sizes="(min-width: 1024px) 110px, 22vw"
                  className={cn('aspect-square w-full', !entry.orderable && '[&_img]:opacity-45 [&_img]:grayscale')}
                />
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col gap-1.5">
        <p className="m-0 text-13 font-semibold text-stone">
          {routine.category === 'skin' ? m.navSkin : m.navHair} · {fillMessage(m.routineStepsCount, { n: formatNumber(routine.steps.length, locale) })}
        </p>
        <h2 className="m-0 font-display text-22 font-extrabold leading-snug text-ink">{title}</h2>
        {locale === 'ar' ? <p className="m-0 line-clamp-2 text-14 leading-22 text-stone">{routine.taglineAr}</p> : null}
      </div>

      <ol className="m-0 flex list-none flex-col p-0">
        {routine.steps.map((step, index) => (
          <li key={step.id} className="flex min-h-10 items-center gap-3 py-1.5 shadow-hairline-top">
            <span className="flex size-6 flex-none items-center justify-center rounded-full bg-sand font-display text-12 font-bold tabular-nums text-ink">
              {formatNumber(index + 1, locale)}
            </span>
            <span className="min-w-0 truncate text-14 font-semibold text-ink">{locale === 'ar' ? step.roleAr : step.roleEn}</span>
          </li>
        ))}
      </ol>

      <div className="mt-auto flex flex-col gap-3 pt-2">
        {failed ? (
          <p role="alert" className="m-0 flex flex-wrap items-center gap-x-3 text-13 text-tomato-ink">
            {m.routineProductError}
            <Button variant="text" size="s" onClick={failed.retry} className="text-13 font-semibold">
              {m.tryAgain}
            </Button>
          </p>
        ) : null}
        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-col">
            <span className="text-12 text-stone">{m.routineTotalLabel}</span>
            {total !== null ? (
              <span className="font-display text-20 font-extrabold tabular-nums text-ink">
                <bdi>{formatEgp(total, 'EGP', locale)}</bdi>
              </span>
            ) : resolved?.settled ? (
              <span className="text-14 text-stone">—</span>
            ) : (
              <Skeleton className="mt-1 h-6 w-24 rounded-4" />
            )}
          </div>
          <Link href={routes.routineDetail(routine.slug)} className={buttonVariants({ variant: 'ink', size: 's' })}>
            {m.homeRoutineOpen}
          </Link>
        </div>
      </div>
    </article>
  );
}
