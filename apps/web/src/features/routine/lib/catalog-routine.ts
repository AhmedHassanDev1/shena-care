import { apiClient } from '@/lib/api-client';
import type { ProductView } from '@/features/catalog/api/products';

export interface RoutineProfileSummary {
  skuId: string;
  routineDomain: 'SKIN' | 'HAIR' | string;
  primaryRole: string | null;
  primaryRoleStatus: string;
}

export interface RoutineChoice {
  skuId: string;
  slug: string;
  name: string;
  brand: string;
  variantName: string;
  size: number | null;
  sizeUnit: string | null;
  price: number | null;
  currency: string | null;
  canOrder: boolean;
  imageUrl: string | null;
  role: string | null;
  roleStatus: string;
  domain: string;
}

export interface SequencedRoutine {
  period: 'AM' | 'PM' | null;
  steps: Array<{ position: number; skuId: string; name: string; role: string | null }>;
  excluded: Array<{ skuId: string; name: string; reason: string }>;
  notes: string[];
  missing: string[];
}

export function buildRoutineChoices(products: ProductView[], profiles: RoutineProfileSummary[]): RoutineChoice[] {
  const bySku = new Map(profiles.map(profile => [profile.skuId, profile]));
  return products.flatMap(product => product.skus.flatMap(sku => {
    const profile = bySku.get(sku.id);
    if (!profile) return [];
    return [{ skuId: sku.id, slug: product.slug, name: product.name, brand: product.brand.name,
      variantName: sku.variantName, size: sku.size, sizeUnit: sku.sizeUnit,
      price: sku.price?.amount ?? null, currency: sku.price?.currency ?? null, canOrder: sku.canOrder,
      imageUrl: product.media.find(media => (media as any).skuId === sku.id && media.isPrimary)?.url
        ?? product.media.find(media => (media as any).skuId === sku.id)?.url ?? product.media.find(media => media.isPrimary)?.url ?? null,
      role: profile.primaryRole, roleStatus: profile.primaryRoleStatus, domain: profile.routineDomain }];
  }));
}

export async function getRoutineProfiles(skuIds: string[]): Promise<RoutineProfileSummary[]> {
  const batches = await Promise.all(Array.from({ length: Math.ceil(skuIds.length / 50) }, (_, index) =>
    apiClient.get<{ items: RoutineProfileSummary[] }>(`/catalog/routine-profiles?skuIds=${skuIds.slice(index * 50, index * 50 + 50).map(encodeURIComponent).join(',')}`)));
  return batches.flatMap(batch => batch.items);
}

export function sequenceRoutine(skuIds: string[], period?: 'AM' | 'PM'): Promise<SequencedRoutine> {
  return apiClient.post<SequencedRoutine>('/catalog/routine-profiles/sequence', { skuIds, period });
}
