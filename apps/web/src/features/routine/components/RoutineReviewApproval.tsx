'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

export function RoutineReviewApproval() {
  const m = useMessages();
  const router = useRouter();
  const [selectedItems, setSelectedItems] = useState<string[]>([
    'm1', 'm2', 'm3', 'm4', 'e1', 'e2', 'e3'
  ]);
  const [added, setAdded] = useState(false);

  const morningItems = [
    { id: 'm1', step: 'غسول صباحي', name: 'Effaclar Foaming Gel 200ml', brand: 'LA ROCHE-POSAY', price: 540 },
    { id: 'm2', step: 'علاج حب الشباب', name: 'Effaclar Duo+ M 40ml', brand: 'LA ROCHE-POSAY', price: 720 },
    { id: 'm3', step: 'ترطيب مهدئ', name: 'Toleriane Sensitive Fluide 40ml', brand: 'LA ROCHE-POSAY', price: 690 },
    { id: 'm4', step: 'واقي شمس مات', name: 'Anthelios UVMune 400 SPF50+ 50ml', brand: 'LA ROCHE-POSAY', price: 850 },
  ];

  const eveningItems = [
    { id: 'e1', step: 'تنظيف مسائي', name: 'Effaclar Cleansing Gel 200ml', brand: 'LA ROCHE-POSAY', price: 540 },
    { id: 'e2', step: 'تقشير وتجديد', name: 'Effaclar Ultra Concentrated Serum 30ml', brand: 'LA ROCHE-POSAY', price: 920 },
    { id: 'e3', step: 'ترميم ليلي', name: 'Cicaplast Baume B5+ 40ml', brand: 'LA ROCHE-POSAY', price: 610 },
  ];

  const toggle = (id: string) => {
    setSelectedItems((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const allItems = [...morningItems, ...eveningItems];
  const totalPrice = allItems
    .filter((it) => selectedItems.includes(it.id))
    .reduce((sum, it) => sum + it.price, 0);

  const handleApprove = () => {
    setAdded(true);
    setTimeout(() => {
      router.push(routes.products);
    }, 600);
  };

  return (
    <div
      data-ui-status="verified-pillar"
      data-route="/routine/builder"
      className="mx-auto flex max-w-narrow flex-col gap-8 pb-28 pt-6"
    >
      {/* Header */}
      <header className="flex flex-col gap-3 rounded-card bg-sand/60 p-6 shadow-outline-hairline lg:p-8">
        <div className="flex items-center gap-2.5">
          <span className="flex size-10 items-center justify-center rounded-full bg-citron text-ink">
            <Icon name="check" size={20} />
          </span>
          <span className="rounded-full bg-cobalt px-3 py-1 text-12 font-bold text-chalk">
            روتين متناسق استرشادي
          </span>
        </div>
        <h1 className="m-0 font-display text-26 font-extrabold leading-34 text-ink lg:text-34 lg:leading-42">
          {m.routineReviewTitle}
        </h1>
        <p className="m-0 text-14.5 leading-24 text-stone">
          {m.routineReviewLead}
        </p>

        <div className="flex flex-wrap items-center gap-2 pt-2 shadow-hairline-top">
          <span className="rounded-full bg-linen px-3 py-1 text-12 font-semibold text-ink shadow-e1">
            ✓ متوافق مع البشرة المعرضة للحبوب
          </span>
          <span className="rounded-full bg-linen px-3 py-1 text-12 font-semibold text-ink shadow-e1">
            ✓ خطوات متوازنة صباحاً ومساءً
          </span>
          <span className="rounded-full bg-linen px-3 py-1 text-12 font-semibold text-cobalt shadow-e1">
            ✓ تغليف محكم وتوصيل معتمد
          </span>
        </div>
      </header>

      {/* Morning Section */}
      <section aria-labelledby="am-review-h" className="flex flex-col gap-4 rounded-card bg-linen p-6 shadow-outline-hairline">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-full bg-sand text-ink">
              ☀️
            </span>
            <h2 id="am-review-h" className="m-0 font-display text-18 font-bold text-ink">
              {m.routineMorningTab}
            </h2>
          </div>
          <span className="text-12 font-bold text-stone">
            ٤ خطوات أساسية
          </span>
        </div>

        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {morningItems.map((item) => (
            <li
              key={item.id}
              onClick={() => toggle(item.id)}
              className="flex cursor-pointer items-center justify-between gap-3 rounded-image bg-chalk p-3.5 shadow-e1 transition-all hover:bg-sand/30"
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    'flex size-5 flex-none items-center justify-center rounded-full border transition-colors',
                    selectedItems.includes(item.id)
                      ? 'border-cobalt bg-cobalt text-chalk'
                      : 'border-line-2 bg-linen'
                  )}
                >
                  {selectedItems.includes(item.id) ? <Icon name="check" size={12} /> : null}
                </span>
                <div className="flex flex-col">
                  <span className="text-11.5 font-bold text-stone">{item.step}</span>
                  <span className="text-14 font-bold text-ink">{item.name}</span>
                </div>
              </div>
              <span className="font-display text-14 font-bold text-ink">
                {item.price} ج.م
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Evening Section */}
      <section aria-labelledby="pm-review-h" className="flex flex-col gap-4 rounded-card bg-linen p-6 shadow-outline-hairline">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-full bg-sand text-ink">
              🌙
            </span>
            <h2 id="pm-review-h" className="m-0 font-display text-18 font-bold text-ink">
              {m.routineEveningTab}
            </h2>
          </div>
          <span className="text-12 font-bold text-stone">
            ٣ خطوات علاجية
          </span>
        </div>

        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {eveningItems.map((item) => (
            <li
              key={item.id}
              onClick={() => toggle(item.id)}
              className="flex cursor-pointer items-center justify-between gap-3 rounded-image bg-chalk p-3.5 shadow-e1 transition-all hover:bg-sand/30"
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    'flex size-5 flex-none items-center justify-center rounded-full border transition-colors',
                    selectedItems.includes(item.id)
                      ? 'border-cobalt bg-cobalt text-chalk'
                      : 'border-line-2 bg-linen'
                  )}
                >
                  {selectedItems.includes(item.id) ? <Icon name="check" size={12} /> : null}
                </span>
                <div className="flex flex-col">
                  <span className="text-11.5 font-bold text-stone">{item.step}</span>
                  <span className="text-14 font-bold text-ink">{item.name}</span>
                </div>
              </div>
              <span className="font-display text-14 font-bold text-ink">
                {item.price} ج.م
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Formulation Synergy Guidance Card */}
      <div className="flex flex-col gap-3 rounded-card bg-sand/60 p-5 shadow-outline-hairline">
        <div className="flex items-center gap-2 text-cobalt">
          <Icon name="shield" size={18} />
          <span className="text-13 font-bold">إرشادات التوافق والتطبيق</span>
        </div>
        <p className="m-0 text-12.5 leading-20 text-stone">
          تم تنسيق خطوات هذا الروتين الاسترشادي لدعم توازن البشرة: يوصى باتباع التسلسل الموضح مع إدخال الأحماض المقشرة تدريجياً لضمان راحة البشرة وتجنب أي تحسس.
        </p>
      </div>

      {/* Floating Bottom Approval Bar */}
      <div className="sticky bottom-6 z-sticky flex items-center justify-between gap-4 rounded-card bg-linen/95 p-4 shadow-e3 backdrop-blur-md">
        <div className="flex flex-col">
          <span className="text-11.5 font-semibold text-stone">إجمالي الروتين المقترح ({selectedItems.length} منتجات)</span>
          <span className="font-display text-20 font-extrabold text-ink">{totalPrice} ج.م</span>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/account/routine"
            className={cn(buttonVariants({ variant: 'ghost', size: 'm' }), 'font-semibold')}
          >
            حفظ الروتين
          </Link>
          <Button
            variant="ink"
            size="l"
            onClick={handleApprove}
            disabled={added || selectedItems.length === 0}
            className="font-bold shadow-e1"
          >
            {added ? 'جاري الانتقال للكتالوج ✓' : 'البحث عن المنتجات في الكتالوج'}
          </Button>
        </div>
      </div>
    </div>
  );
}
