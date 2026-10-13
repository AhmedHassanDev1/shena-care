import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { SectionHeader } from '@/components/ui/section-header';
import { fillMessage, getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { mainCategorySlugs, routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

/** Brand-owned vector artwork per category (arches, drops and waves): no photograph is repeated from the hero. */
function SkinArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 220 180" aria-hidden="true" className={cn('h-full w-auto', className)}>
      <path d="M40 180V84a70 70 0 0 1 140 0v96z" className="fill-atm-accent/35" />
      <path d="M78 180v-62a32 32 0 0 1 64 0v62z" className="fill-card/85" />
      <circle cx="170" cy="52" r="22" className="fill-atm-accent/70" />
      <path d="M62 38c12 15 19 24 19 33a19 19 0 0 1-38 0c0-9 7-18 19-33z" className="fill-atm-ink/80" />
      <circle cx="30" cy="120" r="7" className="fill-atm-accent" />
      <circle cx="196" cy="118" r="4" className="fill-atm-ink/60" />
    </svg>
  );
}

function HairArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 220 180" aria-hidden="true" className={cn('h-full w-auto', className)}>
      <circle cx="150" cy="58" r="40" className="fill-atm-accent/55" />
      <g fill="none" strokeWidth="7" strokeLinecap="round" className="stroke-atm-ink/75">
        <path d="M40 180c0-34 26-34 26-68s-26-34-26-68" />
        <path d="M84 180c0-34 26-34 26-68S84 78 84 44" />
        <path d="M128 180c0-34 26-34 26-68s-26-34-26-68" className="stroke-atm-accent" />
        <path d="M172 180c0-34 22-34 22-68" />
      </g>
    </svg>
  );
}

/** The two MVP entry points, as editorial tiles: each has its own atmosphere and artwork. The label sits on a solid surface. */
export function CategorySection() {
  const m = getMessages(getLocale());
  const categories = [
    { slug: mainCategorySlugs.skin, label: m.homeNavSkin, hint: m.categorySkinDescription, atmosphere: 'rose', Art: SkinArt },
    { slug: mainCategorySlugs.hair, label: m.homeNavHair, hint: m.categoryHairDescription, atmosphere: 'saffron', Art: HairArt },
  ] as const;

  return (
    <section aria-labelledby="home-categories">
      <SectionHeader id="home-categories" title={m.categoriesTitle} />
      <ul className="grid gap-3 sm:grid-cols-2 lg:gap-4">
        {categories.map(({ slug, label, hint, atmosphere, Art }) => (
          <li key={slug}>
            <Link
              href={routes.productsByCategory(slug)}
              data-atmosphere={atmosphere}
              aria-label={fillMessage(m.categoryShopLabel, { name: label })}
              className="group relative flex h-44 items-end justify-between gap-4 overflow-hidden rounded-md bg-gradient-to-br from-atm-wash to-atm-surface p-5 lg:h-56 lg:p-7"
            >
              <span className="relative z-10 grid gap-2">
                <span className="text-display-m text-foreground lg:text-display-l">{label}</span>
                <span className="max-w-[16rem] text-body-s text-ink-soft">{hint}</span>
                <span className="mt-1 inline-flex min-h-control-m w-fit items-center gap-2 rounded-pill bg-card px-4 text-label text-primary transition-colors duration-quick group-hover:bg-primary group-hover:text-primary-foreground">
                  {m.viewAll}
                  <Icon name="chevron-forward" size={18} />
                </span>
              </span>
              <Art className="absolute bottom-0 end-0 h-[88%] translate-y-1 opacity-95 transition-transform duration-settle ease-out motion-safe:group-hover:-translate-y-1" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
