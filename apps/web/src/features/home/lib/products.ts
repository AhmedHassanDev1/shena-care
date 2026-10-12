import type { ProductView } from '@/features/catalog/api/products';

/** What a product card can do for the shopper, decided once from catalog data. */
export type QuickAddAction =
  | { kind: 'add'; skuId: string }
  /** More than one variant: the shopper must pick, so the card links to the product page. */
  | { kind: 'choose' }
  | { kind: 'unavailable' };

export interface ProductCardModel {
  id: string;
  slug: string;
  name: string;
  brandName: string;
  size: number | null;
  sizeUnit: string | null;
  imageUrl: string | null;
  imageAlt: string;
  /** Lowest orderable price; null when the catalog carries no EGP price. */
  price: { amount: number; currency: string } | null;
  /** True when variants differ in price, so the card reads "from …". */
  priceIsFrom: boolean;
  action: QuickAddAction;
}

type Sku = ProductView['skus'][number];

const hasPrice = (sku: Sku): sku is Sku & { price: NonNullable<Sku['price']> } =>
  sku.price !== null && Number.isFinite(sku.price.amount);

export function resolveQuickAdd(product: Pick<ProductView, 'skus'>): QuickAddAction {
  const orderable = product.skus.filter((sku) => sku.canOrder && hasPrice(sku));
  if (orderable.length === 0) return { kind: 'unavailable' };
  // Several variants (even if only one is orderable today) means the shopper has a choice to make.
  if (product.skus.length > 1) return { kind: 'choose' };
  return { kind: 'add', skuId: orderable[0].id };
}

function pickImage(media: ProductView['media']) {
  const images = media.filter((item) => item.type === 'image' && item.url);
  return images.find((item) => item.isPrimary) ?? images[0] ?? null;
}

export function toProductCardModel(product: ProductView): ProductCardModel {
  const priced = product.skus.filter((sku) => sku.canOrder && hasPrice(sku)) as Array<
    Sku & { price: NonNullable<Sku['price']> }
  >;
  const cheapest = priced.reduce<(typeof priced)[number] | null>(
    (best, sku) => (best === null || sku.price.amount < best.price.amount ? sku : best),
    null,
  );
  const image = pickImage(product.media);
  // Pack size is shown only when unambiguous: a product with several variants has several sizes.
  const sizeSku = product.skus.length === 1 ? product.skus[0] : null;

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    brandName: product.brand.name,
    size: sizeSku?.size ?? null,
    sizeUnit: sizeSku?.sizeUnit ?? null,
    imageUrl: image?.url ?? null,
    imageAlt: image?.altText?.trim() || product.name,
    price: cheapest ? { amount: cheapest.price.amount, currency: cheapest.price.currency } : null,
    priceIsFrom: cheapest !== null && priced.some((sku) => sku.price.amount !== cheapest.price.amount),
    action: resolveQuickAdd(product),
  };
}

/** Products the catalog already vetted as sellable, in API order, capped for the home grid. */
export function selectFeaturedProducts(products: ProductView[], limit: number): ProductCardModel[] {
  return products.slice(0, limit).map(toProductCardModel);
}
