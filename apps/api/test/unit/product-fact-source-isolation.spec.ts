import { extractProductFacts } from '../../src/modules/catalog/research/product-fact-extractor';

describe('product fact source isolation', () => {
  const expected = { brand: 'CeraVe', productName: 'Hydrating Cleanser', size: 236, sizeUnit: 'ml', barcode: null };
  it('does not take a formula, benefits or size from the related-products section', () => {
    const result = extractProductFacts(`<title>CeraVe Hydrating Cleanser</title><h1>CeraVe Hydrating Cleanser</h1>
      <p>A gentle cleansing lotion.</p><h2>Products you may like</h2><h3>Foaming Cleanser 236 ml</h3>
      <h4>Ingredients</h4><p>AQUA, GLYCERIN, NIACINAMIDE, CERAMIDE NP</p>
      <h4>Benefits</h4><p>Reduces excess oil and shine.</p>`, 'https://www.cerave.com/hydrating-cleanser', expected);
    expect(result.identityMatched).toBe(true);
    for (const field of ['identity.size', 'composition.inci', 'claims.manufacturerStated']) {
      expect(result.facts.find(fact => fact.field === field)).toBeUndefined();
    }
  });

  it('does not assign one structured GTIN to every size on a multi-size page', () => {
    const result = extractProductFacts(`<title>CeraVe Hydrating Cleanser</title><h1>CeraVe Hydrating Cleanser</h1>
      <p>Sizes: 236 ml, 473 ml</p><script type="application/ld+json">{"@type":"Product","name":"CeraVe Hydrating Cleanser","gtin13":"3337875597180"}</script>`,
    'https://www.cerave.com/hydrating-cleanser', expected);
    expect(result.identityMatched).toBe(true);
    expect(result.facts.find(fact => fact.field === 'identity.gtin')).toBeUndefined();
  });
});
