import Link from 'next/link';
import { fillMessage, getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { mainCategorySlugs, routes } from '@/lib/routes';
import { Wordmark } from './Wordmark';

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
      <div className="mx-auto flex max-w-7xl justify-between gap-12 px-8 py-10">
        <div className="max-w-sm">
          <Wordmark label={m.authHome} className="-ms-1" />
          <p className="mt-3 text-support text-muted-foreground">{m.footerTagline}</p>
        </div>
        <nav aria-label={m.footerShop} className="flex gap-16">
          {columns.map((column) => (
            <div key={column.title}>
              <p className="text-support font-semibold text-foreground">{column.title}</p>
              <ul className="mt-2 space-y-0.5">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="inline-flex min-h-9 items-center text-support text-muted-foreground hover:text-primary"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <p className="border-t border-border-subtle py-4 text-center text-caption text-muted-foreground">
        <bdi dir="ltr">{fillMessage(m.footerRights, { year: new Date().getFullYear() })}</bdi>
      </p>
    </footer>
  );
}
