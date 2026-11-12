import type { ProductDetail } from '../api/discovery';
import type { ProductView } from '../api/products';

const SKIN_SLUGS = new Set([
  'skin-care',
  'cleansers',
  'moisturizers',
  'serums-treatments',
  'sunscreens',
]);

const HAIR_SLUGS = new Set([
  'hair-care',
  'shampoos',
  'conditioners',
  'hair-treatments-styling',
]);

const CONCERN_KEYWORDS = [
  'acne',
  'blemish',
  'sensitive',
  'oily',
  'dry',
  'combination',
  'hyaluron',
  'niacinamide',
  'vitamin c',
  'collagen',
  'spf',
  'sunscreen',
  'cleanser',
  'serum',
  'moistur',
  'soothing',
  'shampoo',
  'conditioner',
];

function resolveDomain(
  categorySlug: string | null | undefined,
  routineDomain?: string | null
): 'skin' | 'hair' | null {
  if (categorySlug) {
    if (SKIN_SLUGS.has(categorySlug)) return 'skin';
    if (HAIR_SLUGS.has(categorySlug)) return 'hair';
  }
  if (routineDomain === 'SKIN_CARE') return 'skin';
  if (routineDomain === 'HAIR_CARE') return 'hair';
  return null;
}

function collectSignalTokens(current: ProductDetail): string[] {
  const tokens = new Set<string>();

  for (const skin of current.suitableSkinTypes ?? []) {
    const clean = skin.trim().toLowerCase();
    if (clean && clean !== 'all') tokens.add(clean);
  }
  for (const hair of current.suitableHairTypes ?? []) {
    const clean = hair.trim().toLowerCase();
    if (clean && clean !== 'all') tokens.add(clean);
  }

  const haystack = [
    current.name,
    current.description,
    current.targetArea,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  for (const keyword of CONCERN_KEYWORDS) {
    if (haystack.includes(keyword)) tokens.add(keyword);
  }

  return [...tokens];
}

function hasOrderableSku(product: ProductView): boolean {
  return product.skus.some(
    (sku) => sku.canOrder && sku.price !== null && Number.isFinite(sku.price.amount)
  );
}

/** Keep the discovery service's ranking, without showing the current item twice. */
export function selectRelatedProducts<T extends { id: string }>(products: T[], currentId: string, limit: number): T[] {
  const seen = new Set([currentId]);
  return products.filter((product) => {
    if (seen.has(product.id)) return false;
    seen.add(product.id);
    return true;
  }).slice(0, limit);
}

/**
 * Ranks genuinely related real products using server catalog taxonomy, line, domain, brand,
 * and compatible concerns without padding unrelated categories (e.g., never mixes Hair Care
 * items into Skin Care recommendations or vice versa).
 */
export function rankRelatedProducts(
  candidates: ReadonlyArray<ProductView>,
  current: ProductDetail,
  limit = 4
): ProductView[] {
  const seenIds = new Set<string>([current.id]);
  const seenSlugs = new Set<string>([current.slug]);
  const currentDomain = resolveDomain(
    current.category?.slug,
    current.routineProfile?.routineDomain
  );
  const currentParentId = current.category?.parentId ?? null;
  const currentSignals = collectSignalTokens(current);

  const scored: Array<{ product: ProductView; score: number; order: number }> = [];

  candidates.forEach((candidate, order) => {
    if (seenIds.has(candidate.id) || seenSlugs.has(candidate.slug)) return;
    seenIds.add(candidate.id);
    seenSlugs.add(candidate.slug);

    const candidateDomain = resolveDomain(candidate.category?.slug);
    if (currentDomain && candidateDomain && currentDomain !== candidateDomain) {
      return;
    }

    const candidateParentId = candidate.category?.parentId ?? null;
    if (
      !currentDomain &&
      currentParentId &&
      candidateParentId &&
      currentParentId !== candidateParentId
    ) {
      return;
    }

    let relevance = 0;

    if (
      current.category?.slug &&
      candidate.category?.slug &&
      current.category.slug === candidate.category.slug
    ) {
      relevance += 100;
    }

    if (
      current.productLine?.slug &&
      candidate.productLine?.slug &&
      current.productLine.slug === candidate.productLine.slug
    ) {
      relevance += 60;
    }

    const sameParentOrDomain =
      Boolean(currentParentId && candidateParentId && currentParentId === candidateParentId) ||
      Boolean(currentDomain && candidateDomain && currentDomain === candidateDomain);

    if (sameParentOrDomain) {
      relevance += 10;
    }

    if (
      sameParentOrDomain &&
      current.brand?.slug &&
      candidate.brand?.slug &&
      current.brand.slug === candidate.brand.slug
    ) {
      relevance += 20;
    }

    if (currentSignals.length > 0) {
      const candidateText = [
        candidate.name,
        candidate.description,
        candidate.usage,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      for (const token of currentSignals) {
        if (candidateText.includes(token)) {
          relevance += 15;
        }
      }
    }

    if (relevance <= 0) return;

    const availabilityBoost = hasOrderableSku(candidate) ? 2 : 0;
    scored.push({
      product: candidate,
      score: relevance + availabilityBoost,
      order,
    });
  });

  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.slice(0, limit).map((item) => item.product);
}
