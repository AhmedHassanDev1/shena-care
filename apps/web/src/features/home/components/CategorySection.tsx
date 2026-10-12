import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { fillMessage, getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { mainCategorySlugs, routes } from '@/lib/routes';
import { SectionHeader } from './SectionHeader';

/** The two MVP entry points. The label sits on a solid surface, never inside the artwork. */
export function CategorySection() {
  const m = getMessages(getLocale());
  const categories = [
    { slug: mainCategorySlugs.skin, label: m.homeNavSkin, image: '/assets/home/skincare-still-life.webp' },
    { slug: mainCategorySlugs.hair, label: m.homeNavHair, image: '/assets/home/haircare-still-life.webp' },
  ];

  return (
    <section aria-labelledby="home-categories">
      <SectionHeader id="home-categories" title={m.categoriesTitle} />
      <ul className="grid grid-cols-2 gap-3 lg:gap-4">
        {categories.map((category) => (
          <li key={category.slug}>
            <Link
              href={routes.productsByCategory(category.slug)}
              aria-label={fillMessage(m.categoryShopLabel, { name: category.label })}
              className="group relative block h-36 overflow-hidden rounded-lg bg-ambient sm:h-48 lg:h-60"
            >
              <Image
                src={category.image}
                alt=""
                fill
                sizes="(min-width: 1280px) 600px, 50vw"
                className="object-cover object-right transition-transform duration-base ease-standard motion-safe:group-hover:scale-[1.03]"
              />
              <span className="absolute inset-x-2 bottom-2 flex items-center justify-between gap-2 rounded-md bg-card px-3 py-2.5 text-support font-semibold text-foreground shadow-raised lg:inset-x-auto lg:bottom-4 lg:start-4 lg:w-fit lg:gap-8 lg:px-4 lg:text-body">
                {category.label}
                <ArrowLeft aria-hidden="true" className="size-4 shrink-0 text-primary ltr:rotate-180" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
