'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageContainer } from '@/components/layout/page-container';
import { Icon } from '@/components/ui/icon';
import { Button, buttonVariants } from '@/components/ui/button';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { useCart } from '@/features/cart/hooks/useCart';
import { type CuratedRoutine, getCuratedRoutineBySlug } from '../data/curatedRoutines';

export function RoutineDetailView({ slug }: { slug: string }) {
  const router = useRouter();
  const { addItem } = useCart();
  const routine = getCuratedRoutineBySlug(slug);
  const [addingAll, setAddingAll] = useState(false);
  const [addedAllSuccess, setAddedAllSuccess] = useState(false);
  const [addedSku, setAddedSku] = useState<string | null>(null);

  if (!routine) {
    return (
      <PageContainer className="flex flex-col items-center justify-center gap-4 py-24 text-center">
        <h1 className="font-display text-24 font-bold text-ink">الروتين المطلوب غير متوفر</h1>
        <p className="text-14 text-stone">تعذر العثور على بروتوكول العناية المحدد.</p>
        <Link href={routes.routines} className={buttonVariants({ variant: 'ink', size: 'm' })}>
          العودة لدليل الروتينات
        </Link>
      </PageContainer>
    );
  }

  const handleAddSingleProduct = async (skuId: string) => {
    try {
      setAddedSku(skuId);
      await addItem({ skuId, quantity: 1 });
      setTimeout(() => setAddedSku(null), 2000);
    } catch {
      setAddedSku(null);
    }
  };

  const handleAddAllToCart = async () => {
    try {
      setAddingAll(true);
      for (const step of routine.steps) {
        if (step.skuId) {
          await addItem({ skuId: step.skuId, quantity: 1 });
        }
      }
      setAddedAllSuccess(true);
      setTimeout(() => setAddedAllSuccess(false), 2500);
    } catch {
      // Handle cart error
    } finally {
      setAddingAll(false);
    }
  };

  return (
    <div
      data-ui-status="verified-pillar"
      data-route={`/routines/${slug}`}
      className="flex flex-col gap-10 pb-28 pt-4 lg:gap-14 lg:pt-6"
    >
      <PageContainer className="flex flex-col gap-8">
        {/* Breadcrumb Navigation */}
        <nav aria-label="مسار التنقل" className="flex items-center gap-2 text-12 text-stone">
          <Link href={routes.home} className="hover:text-ink transition-colors">الرئيسية</Link>
          <span aria-hidden="true">/</span>
          <Link href={routes.routines} className="hover:text-ink transition-colors">دليل الروتينات</Link>
          <span aria-hidden="true">/</span>
          <span className="font-semibold text-ink">{routine.titleAr}</span>
        </nav>

        {/* Routine Hero Header */}
        <header className="flex flex-col gap-4 rounded-card border border-line bg-linen p-6 shadow-e1 sm:p-8">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-sand px-3 py-1 text-12 font-bold text-ink">
              {routine.category === 'skin' ? '🧴 عناية بالبشرة' : '✨ عناية بالشعر'}
            </span>
            <span className="rounded-full bg-citron px-3 py-1 text-12 font-bold text-ink">
              {routine.protocolBadgeAr}
            </span>
            <span className="text-12 text-stone ms-auto">
              {routine.steps.length} خطوات متتالية
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <h1 className="m-0 font-display text-26 font-black leading-tight text-ink sm:text-34 lg:text-40">
              {routine.titleAr}
            </h1>
            <span className="font-serif italic text-14 text-stone sm:text-15">
              {routine.titleEn}
            </span>
            <p className="m-0 max-w-3xl text-14.5 leading-24 text-stone sm:text-15 sm:leading-26 pt-2">
              {routine.descriptionAr}
            </p>
          </div>

          {/* Action Row */}
          <div className="flex flex-wrap items-center gap-3 border-t border-line/70 pt-5">
            <Link
              href={`${routes.routineBuilder}?template=${routine.slug}`}
              className={cn(buttonVariants({ variant: 'ghost', size: 'l' }), 'font-bold')}
            >
              <Icon name="sparkles" size={18} />
              <span>تخصيص هذا الروتين في أداة البناء</span>
            </Link>

            <Button
              variant="ink"
              size="l"
              onClick={handleAddAllToCart}
              disabled={addingAll}
              className="font-bold shadow-e1"
            >
              {addedAllSuccess ? 'تمت إضافة جميع المستحضرات ✓' : addingAll ? 'جاري الإضافة...' : `إضافة كل المستحضرات للسلة (${routine.totalPrice} ج.م)`}
            </Button>
          </div>
        </header>

        {/* Ordered Steps Breakdown */}
        <section aria-labelledby="steps-breakdown-title" className="flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <h2 id="steps-breakdown-title" className="m-0 font-display text-22 font-extrabold text-ink sm:text-26">
              تفاصيل تسلسل الخطوات والمستحضرات المعتمدة
            </h2>
            <p className="m-0 text-13.5 text-stone">
              تم اختيار كل مستحضر وفق معايير التوافق الحيوي والترتيب الصحيح لامتصاص المكونات الفعالة.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            {routine.steps.map((st, idx) => (
              <article
                key={st.id}
                className="flex flex-col justify-between gap-5 rounded-card border border-line bg-linen p-5 shadow-e1 transition-all duration-base hover:shadow-e2 sm:p-6 lg:flex-row lg:items-center"
              >
                <div className="flex items-start gap-4">
                  <span className="flex size-11 flex-none items-center justify-center rounded-full bg-sand font-display text-16 font-black text-ink shadow-e1">
                    {st.num}
                  </span>

                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-sand/70 px-2.5 py-0.5 text-11.5 font-bold text-ink">
                        {st.roleAr}
                      </span>
                      <span className="text-11.5 text-stone">({st.roleEn})</span>
                      <span className="rounded-full bg-sand px-2.5 py-0.5 text-11.5 font-semibold text-ink">
                        {st.actives}
                      </span>
                    </div>

                    <div className="flex flex-col">
                      <span className="text-11.5 font-bold text-stone">{st.brand} • {st.sizeLabel}</span>
                      <Link
                        href={routes.product(st.productSlug)}
                        className="font-display text-16 font-extrabold text-ink hover:text-cobalt transition-colors"
                      >
                        {st.productName}
                      </Link>
                    </div>

                    <div className="flex flex-col gap-1 text-12.5 leading-20 text-stone">
                      <p className="m-0">
                        <strong className="text-ink">لماذا تم اختياره: </strong>
                        {st.whyIncludedAr}
                      </p>
                      <p className="m-0 text-stone">
                        <strong className="text-stone">طريقة الاستخدام: </strong>
                        {st.usageAr}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Step Action & Price */}
                <div className="flex items-center justify-between gap-4 border-t border-line/60 pt-3 lg:border-t-0 lg:pt-0 lg:flex-col lg:items-end">
                  <span className="font-display text-17 font-black text-ink">
                    {st.price} ج.م
                  </span>

                  <div className="flex items-center gap-2">
                    <Link
                      href={routes.product(st.productSlug)}
                      className={cn(buttonVariants({ variant: 'ghost', size: 's' }), 'text-12 font-semibold')}
                    >
                      فحص المستحضر
                    </Link>

                    <Button
                      variant="ink"
                      size="s"
                      onClick={() => handleAddSingleProduct(st.skuId)}
                      disabled={addedSku === st.skuId}
                      className="text-12 font-bold"
                    >
                      {addedSku === st.skuId ? 'تمت الإضافة ✓' : 'إضافة للسلة'}
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* Floating Bottom Action Bar */}
        <div className="sticky bottom-6 z-sticky flex flex-col gap-3 rounded-card border border-line bg-linen/95 p-4 shadow-e3 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col">
            <span className="text-11.5 text-stone">إجمالي مستحضرات الروتين ({routine.steps.length} خطوات)</span>
            <span className="font-display text-20 font-black text-ink">{routine.totalPrice} ج.م</span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              href={`${routes.routineBuilder}?template=${routine.slug}`}
              className={cn(buttonVariants({ variant: 'ghost', size: 'm' }), 'font-bold')}
            >
              تخصيص في أداة البناء
            </Link>

            <Button
              variant="ink"
              size="m"
              onClick={handleAddAllToCart}
              disabled={addingAll}
              className="font-bold shadow-e1"
            >
              {addedAllSuccess ? 'تمت إضافة الروتين للسلة ✓' : 'إضافة الروتين للسلة'}
            </Button>
          </div>
        </div>
      </PageContainer>
    </div>
  );
}
