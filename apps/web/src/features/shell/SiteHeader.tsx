'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PageContainer } from '@/components/layout/page-container';
import { Icon } from '@/components/ui/icon';
import { iconButtonVariants } from '@/components/ui/icon-button';
import { Wordmark } from '@/components/ui/wordmark';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { mainCategorySlugs, routes, shellRoutes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { ProductSearch } from '@/features/catalog/components/ProductSearch';
import { CartLink } from './CartLink';

export interface SiteHeaderProps {
  searchDefault?: string;
}

/**
 * Sahel Global Responsive Header:
 * - Desktop: Two-row editorial layout with Wordmark (with Latin), proportional search, Account pill, Cart pill, and department navigation with active indicators.
 * - Tablet: Proportional search bar, Wordmark, and horizontally scrollable department bar preventing wrapping.
 * - Mobile: Dedicated touch-friendly composition with quick actions, accessible search, horizontal department quick-chips, and expandable menu.
 */
export function SiteHeader({ searchDefault }: SiteHeaderProps) {
  const m = useMessages();
  const pathname = usePathname() || '';
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const departments = [
    { href: routes.productsByCategory(mainCategorySlugs.skin), label: m.navSkin },
    { href: routes.productsByCategory(mainCategorySlugs.hair), label: m.navHair },
    { href: routes.products, label: m.navBrands },
    { href: shellRoutes.routines, label: m.homeNavRoutines },
    { href: routes.routineBuilder, label: m.navBuildRoutine },
    { href: shellRoutes.shina, label: m.footerAskShina, isAssistant: true },
  ];

  const search = (id: string) => (
    <ProductSearch
      id={id}
      label={m.shellSearchLabel}
      placeholder={m.shellSearchPlaceholder}
      defaultValue={searchDefault}
    />
  );

  return (
    <header className="bg-chalk border-b border-ink/15 sticky top-0 z-40 backdrop-blur-md bg-chalk/95">
      {/* ── Mobile View (< 768px) ── */}
      <div className="flex flex-col md:hidden">
        {/* Top bar: Brand + Actions */}
        <div className="flex h-14 items-center justify-between px-4">
          <Link
            href={routes.home}
            aria-label={m.shellHome}
            className="inline-flex min-h-control-s items-center text-ink no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt rounded-pill"
          >
            <Wordmark />
          </Link>

          <div className="flex items-center gap-1.5">
            <Link
              href={routes.account}
              aria-label={m.shellAccount}
              className={iconButtonVariants({ variant: 'plain' })}
            >
              <Icon name="user" size={22} />
            </Link>
            <CartLink variant="icon" />
            <button
              type="button"
              aria-label={mobileMenuOpen ? m.close : m.shellDepartments}
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className={iconButtonVariants({ variant: 'plain' })}
            >
              <Icon name={mobileMenuOpen ? 'close' : 'list'} size={22} />
            </button>
          </div>
        </div>

        {/* Mobile Search Bar */}
        <div className="px-4 pb-2.5 pt-0.5">{search('site-search-m')}</div>

        {/* Mobile Quick Department Chips (Horizontal Scroll) */}
        <nav
          aria-label={m.shellDepartments}
          className="no-scrollbar hidden items-center gap-2 overflow-x-auto px-4 pb-2.5 pt-0.5 md:flex"
        >
          {departments.map((d) => {
            const isActive = pathname === d.href || (d.href !== '/' && pathname.startsWith(d.href));
            return (
              <Link
                key={d.label}
                href={d.href}
                className={cn(
                  'inline-flex flex-none items-center gap-1.5 rounded-pill px-3 py-1 text-12 font-display font-semibold transition-colors duration-fast no-underline',
                  isActive
                    ? 'bg-cobalt text-chalk shadow-elevation-1'
                    : 'border border-line/60 bg-linen text-ink hover:border-line hover:bg-chalk'
                )}
              >
                {d.isAssistant ? (
                  <span
                    className="size-1.5 rounded-full bg-citron ring-2 ring-citron/40"
                    aria-hidden="true"
                  />
                ) : null}
                <span>{d.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Collapsible Mobile Drawer Menu */}
        {mobileMenuOpen ? (
          <div className="border-t border-line/50 bg-linen px-4 py-3 shadow-elevation-2 animate-in fade-in slide-in-from-top-2 duration-fast">
            <div className="flex flex-col gap-1">
              <span className="text-11 font-display font-bold uppercase tracking-wider text-stone mb-1">
                {m.homeNavCategories}
              </span>
              {departments.map((d) => {
                const isActive = pathname === d.href || (d.href !== '/' && pathname.startsWith(d.href));
                return (
                  <Link
                    key={d.label}
                    href={d.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      'flex items-center justify-between rounded-card px-3 py-2.5 text-14 font-display font-semibold transition-colors no-underline',
                      isActive ? 'bg-cobalt text-chalk' : 'text-ink hover:bg-chalk hover:text-cobalt'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {d.isAssistant ? (
                        <span className="size-2 rounded-full bg-citron ring-2 ring-citron/40" />
                      ) : null}
                      <span>{d.label}</span>
                    </div>
                    <Icon name="chevron-forward" size={16} />
                  </Link>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      {/* ── Tablet View (768px – 1023px) ── */}
      <div className="hidden md:block lg:hidden">
        <PageContainer className="flex items-center justify-between gap-4 py-3">
          <Link
            href={routes.home}
            aria-label={m.shellHome}
            className="inline-flex min-h-control-s items-center text-ink no-underline flex-none"
          >
            <Wordmark withLatin />
          </Link>

          <div className="flex-1 max-w-sm">{search('site-search-t')}</div>

          <div className="flex items-center gap-2 flex-none">
            <Link
              href={routes.account}
              aria-label={m.shellAccount}
              className="inline-flex h-control-s items-center gap-1.5 rounded-pill px-3 text-14 font-display font-semibold text-ink no-underline hover:text-cobalt transition-colors"
            >
              <Icon name="user" size={18} />
              <span>{m.shellAccount}</span>
            </Link>
            <CartLink variant="pill" />
          </div>
        </PageContainer>

        {/* Tablet Horizontal Department Strip */}
        <div className="border-t border-line/40 bg-linen/50">
          <PageContainer className="no-scrollbar flex items-center gap-6 overflow-x-auto py-2 text-14 font-display font-medium">
            {departments.map((d) => {
              const isActive = pathname === d.href || (d.href !== '/' && pathname.startsWith(d.href));
              return (
                <Link
                  key={d.label}
                  href={d.href}
                  className={cn(
                    'inline-flex flex-none items-center gap-1.5 py-1 text-14 font-display transition-colors no-underline',
                    isActive ? 'font-bold text-cobalt' : 'text-ink hover:text-cobalt'
                  )}
                >
                  {d.isAssistant ? (
                    <span className="size-2 rounded-full bg-citron ring-2 ring-citron/40" />
                  ) : null}
                  <span>{d.label}</span>
                </Link>
              );
            })}
          </PageContainer>
        </div>
      </div>

      {/* ── Desktop View (1024px+) ── */}
      <div className="hidden lg:block">
        <PageContainer className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 pb-3 pt-4.5">
          <Link
            href={routes.home}
            aria-label={m.shellHome}
            className="inline-flex min-h-control-s items-center text-ink no-underline flex-none"
          >
            <Wordmark withLatin />
          </Link>

          <div className="min-w-0 max-w-[460px] flex-[1_1_340px]">{search('site-search-d')}</div>

          <nav aria-label={m.shellAccountNav} className="ms-auto flex items-center gap-3 flex-none">
            <Link
              href={routes.account}
              className="inline-flex h-control-s items-center gap-2 rounded-pill px-4 text-15 font-display font-medium text-ink no-underline hover:text-cobalt transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
            >
              <Icon name="user" size={20} />
              <span>{m.shellAccount}</span>
            </Link>
            <CartLink variant="pill" />
          </nav>
        </PageContainer>

        {/* Desktop Department Navigation */}
        <div className="border-t border-line/40">
          <PageContainer>
            <nav
              aria-label={m.shellDepartments}
              className="flex flex-wrap items-center gap-x-8 py-2.5 text-15 font-display font-medium"
            >
              {departments.map((d) => {
                const isActive = pathname === d.href || (d.href !== '/' && pathname.startsWith(d.href));
                return (
                  <Link
                    key={d.label}
                    href={d.href}
                    className={cn(
                      'relative py-1.5 inline-flex items-center gap-2 no-underline transition-colors duration-fast',
                      isActive ? 'font-bold text-cobalt' : 'text-ink hover:text-cobalt'
                    )}
                  >
                    {d.isAssistant ? (
                      <span
                        className="size-2 rounded-full bg-citron ring-2 ring-citron/40"
                        aria-hidden="true"
                      />
                    ) : null}
                    <span>{d.label}</span>
                    {isActive ? (
                      <span
                        className="absolute bottom-0 inset-x-0 h-0.5 rounded-full bg-cobalt"
                        aria-hidden="true"
                      />
                    ) : null}
                  </Link>
                );
              })}
            </nav>
          </PageContainer>
        </div>
      </div>
    </header>
  );
}
