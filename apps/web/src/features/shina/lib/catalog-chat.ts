import type { ProductDetail } from '@/features/catalog/api/discovery';
import type { ProductView } from '@/features/catalog/api/products';
import { knownSkinTypes, productHighlights } from '@/features/catalog/lib/product-facts';
import type { SequencedRoutine } from '@/features/routine/lib/catalog-routine';
import { formatAmount } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/messages';
import type {
  ShinaComparison,
  ShinaComparisonProduct,
  ShinaComparisonSpec,
  ShinaProduct,
  ShinaRoutinePreview,
  ShinaRoutineStep,
} from './shina-types';

export type ChatProduct = ShinaProduct;
export type ShinaIntent = 'compare' | 'routine' | 'product-lookup' | 'search' | 'chat';

/** A chat card can only represent a currently sellable public SKU returned by Catalog. */
export function toChatProduct(product: ProductView): ChatProduct | null {
  const sku = product.skus.find((item) => item.canOrder && item.price?.currency === 'EGP');
  if (!sku?.price) return null;
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    brand: product.brand.name,
    price: sku.price.amount,
    currency: sku.price.currency,
    skuId: sku.id,
    variantName: sku.variantName,
    category: product.category?.name ?? '',
    imageUrl:
      product.media.find((item) => item.skuId === sku.id && item.isPrimary)?.url ??
      product.media.find((item) => item.isPrimary)?.url,
    canOrder: true,
  };
}

/** Converts a catalog product to a Shina card model while truthfully marking availability. */
export function productViewToShinaProduct(product: ProductView): ShinaProduct | null {
  const sellable = toChatProduct(product);
  if (sellable) return sellable;
  const fallbackSku = product.skus[0];
  if (!fallbackSku) return null;
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    brand: product.brand.name,
    price: fallbackSku.price?.amount ?? 0,
    currency: fallbackSku.price?.currency ?? 'EGP',
    skuId: fallbackSku.id,
    variantName: fallbackSku.variantName,
    category: product.category?.name ?? '',
    imageUrl:
      product.media.find((item) => item.skuId === fallbackSku.id && item.isPrimary)?.url ??
      product.media.find((item) => item.isPrimary)?.url,
    canOrder: false,
  };
}

/** Category matching is navigation, not a clinical recommendation or inferred product claim. */
export function chooseCatalogProducts(query: string, products: ProductView[]): ProductView[] {
  const q = query.toLocaleLowerCase().trim();
  if (/كل المنتجات|جميع المنتجات|عرض المنتجات|all available|all products/.test(q)) {
    return products.slice(0, 6);
  }
  const named = products.filter((product) => product.name.length >= 12 && q.includes(product.name.toLocaleLowerCase()));
  if (named.length) return [named.sort((a, b) => b.name.length - a.name.length)[0]];
  const kind = /غسول|منظف|cleanser|حبوب|دهنية/.test(q)
    ? /cleanser/
    : /شعر|شامبو|بلسم|hair|shampoo|conditioner|تالف|تساقط/.test(q)
      ? /shampoo|conditioner/
      : /واقي|شمس|sunscreen|spf/.test(q)
        ? /sun|sunscreen/
        : /سيروم|serum/.test(q)
          ? /serum/
          : /مرطب|كريم|جل|moisturizer|cream|gel/.test(q)
            ? /cream|moisturiz|gel/
            : null;
  if (kind) {
    return products
      .filter((product) => kind.test(`${product.name} ${product.category?.slug ?? ''}`.toLowerCase()))
      .slice(0, 6);
  }
  const tokens = q.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 3);
  const matches = products.filter((product) =>
    tokens.some((token) => `${product.name} ${product.brand.name} ${product.category?.name ?? ''}`.toLocaleLowerCase().includes(token)),
  );
  return matches.slice(0, 6);
}

/** Classifies explicit user intent so activity indicators mirror real client/server workflows. */
export function classifyShinaIntent(query: string): ShinaIntent {
  const q = query.toLocaleLowerCase().trim();
  if (/قارن|مقارنة|الفرق|vs\b|versus|compare|difference|أيهما أفضل/.test(q)) {
    return 'compare';
  }
  if (/روتين|صباحي|مسائي|ترتيب|خطوات|routine|sequence|steps/.test(q)) {
    return 'routine';
  }
  if (/غسول|كريم|شامبو|بلسم|واقي|سيروم|جل|مرطب|سعر|متوفر|منتج|منتجات|cleanser|shampoo|conditioner|serum|sunscreen|cream|gel|price|product|search|ابحث|رشح|أفضل/.test(q)) {
    return 'search';
  }
  return 'chat';
}

