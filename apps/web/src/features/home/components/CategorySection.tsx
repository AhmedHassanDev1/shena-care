import Image from 'next/image';
import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { SectionHeader } from '@/components/ui/section-header';
import { fillMessage, getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { mainCategorySlugs, routes } from '@/lib/routes';

/**
 * The two MVP entry points as photographic campaign tiles. Each has its own still life (unbranded packaging,
 * never shown elsewhere on Home) and atmosphere: skin in blush rose, hair in warm saffron. The photograph sits
 * on the end side (mirrored in RTL); the copy sits on a solid atmosphere scrim on the start side, so contrast
 * never depends on the picture.
 */
export function CategorySection() {
  const m = getMessages(getLocale());
  const categories = [
    {
      slug: mainCategorySlugs.skin,
      label: m.homeNavSkin,
      hint: m.categorySkinDescription,
      atmosphere: 'rose',
      src: '/assets/home/skincare-still-life.webp',
      position: 'object-[80%_60%]',
    },
    {
      slug: mainCategorySlugs.hair,
      label: m.homeNavHair,
      hint: m.categoryHairDescription,
      atmosphere: 'saffron',
      src: '/assets/home/haircare-still-life.webp',
      position: 'object-[78%_55%]',
    },
  ] as const;

  return (
    <section aria-labelledby="home-categories">
      <SectionHeader id="home-categories" title={m.categoriesTitle} />
      <ul className="grid gap-3 sm:grid-cols-2 lg:gap-4">
        {categories.map(({ slug, label, hint, atmosphere, src, position }) => (
          <li key={slug}>
            <Link
              href={routes.productsByCategory(slug)}
              data-atmosphere={atmosphere}
              aria-label={fillMessage(m.categoryShopLabel, { name: label })}
              className="group relative isolate flex h-48 items-center overflow-hidden rounded-lg bg-atm-wash lg:h-64"
            >
              {/* The wrapper mirrors (RTL); the image itself only zooms, so the two transforms never collide. */}
              <span aria-hidden="true" className="absolute inset-0 -z-10 rtl:-scale-x-100">
                <Image
                  src={src}
                  alt=""
                  fill
                  sizes="(min-width: 600px) 50vw, 100vw"
                  className={`object-cover ${position} transition-transform duration-settle ease-out motion-safe:group-hover:scale-[1.03]`}
                />
              </span>
              <span
                aria-hidden="true"
                className="absolute inset-0 -z-10 from-atm-wash from-40% via-atm-wash/85 via-55% to-transparent to-80% ltr:bg-gradient-to-r rtl:bg-gradient-to-l lg:from-30% lg:via-45% lg:to-70%"
              />
              <span className="grid max-w-[60%] gap-1.5 px-5 lg:max-w-[55%] lg:gap-2 lg:px-7">
                <span className="text-display-m text-foreground lg:text-display-l">{label}</span>
                <span className="text-body-s text-ink-soft">{hint}</span>
                <span className="mt-2 inline-flex min-h-control-m w-fit items-center gap-2 rounded-pill bg-primary px-5 text-label text-primary-foreground transition-colors duration-quick group-hover:bg-primary-hover">
                  {m.viewAll}
                  <Icon name="chevron-forward" size={18} />
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
