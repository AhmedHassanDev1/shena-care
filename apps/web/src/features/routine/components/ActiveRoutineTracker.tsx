'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

interface TrackerStep {
  id: string;
  num: string;
  title: string;
  product: string;
  instruction: string;
  timeHint: string;
}

const STORAGE_KEY = 'shinacare_active_routine_steps';

const AM_TRACKER_STEPS: TrackerStep[] = [
  {
    id: 'am1',
    num: '٠١',
    title: 'تنظيف لطيف وموازنة الدهون',
    product: 'Effaclar Purifying Foaming Gel',
    instruction: 'اغسلي وجهك بحركات دائرية هادئة لمدة دقيقة بالماء الفاتر.',
    timeHint: '٠٨:٠٠ صباحاً',
  },
  {
    id: 'am2',
    num: '٠٢',
    title: 'علاج حب الشباب والمسام',
    product: 'Effaclar Duo+ M Anti-Imperfections',
    instruction: 'ضعي كمية صغيرة جداً على أماكن الحبوب فقط واتركيها تجف.',
    timeHint: '٠٨:٠٥ صباحاً',
  },
  {
    id: 'am3',
    num: '٠٣',
    title: 'ترطيب وحماية الحاجز',
    product: 'Toleriane Sensitive Fluide',
    instruction: 'وزعي ضختين على كامل الوجه والرقبة برفق.',
    timeHint: '٠٨:١٠ صباحاً',
  },
  {
    id: 'am4',
    num: '٠٤',
    title: 'حماية قصوى واسعة SPF50+',
    product: 'Anthelios UVMune 400 Oil Control',
    instruction: 'ضعي مقدار إصبعين قبل الخروج للشمس بـ ١٥ دقيقة.',
    timeHint: '٠٨:٢٥ صباحاً',
  },
];

const PM_TRACKER_STEPS: TrackerStep[] = [
  {
    id: 'pm1',
    num: '٠١',
    title: 'تنظيف مسائي مزدوج',
    product: 'Effaclar Purifying Foaming Gel',
    instruction: 'تنظيف عميق لإزالة بقايا الواقي الشمسي والتلوث اليومي.',
    timeHint: '٠٩:٣٠ مساءً',
  },
  {
    id: 'pm2',
    num: '٠٢',
    title: 'تقشير وتجديد الخلايا',
    product: 'Effaclar Ultra Concentrated Serum',
    instruction: '٣ قطرات مساءً فقط لتنقية مسام البشرة بلطف.',
    timeHint: '٠٩:٣٥ مساءً',
  },
  {
    id: 'pm3',
    num: '٠٣',
    title: 'ترميم وتغذية ليلية مكثفة',
    product: 'Cicaplast Baume B5+ Ultra-Repairing',
    instruction: 'طبقة مهدئة غنية بالبانثينول لترميم البشرة أثناء النوم.',
    timeHint: '٠٩:٤٥ مساءً',
  },
];

