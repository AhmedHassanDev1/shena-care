import Image from 'next/image';
import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { fillMessage, getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { mainCategorySlugs, routes } from '@/lib/routes';
import { SectionHeader } from '@/components/ui/section-header';

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
              className="group relative block h-36 overflow-hidden rounded-md bg-sand sm:h-48 lg:h-60"
            >
              <Image
                src={category.image}
                alt=""
                fill
                sizes="(min-width: 1280px) 600px, 50vw"
                className="object-cover object-right transition-transform duration-settle ease-out motion-safe:group-hover:scale-[1.03]"
              />
              <span className="absolute inset-x-2 bottom-2 flex min-h-control-m items-center justify-between gap-2 rounded-pill bg-card px-4 text-label text-foreground lg:inset-x-auto lg:bottom-4 lg:start-4 lg:w-fit lg:gap-8">
                {category.label}
                <Icon name="chevron-forward" size={18} className="text-primary" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
