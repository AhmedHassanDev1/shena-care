'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { PageContainer } from '@/components/layout/page-container';
import { Wordmark } from '@/components/ui/wordmark';
import { ProductSearch } from '@/features/catalog/components/ProductSearch';
import { departmentOf, useCategoryTree } from '@/features/catalog/lib/listing';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { AccountMenu } from './AccountMenu';
import { CartLink } from './CartLink';
import { getHeaderNavItems, isHeaderNavActive, type HeaderNavItem } from './header-nav';

export interface SiteHeaderProps {
  searchDefault?: string;
}

interface DepartmentNavProps {
  items: readonly HeaderNavItem[];
  label: string;
  variant: 'desktop' | 'mobile';
}

function DepartmentNavList({
  items,
  label,
  variant,
  isActiveFn,
}: DepartmentNavProps & { isActiveFn: (item: HeaderNavItem) => boolean }) {
  const isMobile = variant === 'mobile';

  return (
    <nav
      aria-label={label}
      className={cn(
        isMobile ? 'flex items-center justify-around gap-1 px-4' : 'flex items-center gap-1 lg:gap-1.5',
      )}
    >
      {items.map((item) => {
        const isActive = isActiveFn(item);
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'relative inline-flex min-h-11 items-center font-display no-underline transition-colors duration-fast ease-standard motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt whitespace-nowrap',
              isMobile
                ? 'flex-1 justify-center px-2 text-13.5'
                : 'shrink-0 rounded-pill px-2.5 lg:px-3 text-14.5',
              isActive
                ? cn(
                    'font-semibold text-cobalt after:pointer-events-none after:absolute after:h-0.5 after:rounded-full after:bg-cobalt',
                    isMobile
                      ? 'after:inset-x-6 after:bottom-0'
                      : 'after:inset-x-2.5 lg:after:inset-x-3 after:bottom-1.5',
                  )
                : isMobile
                  ? 'font-medium text-ink/85 hover:text-cobalt'
                  : 'font-medium text-ink/85 hover:bg-sand/45 hover:text-cobalt',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function DepartmentNavWithSearchParams(props: DepartmentNavProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: categories } = useCategoryTree();

  const categoryParam = searchParams.get('category');
  const brandParam = searchParams.get('brand');
  const searchQuery = searchParams.get('q');
  const departmentSlug = (categoryParam ? departmentOf(categoryParam, categories)?.slug : null) ?? null;

  return (
    <DepartmentNavList
      {...props}
      isActiveFn={(item) =>
        isHeaderNavActive(item.key, {
          pathname,
          categoryParam,
          brandParam,
          searchQuery,
          departmentSlug,
        })
      }
    />
  );
}

function DepartmentNav(props: DepartmentNavProps) {
  return (
    <Suspense fallback={<DepartmentNavList {...props} isActiveFn={() => false} />}>
      <DepartmentNavWithSearchParams {...props} />
    </Suspense>
  );
}

/**
 * Sahel Global Responsive Header:
 * - Desktop & Tablet (`md+`): Clean single-row 72px layout. Start = Brand + Skin/Hair/Brands;
 *   Center = Debounced product/brand search; End = Account action/menu + compact bag counter.
 * - Mobile (`< md`): Dedicated 3-tier touch layout with Brand + compact Account/Cart, full-width
 *   Search, and non-duplicating Skin/Hair/Brands row (complementing MobileDock).
 */
export function SiteHeader({ searchDefault }: SiteHeaderProps) {
  const m = useMessages();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const updateScrolled = () => {
      setScrolled(window.scrollY > 12);
    };
    updateScrolled();
    window.addEventListener('scroll', updateScrolled, { passive: true });
    return () => window.removeEventListener('scroll', updateScrolled);
  }, []);

  const navItems = getHeaderNavItems({
    navSkin: m.navSkin,
    navHair: m.navHair,
    navBrands: m.navBrands,
  });

  return (
    <header
      className={cn(
        'sticky top-0 z-nav border-b transition-colors duration-fast ease-standard motion-reduce:transition-none',
        scrolled
          ? 'border-ink/15 bg-linen/95 shadow-elevation-1 backdrop-blur-sm'
          : 'border-line bg-chalk',
      )}
    >
      {/* Mobile Header (< 768px) */}
      <div className="flex flex-col md:hidden">
        <div className="flex h-14 items-center justify-between gap-2 px-4">
          <Link
            href={routes.home}
            aria-label={m.shellHome}
            className="inline-flex min-h-11 items-center rounded-pill px-1 text-ink no-underline transition-colors duration-fast hover:text-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
          >
            <Wordmark />
          </Link>

          <div className="flex items-center gap-1">
            <AccountMenu compact />
            <CartLink />
          </div>
        </div>

        <div className="px-4 pb-2.5 pt-0.5">
          <ProductSearch
            id="site-search-m"
            label={m.shellSearchLabel}
            placeholder={m.shellSearchPlaceholder}
            defaultValue={searchDefault}
          />
        </div>

        <div className="border-t border-line/70">
          <DepartmentNav items={navItems} label={m.shellDepartments} variant="mobile" />
        </div>
      </div>

      {/* Tablet & Desktop Single-Row Header (768px+) */}
      <div className="hidden md:block">
        <PageContainer className="flex h-header-height items-center justify-between gap-4 lg:gap-7">
          <div className="flex shrink-0 items-center gap-4 lg:gap-6">
            <Link
              href={routes.home}
              aria-label={m.shellHome}
              className="inline-flex min-h-11 items-center rounded-pill px-1 text-ink no-underline transition-colors duration-fast hover:text-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
            >
              <Wordmark withLatin />
            </Link>

            <DepartmentNav items={navItems} label={m.shellDepartments} variant="desktop" />
          </div>

          <div className="min-w-0 flex-1 max-w-md lg:max-w-lg xl:max-w-xl">
            <ProductSearch
              id="site-search-d"
              label={m.shellSearchLabel}
              placeholder={m.shellSearchPlaceholder}
              defaultValue={searchDefault}
            />
          </div>

          <div className="flex shrink-0 items-center gap-1 lg:gap-1.5">
            <AccountMenu />
            <CartLink />
          </div>
        </PageContainer>
      </div>
    </header>
  );
}
