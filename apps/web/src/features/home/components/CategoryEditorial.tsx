'use client';

import Image from 'next/image';
import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Icon } from '@/components/ui/icon';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { mainCategorySlugs, routes } from '@/lib/routes';
import { HOME_IMAGES } from '../lib/home-images';

/**
 * Modern Beauty Editorial: Category Editorial
 * Two striking photographic compositions for SKINCARE and HAIRCARE with edge-to-edge imagery,
 * sophisticated dark overlays, bold typography, and clear editorial navigation.
 */
export function CategoryEditorial() {
  const m = useMessages();

  const categories = [
    {
      id: 'skin',
      englishTitle: 'SKINCARE · ESSENTIALS',
      arabicTitle: 'العناية الفائقة بالبشرة',
      description: 'تركيبات متوازنة مدعومة بالمكونات الفعالة لترميم الحاجز واستعادة نضارة البشرة الطبيعية.',
      ctaText: 'استكشاف مستحضرات البشرة',
      href: routes.productsByCategory(mainCategorySlugs.skin),
      image: HOME_IMAGES.routineSkin,
    },
    {
      id: 'hair',
      englishTitle: 'HAIRCARE · NOURISHMENT',
      arabicTitle: 'العناية المتكاملة بالشعر',
      description: 'علاجات مركزة لتغذية الفروة، تقوية الألياف، ومقاومة التساقط والهيشان من الجذور.',
      ctaText: 'استكشاف مستحضرات الشعر',
      href: routes.productsByCategory(mainCategorySlugs.hair),
      image: HOME_IMAGES.routineHair,
    },
  ];

  return (
    <section aria-labelledby="home-category-editorial-title" className="py-8 lg:py-12">
      <PageContainer className="flex flex-col gap-6">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-cobalt" />
          <h2 id="home-category-editorial-title" className="m-0 font-serif italic text-14 text-stone">
            Editorial Perspectives · عالم العناية
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
          {categories.map((cat) => (
            <article
              key={cat.id}
              className="group relative isolate flex min-h-[420px] flex-col justify-end overflow-hidden rounded-card bg-sand p-6 text-chalk shadow-e1 transition-all duration-base sm:min-h-[480px] sm:p-8 lg:min-h-[520px] lg:p-10"
            >
              {/* Category Background Photography */}
              <div className="absolute inset-0 -z-20 overflow-hidden">
                <Image
                  src={cat.image.src}
                  alt=""
                  fill
                  sizes="(min-width: 1024px) 50vw, 100vw"
                  className="object-cover transition-transform duration-slow ease-standard group-hover:scale-105"
                  style={{ objectPosition: cat.image.position }}
                />
              </div>

              {/* Scrim Overlay */}
              <div
                aria-hidden="true"
                className="absolute inset-0 -z-10 bg-gradient-to-t from-ink via-ink/60 via-45% to-transparent transition-opacity duration-base group-hover:via-ink/50"
              />

              {/* Card Editorial Content */}
              <div className="flex flex-col items-start gap-3">
                <span className="font-serif italic text-13 tracking-wider text-chalk/80 sm:text-14">
                  {cat.englishTitle}
                </span>

                <h3 className="m-0 font-display text-26 font-black leading-tight text-chalk sm:text-30 lg:text-36">
                  {cat.arabicTitle}
                </h3>

                <p className="m-0 max-w-md text-13.5 leading-22 text-chalk/90 sm:text-14 sm:leading-24">
                  {cat.description}
                </p>

                <Link
                  href={cat.href}
                  className="mt-2 inline-flex h-11 items-center justify-center gap-2 rounded-pill bg-chalk px-5 text-13 font-bold text-ink shadow-e1 transition-all duration-fast hover:bg-cobalt hover:text-chalk active:scale-95"
                >
                  <span>{cat.ctaText}</span>
                  <Icon name="arrow-forward" size={16} strokeWidth={2.2} />
                </Link>
              </div>
            </article>
          ))}
        </div>
      </PageContainer>
    </section>
  );
}
