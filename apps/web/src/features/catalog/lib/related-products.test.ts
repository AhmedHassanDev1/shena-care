import { selectRelatedProducts } from './related-products';

describe('selectRelatedProducts', () => {
  it('excludes the viewed product and repeated products while keeping catalog order', () => {
    const products = [
      { id: 'current', slug: 'current' },
      { id: 'a', slug: 'a' },
      { id: 'a', slug: 'a' },
      { id: 'b', slug: 'b' },
    ];
    expect(selectRelatedProducts(products, 'current', 2).map((product) => product.id)).toEqual(['a', 'b']);
  });
});
