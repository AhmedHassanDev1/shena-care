'use client';

import { useQueries } from '@tanstack/react-query';
import { getProductDetail, type ProductDetail } from '@/features/catalog/api/discovery';
import type { CuratedRoutine, CuratedRoutineStep } from '../data/curatedRoutines';

export interface RoutineStepProduct {
  stepId: string;
  state: 'loading' | 'error' | 'ready';
  product: ProductDetail | null;
  /** Shown only when the catalog says the variant can be ordered and has an EGP price. */
  orderable: boolean;
  /** Live price in EGP from the catalog, never the routine file's copy. */
  price: number | null;
  skuId: string | null;
  imageUrl: string | null;
  imageAlt: string;
  retry: () => void;
}

export interface RoutineProducts {
  steps: RoutineStepProduct[];
  /** Sum of live prices of orderable steps; null until every step has loaded. */
  total: number | null;
  /** Every step loaded and orderable: «add all» is exact. */
  complete: boolean;
  settled: boolean;
}

/**
 * Resolves a curated routine's products against the catalog (GET /products/:slug/detail?skuId=). The routine file only
 * names which product and size sits in each step; name, photo, price, availability and the SKU to order all come from
 * the catalog, so a price or stock change shows here without editing the routine.
 */
export function useRoutineProducts(routines: CuratedRoutine[]): Map<string, RoutineProducts> {
  const flat = routines.flatMap((routine) => routine.steps.map((step) => ({ routine: routine.slug, step })));
  // The same product and size sits in several routines: one query per distinct SKU, shared by every step that names it.
  const keyOf = (step: CuratedRoutineStep) => `${step.productSlug}:${step.skuId}`;
  const distinct = [...new Map(flat.map(({ step }) => [keyOf(step), step])).values()];
  const found = useQueries({
    queries: distinct.map((step) => ({
      queryKey: ['routine-step-product', step.productSlug, step.skuId],
      queryFn: () => getProductDetail(step.productSlug, step.skuId),
      staleTime: 60_000,
      retry: 1,
    })),
  });
  const resultFor = new Map(distinct.map((step, index) => [keyOf(step), found[index]]));

  const bySlug = new Map<string, RoutineStepProduct[]>();
  flat.forEach(({ routine, step }) => {
    const result = resultFor.get(keyOf(step));
    if (!result) return;
    const product = result.data ?? null;
    const variant = product?.selectedVariant ?? null;
    const price = variant?.price && variant.price.currency === 'EGP' && Number.isFinite(variant.price.amount) ? variant.price.amount : null;
    const images = (variant?.media.length ? variant.media : (product?.media ?? []).filter((item) => item.skuId === variant?.id)).filter(
      (item) => item.type === 'image' && item.url
    );
    const image = images.find((item) => item.isPrimary) ?? images[0] ?? null;
    const entry: RoutineStepProduct = {
      stepId: step.id,
      state: result.isPending ? 'loading' : result.isError ? 'error' : 'ready',
      product,
      orderable: Boolean(variant?.canOrder && price !== null),
      price,
      skuId: variant?.id ?? null,
      imageUrl: image?.url ?? null,
      imageAlt: image?.altText ?? product?.name ?? step.productName,
      retry: () => void result.refetch(),
    };
    bySlug.set(routine, [...(bySlug.get(routine) ?? []), entry]);
  });

  const out = new Map<string, RoutineProducts>();
  for (const [slug, steps] of bySlug) {
    const settled = steps.every((s) => s.state !== 'loading');
    const loaded = steps.every((s) => s.state === 'ready');
    out.set(slug, {
      steps,
      settled,
      total: loaded ? steps.reduce((sum, s) => sum + (s.orderable && s.price !== null ? s.price : 0), 0) : null,
      complete: loaded && steps.every((s) => s.orderable),
    });
  }
  return out;
}
