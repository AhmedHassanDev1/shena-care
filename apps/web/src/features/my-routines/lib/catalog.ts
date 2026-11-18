import { apiClient } from '@/lib/api-client';
import type { ProductView } from '@/features/catalog/api/products';
import { compactImage } from '@/features/catalog/lib/media-roles';
import type { RecommendedItem } from '@/features/care/api/care-intelligence';
import type { Locale } from '@/lib/i18n/messages';
import type { DraftProduct } from './draft';
import type { StepTiming } from '../api/personal-routines';

/** One catalog variant a customer can put in a routine, with only facts the catalog and the routine-profile API state. */
export interface PickOption {
  skuId: string;
  productId: string;
  slug: string;
  name: string;
  brand: string;
  variant: string | null;
  imageUrl: string | null;
  price: { amount: number; currency: string } | null;
  canOrder: boolean;
  /** Catalog routine role (CLEANSER, SERUM…), when the routine profile has one. */
  role: string | null;
  /** SKIN / HAIR from the routine profile. */
  domain: string | null;
  /** Time of day the product's own directions allow; null when they do not say (never defaulted). */
  periodHint: 'AM' | 'PM' | 'BOTH' | null;
  /** Catalog order of this kind of step (cleanse before moisturize); used only to suggest an order. */
  stepOrder: number | null;
  usage: string | null;
  /** Why the recommendation engine suggested it, in the engine's own words; absent for plain catalog entries. */
  suggestedReason?: string;
}

export interface RoutineProfileFull {
  skuId: string;
  routineDomain: string | null;
  primaryRole: string | null;
  primaryRoleStatus: string | null;
  routinePeriod: string | null;
  routinePeriodStatus: string | null;
  periodEligibility: string | null;
  stepOrder: number | null;
}

export async function fetchProfiles(skuIds: string[]): Promise<RoutineProfileFull[]> {
  const batches = await Promise.all(
    Array.from({ length: Math.ceil(skuIds.length / 50) }, (_, index) =>
      apiClient
        .get<{ items: RoutineProfileFull[] }>(`/catalog/routine-profiles?skuIds=${skuIds.slice(index * 50, index * 50 + 50).map(encodeURIComponent).join(',')}`)
        // A batch the profile service refuses must not hide the whole catalog; those products simply have no role.
        .catch(() => ({ items: [] as RoutineProfileFull[] }))
    )
  );
  return batches.flatMap((batch) => batch.items);
}

function hintOf(profile: RoutineProfileFull | undefined): PickOption['periodHint'] {
  if (!profile) return null;
  if (profile.periodEligibility === 'AM' || profile.periodEligibility === 'PM') return profile.periodEligibility;
  if (profile.routinePeriodStatus === 'VERIFIED' && (profile.routinePeriod === 'AM' || profile.routinePeriod === 'PM' || profile.routinePeriod === 'BOTH')) {
    return profile.routinePeriod;
  }
  return null;
}

export function buildOptions(products: ProductView[], profiles: RoutineProfileFull[]): PickOption[] {
  const bySku = new Map(profiles.map((profile) => [profile.skuId, profile]));
  return products.flatMap((product) =>
    product.skus.map((sku) => {
      const profile = bySku.get(sku.id);
      // Compact references show the identity packshot, never the editorial image (catalog media roles).
      const media = compactImage(product.media);
      return {
        skuId: sku.id,
        productId: product.id,
        slug: product.slug,
        name: product.name,
        brand: product.brand.name,
        variant: sku.variantName || null,
        imageUrl: media?.url ?? null,
        price: sku.price ? { amount: sku.price.amount, currency: sku.price.currency } : null,
        canOrder: sku.canOrder,
        role: profile?.primaryRole ?? null,
        domain: profile?.routineDomain ?? null,
        periodHint: hintOf(profile),
        stepOrder: profile?.stepOrder ?? null,
        usage: product.usage,
      } satisfies PickOption;
    })
  );
}

/** A recommendation-engine item as a picker entry; the engine's own reason is kept verbatim. */
export function optionFromRecommendation(item: RecommendedItem, known: Map<string, PickOption>): PickOption {
  const base = known.get(item.skuId);
  return {
    skuId: item.skuId,
    productId: item.productId,
    slug: item.slug,
    name: item.name,
    brand: item.brand,
    variant: item.variantName,
    imageUrl: item.imageUrl ?? base?.imageUrl ?? null,
    price: { amount: item.price.amount, currency: item.price.currency },
    canOrder: item.canOrder,
    role: base?.role ?? item.role,
    domain: base?.domain ?? (item.careArea ? item.careArea.toUpperCase() : null),
    periodHint: item.usage.period === 'AM' || item.usage.period === 'PM' ? item.usage.period : base?.periodHint ?? null,
    stepOrder: base?.stepOrder ?? null,
    usage: base?.usage ?? item.usage.text,
    suggestedReason: item.reasons[0]?.text,
  };
}

export const toDraftProduct = (option: PickOption): DraftProduct => ({
  skuId: option.skuId,
  productId: option.productId,
  name: option.name,
  brand: option.brand,
  variant: option.variant,
  imageUrl: option.imageUrl,
  slug: option.slug,
});

const ROLE_LABELS: Record<string, { en: string; ar: string }> = {
  CLEANSER: { en: 'Cleanser', ar: 'غسول' },
  TONER: { en: 'Toner', ar: 'تونر' },
  EXFOLIANT: { en: 'Exfoliant', ar: 'مقشّر' },
  SERUM: { en: 'Serum', ar: 'سيروم' },
  TREATMENT_SERUM: { en: 'Serum', ar: 'سيروم' },
  EYE_CARE: { en: 'Eye care', ar: 'عناية العين' },
  MOISTURIZER: { en: 'Moisturizer', ar: 'مرطّب' },
  SUNSCREEN: { en: 'Sunscreen', ar: 'واقي شمس' },
  FACE_OIL: { en: 'Face oil', ar: 'زيت للوجه' },
  HAIR_WASH: { en: 'Shampoo', ar: 'شامبو' },
  HAIR_SHAMPOO: { en: 'Shampoo', ar: 'شامبو' },
  CONDITIONER: { en: 'Conditioner', ar: 'بلسم' },
  HAIR_CONDITIONER: { en: 'Conditioner', ar: 'بلسم' },
  HAIR_MASK: { en: 'Hair mask', ar: 'ماسك للشعر' },
  HAIR_LEAVE_IN: { en: 'Leave-in', ar: 'ليف إن' },
  SCALP_TREATMENT: { en: 'Scalp care', ar: 'عناية بفروة الرأس' },
};

export const roleLabel = (role: string | null, locale: Locale): string | null => (role ? ROLE_LABELS[role]?.[locale] ?? null : null);

/** Default name of a new step: the product's role when the catalog knows it, else the product's own name. */
export const defaultStepTitle = (option: PickOption, locale: Locale): string => roleLabel(option.role, locale) ?? option.name;

/** Which time of day a newly picked product starts in: what its directions allow, else where the customer is looking. */
export function startingTiming(option: PickOption, current: StepTiming): StepTiming {
  if (option.periodHint === 'AM' || option.periodHint === 'PM') return option.periodHint;
  return current === 'AS_NEEDED' ? 'AM' : current;
}
