import { apiClient } from '@/lib/api-client';
import type { ProductView } from './products';
import type { ProductFactFields } from '../lib/product-facts';

/**
 * Public discovery and product detail, exactly as the API composes them
 * (apps/api application/composition: discovery.service.ts, dto/product-detail.dto.ts).
 * The backend applies every sellability gate; the storefront only renders.
 */

export interface DiscoveryFacet {
  slug: string;
  name: string;
  count: number;
}

export interface DiscoveryFilters {
  q?: string;
  brand?: string;
  category?: string;
  productLine?: string;
  concern?: string;
}

export interface DiscoveryPage {
  items: ProductView[];
  /** Eligible products after every filter and gate (not just this page). */
  total: number;
  facets: { brands: DiscoveryFacet[]; categories: DiscoveryFacet[]; productLines: DiscoveryFacet[] };
  pageInfo: { limit: number; hasNextPage: boolean; nextCursor: string | null; snapshotAt: string; evaluatedAt: string };
}

/** Facet keys the API accepts as filters (slugs only: lowercase letters, digits and dashes). */
export const FILTER_KEYS = ['brand', 'category', 'productLine'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];
const SLUG = /^[a-z0-9-]{1,160}$/;

/** Keeps only values the API would accept, so a hand-edited URL degrades to "no filter" instead of a 400. */
export function sanitizeFilters(raw: Record<string, string | undefined>): DiscoveryFilters {
  const filters: DiscoveryFilters = {};
  const q = raw.q?.trim().slice(0, 120);
  if (q) filters.q = q;
  for (const key of FILTER_KEYS) {
    const value = raw[key];
    if (value && SLUG.test(value)) filters[key] = value;
  }
  if (raw.concern && SLUG.test(raw.concern)) filters.concern = raw.concern;
  return filters;
}

/**
 * The same filters without one facet's own value. Facets computed for these filters list every option of that
 * facet, so a chosen brand (line, category) can be switched directly instead of being the only option left.
 */
export function withoutFacet(filters: DiscoveryFilters, key: FilterKey): DiscoveryFilters {
  const rest = { ...filters };
  delete rest[key];
  return rest;
}

/**
 * Display name of an applied facet value. Facets only list values that products carry, so a root category such
 * as `skin-care` is never among them: `known` names those (e.g. the header's department labels) instead of
 * showing the raw slug.
 */
export function facetDisplayName(
  slug: string,
  options: ReadonlyArray<DiscoveryFacet> | undefined,
  known: Readonly<Record<string, string>> = {},
): string {
  return options?.find((facet) => facet.slug === slug)?.name ?? known[slug] ?? slug;
}

export async function discoverProducts(filters: DiscoveryFilters, cursor?: string, limit = 20): Promise<DiscoveryPage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  params.set('limit', String(limit));
  if (cursor) params.set('cursor', cursor);
  return apiClient.get<DiscoveryPage>(`/products/discovery?${params.toString()}`);
}

export interface ProductSuggestion {
  id: string;
  name: string;
  slug: string;
  brand: { name: string; slug: string };
}

export async function suggestProducts(q: string, limit = 8, signal?: AbortSignal): Promise<{ items: ProductSuggestion[]; query: string }> {
  const params = new URLSearchParams({ q: q.trim().slice(0, 120), limit: String(limit) });
  return apiClient.get(`/products/suggestions?${params.toString()}`, { signal });
}

export interface PublicPrice {
  amount: number;
  currency: string;
  compareAtAmount: number | null;
}

export interface PublicMedia {
  id: string;
  skuId: string;
  type: string;
  url: string;
  altText: string | null;
  sortOrder: number;
  isPrimary: boolean;
  originType: string;
  role: string | null;
}

export interface PublicContent {
  language: string;
  name: string | null;
  description: string | null;
  ingredients: string | null;
  usage: string | null;
  warnings: string | null;
}

export interface PublicUsageRule {
  skuId: string;
  evidenceText: string;
  condition: string | null;
  sourceUrl: string;
  reviewedAt: string;
}

export interface PublicVariant {
  id: string;
  code: string;
  barcode: string | null;
  variantName: string;
  size: number | null;
  sizeUnit: string | null;
  price: PublicPrice | null;
  isAvailable: boolean;
  canOrder: boolean;
  availability: { isAvailable: boolean; isFresh: boolean; confirmedAt: string | null; observedAt: string | null; validUntil: string | null };
  media: PublicMedia[];
  content: PublicContent | null;
  usageRules?: PublicUsageRule[];
  promotions: {
    orderDiscountAmount?: number;
    subtotalAfterDiscount?: number;
    currency?: string;
    requiresCheckoutConfirmation?: boolean;
  } | null;
}

export interface ProductDetail extends ProductFactFields {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  usage: string | null;
  warnings: string | null;
  brand: { id: string; name: string; slug: string };
  productLine: { id: string; name: string; slug: string } | null;
  category: { id: string; name: string; slug: string; parentId: string | null } | null;
  skus: PublicVariant[];
  media: PublicMedia[];
  selectedSkuId: string;
  selectedVariant: PublicVariant;
  routinePlacements?: Array<{
    source: 'manual' | 'expert';
    routine: { id: string; title: string; careArea: string };
    step: { title: string; instructions: string | null; order: number; timing: string | null; isOptional: boolean };
  }>;
  evaluatedAt: string;
}

export async function getProductDetail(slugOrId: string, skuId?: string): Promise<ProductDetail> {
  const query = skuId ? `?skuId=${encodeURIComponent(skuId)}` : '';
  return apiClient.get<ProductDetail>(`/products/${encodeURIComponent(slugOrId)}/detail${query}`);
}

export interface ProductReviewSummary {
  average: number | null;
  count: number;
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
  recommendPercent: number | null;
  verifiedCount: number;
}

export interface ProductReview {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  authorName: string;
  skinType: string | null;
  isVerifiedPurchase: boolean;
  isTest?: boolean;
  helpfulCount: number;
  createdAt: string;
}

export type ReviewSort = 'recent' | 'helpful' | 'rating_high' | 'rating_low';

export interface ProductReviewPage {
  summary: ProductReviewSummary;
  items: ProductReview[];
  pageInfo: { page: number; limit: number; hasNextPage: boolean };
}

/** Published reviews and the rating summary (GET /products/:slugOrId/reviews, commerce-owned). */
export async function getProductReviews(
  slugOrId: string,
  query: { page?: number; limit?: number; sort?: ReviewSort; rating?: number } = {},
  token?: string | null,
): Promise<ProductReviewPage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
  const qs = params.toString();
  return apiClient.get<ProductReviewPage>(
    `/products/${encodeURIComponent(slugOrId)}/reviews${qs ? `?${qs}` : ''}`,
    token ? { token } : undefined,
  );
}

/** A care concern as the public taxonomy `GET /care/concerns` returns it (active concerns only). */
export interface Concern {
  id: string;
  name: string;
  slug: string;
  careArea: 'skin' | 'hair';
  description: string | null;
  isActive: boolean;
}
