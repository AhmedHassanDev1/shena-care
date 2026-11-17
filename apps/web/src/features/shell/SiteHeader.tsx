'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { PageContainer } from '@/components/layout/page-container';
import { Icon } from '@/components/ui/icon';
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
  variant: 'desktop' | 'mobile-menu';
  onNavigate?: () => void;
  isOpen?: boolean;
}

function DepartmentNavList({
  items,
  label,
  variant,
  onNavigate,
  isOpen,
  isActiveFn,
}: DepartmentNavProps & { isActiveFn: (item: HeaderNavItem) => boolean }) {
  const isMobileMenu = variant === 'mobile-menu';

  return (
    <nav
      aria-label={label}
      className={cn(
        isMobileMenu ? 'flex max-h-full flex-col overflow-y-auto overscroll-y-contain p-4' : 'flex items-center gap-1 lg:gap-1.5',
      )}
    >
      {isMobileMenu ? <h2 className="m-0 px-4 pb-4 pt-2 text-20 font-bold text-ink">{label}</h2> : null}
      {items.map((item) => {
        const isActive = isActiveFn(item);
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            onClick={onNavigate}
            tabIndex={isMobileMenu && !isOpen ? -1 : undefined}
            className={cn(
              'relative inline-flex min-h-11 items-center font-display no-underline transition-colors duration-fast ease-standard motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt whitespace-nowrap',
              isMobileMenu
                ? 'min-h-16 w-full justify-between border-b border-ink/15 px-4 text-24 font-semibold'
                : 'shrink-0 rounded-pill px-2.5 lg:px-3 text-14.5',
              isActive
                ? isMobileMenu
                  ? 'bg-sand/55 text-cobalt'
                  : cn(
                    'font-semibold text-cobalt after:pointer-events-none after:absolute after:h-0.5 after:rounded-full after:bg-cobalt',
                    'after:inset-x-2.5 lg:after:inset-x-3 after:bottom-1.5',
                  )
                : isMobileMenu
                  ? 'text-ink hover:bg-sand/45 hover:text-cobalt'
                  : 'font-medium text-ink/85 hover:bg-sand/45 hover:text-cobalt',
            )}
          >
            <span>{item.label}</span>
            {isMobileMenu ? <Icon name="arrow-forward" size={22} strokeWidth={1.75} className="text-ink/60" /> : null}
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
 * - Mobile (`< md`): Brand + compact menu/account/cart row and full-width search. Department links
 *   open in an overlay so they do not take a permanent row of screen space.
 */
export function SiteHeader({ searchDefault }: SiteHeaderProps) {
  const m = useMessages();
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const updateScrolled = () => {
      setScrolled(window.scrollY > 12);
    };
    updateScrolled();
    window.addEventListener('scroll', updateScrolled, { passive: true });
    return () => window.removeEventListener('scroll', updateScrolled);
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) return;

    const desktop = window.matchMedia('(min-width: 768px)');
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setMobileMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false);
        menuButtonRef.current?.focus();
      } else if (
        ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key) &&
        !(event.target instanceof HTMLElement && (
          event.target.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) ||
          (event.key === ' ' && event.target.closest('button, [role="button"]'))
        ))
      ) {
        event.preventDefault();
      }
    };
    const preventPageScroll = (event: WheelEvent | TouchEvent) => {
      if ('touches' in event && event.touches.length > 1) return;
      const list = menuRef.current?.querySelector('nav');
      const canScrollMenu = event.target instanceof Node && list?.contains(event.target) && list.scrollHeight > list.clientHeight;
      if (!canScrollMenu && event.cancelable) event.preventDefault();
    };
    const closeWhenFocusLeaves = (event: FocusEvent) => {
      if (event.target instanceof Node && !headerRef.current?.contains(event.target)) {
        setMobileMenuOpen(false);
      }
    };

    if (desktop.matches) setMobileMenuOpen(false);
    desktop.addEventListener('change', closeOnDesktop);
    window.addEventListener('keydown', closeOnEscape);
    document.addEventListener('focusin', closeWhenFocusLeaves);
    document.addEventListener('wheel', preventPageScroll, { passive: false, capture: true });
    document.addEventListener('touchmove', preventPageScroll, { passive: false, capture: true });
    return () => {
      desktop.removeEventListener('change', closeOnDesktop);
      window.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('focusin', closeWhenFocusLeaves);
      document.removeEventListener('wheel', preventPageScroll, true);
      document.removeEventListener('touchmove', preventPageScroll, true);
    };
  }, [mobileMenuOpen]);

  const navItems = getHeaderNavItems({
    navSkin: m.navSkin,
    navHair: m.navHair,
    navBrands: m.navBrands,
  });

  return (
    <header
      ref={headerRef}
      className={cn(
        'sticky top-0 border-b transition-colors duration-fast ease-standard motion-reduce:transition-none',
        mobileMenuOpen ? 'z-overlay md:z-nav' : 'z-nav',
        scrolled
          ? cn('border-ink/15 bg-linen/95 shadow-elevation-1', mobileMenuOpen ? 'md:backdrop-blur-sm' : 'backdrop-blur-sm')
          : 'border-line bg-chalk',
      )}
    >
      {/* Mobile Header (< 768px) */}
      <div className="flex flex-col md:hidden">
        <div className="flex h-14 items-center justify-between gap-2 px-4">
          <div className="flex min-w-0 items-center gap-1">
            <button
              ref={menuButtonRef}
              type="button"
              aria-label={m.shellDepartments}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-department-menu"
              onClick={() => setMobileMenuOpen((open) => !open)}
              className="inline-flex size-11 items-center justify-center rounded-pill text-ink transition-colors duration-fast hover:bg-sand/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
            >
              <Icon name={mobileMenuOpen ? 'close' : 'menu'} size={22} strokeWidth={1.75} />
            </button>
            <Link
              href={routes.home}
              aria-label={m.shellHome}
              className="inline-flex min-h-11 items-center rounded-pill px-1 text-ink no-underline transition-colors duration-fast hover:text-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
            >
              <Wordmark />
            </Link>
          </div>

          <div className="flex items-center gap-1">
            <AccountMenu compact />
            <CartLink />
          </div>
        </div>

        <div className="px-4 pb-2.5 pt-0.5">
          <ProductSearch
            id="site-search-m"
            mobile
            label={m.shellSearchLabel}
            placeholder={m.shellSearchPlaceholder}
            defaultValue={searchDefault}
          />
        </div>

      </div>
      <div
        ref={menuRef}
        id="mobile-department-menu"
        aria-hidden={!mobileMenuOpen}
        className={cn(
          'shutter soft absolute inset-x-0 top-full z-nav h-[calc(100dvh-100%)] overflow-hidden border-t border-ink/15 bg-chalk/80 shadow-elevation-2 backdrop-blur-2xl transition-[opacity,transform,visibility] duration-base ease-standard motion-reduce:transition-none md:hidden',
          mobileMenuOpen ? 'visible translate-y-0 opacity-100' : 'pointer-events-none invisible -translate-y-2 opacity-0',
        )}
      >
        <DepartmentNav
          items={navItems}
          label={m.shellDepartments}
          variant="mobile-menu"
          onNavigate={() => {
            menuButtonRef.current?.focus();
            setMobileMenuOpen(false);
          }}
          isOpen={mobileMenuOpen}
        />
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
