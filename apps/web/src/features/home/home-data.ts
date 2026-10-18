import { discoverProducts, type DiscoveryPage } from '@/features/catalog/api/discovery';
import type { ProductView } from '@/features/catalog/api/products';
import { categoryLabel } from '@/features/catalog/lib/card-model';
import { apiClient } from '@/lib/api-client';
import type { Locale } from '@/lib/i18n/messages';

/** A root department with its children, as `GET /categories` returns it (catalog-owned, active only). */
export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  children: Array<{ id: string; name: string; slug: string; sortOrder: number }>;
}

export interface HomeDepartment {
  slug: string;
  title: string;
  /** «غسول · سيرم وعلاج · مرطّب · واقي شمس» from the department's real child categories. */
  sub: string;
}

export interface HomeBrand {
  slug: string;
  name: string;
  /** Which departments the brand's visible products sit in (skin / hair / both); null when unknown. */
  area: 'skin' | 'hair' | 'both' | null;
}

export interface HomeData {
  products: ProductView[];
  departments: HomeDepartment[];
  brands: HomeBrand[];
  /** False when the catalog request failed (never shown as "no products"). */
  ok: boolean;
}

/** Products shown in the season picks: a feature card plus six cards (two desktop rows). */
export const PICKS_COUNT = 7;

/**
 * Home reads only real catalog data: the discovery feed (sellable products, brand facets), and the department tree.
 * No fixtures, no preview data: an empty or failed catalog shows its own state.
 */
export async function loadHomeData(locale: Locale): Promise<HomeData> {
  const [page, categories] = await Promise.all([
    discoverProducts({}, undefined, 48).catch((): DiscoveryPage | null => null),
    apiClient.get<CategoryNode[]>('/categories').catch((): CategoryNode[] => []),
  ]);
  if (!page) return { products: [], departments: [], brands: [], ok: false };

  const roots = new Map<string, CategoryNode>();
  for (const root of categories) {
    roots.set(root.id, root);
    for (const child of root.children) roots.set(child.id, root);
  }
  const departments = categories.map((root) => ({
    slug: root.slug,
    title: categoryLabel(root, locale) ?? root.name,
    sub: root.children.map((child) => categoryLabel(child, locale) ?? child.name).join(' · '),
  }));

  const areaOf = (product: ProductView): 'skin' | 'hair' | null => {
    const id = product.category?.id;
    const root = id ? roots.get(id) : undefined;
    if (root?.slug === 'skin-care') return 'skin';
    if (root?.slug === 'hair-care') return 'hair';
    return null;
  };
  const brandAreas = new Map<string, Set<'skin' | 'hair'>>();
  for (const product of page.items) {
    const area = areaOf(product);
    const set = brandAreas.get(product.brand.slug) ?? new Set();
    if (area) set.add(area);
    brandAreas.set(product.brand.slug, set);
  }
  const brands = page.facets.brands.map((facet): HomeBrand => {
    const set = brandAreas.get(facet.slug);
    const area: HomeBrand['area'] = !set || set.size === 0 ? null : set.size === 2 ? 'both' : [...set][0];
    return { slug: facet.slug, name: facet.name, area };
  });

  return { products: page.items, departments, brands, ok: true };
}
