import { extractProductFacts } from '../../src/modules/catalog/research/product-fact-extractor';

describe('manufacturer configurable product variant images (Bioderma pilot)', () => {
  const expected = { brand: 'Bioderma', productName: 'Sensibio H2O', size: 250, sizeUnit: 'ml', barcode: null };
  const url = 'https://www.bioderma.co.uk/p/sensibio-h2o-micellar-water';
  const image = (size: number) => `https://back-ac-prod.bioderma.com/media/catalog/product/${size}.jpg`;
  const variant = (size: number) => ({ name: `Sensibio H2O ${size} ml`, sku: `pack-${size}`, variantAttributes: { volume: size }, assets: [
    { type: 'image', label: '', position: 0, path: image(size) },
    { type: 'image', label: 'Composition', position: 8, path: 'https://back-ac-prod.bioderma.com/composition.jpg' },
    { type: 'video', label: '', position: 0, path: 'https://back-ac-prod.bioderma.com/video.jpg' },
  ] });
  const page = (variants: unknown[]) => `<title>Bioderma Sensibio H2O</title><h1>Sensibio H2O</h1><p>100 ml, 250 ml, 500 ml</p>
    <meta property="og:image" content="${image(500)}"><form data-product-sku="BIO_SENSIBIO_H2O" data-product-variants="${JSON.stringify(variants).replace(/"/g, '&#34;')}"></form>`;
  const images = (html: string) => extractProductFacts(html, url, expected).facts.find(f => f.field === 'media.sourceImages')?.value;
  it('extracts the original asset explicitly bound to 250 ml, without the default 500 ml hero or other gallery roles', () => {
    expect(images(page([variant(500), variant(250), variant(100)]))).toEqual([image(250)]);
  });
  it('does not fall back to the default hero when the requested variant has no matching packshot', () => {
    expect(images(page([variant(500), variant(100)]))).toBeUndefined();
  });
  it('refuses ambiguous variant bindings and additional formulation dimensions', () => {
    expect(images(page([variant(250), { ...variant(250), sku: 'another-pack' }]))).toBeUndefined();
    expect(images(page([{ ...variant(250), variantAttributes: { volume: 250, fragrance: 'rose' } }]))).toBeUndefined();
  });
  it('rejects an unsafe image URL and never turns a manufacturer SKU code into a GTIN', () => {
    const item = variant(250); item.assets[0].path = 'http://back-ac-prod.bioderma.com/insecure.jpg';
    const result = extractProductFacts(page([item]), url, expected);
    expect(result.facts.some(f => f.field === 'media.sourceImages' || f.field === 'identity.gtin')).toBe(false);
  });
});
