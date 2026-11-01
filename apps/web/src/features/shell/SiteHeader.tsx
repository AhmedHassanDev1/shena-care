import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Icon } from '@/components/ui/icon';
import { iconButtonVariants } from '@/components/ui/icon-button';
import { Wordmark } from '@/components/ui/wordmark';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { mainCategorySlugs, routes, shellRoutes } from '@/lib/routes';
import { ProductSearch } from '@/features/catalog/components/ProductSearch';
import { CartLink } from './CartLink';

/**
 * Sahel Site Header: Lime-wash chalk ground, hairline border, search pill, clean typography.
 */
export function SiteHeader({ searchDefault }: { searchDefault?: string }) {
  const m = getMessages(getLocale());
  const departments = [
    { href: routes.productsByCategory(mainCategorySlugs.skin), label: m.navSkin },
    { href: routes.productsByCategory(mainCategorySlugs.hair), label: m.navHair },
    { href: routes.products, label: m.navBrands },
    { href: shellRoutes.routines, label: m.homeNavRoutines },
    { href: routes.routineBuilder, label: m.navBuildRoutine },
    { href: shellRoutes.shina, label: m.footerAskShina, isAssistant: true },
  ];
  const search = (id: string) => (
    <ProductSearch id={id} label={m.shellSearchLabel} placeholder={m.shellSearchPlaceholder} defaultValue={searchDefault} />
  );

  return (
    <header className="bg-chalk border-b border-ink/15">
      {/* Phone */}
      <div className="flex flex-col gap-2.5 px-4 pb-3 pt-2 lg:hidden">
        <div className="flex h-12 items-center justify-between">
          <Link href={routes.home} aria-label={m.shellHome} className="inline-flex min-h-control-s items-center text-ink no-underline">
            <Wordmark />
          </Link>
          <div className="flex items-center gap-1.5">
            <Link href={routes.account} aria-label={m.shellAccount} className={iconButtonVariants({ variant: 'plain' })}>
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
          <Link href={routes.home} aria-label={m.shellHome} className="inline-flex min-h-control-s items-center text-ink no-underline">
            <Wordmark withLatin />
          </Link>
          <div className="min-w-0 max-w-search-max flex-[1_1_340px]">{search('site-search-d')}</div>
          <nav aria-label={m.shellAccountNav} className="ms-auto flex items-center gap-2">
            <Link
              href={routes.account}
              className="inline-flex h-control-s items-center gap-2 rounded-pill px-4 text-15 font-display font-medium text-ink no-underline hover:text-cobalt transition-colors"
            >
              <Icon name="user" size={20} />
              <span>{m.shellAccount}</span>
            </Link>
            <CartLink variant="pill" />
          </nav>
        </PageContainer>
        <PageContainer>
          <nav aria-label={m.shellDepartments} className="flex flex-wrap items-center gap-x-8 pb-2.5 text-16 font-display font-medium">
            {departments.map((d) => (
              <Link
                key={d.label}
                href={d.href}
                className="py-2 inline-flex items-center gap-2 text-ink no-underline hover:text-cobalt transition-colors"
              >
                {d.isAssistant ? <span className="sun sm" style={{ width: 18, height: 18, boxShadow: '0 0 0 3px rgba(228,238,60,.3)' }} /> : null}
                <span>{d.label}</span>
              </Link>
            ))}
          </nav>
        </PageContainer>
      </div>
    </header>
  );
}
