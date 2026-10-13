import type { ProductCardModel } from '../lib/products';

/**
 * Design-preview product cards (development only, opt-in with `/?preview=products`).
 *
 * These are ILLUSTRATIONS: no real brand, no price, no stock, no photograph (a silhouette stands in), and
 * their action is `preview`, so they can never be added to a cart. They exist so the product shelf can be
 * reviewed while the catalog is empty. See isProductPreview() for the gate.
 */
const item = (n: number, name: string, shape: NonNullable<ProductCardModel['art']>['shape'], tint: NonNullable<ProductCardModel['art']>['tint']): ProductCardModel => ({
  id: `preview-product-${n}`,
  slug: `preview-${n}`,
  name,
  brandName: 'ماركة توضيحية',
  size: null,
  sizeUnit: null,
  imageUrl: null,
  imageAlt: name,
  price: null,
  priceIsFrom: false,
  action: { kind: 'preview' },
  art: { shape, tint },
});

export const PREVIEW_PRODUCTS: ProductCardModel[] = [
  item(1, 'سيروم توضيحي', 'dropper', 'malachite'),
  item(2, 'مرطب توضيحي', 'jar', 'henna'),
  item(3, 'غسول توضيحي', 'pump', 'saffron'),
  item(4, 'واقي شمس توضيحي', 'tube', 'kohl'),
];
