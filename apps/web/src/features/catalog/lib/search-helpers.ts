import { routes } from '@/lib/routes';
import type { ProductSuggestion } from '../api/discovery';

export interface SearchBrandCandidate {
  slug: string;
  name: string;
  isActive?: boolean;
}

export type SearchOption =
  | { id: string; kind: 'brand'; href: string; slug: string; label: string }
  | { id: string; kind: 'product'; href: string; slug: string; label: string; brandName: string }
  | { id: string; kind: 'view-all'; href: string; label: string };

/** Trims, collapses repeated whitespace, and caps length to match the API suggestion limit. */
export function normalizeSearchQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, 120);
}

/** Normalizes Arabic alef/teh/yeh forms, strips tashkeel, and folds Latin case for matching. */
export function normalizeSearchFold(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[\u0622\u0623\u0625]/g, '\u0627')
    .replace(/\u0629/g, '\u0647')
    .replace(/\u0649/g, '\u064A')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Matches active brands against an Arabic or English query, prioritizing prefix hits. */
export function matchActiveBrands(
  brands: ReadonlyArray<SearchBrandCandidate> | null | undefined,
  query: string,
  limit = 3,
): SearchBrandCandidate[] {
  const normalized = normalizeSearchQuery(query);
  if (normalized.length < 2 || !Array.isArray(brands) || limit <= 0) {
    return [];
  }

  const needle = normalizeSearchFold(normalized);
  const prefixMatches: SearchBrandCandidate[] = [];
  const substringMatches: SearchBrandCandidate[] = [];

  for (const brand of brands) {
    if (brand.isActive === false) continue;
    const foldedName = normalizeSearchFold(brand.name);
    const foldedSlugWords = normalizeSearchFold(brand.slug.replace(/[-_]+/g, ' '));
    const foldedSlugRaw = normalizeSearchFold(brand.slug);

    if (
      foldedName.startsWith(needle) ||
      foldedSlugWords.startsWith(needle) ||
      foldedSlugRaw.startsWith(needle)
    ) {
      prefixMatches.push(brand);
    } else if (
      foldedName.includes(needle) ||
      foldedSlugWords.includes(needle) ||
      foldedSlugRaw.includes(needle)
    ) {
      substringMatches.push(brand);
    }
  }

  return [...prefixMatches, ...substringMatches].slice(0, limit);
}

/** Builds a flat keyboard-navigable list mirroring the rendered popup sections. */
export function buildSearchOptions(input: {
  query: string;
  brands: ReadonlyArray<SearchBrandCandidate>;
  products: ReadonlyArray<ProductSuggestion>;
  viewAllLabel?: string;
}): SearchOption[] {
  const options: SearchOption[] = [];

  for (const brand of input.brands) {
    options.push({
      id: `brand:${brand.slug}`,
      kind: 'brand',
      href: `${routes.products}?brand=${encodeURIComponent(brand.slug)}`,
      slug: brand.slug,
      label: brand.name,
    });
  }

  for (const product of input.products) {
    options.push({
      id: `product:${product.id}`,
      kind: 'product',
      href: routes.product(product.slug),
      slug: product.slug,
      label: product.name,
      brandName: product.brand.name,
    });
  }

  const normalized = normalizeSearchQuery(input.query);
  if (input.viewAllLabel && normalized.length >= 2 && options.length > 0) {
    options.push({
      id: 'search:view-all',
      kind: 'view-all',
      href: routes.productsSearch(normalized),
      label: input.viewAllLabel,
    });
  }

  return options;
}

/** Moves the active combobox option index smoothly with wrapping at list bounds. */
export function stepActiveIndex(
  currentIndex: number,
  total: number,
  key: 'ArrowDown' | 'ArrowUp' | 'Home' | 'End',
): number {
  if (total <= 0) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return total - 1;
  if (key === 'ArrowDown') {
    return currentIndex < total - 1 ? currentIndex + 1 : 0;
  }
  return currentIndex > 0 ? currentIndex - 1 : total - 1;
}