export function ActiveRoutineTracker() {
  const m = useMessages();
  const [period, setPeriod] = useState<'am' | 'pm'>('am');
  const [checkedSteps, setCheckedSteps] = useState<Record<string, boolean>>({
    am1: true,
    am2: true,
    am3: true,
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        setCheckedSteps(JSON.parse(saved));
      }
    } catch {
      // LocalStorage access restricted or unavailable
    }
  }, []);

  const steps = period === 'am' ? AM_TRACKER_STEPS : PM_TRACKER_STEPS;
  const completedCount = steps.filter((s) => checkedSteps[s.id]).length;
  const progressPct = Math.round((completedCount / steps.length) * 100);

  const toggleStep = (id: string) => {
    setCheckedSteps((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore write error
      }
      return next;
    });
  };

  return (
    <div
      data-ui-status="redesign-pending"
      data-route="/account/routine"
      className="mx-auto flex max-w-narrow flex-col gap-8 pb-28 pt-6"
    >
      {/* Header */}
      <header className="flex flex-col gap-4 rounded-card bg-sand/60 p-6 shadow-outline-hairline lg:p-8">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-card bg-saffron-tint text-saffron-ink shadow-elevation-1">
              <Icon name="sun" size={22} />
            </span>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <h1 className="m-0 font-display text-24 font-extrabold leading-32 text-night lg:text-30 lg:leading-38">
                  {m.routineTrackerTitle}
                </h1>
                <span className="rounded-full bg-bottle-tint px-2 py-0.5 text-11 font-semibold text-bottle">
                  متابعة محلية
                </span>
              </div>
              <span className="text-13 leading-20 text-ink-2">
                الالتزام اليومي يصنع الفارق في تجديد ونضارة البشرة
              </span>
            </div>
          </div>

          <div className="flex flex-col items-end">
            <span className="rounded-full bg-bottle px-3 py-1 font-display text-13 font-bold text-linen">
              ٧ {m.routineTrackerStreak} 🔥
            </span>
            <span className="text-11 text-ink-3">إنجاز رائع</span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="flex flex-col gap-2 pt-2 shadow-hairline-top">
          <div className="flex items-center justify-between text-13 font-bold text-night">
            <span>
              تم إنجاز {completedCount} من أصل {steps.length} خطوات اليوم
            </span>
            <span className="font-tabular text-bottle">{progressPct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-bone">
            <div
              className="h-full rounded-full bg-bottle transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </header>

      {/* AM / PM Toggle */}
      <div className="flex rounded-full bg-bone p-1 shadow-elevation-1">
        <button
          type="button"
          onClick={() => setPeriod('am')}
          className={cn(
            'flex-1 rounded-full py-2.5 text-center text-14 font-bold transition-all',
            period === 'am'
              ? 'bg-night text-linen shadow-elevation-1'
              : 'text-ink-2 hover:text-night'
          )}
        >
          ☀️ الروتين الصباحي (٠٨:٠٠ ص)
        </button>
        <button
          type="button"
          onClick={() => setPeriod('pm')}
          className={cn(
            'flex-1 rounded-full py-2.5 text-center text-14 font-bold transition-all',
            period === 'pm'
              ? 'bg-night text-linen shadow-elevation-1'
              : 'text-ink-2 hover:text-night'
          )}
        >
          🌙 الروتين المسائي (٠٩:٣٠ م)
        </button>
      </div>

      {/* Step by step checklist */}
      <div className="flex flex-col gap-3.5">
        {steps.map((st) => {
          const isDone = Boolean(checkedSteps[st.id]);
          return (
            <div
              key={st.id}
              onClick={() => toggleStep(st.id)}
              className={cn(
                'flex cursor-pointer items-start justify-between gap-3.5 rounded-card p-5 shadow-outline-hairline transition-all',
                isDone
                  ? 'bg-linen opacity-95'
                  : 'bg-linen shadow-elevation-1 ring-1 ring-bottle/20'
              )}
            >
              <div className="flex items-start gap-3.5">
                <span
                  className={cn(
                    'mt-0.5 flex size-6 flex-none items-center justify-center rounded-full border transition-all',
                    isDone
                      ? 'border-bottle bg-bottle text-linen'
                      : 'border-line-2 bg-bone text-transparent'
                  )}
                >
                  <Icon name="check" size={14} />
                </span>

                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-12 font-bold text-ink-3">
                      خطوة {st.num}
                    </span>
                    <span className="text-11.5 font-semibold text-ink-3">
                      • {st.timeHint}
                    </span>
                  </div>
                  <h2
                    className={cn(
                      'm-0 font-display text-15 font-bold leading-22',
                      isDone ? 'text-ink-2 line-through' : 'text-night'
                    )}
                  >
                    {st.product}
                  </h2>
                  <p className="m-0 text-12.5 leading-18 text-ink-2">
                    {st.instruction}
                  </p>
                </div>
              </div>

              <span
                className={cn(
                  'rounded-full px-2.5 py-1 text-11.5 font-bold',
                  isDone
                    ? 'bg-bottle-tint text-bottle'
                    : 'bg-sand text-night'
                )}
              >
                {isDone ? m.routineStepDone : m.routineStepPending}
              </span>
            </div>
          );
        })}
      </div>

      {/* Quick Routine Reorder & Guidance Card */}
      <div className="flex flex-col gap-3 rounded-card bg-linen p-6 shadow-outline-hairline sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <span className="font-display text-15 font-bold text-night">
            قاربت عبوتك على الانتهاء؟
          </span>
          <span className="text-13 text-ink-2">
            يمكنك إعادة طلب منتجات روتينك المسجلة مباشرة لتصلك قبل نفادها.
          </span>
        </div>
        <Link
          href={routes.cart}
          className={cn(buttonVariants({ variant: 'bottle', size: 'm' }), 'font-bold self-start sm:self-auto')}
        >
          طلب إعادة تزويد
        </Link>
      </div>
    </div>
  );
}
