'use client';

import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Icon } from '@/components/ui/icon';
import { categoryLabel } from '@/features/catalog/lib/card-model';
import { formatNumber } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { routes, shellRoutes } from '@/lib/routes';
import { cn } from '@/lib/utils';

type Step = { slug: string; name: string; titleAr: string; desc: string };

const SKIN_STEPS: Step[] = [
  { slug: 'cleansers', name: 'Cleansers', titleAr: 'تنظيف لطيف', desc: 'موازنة الإفرازات دون تجريد الحاجز' },
  { slug: 'serums-treatments', name: 'Serums & Treatments', titleAr: 'سيروم علاجي', desc: 'تركيز مستهدف للمكونات الفعالة' },
  { slug: 'moisturizers', name: 'Moisturizers', titleAr: 'ترميم وترطيب', desc: 'حبس الرطوبة ودعم مرونة الجلد' },
  { slug: 'sunscreens', name: 'Sunscreens', titleAr: 'حماية قصوى', desc: 'وقاية يومية واسعة ضد الأشعة' },
];

const HAIR_STEPS: Step[] = [
  { slug: 'shampoos', name: 'Shampoos', titleAr: 'تنقية الفروة', desc: 'إزالة الرواسب والحفاظ على التوازن' },
  { slug: 'conditioners', name: 'Conditioners', titleAr: 'ترطيب الألياف', desc: 'تنعيم الخصلات وسهولة التصفيف' },
  { slug: 'hair-treatments-styling', name: 'Hair Treatments', titleAr: 'علاج وتغذية', desc: 'تقوية البصيلات والوقاية من التلف' },
];

/**
 * Modern Beauty Editorial: Curated Routines
 * Replaces dense software-dashboard cards with an editorial regimen guide.
 * Features clear purpose, concise steps, and direct commerce links.
 */
export function RoutineSection() {
  const locale = useLocale();
  const m = useMessages();

  const routines = [
    {
      id: 'skin',
      tag: 'DAILY SKINCARE PROTOCOL',
      title: m.homeRoutineSkinTitle,
      body: m.homeRoutineSkinBody,
      steps: SKIN_STEPS,
      detailHref: routes.routineDetail('morning-radiance'),
      builderHref: `${routes.routineBuilder}?template=morning-radiance`,
    },
    {
      id: 'hair',
      tag: 'HAIR WELLNESS PROTOCOL',
      title: m.homeRoutineHairTitle,
      body: m.homeRoutineHairBody,
      steps: HAIR_STEPS,
      detailHref: routes.routineDetail('frizz-curl-definition'),
      builderHref: `${routes.routineBuilder}?template=frizz-curl-definition`,
    },
  ];

  return (
    <section aria-labelledby="home-routine-title" className="border-t border-line bg-sand/30 py-12 lg:py-16">
      <PageContainer className="flex flex-col gap-8 lg:gap-10">
        {/* Header */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-cobalt" />
              <span className="font-serif italic text-14 text-stone">Curated Regimens</span>
            </div>
            <h2 id="home-routine-title" className="m-0 font-display text-24 font-black tracking-tight text-ink sm:text-28 lg:text-34">
              {m.homeRoutineTitle}
            </h2>
            <p className="m-0 max-w-xl text-14 leading-22 text-stone lg:text-15 lg:leading-24">
              {m.homeRoutineBody}
            </p>
          </div>

          <Link
            href={shellRoutes.routines}
            className="group inline-flex items-center gap-1.5 self-start font-serif italic text-14 font-bold text-cobalt transition-colors hover:text-ink sm:self-auto"
          >
            <span>{m.homeRoutinesAll}</span>
            <Icon name="arrow-forward" size={16} className="transition-transform group-hover:translate-x-[-2px] rtl:group-hover:translate-x-[2px]" />
          </Link>
        </div>

        {/* Regimen Cards Grid */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {routines.map((r) => (
            <article
              key={r.id}
              className="flex flex-col justify-between rounded-card border border-line bg-linen p-6 shadow-e1 transition-all duration-base hover:shadow-e2 sm:p-8"
            >
              <div className="flex flex-col gap-6">
                {/* Protocol Header */}
                <div className="flex flex-col gap-2 border-b border-line pb-5">
                  <span className="font-serif italic text-13 tracking-wider text-stone">
                    {r.tag}
                  </span>
                  <h3 className="m-0 font-display text-22 font-extrabold text-ink sm:text-26">
                    {r.title}
                  </h3>
                  <p className="m-0 text-13.5 leading-22 text-stone sm:text-14 sm:leading-24">
                    {r.body}
                  </p>
                </div>

                {/* Steps Timeline */}
                <ol className="m-0 flex list-none flex-col gap-3.5 p-0">
                  {r.steps.map((st, idx) => (
                    <li key={st.slug} className="flex items-start gap-3.5">
                      <span className="mt-0.5 flex size-6 flex-none items-center justify-center rounded-full bg-sand font-display text-11.5 font-bold text-ink">
                        {formatNumber(idx + 1, locale)}
                      </span>
                      <div className="flex flex-col gap-0.5">
                        <Link
                          href={routes.productsByCategory(st.slug)}
                          className="font-display text-14 font-bold text-ink hover:text-cobalt transition-colors"
                        >
                          {st.titleAr} <span className="font-sans text-11.5 font-normal text-stone">({st.name})</span>
                        </Link>
                        <span className="text-12 leading-18 text-stone">
                          {st.desc}
                        </span>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Protocol CTA Row */}
              <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
                <Link
                  href={r.detailHref}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-pill bg-ink px-5 text-13 font-bold text-chalk shadow-e1 transition-all hover:bg-cobalt active:scale-95"
                >
                  <span>استكشاف الروتين</span>
                  <Icon name="arrow-forward" size={16} />
                </Link>

                <Link
                  href={r.builderHref}
                  className="inline-flex items-center gap-1.5 font-medium text-12.5 text-stone hover:text-cobalt transition-colors"
                >
                  <span>تخصيص في أداة البناء</span>
                  <Icon name="arrow-forward" size={14} />
                </Link>
              </div>
            </article>
          ))}
        </div>
      </PageContainer>
    </section>
  );
}