/** Selects two distinct catalog products matching the comparison query cleanly without inventing data. */
export function pickComparisonPair(query: string, products: ProductView[]): [ProductView, ProductView] | null {
  if (products.length < 2) return null;

  const q = query.toLocaleLowerCase().trim();
  const explicitMatches = products.filter(
    (product) =>
      q.includes(product.name.toLocaleLowerCase()) ||
      q.includes(product.slug.toLocaleLowerCase()) ||
      q.includes(`${product.brand.name} ${product.name}`.toLocaleLowerCase()),
  );

  if (explicitMatches.length >= 2) {
    return [explicitMatches[0], explicitMatches[1]];
  }

  const ranked = chooseCatalogProducts(query, products);
  const pool = ranked.length >= 2 ? ranked : products;

  if (explicitMatches.length === 1) {
    const first = explicitMatches[0];
    const sibling =
      pool.find((item) => item.id !== first.id && item.category?.slug === first.category?.slug) ??
      pool.find((item) => item.id !== first.id);
    if (sibling) return [first, sibling];
  }

  const byCategory = new Map<string, ProductView[]>();
  for (const item of pool) {
    const key = item.category?.slug ?? 'all';
    const list = byCategory.get(key) ?? [];
    list.push(item);
    byCategory.set(key, list);
  }
  for (const list of byCategory.values()) {
    if (list.length >= 2) return [list[0], list[1]];
  }

  return pool.length >= 2 ? [pool[0], pool[1]] : [products[0], products[1]];
}

const TEXTURE_LABELS: Record<'ar' | 'en', Record<string, string>> = {
  ar: {
    GEL: 'جل خفيف',
    CREAM: 'كريم',
    GEL_CREAM: 'جل كريم',
    LOTION: 'لوشن',
    SERUM: 'سيروم',
    FOAM: 'رغوة',
    LIQUID: 'سائل',
    SPRAY: 'سبراي',
    BALM: 'بلسم غني',
    OIL: 'زيت',
  },
  en: {
    GEL: 'Gel',
    CREAM: 'Cream',
    GEL_CREAM: 'Gel-Cream',
    LOTION: 'Lotion',
    SERUM: 'Serum',
    FOAM: 'Foam',
    LIQUID: 'Liquid',
    SPRAY: 'Spray',
    BALM: 'Balm',
    OIL: 'Oil',
  },
};

const SKIN_TYPE_LABELS: Record<'ar' | 'en', Record<string, string>> = {
  ar: { normal: 'عادية', dry: 'جافة', oily: 'دهنية', combination: 'مختلطة', sensitive: 'حساسة' },
  en: { normal: 'Normal', dry: 'Dry', oily: 'Oily', combination: 'Combination', sensitive: 'Sensitive' },
};

