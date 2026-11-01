/**
 * The storefront's routine outlines: the catalog's own categories in the order they are used. One source for the
 * homepage routine cards and the product page's «where it fits», keyed by category slug (never by display name).
 */
export interface RoutineOrderStep {
  slug: string;
  /** Catalog category name (English), the fallback label for categoryLabel(). */
  name: string;
}

export const ROUTINE_ORDER = {
  skin: {
    department: 'skin-care',
    steps: [
      { slug: 'cleansers', name: 'Cleansers' },
      { slug: 'serums-treatments', name: 'Serums & Treatments' },
      { slug: 'moisturizers', name: 'Moisturizers' },
      { slug: 'sunscreens', name: 'Sunscreens' },
    ],
  },
  hair: {
    department: 'hair-care',
    steps: [
      { slug: 'shampoos', name: 'Shampoos' },
      { slug: 'conditioners', name: 'Conditioners' },
      { slug: 'hair-treatments-styling', name: 'Hair Treatments' },
    ],
  },
} as const satisfies Record<string, { department: string; steps: RoutineOrderStep[] }>;

export type RoutineKind = keyof typeof ROUTINE_ORDER;

/** The routine a category belongs to and its 0-based step index, or null for categories outside both outlines. */
export function routineStepFor(categorySlug: string | null | undefined): { kind: RoutineKind; index: number } | null {
  if (!categorySlug) return null;
  for (const kind of Object.keys(ROUTINE_ORDER) as RoutineKind[]) {
    const index = ROUTINE_ORDER[kind].steps.findIndex((step) => step.slug === categorySlug);
    if (index >= 0) return { kind, index };
  }
  return null;
}
