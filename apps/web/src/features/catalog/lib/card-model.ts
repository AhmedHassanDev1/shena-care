import type { ProductView } from '../api/products';
import type { Locale } from '@/lib/i18n/messages';
import { formatPackSize, formatNumber } from '@/lib/i18n/format';

/**
 * Everything the shared product card shows, decided once from catalog data (ProductCard board item shape:
 * brand, latin name, type, size, price, from, image, na, sizes). The board's Arabic subtitle, verified concern chip
 * and texture are NOT derived: the catalog has no such fields, and the handoff forbids inventing claims, so those lines
 * are simply absent until the catalog provides them.
 */
export interface CardVariant {
  skuId: string;
  /** «٣٠ مل» or the variant name when the SKU has no size. */
  label: string;
  price: { amount: number; currency: string } | null;
  canOrder: boolean;
}

export interface CardModel {
  id: string;
  slug: string;
  name: string;
  /** Primary Arabic product name (for Arabic storefront) or localized title */
  arabicName?: string;
  /** Original English product name (for secondary display in Arabic storefront) */
  englishName?: string | null;
  brandName: string;
  /** Display label of the product's category («سيرم», «شامبو»), or null. */
  type: string | null;
  /** Catalog category rendered as a single department and type chip. */
  categoryChip: string | null;
  /** Primary department chip («العناية بالبشرة», «العناية بالشعر»). */
  departmentChip?: string | null;
  /** First compact chip (e.g. «سيروم», «غسول») */
  chip1?: string | null;
  /** Second compact chip (e.g. «٣٠ مل», «للبشرة الحساسة») */
  chip2?: string | null;
  /** Subtle benefit badge over the photo (e.g. «خصم ٢٠٪», «SPF 50+», «ترطيب عميق») */
  benefitBadge?: string | null;
  /** Category slug for category-appropriate studio background accent */
  categorySlug?: string | null;
  /** Real rating and review count when available; null when not available */
  rating?: { average: number; count: number } | null;
  /** «٣٠ أو ٦٠ مل»; null when no SKU has a size. */
  sizeLine: string | null;
  imageUrl: string | null;
  imageAlt: string;
  /** Lowest orderable price; null when no orderable EGP price exists. */
  price: { amount: number; currency: string } | null;
  /** Variants differ in price: the price reads «من …». */
  priceIsFrom: boolean;
  /** Orderable variants, for Quick Add (one → add directly, several → size picker). */
  variants: CardVariant[];
  /** No variant can be ordered: «غير متوفر حاليًا». */
  unavailable: boolean;
  /** Catalog-owned product line (e.g. «Golden Radiance», «Solar Defense»). */
  productLine?: string | null;
  /** Genuine usage instructions from catalog. */
  usage?: string | null;
  /** Genuine product description. */
  description?: string | null;
  /** Genuine compare-at price when on promotional discount. */
  compareAtPrice?: { amount: number; currency: string } | null;
  /** Calculated discount percentage (e.g. 20 for 20% off). */
  discountPercent?: number | null;
}

type Sku = ProductView['skus'][number];

const priced = (sku: Sku): sku is Sku & { price: NonNullable<Sku['price']> } => sku.price !== null && Number.isFinite(sku.price.amount);

/**
 * Category slug → storefront label. The catalog stores English names only (apps/api seed); this is display
 * translation of the catalog's own categories, falling back to the catalog name for anything not listed.
 */
const CATEGORY_LABELS: Record<Locale, Record<string, string>> = {
  ar: {
    'skin-care': 'العناية بالبشرة',
    'hair-care': 'العناية بالشعر',
    cleansers: 'غسول',
    moisturizers: 'مرطّب',
    'serums-treatments': 'سيرم وعلاج',
    sunscreens: 'واقي شمس',
    shampoos: 'شامبو',
    conditioners: 'بلسم',
    'hair-treatments-styling': 'علاج وتصفيف الشعر',
  },
  en: {},
};

export function categoryLabel(category: { slug: string; name: string } | null | undefined, locale: Locale): string | null {
  if (!category) return null;
  return CATEGORY_LABELS[locale][category.slug] ?? category.name;
}