function detailToComparisonProduct(detail: ProductDetail, locale: Locale): ShinaComparisonProduct {
  const variant = detail.selectedVariant ?? detail.skus[0];
  const primaryMedia =
    detail.media.find((item) => item.skuId === variant?.id && item.isPrimary)?.url ??
    detail.media.find((item) => item.isPrimary)?.url ??
    detail.media[0]?.url;

  const specs: ShinaComparisonSpec[] = [];
  if (detail.category?.name) {
    specs.push({ label: locale === 'ar' ? 'التصنيف' : 'Category', value: detail.category.name });
  }
  if (variant?.size && variant?.sizeUnit) {
    specs.push({
      label: locale === 'ar' ? 'الحجم' : 'Size',
      value: `${variant.size} ${variant.sizeUnit}`,
    });
  } else if (variant?.variantName) {
    specs.push({
      label: locale === 'ar' ? 'العبوة' : 'Variant',
      value: variant.variantName,
    });
  }

  for (const hl of productHighlights(detail)) {
    if (hl.kind === 'spf' && hl.value != null) {
      specs.push({ label: 'SPF', value: `${hl.value}+` });
    } else if (hl.kind === 'texture' && typeof hl.value === 'string') {
      specs.push({
        label: locale === 'ar' ? 'القوام' : 'Texture',
        value: TEXTURE_LABELS[locale][hl.value] ?? hl.value,
      });
    } else if (hl.kind === 'fragrance-free') {
      specs.push({
        label: locale === 'ar' ? 'العطور' : 'Fragrance',
        value: locale === 'ar' ? 'خالٍ من العطور' : 'Fragrance-free',
      });
    } else if (hl.kind === 'non-comedogenic') {
      specs.push({
        label: locale === 'ar' ? 'المسام' : 'Pores',
        value: locale === 'ar' ? 'لا يسد المسام' : 'Non-comedogenic',
      });
    }
  }

  const skins = knownSkinTypes(detail.suitableSkinTypes);
  if (skins.length > 0) {
    specs.push({
      label: locale === 'ar' ? 'مناسب للبشرة' : 'Skin type',
      value: skins.map((s) => SKIN_TYPE_LABELS[locale][s] ?? s).join(' · '),
    });
  }

  const keyIngredients = detail.keyIngredients ?? detail.selectedVariant?.keyIngredients ?? [];
  if (keyIngredients.length > 0) {
    specs.push({
      label: locale === 'ar' ? 'أبرز المكونات' : 'Key actives',
      value: keyIngredients
        .slice(0, 2)
        .map((ing) => (locale === 'ar' && ing.nameAr ? ing.nameAr : ing.name))
        .join('، '),
    });
  }

  if (specs.length === 0) {
    specs.push({
      label: locale === 'ar' ? 'الحالة' : 'Availability',
      value: variant?.canOrder
        ? locale === 'ar'
          ? 'متاح للطلب'
          : 'Available'
        : locale === 'ar'
          ? 'غير متاح حاليًا'
          : 'Unavailable',
    });
  }

  return {
    slug: detail.slug,
    skuId: variant?.id ?? detail.selectedSkuId,
    brand: detail.brand.name,
    name: detail.name,
    imageUrl: primaryMedia,
    price: variant?.price?.amount ?? null,
    currency: variant?.price?.currency ?? 'EGP',
    canOrder: Boolean(variant?.canOrder && variant?.price?.currency === 'EGP'),
    variantLabel:
      variant?.size && variant?.sizeUnit ? `${variant.size} ${variant.sizeUnit}` : variant?.variantName || '',
    specs: specs.slice(0, 5),
  };
}

/** Builds a strictly factual side-by-side comparison from live GET /products/:slug/detail payloads. */
export function buildShinaComparison(
  products: [ProductDetail, ProductDetail],
  locale: Locale,
): ShinaComparison {
  const first = detailToComparisonProduct(products[0], locale);
  const second = detailToComparisonProduct(products[1], locale);
  const priceLine =
    first.price != null && second.price != null
      ? `${first.name} (${formatAmount(first.price, locale)}) vs ${second.name} (${formatAmount(second.price, locale)})`
      : `${first.name} vs ${second.name}`;
  return {
    title:
      locale === 'ar'
        ? `مقارنة موثقة: ${first.name} و ${second.name}`
        : `Verified comparison: ${priceLine}`,
    products: [first, second],
  };
}

const ROLE_LABELS: Record<'ar' | 'en', Record<string, string>> = {
  ar: {
    CLEANSER: 'غسول منظف',
    TONER: 'تونر',
    SERUM: 'سيروم علاجي',
    MOISTURIZER: 'مرطب',
    SUNSCREEN: 'واقي شمس',
    SHAMPOO: 'شامبو',
    HAIR_WASH: 'غسول للشعر',
    HAIR_CONDITIONER: 'بلسم للشعر',
    HAIR_TREATMENT: 'علاج للشعر',
    CONDITIONER: 'بلسم',
    TREATMENT: 'علاج مركز',
  },
  en: {
    CLEANSER: 'Cleanser',
    TONER: 'Toner',
    SERUM: 'Treatment serum',
    MOISTURIZER: 'Moisturizer',
    SUNSCREEN: 'Sunscreen',
    SHAMPOO: 'Shampoo',
    HAIR_WASH: 'Hair wash',
    HAIR_CONDITIONER: 'Hair conditioner',
    HAIR_TREATMENT: 'Hair treatment',
    CONDITIONER: 'Conditioner',
    TREATMENT: 'Treatment',
  },
};

