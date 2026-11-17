'use client';

import Image from 'next/image';
import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Reveal } from '@/components/motion/reveal';
import { Icon } from '@/components/ui/icon';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { mainCategorySlugs, routes } from '@/lib/routes';

/**
 * CategoryEditorial — Approved ShinaCare Sahel Category Showcase.
 *
 * Visual fidelity from Stitch project 15850160123086413494:
 * - Asymmetric 2-Card Layout (Desktop 1024px+):
 *   1. Skincare (67% width, leading / right in RTL):
 *      - Natural photographic spread on the right half.
 *      - Sunlit tomato slatted shutter panel on the left half with hydration badge,
 *        prominent editorial typography, and solid ink pill CTA.
 *   2. Haircare (33% width, trailing / left in RTL):
 *      - Natural photographic spread on the top (52%).
 *      - Sunlit cobalt slatted shutter panel on the bottom (48%) with
 *        crisp typography and chalk-outlined pill CTA.
 * - Mobile-first responsive hierarchy:
 *   - Stacks cleanly on phones (< 768px) with generous image viewports,
 *     responsive typography, and full-width pill targets that never wrap.
 *   - Seamless side-by-side split on tablets (768px+) and asymmetric layout on desktop.
 * - Adheres 100% to SAHEL Design System tokens (0 raw hex, 0 unapproved utilities,
 *   RTL logical directional behavior, and accessible semantics).
 */
export function CategoryEditorial() {
  const m = useMessages();

  return (
    <section id="categories" aria-labelledby="home-categories-heading" className="overflow-hidden py-8 lg:py-14">
      <PageContainer className="flex flex-col gap-6 lg:gap-8">
        <Reveal className="flex max-w-2xl flex-col gap-2">
          <h2 id="home-categories-heading" className="m-0 font-display text-display-1 font-extrabold tracking-tight text-ink">
            {m.homeCategoriesTitle}
          </h2>
          <p className="m-0 text-body text-stone">{m.homeCategoriesSubtitle}</p>
        </Reveal>

        {/* Two photographs, the first wider; the caption sits under the picture, not on a coloured slab. */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3 lg:gap-10">
          <CategoryFigure
            href={routes.productsByCategory(mainCategorySlugs.skin)}
            src="/assets/categories/skincare-editorial.png"
            title={m.homeCategorySkinTitle}
            body={m.homeCategorySkinBody}
            cta={m.homeCategorySkinCta}
            className="md:col-span-2"
            ratio="aspect-[4/3] md:aspect-[16/11]"
            sizes="(min-width: 768px) 66vw, 100vw"
            position="object-center"
          />
          <CategoryFigure
            href={routes.productsByCategory(mainCategorySlugs.hair)}
            src="/assets/categories/haircare-editorial.png"
            title={m.homeCategoryHairTitle}
            body={m.homeCategoryHairBody}
            cta={m.homeCategoryHairCta}
            ratio="aspect-[4/3] md:aspect-[3/4]"
            sizes="(min-width: 768px) 33vw, 100vw"
            position="object-top"
          />
        </div>
      </PageContainer>
    </section>
  );
}

function CategoryFigure({
  href, src, title, body, cta, className, ratio, sizes, position,
}: {
  href: string; src: string; title: string; body: string; cta: string;
  className?: string; ratio: string; sizes: string; position: string;
}) {
  return (
    <Reveal className={className}>
      <Link href={href} aria-label={title} className="group flex flex-col gap-4 text-ink no-underline">
        <div className={`relative w-full overflow-hidden rounded-sheet bg-sand ${ratio}`}>
          <Image
            src={src}
            alt={title}
            fill
            sizes={sizes}
            className={`object-cover ${position} transition-transform duration-slow ease-standard motion-safe:group-hover:scale-[1.03]`}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <h3 className="m-0 font-display text-display-2 font-bold text-ink">{title}</h3>
          <p className="m-0 max-w-md text-body text-stone">{body}</p>
          <span className="link-quiet mt-1 inline-flex w-fit items-center gap-2 font-display text-16 font-bold text-cobalt">
            {cta}
            <Icon name="arrow-forward" size={16} strokeWidth={2.2} className="transition-transform duration-fast ease-standard motion-safe:group-hover:-translate-x-1" />
          </span>
        </div>
      </Link>
    </Reveal>
  );
}