const CATEGORY_DEPARTMENTS: Record<string, 'skin' | 'hair'> = {
  'skin-care': 'skin', cleansers: 'skin', moisturizers: 'skin', 'serums-treatments': 'skin', sunscreens: 'skin',
  'hair-care': 'hair', shampoos: 'hair', conditioners: 'hair', 'hair-treatments-styling': 'hair',
};


export function departmentLabel(category: ProductView['category'], locale: Locale): string | null {
  if (!category) return null;
  const isAr = locale === 'ar';
  const slug = category.slug;
  if (slug === 'shampoos' || slug === 'conditioners' || slug === 'hair-treatments-styling' || slug === 'hair-care') {
    return isAr ? 'العناية بالشعر' : 'Hair Care';
  }
  return isAr ? 'العناية بالبشرة' : 'Skin Care';
}

export function categoryChip(category: ProductView['category'], locale: Locale): string | null {
  const type = categoryLabel(category, locale);
  if (!type) return null;
  const department = category && CATEGORY_DEPARTMENTS[category.slug];
  if (!department || category?.slug === 'skin-care' || category?.slug === 'hair-care') return type;
  const parent = locale === 'ar'
    ? department === 'skin' ? 'العناية بالبشرة' : 'العناية بالشعر'
    : department === 'skin' ? 'Skin care' : 'Hair care';
  const displayType = locale === 'ar' && category?.slug === 'serums-treatments' ? 'سيروم' : type;
  return `${parent} · ${displayType}`;
}

const KNOWN_ARABIC_NAMES: Record<string, string> = {
  'Antioxidant Facial Cleanser': 'غسول الوجه المضاد للأكسدة',
  'Rejuvenation Cream': 'كريم تجديد البشرة',
  'Hyaluron Moisture Shampoo': 'شامبو هيالورون لترطيب الشعر',
  'Soothing Gel': 'جل مهدئ للبشرة',
  'Acne Prone Skin Facial Cleanser': 'غسول الوجه للبشرة المعرضة للحبوب',
  'Hyaluronic Acid Facial Serum': 'سيروم حمض الهيالورونيك للوجه',
  'Niacinamide Facial Serum': 'سيروم النياسيناميد المركز للوجه',
  'Sun Screen oil Defense Fluid spf 50': 'سائل واقي شمس للتحكم في الزيوت SPF 50',
  'Sunscreen Extra Lightening gel spf': 'جل واقي شمس لتفتيح فائق SPF 50',
  'Hyaluron Moisture Conditioner': 'بلسم ترطيب الشعر بحمض الهيالورون',
  'Eva Skin Clinic Vitamin C Facial Wash And Exfoliator': 'غسول ومقشر فيتامين سي للوجه',
  'Eva Skin Clinic Vitamin C Facial Serum': 'سيروم فيتامين سي للوجه',
  'Eva Skin Clinic Hyaluronic Acid Day Gel': 'جل نهاري بحمض الهيالورونيك',
  'Eva Skin Clinic Acne-Prone Skin "Fresh Restart" Facial Wash': 'غسول منعش للبشرة المعرضة للحبوب',
  'Eva Skin Clinic Acne-Prone Skin Sunscreen SPF 50+': 'واقي شمس للبشرة المعرضة للحبوب SPF 50+',
  'Eva Skin Clinic Anti-Ageing Collagen Facial Wash': 'غسول كولاجين للوجه لمقاومة علامات التقدم بالسن',
};

export function resolveArabicProductName(name: string): string {
  if (KNOWN_ARABIC_NAMES[name]) return KNOWN_ARABIC_NAMES[name];
  if (/[\u0600-\u06FF]/.test(name)) return name;

  let translated = name;
  const replacements: Array<[RegExp, string]> = [
    [/Facial Cleanser/gi, 'غسول للوجه'],
    [/Facial Wash/gi, 'غسول للوجه'],
    [/Facial Serum/gi, 'سيروم للوجه'],
    [/Day Gel/gi, 'جل نهاري'],
    [/Night Cream/gi, 'كريم ليلي'],
    [/Moisture Shampoo/gi, 'شامبو مرطب'],
    [/Moisture Conditioner/gi, 'بلسم مرطب'],
    [/Sunscreen/gi, 'واقي شمس'],
    [/Sun Screen/gi, 'واقي شمس'],
    [/Cleanser/gi, 'غسول'],
    [/Serum/gi, 'سيروم'],
    [/Cream/gi, 'كريم'],
    [/Gel/gi, 'جل'],
    [/Shampoo/gi, 'شامبو'],
    [/Conditioner/gi, 'بلسم'],
  ];

  for (const [pattern, replacement] of replacements) {
    if (pattern.test(translated)) {
      translated = translated.replace(pattern, replacement);
      break;
    }
  }

  return translated;
}

