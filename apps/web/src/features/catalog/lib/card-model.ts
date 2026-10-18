import type { ProductView } from '../api/products';
import type { Locale } from '@/lib/i18n/messages';
import { formatPackSize } from '@/lib/i18n/format';

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
  brandName: string;
  /** Display label of the product's category («سيرم», «شامبو»), or null. */
  type: string | null;
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

function pickImage(media: ProductView['media']) {
  const images = media.filter((item) => item.type === 'image' && item.url);
  return images.find((item) => item.isPrimary) ?? images[0] ?? null;
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

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    brandName: product.brand.name,
    type: categoryLabel(product.category, locale),
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
  };
}
