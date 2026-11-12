import { mainCategorySlugs, routes } from '@/lib/routes';

export const HEADER_NAV_KEYS = ['skin', 'hair', 'brands'] as const;
export type HeaderNavKey = (typeof HEADER_NAV_KEYS)[number];

export interface HeaderNavItem {
  key: HeaderNavKey;
  href: string;
  label: string;
}

export interface HeaderNavLabels {
  navSkin: string;
  navHair: string;
  navBrands: string;
}

export interface HeaderNavLocation {
  pathname: string | null | undefined;
  categoryParam?: string | null;
  brandParam?: string | null;
  searchQuery?: string | null;
  departmentSlug?: string | null;
}

/**
 * Returns the essential storefront header navigation items in display order:
 * Skin, Hair, Brands.
 */
export function getHeaderNavItems(labels: HeaderNavLabels): readonly HeaderNavItem[] {
  return [
    { key: 'skin', href: routes.productsByCategory(mainCategorySlugs.skin), label: labels.navSkin },
    { key: 'hair', href: routes.productsByCategory(mainCategorySlugs.hair), label: labels.navHair },
    { key: 'brands', href: routes.products, label: labels.navBrands },
  ];
}

function normalizePathname(pathname: string | null | undefined): string {
  if (!pathname) return '';
  const stripped = pathname.replace(/\/+$/, '');
  return stripped || '/';
}

/**
 * Resolves whether a header navigation item is active for the current URL state.
 * Matches exact `/products` path and disambiguates query parameters so search
 * queries or sub-categories never highlight unrelated items.
 */
export function isHeaderNavActive(key: HeaderNavKey, location: HeaderNavLocation): boolean {
  if (normalizePathname(location.pathname) !== routes.products) {
    return false;
  }

  const category = location.categoryParam?.trim() || null;
  const brand = location.brandParam?.trim() || null;
  const search = location.searchQuery?.trim() || null;
  const department = location.departmentSlug?.trim() || null;

  const isSkin = category === mainCategorySlugs.skin || department === mainCategorySlugs.skin;
  const isHair = category === mainCategorySlugs.hair || department === mainCategorySlugs.hair;

  if (key === 'skin') return isSkin;
  if (key === 'hair') return isHair;

  return !isSkin && !isHair && (!search || Boolean(brand));
}
