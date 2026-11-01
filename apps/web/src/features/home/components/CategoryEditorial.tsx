'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Section, SectionHeader } from '@/components/layout/section';
import { Icon } from '@/components/ui/icon';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { mainCategorySlugs, routes } from '@/lib/routes';
import { HOME_IMAGES } from '../lib/home-images';

/**
 * The two departments as photographic doors. Copy names what each department actually holds (the catalog's own
 * categories), never an efficacy claim. The scrim exists only so the type stays readable on the photograph.
 */
export function CategoryEditorial() {
  const m = useMessages();

  const departments = [
    {
      id: 'skin',
      title: m.homeCategorySkinTitle,
      body: m.homeCategorySkinBody,
      cta: m.homeCategorySkinCta,
      href: routes.productsByCategory(mainCategorySlugs.skin),
      image: HOME_IMAGES.routineSkin,
    },
    {
      id: 'hair',
      title: m.homeCategoryHairTitle,
      body: m.homeCategoryHairBody,
      cta: m.homeCategoryHairCta,
      href: routes.productsByCategory(mainCategorySlugs.hair),
      image: HOME_IMAGES.routineHair,
    },
  ];

  return (
    <Section labelledBy="home-departments-title">
      <SectionHeader title={m.homeCategoriesTitle} titleId="home-departments-title" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:gap-6">
        {departments.map((dept) => (
          <Link
            key={dept.id}
            href={dept.href}
            className="group relative isolate flex aspect-[4/3] flex-col justify-end overflow-hidden rounded-image bg-sand p-5 text-chalk no-underline sm:aspect-[4/5] sm:p-7 lg:aspect-[5/4] lg:p-9"
          >
            <Image
              src={dept.image.src}
              alt=""
              fill
              sizes="(min-width: 1360px) 650px, (min-width: 640px) 50vw, 100vw"
              className="-z-20 object-cover transition-transform duration-slow ease-standard motion-safe:group-hover:scale-[1.03]"
              style={{ objectPosition: dept.image.position }}
            />
            <span aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-t from-ink/85 via-ink/35 via-45% to-transparent" />

            <h3 className="m-0 font-display text-28 font-extrabold leading-tight text-chalk lg:text-40">{dept.title}</h3>
            <p className="m-0 mt-2 max-w-sm text-15 leading-24 text-chalk/90 lg:text-16 lg:leading-26">{dept.body}</p>
            <span className="mt-4 inline-flex h-control-s items-center gap-2 self-start rounded-pill bg-chalk px-5 text-14 font-bold text-ink shadow-elevation-1 transition-colors duration-fast group-hover:bg-cobalt group-hover:text-chalk">
              {dept.cta}
              <Icon name="arrow-forward" size={16} strokeWidth={2.2} />
            </span>
          </Link>
        ))}
      </div>
    </Section>
  );
}
