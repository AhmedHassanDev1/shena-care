import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Icon } from '@/components/ui/icon';
import { iconButtonVariants } from '@/components/ui/icon-button';
import { Wordmark } from '@/components/ui/wordmark';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { mainCategorySlugs, routes } from '@/lib/routes';
import { ProductSearch } from '@/features/catalog/components/ProductSearch';
import { CartLink } from './CartLink';

/**
 * Browsing header (Main / PLP / PDP / CartD desktop; Mobile / PLPMobile phone). Two compositions, one per form factor:
 *  - phone (< lg): 48-tall row with the wordmark (28/30) and the account + cart icons, then the 50-tall search;
 *  - desktop (lg+): wordmark + SHINACARE, the search (max 580), «حسابي» and the night «السلة» pill; under it the
 *    department row (15/25, 500). Inset 1px line hairline at the bottom.
 * Department entries only link to destinations the catalog has (skin-care, hair-care roots; the listing for brands).
 */
export function SiteHeader({ searchDefault }: { searchDefault?: string }) {
  const m = getMessages(getLocale());
  const departments = [
    { href: routes.productsByCategory(mainCategorySlugs.skin), label: m.navSkin },
    { href: routes.productsByCategory(mainCategorySlugs.hair), label: m.navHair },
    { href: routes.products, label: m.navBrands },
    { href: routes.routineBuilder, label: m.navBuildRoutine },
  ];
  const search = (id: string) => (
    <ProductSearch id={id} label={m.shellSearchLabel} placeholder={m.shellSearchPlaceholder} defaultValue={searchDefault} />
  );

  return (
    <header className="bg-bone lg:shadow-hairline-bottom">
      {/* Phone */}
      <div className="flex flex-col gap-2 px-4 pt-1.5 lg:hidden">
        <div className="flex h-12 items-center justify-between">
          <Link href={routes.home} aria-label={m.shellHome} className="inline-flex min-h-control-s items-center text-night no-underline">
            <Wordmark />
          </Link>
          <div className="flex items-center gap-1">
            <Link href={routes.account} aria-label={m.shellAccount} className={iconButtonVariants()}>
              <Icon name="user" size={24} />
            </Link>
            <CartLink variant="icon" />
          </div>
        </div>
        {search('site-search-m')}
      </div>

      {/* Desktop */}
      <div className="hidden lg:block">
        <PageContainer className="flex flex-wrap items-center gap-x-8 gap-y-4 pb-3 pt-4.5">
          <Link href={routes.home} aria-label={m.shellHome} className="inline-flex min-h-control-s items-center text-night no-underline">
            <Wordmark withLatin />
          </Link>
          <div className="min-w-0 max-w-search-max flex-[1_1_340px]">{search('site-search-d')}</div>
          <nav aria-label={m.shellAccountNav} className="ms-auto flex items-center gap-1.5">
            <Link
              href={routes.account}
              className="inline-flex h-control-s items-center gap-2 rounded-pill px-3.5 text-14 font-medium text-night no-underline hover:text-blue"
            >
              <Icon name="user" size={22} />
              <span>{m.shellAccount}</span>
            </Link>
            <CartLink variant="pill" />
          </nav>
        </PageContainer>
        <PageContainer>
          <nav aria-label={m.shellDepartments} className="flex flex-wrap gap-x-8 pb-1 text-15 font-medium leading-25">
            {departments.map((d) => (
              <Link key={d.label} href={d.href} className="py-2.5 text-night no-underline hover:text-blue">
                {d.label}
              </Link>
            ))}
          </nav>
        </PageContainer>
      </div>
    </header>
  );
}
