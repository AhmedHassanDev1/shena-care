'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

interface RoutineStep {
  num: string;
  stepName: string;
  productName: string;
  brand: string;
  actives: string;
  usage: string;
  price: string;
}

const MORNING_STEPS: RoutineStep[] = [
  {
    num: '٠١',
    stepName: 'تنظيف لطيف وموازنة الإفرازات',
    productName: 'Effaclar Purifying Foaming Gel',
    brand: 'LA ROCHE-POSAY',
    actives: 'زنك بيديوليت + مياه حرارية مهدئة',
    usage: 'رغوة خفيفة بحركات دائرية لمدة ٦٠ ثانية مع ماء فاتر صباحاً.',
    price: '٥٤٠ ج.م',
  },
  {
    num: '٠٢',
    stepName: 'علاج مستهدف لحبوب والمسام',
    productName: 'Effaclar Duo+ M Anti-Imperfections',
    brand: 'LA ROCHE-POSAY',
    actives: 'فيلوما + نياسيناميد نقي + حمض الساليسيليك',
    usage: 'طبقة رقيقة جداً على مناطق الحبوب والرؤوس السوداء بعد الجفاف التام.',
    price: '٧٢٠ ج.م',
  },
  {
    num: '٠٣',
    stepName: 'ترميم حاجز البشرة وترطيب غير دهني',
    productName: 'Toleriane Sensitive Fluide',
    brand: 'LA ROCHE-POSAY',
    actives: 'جلسرين نباتي + سيراميد + فيتامين ب٣',
    usage: 'ضختان لتغطية الوجه والرقبة لتهدئة أي تحسس وحبس الرطوبة.',
    price: '٦٩٠ ج.م',
  },
  {
    num: '٠٤',
    stepName: 'حماية قصوى واسعة ضد أشعة الشمس',
    productName: 'Anthelios UVMune 400 Oil Control SPF50+',
    brand: 'LA ROCHE-POSAY',
    actives: 'فلتر ميكسوريل ٤٠٠ + تقنية امتصاص الدهون',
    usage: 'كمية مقدار إصبعين قبل الخروج للشمس بـ ١٥ دقيقة.',
    price: '٨٥٠ ج.م',
  },
];

const EVENING_STEPS: RoutineStep[] = [
  {
    num: '٠١',
    stepName: 'تنظيف مسائي عميق لإزالة الرواسب والواقي',
    productName: 'Effaclar Cleansing Foaming Gel',
    brand: 'LA ROCHE-POSAY',
    actives: 'منظفات لطيفة خالية من الصابون',
    usage: 'غسول دافئ ينظف المسام من ذرات التلوث ورواسب اليوم.',
    price: '٥٤٠ ج.م',
  },
  {
    num: '٠٢',
    stepName: 'تجديد الخلايا وتقشير دقيق ليلي',
    productName: 'Effaclar Ultra Concentrated Serum',
    brand: 'LA ROCHE-POSAY',
    actives: 'ثلاثي الأحماض المقشرة: ساليسيليك، جليكوليك، LHA',
    usage: '٣ قطرات مساءً فقط مع تجنب محيط العينين والشفتين.',
    price: '٩٢٠ ج.م',
  },
  {
    num: '٠٣',
    stepName: 'ترميم وتغذية ليلية مكثفة',
    productName: 'Cicaplast Baume B5+ Ultra-Repairing',
    brand: 'LA ROCHE-POSAY',
    actives: 'ماديكاسوسيد + بانثينول ٥٪ + تريبيوما الحيوية',
    usage: 'طبقة خفيفة لتهدئة البشرة وتسريع الترميم أثناء النوم.',
    price: '٦١٠ ج.م',
  },
];