export function routineSequenceToPreview(
  sequenced: SequencedRoutine,
  products: ProductView[],
  period: 'AM' | 'PM' | undefined,
  locale: Locale,
): ShinaRoutinePreview {
  const productBySku = new Map<string, ShinaProduct>();
  for (const product of products) {
    const mapped = productViewToShinaProduct(product);
    if (!mapped) continue;
    for (const sku of product.skus) {
      productBySku.set(sku.id, {
        ...mapped,
        skuId: sku.id,
        price: sku.price?.amount ?? mapped.price,
        currency: sku.price?.currency ?? mapped.currency,
        variantName: sku.variantName,
        canOrder: Boolean(sku.canOrder && sku.price?.currency === 'EGP'),
      });
    }
  }

  const timing = period === 'PM' ? 'pm' : 'am';
  const steps: ShinaRoutineStep[] = sequenced.steps.map((step) => ({
    order: step.position,
    title: step.name,
    timing,
    isOptional: false,
    roleLabel: step.role ? ROLE_LABELS[locale][step.role] ?? step.role : null,
    product: productBySku.get(step.skuId) ?? null,
  }));

  const title =
    period === 'PM'
      ? locale === 'ar'
        ? 'ترتيب الروتين المسائي من الكتالوج'
        : 'Catalog Evening Routine Sequence'
      : period === 'AM'
        ? locale === 'ar'
          ? 'ترتيب الروتين الصباحي من الكتالوج'
          : 'Catalog Morning Routine Sequence'
        : locale === 'ar'
          ? 'ترتيب الروتين من الكتالوج'
          : 'Catalog Routine Sequence';

  return {
    title,
    description:
      sequenced.missing.length > 0
        ? locale === 'ar'
          ? `خطوات مقترحة للبحث لاحقًا: ${sequenced.missing.map((r) => ROLE_LABELS.ar[r] ?? r).join(' · ')}`
          : `Optional missing steps: ${sequenced.missing.map((r) => ROLE_LABELS.en[r] ?? r).join(' · ')}`
        : null,
    careArea: 'skin',
    source: 'catalog-sequence',
    steps,
    notes: sequenced.notes,
    excludedCount: sequenced.excluded.length,
  };
}

export function buildStarterSuggestions(locale: Locale): string[] {
  if (locale === 'ar') {
    return [
      'أفضل غسول متاح الآن',
      'قارني بين غسولين للبشرة',
      'رتّبي لي روتين صباحي من الكتالوج',
      'منتجات مناسبة للشعر الجاف',
    ];
  }
  return [
    'Best cleanser in stock',
    'Compare two facial cleansers',
    'Sequence a morning routine',
    'Hydrating hair care products',
  ];
}

export function buildFollowUpSuggestions(opts: {
  locale: Locale;
  products?: ShinaProduct[];
  hasComparison?: boolean;
  hasRoutine?: boolean;
  isAuthenticated: boolean;
}): string[] {
  const { locale, products, hasComparison, hasRoutine } = opts;
  const first = products?.[0];
  const suggestions: string[] = [];

  if (locale === 'ar') {
    if (products && products.length >= 2 && !hasComparison) {
      suggestions.push(`قارني بين ${products[0].name} و ${products[1].name}`);
    } else if (!hasComparison) {
      suggestions.push('قارني بين منتجين من الكتالوج');
    }
    if (!hasRoutine) {
      suggestions.push('رتّبي لي روتين صباحي');
    }
    if (first) {
      suggestions.push(`مواصفات ${first.name}`);
    }
    suggestions.push('كل المنتجات المتاحة');
    return suggestions.slice(0, 3);
  }

  if (products && products.length >= 2 && !hasComparison) {
    suggestions.push(`Compare ${products[0].name} vs ${products[1].name}`);
  } else if (!hasComparison) {
    suggestions.push('Compare two catalog products');
  }
  if (!hasRoutine) {
    suggestions.push('Sequence a morning routine');
  }
  if (first) {
    suggestions.push(`Details for ${first.name}`);
  }
  suggestions.push('All available products');
  return suggestions.slice(0, 3);
}
