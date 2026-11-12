import { imageBelongsToVerifiedProductPage } from '../../src/application/composition/services/intake/catalog-enrichment.service';

describe('catalog intake image provenance', () => {
  const image = 'https://shop.parkvillepharma.com/cdn/shop/files/Untitled_design_671a351c.png';
  const official = 'https://shop.parkvillepharma.com/products/shaan-facial-cleanser-250-gm';

  it('accepts an opaque CDN image tied to the exact verified product page', () => {
    expect(imageBelongsToVerifiedProductPage(image, official, [official])).toBe(true);
  });

  it('does not trust an opaque image from a different page', () => {
    expect(imageBelongsToVerifiedProductPage(image, 'https://shop.parkvillepharma.com/products/other', [official])).toBe(false);
  });
});
