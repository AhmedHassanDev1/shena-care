import Link from 'next/link';
import { fillMessage, getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { mainCategorySlugs, routes } from '@/lib/routes';
import { PageContainer } from '@/components/layout/page-container';
import { WordmarkLink } from '@/components/navigation/wordmark-link';

/** Desktop footer: only destinations that exist and a statement of what the store is. */
export function DesktopFooter() {
  const m = getMessages(getLocale());
  const columns = [
    {
      title: m.footerShop,
      links: [
        { href: routes.products, label: m.homeNavProducts },
        { href: routes.productsByCategory(mainCategorySlugs.skin), label: m.homeNavSkin },
        { href: routes.productsByCategory(mainCategorySlugs.hair), label: m.homeNavHair },
        { href: routes.routineBuilder, label: m.homeNavRoutines },
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

  return (
    <footer className="mt-16 hidden border-t border-border bg-card lg:block">
      <PageContainer className="flex justify-between gap-12 py-10">
        <div className="max-w-sm">
          <WordmarkLink label={m.authHome} size="m" className="-ms-1" />
          <p className="mt-3 text-body-s text-muted-foreground">{m.footerTagline}</p>
        </div>
        <nav aria-label={m.footerShop} className="flex gap-16">
          {columns.map((column) => (
            <div key={column.title}>
              <p className="text-label text-foreground">{column.title}</p>
              <ul className="mt-2 space-y-0.5">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="inline-flex min-h-control-s items-center text-body-s text-muted-foreground underline decoration-transparent underline-offset-4 transition-[color,text-decoration-color] duration-quick hover:text-primary hover:decoration-current"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </PageContainer>
      <p className="border-t border-border-subtle py-4 text-center text-caption text-muted-foreground">
        <bdi dir="ltr">{fillMessage(m.footerRights, { year: new Date().getFullYear() })}</bdi>
      </p>
    </footer>
  );
}
