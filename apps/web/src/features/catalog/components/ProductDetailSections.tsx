'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Section, SectionHeader } from '@/components/layout/section';
import { ArrowLink } from '@/components/ui/arrow-link';
import { cardVariants } from '@/components/ui/card-variants';
import { Icon } from '@/components/ui/icon';
import { useCart } from '@/features/cart/hooks/useCart';
import { useLocale } from '@/lib/i18n/LocaleProvider';
import { formatAmount } from '@/lib/i18n/format';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import type { ProductDetail } from '../api/discovery';
import { MOCK_RELATED_PRODUCTS_LIST } from '../lib/mock-product-detail';

/**
 * 4 USP / Feature Highlight Cards directly matching the design reference:
 * 1. يدعم حاجز البشرة
 * 2. تقليل مظهر المسام
 * 3. يوحد لون البشرة
 * 4. ينظم إفراز الدهون
 */
export function ProductHighlights({ product }: { product: ProductDetail }) {
  const highlights = [
    {
      id: 'barrier',
      title: 'يدعم حاجز البشرة',
      subtitle: 'يقوي حاجز البشرة الطبيعي في 14 يوماً',
      icon: 'shield' as const,
      iconBg: 'bg-tomato/10 text-tomato-ink',
    },
    {
      id: 'pores',
      title: 'تقليل مظهر المسام',
      subtitle: 'يقلل حجم المسام الواسعة بنسبة 85%',
      icon: 'target' as const,
      iconBg: 'bg-warn/15 text-warn',
    },
    {
      id: 'tone',
      title: 'يوحد لون البشرة',
      subtitle: 'يقلل التصبغات وآثار الحبوب بفاعلية',
      icon: 'sparkles' as const,
      iconBg: 'bg-cobalt/10 text-cobalt',
    },
    {
      id: 'sebum',
      title: 'ينظم إفراز الدهون',
      subtitle: 'تحكم فوري باللمعان والزيوت طوال اليوم',
      icon: 'droplet' as const,
      iconBg: 'bg-sand text-ink',
    },
  ];

  return (
    <Section labelledBy={`pdp-highlights-${product.id}`} rhythm="compact" className="pt-2">
      <h2 id={`pdp-highlights-${product.id}`} className="sr-only">
        مميزات المنتج الأساسية
      </h2>
      <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 lg:grid-cols-4 lg:gap-4">
        {highlights.map((item) => (
          <li
            key={item.id}
            className={cn(
              cardVariants(),
              'group flex flex-col items-center gap-2 p-3.5 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-elevation-2 lg:p-4.5'
            )}
          >
            <span
              className={cn(
                'flex size-11 items-center justify-center rounded-pill transition-transform duration-300 group-hover:scale-110',
                item.iconBg
              )}
            >
              <Icon name={item.icon} size={22} strokeWidth={2} />
            </span>
            <span className="font-display text-15 font-bold leading-22 text-ink lg:text-16">
              <bdi>{item.title}</bdi>
            </span>
            <span className="text-12.5 leading-18 text-stone lg:text-13">
              {item.subtitle}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * «عن المنتج»: Detailed description, feature pills, and a sensory texture preview card.
 */
export function ProductAbout({ product, name }: { product: ProductDetail; name: string }) {
  const description =
    product.description ||
    'سيروم غني بتركيز 10% من النياسيناميد النقي (فيتامين B3) والزنك 1%، صُمم خصيصاً للتحكم الفائق في إفراز الزيوت وتقليص مظهر المسام الواسعة مع توحيد لون البشرة والحد من التصبغات والبقع الناتجة عن آثار حب الشباب. تركيبة خفيفة وسريعة الامتصاص تمنح البشرة ملمساً ناعماً غير دهني، وتدعم الحاجز الواقي دون التسبب في انسداد المسام.';

  const pills = [
    'مناسب للبشرة الدهنية والمختلطة',
    'سريع الامتصاص وغير لزج',
    'خالٍ من العطور والبارابين',
    'غير كوميدوجينيك (لا يسد المسام)',
  ];

  return (
    <Section labelledBy={`pdp-about-${product.id}`} rhythm="compact">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="size-2 rounded-pill bg-citron animate-pulse" />
        <SectionHeader title="عن المنتج" titleId={`pdp-about-${product.id}`} />
      </div>

      <div className={cn(cardVariants(), 'mt-3 grid gap-6 p-5 lg:grid-cols-3 lg:items-center lg:gap-8 lg:p-6')}>
        <div className="flex flex-col gap-4 lg:col-span-2">
          <p dir="auto" className="m-0 text-15 leading-27 text-ink text-match-parent lg:text-16 lg:leading-28">
            {description}
          </p>

          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {pills.map((pill) => (
              <li
                key={pill}
                className="flex items-center gap-1.5 rounded-pill bg-sand/60 px-3 py-1.5 text-13 font-semibold text-ink"
              >
                <Icon name="check" size={14} className="text-ok" strokeWidth={2.4} />
                <span>{pill}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex flex-col items-center justify-center rounded-card bg-chalk p-4 text-center shadow-outline-hairline">
          <div className="relative size-36 overflow-hidden rounded-image">
            <Image
              src="/assets/products/sahel-Hyaluronic-Acid-Facial-Serum.png"
              alt={`قوام ${name}`}
              fill
              sizes="(min-width: 1024px) 160px, 140px"
              className="object-contain transition-transform duration-500 hover:scale-105"
            />
          </div>
          <span className="mt-2 text-13 font-bold text-ink">قوام خفيف وسريع الامتصاص</span>
          <span className="text-12 text-stone">يدعم التنظيم اليومي لإفراز الزيوت</span>
        </div>
      </div>
    </Section>
  );
}

/**
 * «المكونات الفعالة»: 3 highlighted cards with Hero Cobalt Blue featured ingredient.
 */
export function ProductIngredients({ product }: { product: ProductDetail }) {
  const ingredients = [
    {
      id: 'niacinamide',
      name: 'النياسيناميد 10% (Niacinamide)',
      scientific: 'Vitamin B3',
      role: 'المكون الرئيسي',
      description:
        'فيتامين B3 النقي بتركيز طبي فائق، يقوي حاجز البشرة الطبيعي، يقلص المسام الواسعة، يفتح التصبغات ويوحد لون الجلد، وينظم إفراز الزيوت.',
      badge: 'تركيز طبي مثبت سريرياً',
      featured: true,
      icon: 'atom' as const,
    },
    {
      id: 'zinc',
      name: 'زنك PCA 1%',
      scientific: 'Zinc PCA',
      role: 'معدل الدهون ومضاد للالتهاب',
      description:
        'يعمل على توازن نشاط الغدد الدهنية، يقاوم البكتيريا المسببة لحب الشباب، ويهدئ الاحمرار والتهيج الناتج عن البثور.',
      badge: 'مضاد للمعان والبكتيريا',
      featured: false,
      icon: 'droplet' as const,
    },
    {
      id: 'panthenol',
      name: 'بانثينول (B5) + ترطيب مكثف',
      scientific: 'Pro-Vitamin B5',
      role: 'مهدئ ومرطب للحاجز',
      description:
        'ترطيب عميق ومهدئ للبشرة لمنع الجفاف أو التحسس الناتج عن تنظيم الإفرازات الدهنية، لتبقى البشرة مرنة وناعمة ومشرقة.',
      badge: 'تهدئة وترطيب فائق',
      featured: false,
      icon: 'shield' as const,
    },
  ];

  return (
    <Section labelledBy={`pdp-ingredients-${product.id}`} rhythm="compact">
      <SectionHeader
        title="المكونات الفعالة"
        titleId={`pdp-ingredients-${product.id}`}
        lead="3 مكونات طبية أساسية بفاعلية متكاملة"
      />

      <div className="grid gap-3 md:grid-cols-3 lg:gap-4">
        {ingredients.map((item) =>
          item.featured ? (
            <div
              key={item.id}
              className="relative flex flex-col justify-between gap-4 rounded-card bg-cobalt p-5 text-chalk shadow-elevation-2 transition-transform duration-300 hover:-translate-y-1"
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 rounded-pill bg-chalk/15 px-3 py-1 text-12 font-bold text-chalk backdrop-blur-sm">
                  <span aria-hidden="true" className="size-2 rounded-pill bg-citron animate-ping" />
                  {item.role}
                </span>
                <span className="flex size-8 items-center justify-center rounded-pill bg-chalk/20 text-chalk">
                  <Icon name={item.icon} size={18} />
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                <h3 className="m-0 font-display text-20 font-bold leading-26 text-chalk">
                  {item.name}
                </h3>
                <p className="m-0 text-13.5 leading-22 text-chalk/90">
                  {item.description}
                </p>
              </div>
              <span className="self-start rounded-pill bg-citron px-2.5 py-0.5 text-11.5 font-bold text-ink">
                {item.badge}
              </span>
            </div>
          ) : (
            <div
              key={item.id}
              className={cn(
                cardVariants(),
                'flex flex-col justify-between gap-4 p-5 transition-transform duration-300 hover:-translate-y-1 hover:shadow-elevation-1'
              )}
            >
              <div className="flex items-center justify-between">
                <span className="rounded-pill bg-sand px-2.5 py-0.5 text-12 font-semibold text-ink">
                  {item.scientific}
                </span>
                <span className="flex size-8 items-center justify-center rounded-pill bg-sand text-cobalt">
                  <Icon name={item.icon} size={18} />
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                <h3 className="m-0 font-display text-18 font-bold leading-24 text-ink">
                  {item.name}
                </h3>
                <p className="m-0 text-13.5 leading-22 text-stone">
                  {item.description}
                </p>
              </div>
              <span className="self-start text-12 font-medium text-cobalt">
                {item.badge}
              </span>
            </div>
          )
        )}
      </div>
    </Section>
  );
}

/**
 * «طريقة الاستخدام»: 4 Chronological interactive steps with progress indicators.
 */
export function ProductUsage({ product }: { product: ProductDetail }) {
  const steps = [
    {
      num: 1,
      title: 'تنظيف البشرة بعناية',
      body: 'اغسل وجهك بغسول لطيف مناسب للبشرة الدهنية وجفف بلطف بمنشفة ناعمة.',
      icon: 'sparkles' as const,
    },
    {
      num: 2,
      title: 'ضع 3-4 قطرات مباشرة',
      body: 'وزع قطرات السيروم مباشرة على الجبهة والوجنتين والذقن والرقبة.',
      icon: 'pipette' as const,
    },
    {
      num: 3,
      title: 'تدليك خفيف حتى الامتصاص',
      body: 'دلك بلطف بحركات دائرية ناعمة لأعلى حتى تمتصه البشرة تماماً في ثوانٍ.',
      icon: 'wrinkles' as const,
    },
    {
      num: 4,
      title: 'صباحاً ومساءً',
      body: 'استخدمه مرتين يومياً. نهاراً يُتبع بواقي شمس، ومساءً بكريم مرطب مناسب.',
      icon: 'sun-moon' as const,
    },
  ];

  return (
    <Section labelledBy={`pdp-usage-${product.id}`} rhythm="compact">
      <SectionHeader
        title="طريقة الاستخدام"
        titleId={`pdp-usage-${product.id}`}
        lead="خطوات تطبيق مثالية للحصول على أفضل النتائج الطبية"
      />

      <ol className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
        {steps.map((step, idx) => (
          <li
            key={step.num}
            className={cn(
              cardVariants(),
              'group relative flex flex-col gap-3 p-4 transition-all duration-300 hover:-translate-y-1 hover:shadow-elevation-2'
            )}
          >
            <div className="flex items-center justify-between">
              <span className="flex size-8 items-center justify-center rounded-pill bg-sand font-display text-15 font-bold text-cobalt group-hover:bg-cobalt group-hover:text-chalk transition-colors">
                {step.num}
              </span>
              <span className="flex size-8 items-center justify-center rounded-pill bg-chalk text-stone">
                <Icon name={step.icon} size={18} />
              </span>
            </div>

            <h3 className="m-0 font-display text-16 font-bold leading-22 text-ink">
              {step.title}
            </h3>

            <p className="m-0 text-13 leading-22 text-stone">
              {step.body}
            </p>

            {idx < steps.length - 1 ? (
              <span className="absolute -end-2 top-1/2 hidden -translate-y-1/2 text-stone/50 lg:block">
                <Icon name="chevron-forward" size={16} />
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </Section>
  );
}

/**
 * «مكان المنتج في روتينك اليومي»: 5 steps with Step 3 illuminated in Cobalt.
 */
export function RoutinePlacement({ product }: { product: ProductDetail }) {
  const steps = [
    { num: 1, title: 'الغسول', subtitle: 'تنظيف عميق للمسام' },
    { num: 2, title: 'التونر', subtitle: 'موازنة حموضة الجلد' },
    {
      num: 3,
      title: 'سيروم النياسيناميد',
      subtitle: 'الخطوة 3 الحالية (أنت هنا)',
      current: true,
    },
    { num: 4, title: 'المرطب', subtitle: 'حبس الرطوبة والترميم' },
    { num: 5, title: 'واقي الشمس', subtitle: 'حماية نهارية SPF' },
  ];

  return (
    <Section labelledBy={`pdp-routine-${product.id}`} band rhythm="compact">
      <SectionHeader
        title="مكان المنتج في روتينك اليومي"
        titleId={`pdp-routine-${product.id}`}
        lead="الترتيب الصحيح لخطوات العناية اليومية بالبشرة"
      />

      <ol className="-mx-4 m-0 flex list-none snap-x gap-2.5 overflow-x-auto px-4 pb-1 scrollbar-none lg:mx-0 lg:grid lg:grid-cols-5 lg:gap-3 lg:overflow-visible lg:px-0">
        {steps.map((step, idx) => (
          <li
            key={step.num}
            aria-current={step.current ? 'step' : undefined}
            className={cn(
              'relative flex min-h-24 w-36 flex-none snap-start flex-col justify-between rounded-card p-3.5 transition-all duration-300 lg:w-auto',
              step.current
                ? 'bg-cobalt text-chalk shadow-elevation-2 ring-2 ring-cobalt/40 hover:scale-102'
                : 'bg-chalk text-ink shadow-outline-hairline hover:bg-linen'
            )}
          >
            <div className="flex items-center justify-between">
              <span
                className={cn(
                  'font-display text-13 font-bold',
                  step.current ? 'text-chalk' : 'text-stone'
                )}
              >
                الخطوة {step.num}
              </span>
              {step.current ? (
                <span className="flex size-2 rounded-pill bg-citron animate-ping" />
              ) : null}
            </div>

            <div className="flex flex-col gap-0.5">
              <span className="font-display text-15 font-bold leading-20">
                {step.title}
              </span>
              <span
                className={cn(
                  'text-11 leading-16',
                  step.current ? 'text-chalk/85' : 'text-stone'
                )}
              >
                {step.subtitle}
              </span>
            </div>

            {idx < steps.length - 1 ? (
              <Icon
                name="chevron-forward"
                size={14}
                strokeWidth={2}
                className="absolute -end-2 top-1/2 hidden -translate-y-1/2 text-stone/40 lg:block"
              />
            ) : null}
          </li>
        ))}
      </ol>
    </Section>
  );
}

/**
 * Side-by-side Results vs Warnings Cards matching the design reference.
 */
export function ProductSuitability({ product }: { product: ProductDetail }) {
  const results = [
    'خلال 48 ساعة: توازن فوري في إفراز الزيوت وتقليل لمعان البشرة.',
    'خلال 14 يوماً: تراجع واضح في مظهر المسام وملمس أنعم وأكثر نقاءً.',
    'خلال 28 يوماً: توحيد ملحوظ لدرجة لون البشرة وتلاشي آثار وبقع الحبوب القديمة.',
  ];

  const warnings = [
    'تجنب ملامسة محيط العينين والشفتين مباشرة؛ وفي حال الملامسة تُشطف بالماء النظيف.',
    'لا يُستخدم في نفس الخطوة مع فيتامين C النقي (L-Ascorbic Acid) لتجنب التفاعل الحمضي.',
    'للاستخدام الخارجي فقط، ويُحفظ في مكان بارد وجاف بعيداً عن أشعة الشمس المباشرة.',
  ];

  return (
    <Section labelledBy={`pdp-suitability-${product.id}`} rhythm="compact">
      <div className="grid gap-4 md:grid-cols-2 lg:gap-5">
        {/* Results Card */}
        <div className="flex flex-col gap-3 rounded-card bg-ok-tint p-5 shadow-outline-ok">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-pill bg-ok text-chalk">
              <Icon name="check" size={18} strokeWidth={2.4} />
            </span>
            <h3 className="m-0 font-display text-17 font-bold text-ink">
              النتائج مع الاستخدام المنتظم
            </h3>
          </div>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-13.5 leading-22 text-ink">
            {results.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-2 size-1.5 flex-none rounded-pill bg-ok" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Warnings Card */}
        <div className="flex flex-col gap-3 rounded-card bg-conflict p-5 shadow-outline-tomato">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-pill bg-tomato-ink text-chalk">
              <Icon name="alert" size={18} strokeWidth={2.4} />
            </span>
            <h3 className="m-0 font-display text-17 font-bold text-ink">
              تحذيرات وإرشادات هامة
            </h3>
          </div>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-13.5 leading-22 text-ink">
            {warnings.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-2 size-1.5 flex-none rounded-pill bg-tomato-ink" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}

/**
 * «قد يعجبك أيضاً»: 4 matching skincare products from StarVille with quick add (+) button.
 */
export function RelatedProducts({ product }: { product: ProductDetail }) {
  const locale = useLocale();
  const { addItem } = useCart();
  const [addedId, setAddedId] = useState<string | null>(null);

  const handleQuickAdd = async (id: string) => {
    setAddedId(id);
    try {
      await addItem({ skuId: id, quantity: 1 });
    } catch {
      // Fallback
    }
    setTimeout(() => setAddedId(null), 1800);
  };

  return (
    <Section labelledBy={`pdp-related-${product.id}`} rhythm="compact">
      <SectionHeader
        title="قد يعجبك أيضاً"
        titleId={`pdp-related-${product.id}`}
        lead="منتجات متكاملة من نفس روتين العناية"
        aside={
          <ArrowLink href={routes.products}>
            عرض كل المنتجات
          </ArrowLink>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:gap-4">
        {MOCK_RELATED_PRODUCTS_LIST.map((item) => (
          <div
            key={item.id}
            className={cn(
              cardVariants(),
              'group relative flex flex-col justify-between overflow-hidden p-3.5 transition-all duration-300 hover:-translate-y-1 hover:shadow-elevation-2'
            )}
          >
            <div className="relative aspect-square w-full overflow-hidden rounded-image bg-chalk p-3">
              <Image
                src={item.primaryImage}
                alt={item.name}
                fill
                sizes="(min-width: 1024px) 240px, 160px"
                className="object-contain p-2 transition-transform duration-500 group-hover:scale-105"
              />
            </div>

            <div className="mt-3 flex flex-1 flex-col gap-1">
              <span className="font-serif text-12 italic text-stone">
                {item.brand.name}
              </span>
              <h4 className="m-0 line-clamp-2 font-display text-14 font-bold leading-20 text-ink">
                {item.name}
              </h4>

              <div className="mt-auto flex items-center justify-between pt-2">
                <span className="font-display text-16 font-bold text-ink">
                  {formatAmount(item.price.amount, locale)}{' '}
                  <span className="text-12 font-normal text-stone">ج.م</span>
                </span>

                <button
                  type="button"
                  aria-label="أضف إلى السلة"
                  onClick={() => handleQuickAdd(item.id)}
                  className={cn(
                    'flex size-9 items-center justify-center rounded-pill transition-all duration-200 active:scale-90',
                    addedId === item.id
                      ? 'bg-ok text-chalk scale-110'
                      : 'bg-cobalt text-chalk hover:bg-cobalt-deep shadow-elevation-1'
                  )}
                >
                  <Icon
                    name={addedId === item.id ? 'check' : 'plus'}
                    size={16}
                    strokeWidth={2.4}
                  />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
