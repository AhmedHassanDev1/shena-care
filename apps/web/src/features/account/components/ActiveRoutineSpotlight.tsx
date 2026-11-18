'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { GlassBadge } from '@/components/ui/glass-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { listRoutines, getRoutine, type RoutineListItem, type SavedRoutineView } from '@/features/my-routines/api/personal-routines';
import { useMessages, useLocale } from '@/lib/i18n/LocaleProvider';
import { formatNumber } from '@/lib/i18n/format';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';

interface ActiveRoutineSpotlightProps {
  isAuthenticated: boolean;
}

export function ActiveRoutineSpotlight({ isAuthenticated }: ActiveRoutineSpotlightProps) {
  const m = useMessages();
  const locale = useLocale();

  const routinesListQuery = useQuery({
    queryKey: ['personal-routines'],
    queryFn: () => listRoutines(),
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  const routines = routinesListQuery.data || [];
  const latestRoutineSummary: RoutineListItem | undefined = routines[0];

  const routineDetailsQuery = useQuery({
    queryKey: ['personal-routine-details', latestRoutineSummary?.id],
    queryFn: () => getRoutine(latestRoutineSummary!.id),
    enabled: Boolean(latestRoutineSummary?.id),
    staleTime: 60_000,
  });

  const routine: SavedRoutineView | undefined = routineDetailsQuery.data;

  if (routinesListQuery.isLoading) {
    return (
      <div className="routine-glass rounded-card p-6 md:p-8">
        <Skeleton className="h-6 w-40 rounded-pill" />
        <Skeleton className="mt-4 h-28 w-full rounded-card" />
      </div>
    );
  }

  if (!latestRoutineSummary) {
    return (
      <section
        aria-label={m.profileActiveRoutineTitle}
        className="routine-glass relative overflow-hidden rounded-card p-6 md:p-8"
      >
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-3">
            <span className="flex items-center gap-2 font-display text-17 font-bold text-ink">
              <Icon name="routine" size={20} className="text-cobalt" />
              <span>{m.profileActiveRoutineTitle}</span>
            </span>
            <p className="m-0 max-w-xl text-15 leading-relaxed text-stone">
              {m.profileActiveRoutineEmpty}
            </p>
          </div>

          <Link
            href="/routines/build"
            className="inline-flex h-control-m items-center justify-center gap-2 rounded-pill bg-cobalt px-6 font-display text-14 font-semibold text-chalk shadow-elevation-1 transition-colors hover:bg-cobalt-deep"
          >
            <Icon name="plus" size={16} />
            <span>{m.profileBuildRoutineAction}</span>
          </Link>
        </div>
      </section>
    );
  }

  const morningSteps = routine?.steps?.filter((s) => s.timing === 'AM' || s.timing === 'AS_NEEDED') || [];
  const eveningSteps = routine?.steps?.filter((s) => s.timing === 'PM') || [];

  return (
    <section
      aria-label={m.profileActiveRoutineTitle}
      className="routine-glass relative overflow-hidden rounded-card p-6 md:p-8"
    >
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <GlassBadge tone="quiet">
              <span className="flex items-center gap-1 font-display text-12 font-semibold text-cobalt">
                <Icon name="routine" size={13} />
                <span>{latestRoutineSummary.careArea === 'skin' ? 'روتين البشرة' : 'روتين الشعر'}</span>
              </span>
            </GlassBadge>

            <span className="rounded-pill bg-linen/90 px-2.5 py-0.5 text-12 font-medium text-stone shadow-elevation-1">
              {fillMessage(m.profileMorningStepsCount, { n: formatNumber(morningSteps.length, locale) })}
            </span>
            <span className="rounded-pill bg-linen/90 px-2.5 py-0.5 text-12 font-medium text-stone shadow-elevation-1">
              {fillMessage(m.profileEveningStepsCount, { n: formatNumber(eveningSteps.length, locale) })}
            </span>
          </div>

          <h3 className="m-0 font-display text-display-3 font-bold text-ink">
            {latestRoutineSummary.title}
          </h3>

          <p className="m-0 text-14 text-stone">
            {m.profileActiveRoutineSubtitle}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/account/routine/${encodeURIComponent(latestRoutineSummary.id)}`}
            className="inline-flex h-control-s items-center justify-center gap-1.5 rounded-pill border border-line bg-linen px-4 font-display text-13 font-semibold text-ink shadow-elevation-1 hover:bg-sand/40"
          >
            <span>{m.profileViewFullRoutine}</span>
            <Icon name="arrow-forward" size={14} />
          </Link>

          <Link
            href={`/account/routine/${encodeURIComponent(latestRoutineSummary.id)}?edit=1`}
            className="inline-flex h-control-s items-center justify-center gap-1.5 rounded-pill border border-line bg-linen px-3.5 font-display text-13 font-medium text-stone hover:text-ink"
          >
            <Icon name="pencil" size={13} />
            <span>{m.profileEditAction}</span>
          </Link>
        </div>
      </div>

      {/* Routine Steps Preview */}
      {routine?.steps && routine.steps.length > 0 ? (
        <div className="mt-6 border-t border-line/60 pt-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
            {routine.steps.slice(0, 6).map((step, idx) => (
              <div
                key={step.id || idx}
                className="flex items-center gap-3 rounded-input border border-line/70 bg-linen/90 p-3 shadow-elevation-1"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-pill bg-sand/70 font-display text-12 font-bold text-ink">
                  {formatNumber(idx + 1, locale)}
                </span>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-display text-13 font-semibold text-ink">
                    {step.title}
                  </span>
                  {step.product?.productName ? (
                    <span className="truncate text-11 text-stone">
                      {step.product.brandName ? `${step.product.brandName} · ` : ''}
                      {step.product.productName}
                    </span>
                  ) : (
                    <span className="text-11 text-stone/80">
                      {step.timing === 'AM' ? 'خطوة صباحية' : 'خطوة مسائية'}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {routine.steps.length > 6 ? (
            <div className="mt-3 text-start">
              <Link
                href={`/account/routine/${encodeURIComponent(latestRoutineSummary.id)}`}
                className="text-12 font-medium text-cobalt hover:underline"
              >
                + {formatNumber(routine.steps.length - 6, locale)} خطوات أخرى في الروتين الكامل
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
