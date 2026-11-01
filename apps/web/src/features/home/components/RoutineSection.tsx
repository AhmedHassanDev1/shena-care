'use client';

import Link from 'next/link';
import { Section, SectionHeader } from '@/components/layout/section';
import { Icon } from '@/components/ui/icon';
import { categoryLabel } from '@/features/catalog/lib/card-model';
import { ROUTINE_ORDER } from '@/features/catalog/lib/routine-order';
import { formatNumber } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { routes, shellRoutes } from '@/lib/routes';

const SKIN_STEPS = ROUTINE_ORDER.skin.steps;
const HAIR_STEPS = ROUTINE_ORDER.hair.steps;

/**
 * Two ready-made routine outlines. A routine is an order of steps, so the steps are numbered; each step names a real
 * catalog category and links to it. No per-step efficacy claims: the catalog has none to back them.
 */
export function RoutineSection() {
  const locale = useLocale();
  const m = useMessages();

  const routines = [
    {
      id: 'skin',
      title: m.homeRoutineSkinTitle,
      meta: fillMessage(m.homeRoutineSkinMeta, { n: formatNumber(SKIN_STEPS.length, locale) }),
      body: m.homeRoutineSkinBody,
      steps: SKIN_STEPS,
      detailHref: routes.routineDetail('morning-radiance'),
      builderHref: `${routes.routineBuilder}?template=morning-radiance`,
    },
    {
      id: 'hair',
      title: m.homeRoutineHairTitle,
      meta: fillMessage(m.homeRoutineHairMeta, { n: formatNumber(HAIR_STEPS.length, locale) }),
      body: m.homeRoutineHairBody,
      steps: HAIR_STEPS,
      detailHref: routes.routineDetail('frizz-curl-definition'),
      builderHref: `${routes.routineBuilder}?template=frizz-curl-definition`,
    },
  ];

  return (
    <Section labelledBy="home-routine-title" band>
      <SectionHeader
        title={m.homeRoutineTitle}
        titleId="home-routine-title"
        lead={m.homeRoutineBody}
        aside={
          <Link href={shellRoutes.routines} className="link-quiet inline-flex items-center gap-1.5 text-14 font-bold text-ink">
            <span>{m.homeRoutinesAll}</span>
            <Icon name="arrow-forward" size={16} />
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
        {routines.map((r) => (
          <article key={r.id} className="flex flex-col rounded-card bg-chalk p-5 shadow-outline-hairline sm:p-7">
            <p className="m-0 text-13 font-semibold text-stone">{r.meta}</p>
            <h3 className="m-0 mt-1 font-display text-26 font-extrabold text-ink lg:text-28">{r.title}</h3>
            <p className="m-0 mt-2 max-w-md text-15 leading-24 text-stone">{r.body}</p>

            <ol className="m-0 mt-5 flex list-none flex-col p-0">
              {r.steps.map((st, idx) => (
                <li key={st.slug} className="shadow-hairline-top">
                  <Link
                    href={routes.productsByCategory(st.slug)}
                    className="group flex min-h-12 items-center gap-3.5 py-2 text-ink no-underline"
                  >
                    <span className="flex size-7 flex-none items-center justify-center rounded-full bg-sand font-display text-13 font-bold tabular-nums">
                      {formatNumber(idx + 1, locale)}
                    </span>
                    <span className="flex-1 font-display text-16 font-bold transition-colors duration-fast group-hover:text-cobalt">
                      {categoryLabel(st, locale)}
                    </span>
                    <Icon name="arrow-forward" size={16} className="text-stone transition-colors duration-fast group-hover:text-cobalt" />
                  </Link>
                </li>
              ))}
            </ol>

            <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-3 pt-6">
              <Link
                href={r.detailHref}
                className="inline-flex h-control-s items-center justify-center gap-2 rounded-pill bg-ink px-5 text-14 font-bold text-chalk shadow-elevation-1 transition-colors duration-fast hover:bg-cobalt"
              >
                {m.homeRoutineOpen}
              </Link>
              <Link href={r.builderHref} className="link-quiet text-14 font-semibold text-ink">
                {m.homeRoutineCustomize}
              </Link>
            </div>
          </article>
        ))}
      </div>
    </Section>
  );
}
