'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { Button, buttonVariants } from '@/components/ui/button';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { useCart } from '@/features/cart/hooks/useCart';
import {
  getSavedCustomerRoutine,
  clearSavedCustomerRoutine,
  getDailyTrackerChecks,
  setDailyTrackerChecks,
  type CustomerSavedRoutine,
} from '../lib/routineStorage';

export function ActiveRoutineTracker() {
  const { addItem } = useCart();
  const [routine, setRoutine] = useState<CustomerSavedRoutine | null>(null);
  const [checkedSteps, setCheckedSteps] = useState<Record<string, boolean>>({});
  const [period, setPeriod] = useState<'morning' | 'evening'>('morning');
  const [isClientLoaded, setIsClientLoaded] = useState(false);
  const [addingAll, setAddingAll] = useState(false);
  const [addedSuccess, setAddedSuccess] = useState(false);

  useEffect(() => {
    setRoutine(getSavedCustomerRoutine());
    setCheckedSteps(getDailyTrackerChecks());
    setIsClientLoaded(true);
  }, []);

  const toggleStep = (id: string) => {
    const next = { ...checkedSteps, [id]: !checkedSteps[id] };
    setCheckedSteps(next);
    setDailyTrackerChecks(next);
  };

  const handleClearRoutine = () => {
    if (window.confirm('هل أنتِ متأكدة من رغبتك في حذف هذا الروتين المحفوظ؟')) {
      clearSavedCustomerRoutine();
      setRoutine(null);
      setCheckedSteps({});
    }
  };

  const handleAddAllToCart = async () => {
    if (!routine) return;
    try {
      setAddingAll(true);
      const allSteps = [...routine.morningSteps, ...routine.eveningSteps];
      for (const st of allSteps) {
        if (st.skuId) {
          await addItem({ skuId: st.skuId, quantity: 1 });
        }
      }
      setAddedSuccess(true);
      setTimeout(() => setAddedSuccess(false), 2500);
    } catch {
      // Error handled
    } finally {
      setAddingAll(false);
    }
  };

  // EMPTY STATE: Customer does not have a saved routine yet
  if (!isClientLoaded || !routine) {
    return (
      <div
        data-ui-status="verified-pillar"
        data-route="/account/routine"
        className="mx-auto flex max-w-narrow flex-col gap-8 pb-24 pt-6"
      >
        <section
          aria-labelledby="empty-routine-title"
          className="flex flex-col items-center justify-center gap-6 rounded-card border border-line bg-linen p-8 text-center shadow-elevation-1 sm:p-12"
        >
          <span className="flex size-16 items-center justify-center rounded-full bg-sand text-ink shadow-elevation-1">
            <Icon name="routine" size={32} />
          </span>

          <div className="flex max-w-md flex-col gap-2">
            <h1 id="empty-routine-title" className="m-0 font-display text-24 font-black text-ink sm:text-28">
              ليس لديك روتين محفوظ بعد
            </h1>
            <p className="m-0 text-14 leading-24 text-stone">
              الروتين المحفوظ يتيح لك متابعة خطواتك اليومية صباحاً ومساءً، التحقق من تطبيق المستحضرات، وإعادة طلب النواقص بضغطة واحدة.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link
              href={routes.routines}
              className={cn(buttonVariants({ variant: 'ink', size: 'l' }), 'font-bold shadow-elevation-1')}
            >
              <span>استكشاف الروتينات الجاهزة</span>
              <Icon name="arrow-forward" size={16} />
            </Link>

            <Link
              href={routes.routineBuilder}
              className={cn(buttonVariants({ variant: 'ghost', size: 'l' }), 'font-bold')}
            >
              بناء روتين مخصص
            </Link>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-4 border-t border-line/60 pt-6 text-12 text-stone">
            <span className="flex items-center gap-1.5 font-medium">
              ✓ لا ننشئ روتيناً تلقائياً دون موافقتك
            </span>
            <span className="text-stone">•</span>
            <span className="flex items-center gap-1.5 font-medium">
              ✓ خيارات حقيقية من الكتالوج المعتمد
            </span>
          </div>
        </section>
      </div>
    );
  }

  // ACTIVE SAVED ROUTINE STATE
  const currentSteps = period === 'morning' ? routine.morningSteps : routine.eveningSteps;
  const activeSteps = currentSteps.length > 0 ? currentSteps : routine.morningSteps;
  const completedCount = activeSteps.filter((s) => checkedSteps[s.id]).length;
  const progressPct = activeSteps.length > 0 ? Math.round((completedCount / activeSteps.length) * 100) : 0;

  return (
    <div
      data-ui-status="verified-pillar"
      data-route="/account/routine"
      className="mx-auto flex max-w-narrow flex-col gap-8 pb-28 pt-6"
    >
      {/* Header */}
      <header className="flex flex-col gap-4 rounded-card border border-line bg-linen p-6 shadow-elevation-1 sm:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex size-12 flex-none items-center justify-center rounded-card bg-sand text-ink shadow-elevation-1">
              <Icon name="routine" size={24} />
            </span>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <h1 className="m-0 font-display text-22 font-black leading-tight text-ink sm:text-26">
                  {routine.title}
                </h1>
                <span className="rounded-full bg-citron px-2.5 py-0.5 text-11 font-bold text-ink">
                  روتين محفوظ
                </span>
              </div>
              <span className="text-12.5 text-stone">
                مجال العناية: {routine.category === 'skin' ? 'بشرة' : 'شعر'} • حفظ في {new Date(routine.savedAt).toLocaleDateString('ar-EG')}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <Link
              href={routes.routineBuilder}
              className={cn(buttonVariants({ variant: 'ghost', size: 's' }), 'text-12 font-bold')}
            >
              تعديل الروتين
            </Link>
            <button
              type="button"
              onClick={handleClearRoutine}
              className="text-12 text-stone hover:text-ink underline px-2"
            >
              حذف
            </button>
          </div>
        </div>

        {/* Real Daily Progress */}
        <div className="flex flex-col gap-2 border-t border-line/60 pt-3">
          <div className="flex items-center justify-between text-13 font-bold text-ink">
            <span>
              تم إنجاز {completedCount} من أصل {activeSteps.length} خطوات اليوم
            </span>
            <span className="tabular-nums text-cobalt">{progressPct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-sand/60">
            <div
              className="h-full rounded-full bg-cobalt transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </header>

      {/* AM / PM Toggle (if routine has both periods) */}
      {routine.eveningSteps.length > 0 ? (
        <div className="flex rounded-full bg-sand/60 p-1 shadow-elevation-1">
          <button
            type="button"
            onClick={() => setPeriod('morning')}
            className={cn(
              'flex-1 rounded-full py-2.5 text-center text-13 font-bold transition-all',
              period === 'morning'
                ? 'bg-ink text-chalk shadow-elevation-1'
                : 'text-stone hover:text-ink'
            )}
          >
            ☀️ الروتين الصباحي ({routine.morningSteps.length} خطوات)
          </button>
          <button
            type="button"
            onClick={() => setPeriod('evening')}
            className={cn(
              'flex-1 rounded-full py-2.5 text-center text-13 font-bold transition-all',
              period === 'evening'
                ? 'bg-ink text-chalk shadow-elevation-1'
                : 'text-stone hover:text-ink'
            )}
          >
            🌙 الروتين المسائي ({routine.eveningSteps.length} خطوات)
          </button>
        </div>
      ) : null}

      {/* Steps Checklist */}
      <div className="flex flex-col gap-3">
        {activeSteps.map((st) => {
          const isDone = Boolean(checkedSteps[st.id]);
          return (
            <div
              key={st.id}
              onClick={() => toggleStep(st.id)}
              className={cn(
                'flex cursor-pointer items-start justify-between gap-3.5 rounded-card border p-4 shadow-elevation-1 transition-all sm:p-5',
                isDone
                  ? 'border-line/60 bg-sand/40 opacity-80'
                  : 'border-line bg-linen hover:shadow-elevation-2'
              )}
            >
              <div className="flex items-start gap-3.5">
                <span
                  className={cn(
                    'mt-0.5 flex size-5.5 flex-none items-center justify-center rounded-full border transition-all',
                    isDone
                      ? 'border-cobalt bg-cobalt text-chalk'
                      : 'border-line bg-chalk text-transparent'
                  )}
                >
                  <Icon name="check" size={13} />
                </span>

                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-11.5 font-bold text-stone">
                      خطوة {st.num}
                    </span>
                    <span className="text-11.5 font-semibold text-cobalt">
                      {st.stepName}
                    </span>
                  </div>

                  <h2
                    className={cn(
                      'm-0 font-display text-15 font-bold leading-snug',
                      isDone ? 'text-stone line-through' : 'text-ink'
                    )}
                  >
                    {st.productName}
                  </h2>
                  <span className="text-11.5 text-stone">{st.brand} • {st.actives}</span>

                  <p className="m-0 text-12 text-stone pt-0.5">
                    {st.usage}
                  </p>
                </div>
              </div>

              <div className="flex flex-col items-end gap-1">
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-11 font-bold',
                    isDone
                      ? 'bg-sand text-cobalt'
                      : 'bg-sand/60 text-stone'
                  )}
                >
                  {isDone ? 'تمت الخطوة' : 'في الانتظار'}
                </span>
                <span className="font-display text-12 font-bold text-ink">
                  {st.price} ج.م
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick Reorder Card */}
      <div className="flex flex-col gap-3 rounded-card border border-line bg-linen p-5 shadow-elevation-1 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex flex-col gap-0.5">
          <span className="font-display text-15 font-bold text-ink">
            قاربت عبوات روتينك على الانتهاء؟
          </span>
          <span className="text-12.5 text-stone">
            يمكنك إعادة طلب كافة مستحضرات روتينك مباشرة لتصلك قبل نفادها.
          </span>
        </div>

        <Button
          variant="ink"
          size="m"
          onClick={handleAddAllToCart}
          disabled={addingAll}
          className="font-bold self-start sm:self-auto shadow-elevation-1"
        >
          {addedSuccess ? 'تمت إضافة الروتين للسلة ✓' : addingAll ? 'جاري الإضافة...' : 'إضافة كل النواقص للسلة'}
        </Button>
      </div>
    </div>
  );
}
