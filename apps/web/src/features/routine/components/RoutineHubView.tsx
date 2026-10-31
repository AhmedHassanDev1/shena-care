'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Icon } from '@/components/ui/icon';
import { buttonVariants } from '@/components/ui/button';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { CURATED_ROUTINES, type CuratedRoutine } from '../data/curatedRoutines';
import { getSavedCustomerRoutine, type CustomerSavedRoutine } from '../lib/routineStorage';

export function RoutineHubView() {
  const [activeTab, setActiveTab] = useState<'all' | 'skin' | 'hair'>('all');
  const [savedRoutine, setSavedRoutine] = useState<CustomerSavedRoutine | null>(null);

  useEffect(() => {
    setSavedRoutine(getSavedCustomerRoutine());
  }, []);

  const filteredRoutines = activeTab === 'all'
    ? CURATED_ROUTINES
    : CURATED_ROUTINES.filter((r) => r.category === activeTab);

  return (
    <div
      data-ui-status="verified-pillar"
      data-route="/routines"
      className="flex flex-col gap-10 pb-24 pt-6 lg:gap-14"
    >
      <PageContainer className="flex flex-col gap-8">
        {/* Header */}
        <header className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="size-2 rounded-full bg-cobalt animate-pulse" />
            <span className="font-serif italic text-14 text-stone">Care Architecture</span>
            <span aria-hidden="true" className="text-stone/40">•</span>
            <span className="text-12 font-semibold text-cobalt">دليل الروتينات المعتمدة</span>
          </div>
          <h1 className="m-0 font-display text-28 font-black leading-tight text-ink sm:text-36 lg:text-44">
            دليل الروتينات والعناية المتكاملة
          </h1>
          <p className="m-0 max-w-2xl text-14.5 leading-24 text-stone sm:text-16 sm:leading-28">
            استكشفي بروتوكولات العناية الجاهزة المُعدة بواسطة خبراء العناية وفق مستحضرات الكتالوج الحقيقية، أو استخدمي أداة بناء الروتين لتصميم روتين مفصل لاحتياجاتك.
          </p>
        </header>

        {/* Prioritized Saved Routine Banner (Only if customer has an actual saved routine) */}
        {savedRoutine ? (
          <section
            aria-labelledby="saved-routine-banner-title"
            className="flex flex-col gap-4 rounded-card border border-line bg-linen p-5 shadow-e1 sm:flex-row sm:items-center sm:justify-between sm:p-6"
          >
            <div className="flex items-center gap-4">
              <span className="flex size-12 flex-none items-center justify-center rounded-full bg-cobalt text-chalk shadow-e1">
                <Icon name="routine" size={24} />
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="text-11.5 font-bold text-cobalt">روتينك النشط المحفوظ</span>
                <h2 id="saved-routine-banner-title" className="m-0 font-display text-17 font-bold text-ink">
                  {savedRoutine.title}
                </h2>
                <span className="text-12.5 text-stone">
                  {savedRoutine.morningSteps.length + savedRoutine.eveningSteps.length} خطوات يومية متابعة • حفظ في {new Date(savedRoutine.savedAt).toLocaleDateString('ar-EG')}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-auto">
              <Link
                href={routes.myRoutine}
                className={cn(buttonVariants({ variant: 'ink', size: 'm' }), 'font-bold shadow-e1')}
              >
                <span>متابعة روتيني اليومي</span>
                <Icon name="arrow-forward" size={16} />
              </Link>
            </div>
          </section>
        ) : null}

        {/* Interactive Routine Builder Invitation Card */}
        <section
          aria-labelledby="builder-invite-title"
          className="flex flex-col justify-between gap-6 rounded-card border border-line bg-linen p-6 shadow-e1 transition-all duration-base hover:shadow-e2 sm:p-8 lg:flex-row lg:items-center"
        >
          <div className="flex max-w-xl flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-sand text-ink">
                ✨
              </span>
              <span className="font-serif italic text-13 text-stone">Personalized Diagnostics</span>
            </div>
            <h2 id="builder-invite-title" className="m-0 font-display text-22 font-extrabold text-ink sm:text-26">
              تريدين روتيناً مصمماً خصيصاً لاحتياجك؟
            </h2>
            <p className="m-0 text-13.5 leading-22 text-stone sm:text-14 sm:leading-24">
              أجيبي عن أسئلة بسيطة حول نوع بشرتك أو شعرك، أهدافك المحددة، وميزانيتك لنقترح لك خطوات متوازنة ومنتجات حقيقية يمكنك مراجعتها وتعديلها بحرية.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={routes.routineBuilder}
              className={cn(buttonVariants({ variant: 'ink', size: 'l' }), 'font-bold shadow-e1')}
            >
              <span>ابني روتينك المخصص الآن</span>
              <Icon name="arrow-forward" size={18} />
            </Link>
          </div>
        </section>

        {/* Category Tabs Switcher */}
        <div className="flex items-center justify-between border-b border-line pb-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={cn(
                'rounded-full px-4 py-2 text-13 font-bold transition-all',
                activeTab === 'all'
                  ? 'bg-ink text-chalk shadow-e1'
                  : 'bg-sand/60 text-stone hover:bg-sand hover:text-ink'
              )}
            >
              جميع الروتينات ({CURATED_ROUTINES.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('skin')}
              className={cn(
                'rounded-full px-4 py-2 text-13 font-bold transition-all',
                activeTab === 'skin'
                  ? 'bg-ink text-chalk shadow-e1'
                  : 'bg-sand/60 text-stone hover:bg-sand hover:text-ink'
              )}
            >
              روتينات البشرة (٣)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('hair')}
              className={cn(
                'rounded-full px-4 py-2 text-13 font-bold transition-all',
                activeTab === 'hair'
                  ? 'bg-ink text-chalk shadow-e1'
                  : 'bg-sand/60 text-stone hover:bg-sand hover:text-ink'
              )}
            >
              روتينات الشعر (٢)
            </button>
          </div>

          <span className="hidden text-12 text-stone sm:inline">
            مستحضرات صيدلانية معتمدة من الكتالوج
          </span>
        </div>

        {/* Curated Routine Cards Grid */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredRoutines.map((routine) => (
            <article
              key={routine.slug}
              className="flex flex-col justify-between rounded-card border border-line bg-linen p-6 shadow-e1 transition-all duration-base hover:-translate-y-1 hover:shadow-e2"
            >
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-2 border-b border-line/60 pb-3">
                  <span className="rounded-full bg-sand px-2.5 py-0.5 text-11 font-bold text-ink">
                    {routine.category === 'skin' ? '🧴 عناية بالبشرة' : '✨ عناية بالشعر'}
                  </span>
                  <span className="text-11.5 font-semibold text-cobalt">
                    {routine.protocolBadgeAr}
                  </span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <h3 className="m-0 font-display text-19 font-extrabold leading-snug text-ink">
                    {routine.titleAr}
                  </h3>
                  <span className="font-serif italic text-12.5 text-stone">
                    {routine.titleEn}
                  </span>
                  <p className="m-0 line-clamp-3 text-13 leading-20 text-stone pt-1">
                    {routine.taglineAr}
                  </p>
                </div>

                {/* Steps Mini Preview */}
                <div className="flex flex-col gap-2 rounded-card bg-chalk p-3.5">
                  <span className="text-11.5 font-bold text-stone">
                    تسلسل خطوات البروتوكول:
                  </span>
                  <ol className="m-0 flex list-none flex-col gap-1.5 p-0 text-12 text-ink">
                    {routine.steps.map((st) => (
                      <li key={st.id} className="flex items-center gap-2">
                        <span className="flex size-4.5 flex-none items-center justify-center rounded-full bg-sand font-display text-10 font-bold text-ink">
                          {st.num}
                        </span>
                        <span className="truncate font-medium">{st.roleAr}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>

              {/* Card Footer Actions */}
              <div className="mt-6 flex items-center justify-between gap-3 border-t border-line/70 pt-4">
                <div className="flex flex-col">
                  <span className="text-10.5 text-stone">إجمالي المستحضرات</span>
                  <span className="font-display text-15 font-bold text-ink">
                    {routine.totalPrice} ج.م
                  </span>
                </div>

                <Link
                  href={routes.routineDetail(routine.slug)}
                  className={cn(buttonVariants({ variant: 'ink', size: 's' }), 'font-bold shadow-e1')}
                >
                  <span>استكشاف الروتين</span>
                  <Icon name="arrow-forward" size={14} />
                </Link>
              </div>
            </article>
          ))}
        </div>
      </PageContainer>
    </div>
  );
}