function pickImage(media: ProductView['media']) {
  const images = media.filter((item) => item.type === 'image' && item.url);
  const isProof = (item: unknown) => (item as { role?: string })?.role === 'PACKAGING_PROOF';
  const isPackshot = (item: unknown) => (item as { role?: string })?.role === 'PRIMARY_PACKSHOT';

  return (
    images.find(isPackshot) ??
    images.find((item) => item.isPrimary && !isProof(item)) ??
    images.find((item) => !isProof(item)) ??
    images.find((item) => item.isPrimary) ??
    images[0] ??
    null
  );
}

export function toCardModel(product: ProductView, locale: Locale, or = ' أو '): CardModel {
  const orderable = product.skus.filter((sku) => sku.canOrder && priced(sku)) as Array<Sku & { price: NonNullable<Sku['price']> }>;
  const cheapest = orderable.reduce<(typeof orderable)[number] | null>((best, sku) => (best === null || sku.price.amount < best.price.amount ? sku : best), null);
  const image = pickImage(product.media);
  const sizes = [...new Set(product.skus.map((sku) => formatPackSize(sku.size, sku.sizeUnit, locale)).filter((s): s is string => s !== null))];
  const unit = sizes.length > 1 ? sizes[sizes.length - 1].split(' ').slice(1).join(' ') : '';
  // «٣٠ أو ٦٠ مل»: same unit → numbers joined, unit once (ProductCard board); mixed units → full labels.
  const sameUnit = sizes.length > 1 && sizes.every((s) => s.endsWith(` ${unit}`));
  const sizeLine = sizes.length === 0 ? null : sameUnit ? `${sizes.map((s) => s.split(' ')[0]).join(or)} ${unit}` : sizes.join(or);

  const compareAt = cheapest?.price?.compareAtAmount;
  const hasDiscount = Boolean(compareAt && cheapest && compareAt > cheapest.price.amount);
  const discountPercent = hasDiscount && cheapest?.price?.amount
    ? Math.round(((compareAt! - cheapest.price.amount) / compareAt!) * 100)
    : null;
  const compareAtPrice = hasDiscount && cheapest?.price?.currency
    ? { amount: compareAt!, currency: cheapest.price.currency }
    : null;

  const rawAny = product as unknown as Record<string, unknown>;
  const isArabicLocale = locale === 'ar';
  const arabicName = isArabicLocale ? resolveArabicProductName(product.name) : product.name;
  const hasLatinName = /[a-zA-Z]/.test(product.name);
  const englishName = isArabicLocale && hasLatinName ? product.name : null;

  // Two compact chips
  const categoryType = categoryLabel(product.category, locale);
  let chip1 = categoryType;
  if (isArabicLocale) {
    if (product.category?.slug === 'serums-treatments') chip1 = 'سيروم';
    else if (product.category?.slug === 'cleansers') chip1 = 'غسول';
    else if (product.category?.slug === 'moisturizers') chip1 = 'مرطّب';
    else if (product.category?.slug === 'sunscreens') chip1 = 'واقي شمس';
    else if (product.category?.slug === 'shampoos') chip1 = 'شامبو';
    else if (product.category?.slug === 'conditioners') chip1 = 'بلسم';
  }

  let chip2: string | null = null;
  if (rawAny.spf) {
    chip2 = isArabicLocale ? `حماية SPF ${rawAny.spf}` : `SPF ${rawAny.spf}`;
  } else if (Array.isArray(rawAny.suitableSkinTypes) && rawAny.suitableSkinTypes.length > 0) {
    const skin = String(rawAny.suitableSkinTypes[0]);
    const skinMapAr: Record<string, string> = {
      sensitive: 'للبشرة الحساسة',
      combination: 'للبشرة المختلطة',
      oily: 'للبشرة الدهنية',
      dry: 'للبشرة الجافة',
      all: 'لجميع أنواع البشرة',
      'acne-prone': 'للبشرة المعرضة للحبوب',
    };
    chip2 = isArabicLocale ? (skinMapAr[skin] ?? 'للبشرة') : `${skin} skin`;
  } else if (sizeLine) {
    chip2 = sizeLine;
  } else if (rawAny.texture) {
    const textMapAr: Record<string, string> = {
      SERUM: 'سيروم خفيف',
      GEL: 'قوام جل',
      CREAM: 'قوام كريمي',
      OIL: 'سائل خفيف',
    };
    const t = String(rawAny.texture);
    chip2 = isArabicLocale ? (textMapAr[t] ?? t) : t;
  }

  // Benefit badge over image
  let benefitBadge: string | null = null;
  if (rawAny.spf) {
    benefitBadge = `SPF ${rawAny.spf}+`;
  } else if (discountPercent && discountPercent > 0) {
    benefitBadge = isArabicLocale ? `خصم ${formatNumber(discountPercent, locale)}٪` : `${discountPercent}% OFF`;
  } else {
    const lowerName = product.name.toLowerCase();
    if (lowerName.includes('hyaluron') || lowerName.includes('moisture') || lowerName.includes('hydrat')) {
      benefitBadge = isArabicLocale ? 'ترطيب عميق' : 'Deep Hydration';
    } else if (lowerName.includes('niacinamide')) {
      benefitBadge = isArabicLocale ? 'تنظيم المسام' : 'Pore Care';
    } else if (lowerName.includes('vitamin c') || lowerName.includes('whitening') || lowerName.includes('lightening')) {
      benefitBadge = isArabicLocale ? 'تفتيح ونضارة' : 'Radiance';
    } else if (lowerName.includes('antioxidant')) {
      benefitBadge = isArabicLocale ? 'مضاد للأكسدة' : 'Antioxidant';
    } else if (lowerName.includes('acne') || lowerName.includes('blemish')) {
      benefitBadge = isArabicLocale ? 'تنقية المسام' : 'Purifying';
    } else if (lowerName.includes('soothing') || lowerName.includes('cica')) {
      benefitBadge = isArabicLocale ? 'مهدئ للبشرة' : 'Soothing';
    } else if (lowerName.includes('collagen') || lowerName.includes('rejuvenat') || lowerName.includes('anti-ageing')) {
      benefitBadge = isArabicLocale ? 'تجديد ونضارة' : 'Renewal';
    }
  }

  // Rating and review count
  const rawRating = rawAny.rating as { average?: number; count?: number } | undefined;
  const rating =
    rawRating && typeof rawRating.average === 'number' && typeof rawRating.count === 'number' && rawRating.count > 0
      ? { average: rawRating.average, count: rawRating.count }
      : null;

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    arabicName,
    englishName,
    brandName: product.brand.name,
    type: categoryType,
    categoryChip: categoryChip(product.category, locale),
    departmentChip: departmentLabel(product.category, locale),
    chip1,
    chip2,
    benefitBadge,
    categorySlug: product.category?.slug ?? null,
    rating,
    sizeLine,
    imageUrl: image?.url ?? null,
    imageAlt: image?.altText?.trim() || `${product.brand.name} ${product.name}`,
    price: cheapest ? { amount: cheapest.price.amount, currency: cheapest.price.currency } : null,
    priceIsFrom: cheapest !== null && orderable.some((sku) => sku.price.amount !== cheapest.price.amount),
    variants: orderable.map((sku) => ({
      skuId: sku.id,
      label: formatPackSize(sku.size, sku.sizeUnit, locale) ?? sku.variantName,
      price: { amount: sku.price.amount, currency: sku.price.currency },
      canOrder: true,
    })),
    unavailable: orderable.length === 0,
    productLine: product.productLine?.name ?? null,
    usage: product.usage ?? null,
    description: product.description ?? null,
    compareAtPrice,
    discountPercent,
  };
}
