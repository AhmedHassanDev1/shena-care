import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { WordmarkLink } from '@/components/navigation/wordmark-link';
import { fillMessage, getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { mainCategorySlugs, routes } from '@/lib/routes';

const linkClass =
  'inline-flex min-h-control-s items-center text-body-s text-muted-foreground underline decoration-transparent underline-offset-4 transition-[color,text-decoration-color] duration-quick hover:text-primary hover:decoration-current';

/**
 * Footer: destinations that exist plus a statement of what the store is. Desktop gets three link columns;
 * phones get a compact version (brand, tagline, two link rows, rights) that clears the fixed bottom navigation.
 */
export function DesktopFooter() {
  const m = getMessages(getLocale());
  const columns = [
    {
      title: m.footerShop,
      links: [
        { href: routes.products, label: m.homeNavProducts },
        { href: routes.productsByCategory(mainCategorySlugs.skin), label: m.homeNavSkin },
        { href: routes.productsByCategory(mainCategorySlugs.hair), label: m.homeNavHair },
      ],
    },
    {
      title: m.footerHelp,
      links: [
        { href: routes.routineBuilder, label: m.footerRoutines },
        { href: routes.products, label: m.searchSubmit },
      ],
    },
    {
      title: m.footerAccount,
      links: [
        { href: routes.account, label: m.homeNavAccount },
        { href: routes.cart, label: m.homeNavCart },
      ],
    },
  ];
  const rights = <bdi dir="ltr">{fillMessage(m.footerRights, { year: new Date().getFullYear() })}</bdi>;

  return (
    <footer className="mt-12 border-t border-border bg-card lg:mt-16">
      {/* Desktop */}
      <PageContainer className="hidden justify-between gap-12 py-12 lg:flex">
        <div className="grid max-w-sm content-start gap-3">
          <WordmarkLink label={m.authHome} size="m" className="-ms-1" />
          <p className="text-body-s text-muted-foreground">{m.footerTagline}</p>
        </div>
        <nav aria-label={m.footerShop} className="flex gap-16">
          {columns.map((column) => (
            <div key={column.title}>
              <p className="text-label text-foreground">{column.title}</p>
              <ul className="mt-2 grid">
                {column.links.map((link) => (
                  <li key={link.href + link.label}>
                    <Link href={link.href} className={linkClass}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </PageContainer>

      {/* Phones and tablets */}
      <PageContainer className="grid gap-4 py-8 lg:hidden">
        <WordmarkLink label={m.authHome} size="m" className="-ms-1 w-fit" />
        <p className="max-w-md text-body-s text-muted-foreground">{m.footerTagline}</p>
        <ul className="flex flex-wrap gap-x-5">
          {[...columns[0].links, columns[1].links[0]].map((link) => (
            <li key={link.href + link.label}>
              <Link href={link.href} className={linkClass}>
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </PageContainer>

      <p className="border-t border-border-subtle py-4 text-center text-caption text-muted-foreground">{rights}</p>
    </footer>
  );
}
