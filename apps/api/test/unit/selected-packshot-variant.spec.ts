import { extractProductFacts } from '../../src/modules/catalog/research/product-fact-extractor';

describe('real Cetaphil selected-size and review-text failure cases', () => {
  const sku = { brand: 'Cetaphil', productName: 'Gentle Skin Cleanser', size: 236, sizeUnit: 'ml', barcode: null };
  const image = 'https://www.cetaphil.co.uk/images/GSC-1L.jpg';
  const page = (selected: string | null) => `<h1>Cetaphil Gentle Skin Cleanser</h1>
    <meta property="og:image" content="${image}">
    <span class="bvseo-itemReviewed">Cetaphil Gentle Skin Cleanser 236ml</span>
    <select class="custom-select select-size"><option data-attr-value="236ml" ${selected === '236ml' ? 'selected' : ''}>236ml</option>
    <option data-attr-value="1L" ${selected === '1L' ? 'selected' : ''}>1L</option></select>`;
  const extract = (html: string) => extractProductFacts(html, 'https://www.cetaphil.co.uk/product', sku);

  it('never imports the selected 1L image for an offered 236ml variant', () => {
    const result = extract(page('1L'));
    expect(result.facts.find(fact => fact.field === 'identity.size')?.value).toEqual({ value: 236, unit: 'ml' });
    expect(result.facts.find(fact => fact.field === 'media.sourceImages')).toBeUndefined();
    expect(result.rejected).toContainEqual(expect.objectContaining({ field: 'media.sourceImages', reason: 'VARIANT_IMAGE_NOT_CONFIRMED' }));
  });
  it('abstains from generic hero images when no size is selected', () => {
    expect(extract(page(null)).facts.find(fact => fact.field === 'media.sourceImages')).toBeUndefined();
  });
  it('retains the selected exact variant image', () => {
    const html = page('236ml').replaceAll(image, 'https://www.cetaphil.co.uk/images/GSC-236ml.jpg');
    expect(extract(html).facts.find(fact => fact.field === 'media.sourceImages')?.value)
      .toEqual(['https://www.cetaphil.co.uk/images/GSC-236ml.jpg']);
  });
  it('does not prove product size from an aggregate review label alone', () => {
    const result = extract('<h1>Cetaphil Gentle Skin Cleanser</h1><span class="bvseo-itemReviewed">Cetaphil Gentle Skin Cleanser 236ml</span>');
    expect(result.facts.find(fact => fact.field === 'identity.size')).toBeUndefined();
    expect(result.rejected).toContainEqual(expect.objectContaining({ reason: 'SIZE_NOT_CONFIRMED_BY_PAGE' }));
  });
  it('rejects a stale 1L hero even when the selector now says 236ml', () => {
    expect(extract(page('236ml')).facts.find(fact => fact.field === 'media.sourceImages')).toBeUndefined();
  });
  it('does not promote a sitewide campaign OG image over the product structured packshot', () => {
    const packshot = 'https://theordinary.com/products/rdn-hyaluronic-acid-2pct-b5-30ml.png';
    const result = extractProductFacts(`<h1>The Ordinary Hyaluronic Acid 2% + B5 30ml</h1>
      <script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'The Ordinary Hyaluronic Acid 2% + B5 30ml', image: [packshot,
      'https://theordinary.com/products/infographics/ingredient-graphic.jpg'] })}</script>
      <meta property="og:image" content="https://theordinary.com/theordinary/homepage/slotA/heroes-slot-a-mobile.jpg">`,
    'https://theordinary.com/product', { brand: 'The Ordinary', productName: 'Hyaluronic Acid 2% + B5', size: 30, sizeUnit: 'ml', barcode: null });
    expect(result.facts.find(fact => fact.field === 'media.sourceImages')?.value).toEqual([packshot]);
  });
});
