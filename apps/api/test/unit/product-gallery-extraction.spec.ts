import { extractProductFacts } from '../../src/modules/catalog/research/product-fact-extractor';

describe('official native product gallery evidence', () => {
  const expected = { brand: 'CeraVe', productName: 'Hydrating Cleanser', size: 236, sizeUnit: 'ml', barcode: null };
  const page = 'https://africa.cerave.com/en/our-products/cleansers/hydrating-cleanser';
  const image = 'https://africa.cerave.com/media/French/New-Product-Images/HydratingCleanserWithAward.webp';
  const html = `<title>CeraVe Hydrating Cleanser 236 ml</title><h1>Hydrating Cleanser</h1><p>236 ml</p><meta property="og:image" content="https://africa.cerave.com/media/English/small/HydratingCleanser.jpg">`;
  const images = (tail: string) => extractProductFacts(html + tail, page, expected).facts.find(f => f.field === 'media.sourceImages')?.value as string[];
  it('retains an explicit exact-product gallery original across locale directories', () => {
    expect(images(`<img class="xzoom img-responsive" src="${image}">`)).toContain(image);
  });
  it('does not collect generic images, another product, foreign hosts or related-product galleries', () => {
    const list = images(`<img src="${image}"><img class="xzoom" src="https://africa.cerave.com/media/FoamingCleanser.webp"><img class="xzoom" src="https://other.example/HydratingCleanser.webp"><h2>Related products</h2><img class="xzoom" src="${image}">`);
    expect(list).not.toContain(image);
    expect(list.some(url => url.includes('Foaming') || url.includes('other.example'))).toBe(false);
  });
});