export function RoutineDraftAssistant() {
  const m = useMessages();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'am' | 'pm'>('am');
  const [query, setQuery] = useState('');
  const [swappedIndex, setSwappedIndex] = useState<number | null>(null);

  const steps = activeTab === 'am' ? MORNING_STEPS : EVENING_STEPS;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      router.push(`${routes.products}?q=${encodeURIComponent(query.trim())}`);
    }
  };

  return (
    <div
      data-ui-status="redesign-pending"
      data-route="/shina"
      className="mx-auto flex max-w-narrow flex-col gap-8 pb-24 pt-6"
    >
      {/* Header with Shina avatar and consultation rationale */}
      <header className="flex flex-col gap-4 rounded-card bg-sand/60 p-6 shadow-outline-hairline lg:p-8">
        <div className="flex items-center gap-4">
          <span className="flex size-14 flex-none items-center justify-center rounded-card bg-saffron-tint text-saffron-ink shadow-elevation-1">
            <Icon name="sparkles" size={28} />
          </span>
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="m-0 font-display text-24 font-extrabold leading-30 text-night lg:text-30 lg:leading-36">
                {m.routineDraftTitle}
              </h1>
              <span className="rounded-full bg-bottle-tint px-2.5 py-0.5 text-11.5 font-bold text-bottle">
                اقتراح استرشادي
              </span>
            </div>
            <p className="m-0 text-14 leading-22 text-ink-2">
              {m.routineDraftSubtitle}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-2 shadow-hairline-top">
          <span className="rounded-full bg-linen px-3 py-1 text-12 font-semibold text-night shadow-elevation-1">
            🎯 الهدف: تنظيم الإفرازات ودعم حاجز البشرة
          </span>
          <span className="rounded-full bg-linen px-3 py-1 text-12 font-semibold text-night shadow-elevation-1">
            🧴 نوع البشرة: دهنية إلى مختلطة
          </span>
          <span className="rounded-full bg-linen px-3 py-1 text-12 font-semibold text-bottle shadow-elevation-1">
            ✓ تناغم خطوات الاستخدام
          </span>
        </div>
      </header>

      {/* AM / PM Tab Switcher */}
      <div className="flex flex-col gap-4">
        <div className="flex rounded-full bg-bone p-1 shadow-elevation-1">
          <button
            type="button"
            onClick={() => setActiveTab('am')}
            className={cn(
              'flex-1 rounded-full py-2.5 text-center text-14 font-bold transition-all',
              activeTab === 'am'
                ? 'bg-night text-linen shadow-elevation-1'
                : 'text-ink-2 hover:text-night'
            )}
          >
            ☀️ {m.routineMorningTab}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('pm')}
            className={cn(
              'flex-1 rounded-full py-2.5 text-center text-14 font-bold transition-all',
              activeTab === 'pm'
                ? 'bg-night text-linen shadow-elevation-1'
                : 'text-ink-2 hover:text-night'
            )}
          >
            🌙 {m.routineEveningTab}
          </button>
        </div>

        {/* Steps List */}
        <div className="flex flex-col gap-4">
          {steps.map((st, idx) => (
            <div
              key={st.num}
              className={cn(
                'group flex flex-col gap-3.5 rounded-card bg-linen p-5 shadow-outline-hairline transition-all lg:p-6',
                swappedIndex === idx && 'ring-2 ring-bottle ring-offset-2'
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 flex-none items-center justify-center rounded-full bg-bottle-tint font-display text-14 font-bold text-bottle">
                    {st.num}
                  </span>
                  <div className="flex flex-col">
                    <span className="text-12 font-bold text-ink-3">
                      {st.brand}
                    </span>
                    <h2 className="m-0 font-display text-16 font-bold leading-24 text-night">
                      {st.productName}
                    </h2>
                  </div>
                </div>
                <span className="font-display text-15 font-bold text-night">
                  {st.price}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-sand/70 px-2.5 py-0.5 text-11.5 font-semibold text-night">
                  {st.stepName}
                </span>
                <span className="rounded-full bg-bottle-tint px-2.5 py-0.5 text-11.5 font-semibold text-bottle">
                  {st.actives}
                </span>
              </div>

              <p className="m-0 text-13 leading-22 text-ink-2">
                {st.usage}
              </p>

              <div className="flex items-center justify-between pt-2 shadow-hairline-top">
                <button
                  type="button"
                  onClick={() => setSwappedIndex(swappedIndex === idx ? null : idx)}
                  className="inline-flex items-center gap-1.5 text-12 font-bold text-bottle hover:underline"
                >
                  <Icon name="retry" size={14} />
                  <span>{swappedIndex === idx ? 'تم تثبيت البديل' : 'عرض بديل متوافق'}</span>
                </button>
                <span className="text-11.5 text-ink-3">
                  إرشاد استخدام يومي
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Floating Action & Question Bar */}
      <div className="sticky bottom-6 z-sticky flex flex-col gap-3 rounded-card bg-linen/95 p-4 shadow-elevation-3 backdrop-blur-md">
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحثي عن منتجات أو مكونات مطابقة في الكتالوج..."
            className="h-11 flex-1 rounded-full bg-bone px-4 text-14 font-medium text-night placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-bottle"
          />
          <button
            type="submit"
            className="flex size-11 flex-none items-center justify-center rounded-full bg-night text-linen transition-colors hover:bg-bottle"
            aria-label="بحث في الكتالوج"
          >
            <Icon name="search" size={18} />
          </button>
        </form>

        <Link
          href={routes.routineBuilder}
          className={cn(buttonVariants({ variant: 'bottle', size: 'l' }), 'w-full justify-center text-center font-bold')}
        >
          <span>{m.routineReviewTitle}</span>
          <Icon name="arrow-forward" size={18} />
        </Link>
      </div>
    </div>
  );
}
