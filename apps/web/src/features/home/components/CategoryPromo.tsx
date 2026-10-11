import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { Messages } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { SectionHeading } from './SectionHeading';

const CATEGORIES = [
  {
    id: 'skin-care',
    titleKey: 'categorySkinTitle',
    copyKey: 'categorySkinCopy',
    image: '/assets/home/skincare-still-life.webp',
  },
  {
    id: 'hair-care',
    titleKey: 'categoryHairTitle',
    copyKey: 'categoryHairCopy',
    image: '/assets/home/haircare-still-life.webp',
  },
] as const;

/**
 * The still-lifes keep their products on one side. The photo is mirrored in RTL (`rtl-mirror`) so the
 * products always sit opposite the copy, and a token gradient from the copy side keeps text readable.
 */
export function CategoryPromo({ m }: { m: Messages }) {
  return (
    <section aria-labelledby="categories-title" className="pt-12 md:pt-16">
      <SectionHeading id="categories-title" title={m.categoriesTitle} />
      <div className="grid gap-4 md:grid-cols-2 md:gap-5">
        {CATEGORIES.map((category) => (
          <Link
            key={category.id}
            href={`${routes.products}?category=${category.id}`}
            className="group relative isolate flex flex-col overflow-hidden rounded-md bg-primary-subtle md:min-h-[16rem] md:flex-row"
          >
            {/* Mobile: photo on top fading into the copy panel. md+: full-bleed photo, copy over a side fade. */}
            <span aria-hidden="true" className="rtl-mirror relative -z-10 h-40 w-full overflow-hidden md:absolute md:inset-0 md:h-auto">
              <Image
                src={category.image}
                alt=""
                fill
                sizes="(min-width: 768px) 50vw, 100vw"
                className="object-cover object-[80%_60%] transition-transform duration-base ease-standard group-hover:scale-[1.02]"
              />
              <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-primary-subtle to-transparent md:hidden" />
              {/* Physical `left` on purpose: this layer is inside the mirrored wrapper, so it lands on the
                  copy side (inline start) in both directions. */}
              <span className="absolute inset-y-0 left-0 hidden w-[80%] bg-gradient-to-r from-primary-subtle from-35% via-primary-subtle/80 to-transparent md:block" />
            </span>
            <span className="flex flex-col justify-end px-5 pb-5 pt-1 md:max-w-[55%] md:p-6">
              <strong className="text-h2 font-semibold text-foreground">{m[category.titleKey]}</strong>
              <span className="mt-1 text-support text-foreground/80">{m[category.copyKey]}</span>
              <span className="mt-4 inline-flex items-center gap-1.5 text-support font-semibold text-primary">
                {m.categoryCta}
                <ArrowRight aria-hidden="true" className="rtl-mirror size-4" />
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
