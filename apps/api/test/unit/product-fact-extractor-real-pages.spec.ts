import { extractProductFacts } from '../../src/modules/ingestion/services/product-fact-extractor';

/** Page shapes recorded from the real sources on 2026-11-06 (structure and the decisive lines only). */
const ceraveTabbed = `<html><head><title>Hydrating Cleanser</title></head><body>
<h1>CeraVe Hydrating Cleanser</h1><h2></h2><p>For Normal to Dry Skin</p><p>A moisturising cleansing lotion for normal to dry skin with 3 essential ceramides to help protect skin's natural barrier.</p>
<p>Sizes available: 88ml, 236 ml, 473 ml.</p>
<ul><li>PRODUCT FEATURES + BENEFITS</li><li>Ingredients</li><li>HOW TO USE</li></ul>
<p>A hydrating and soothing facial cleansing lotion for normal to dry skin on the face and body.</p><p>Fragrance free, soap free and hypoallergenic.</p>
<p>Recommended use in conjunction with CeraVe Moisturizing Cream</p>
<p>AQUA/WATER, GLYCERIN, CETEARYL ALCOHOL, PHENOXYETHANOL, STEARYL ALCOHOL, CERAMIDE NP, CERAMIDE AP, SODIUM HYALURONATE, CARBOMER, CERAMIDE EOP</p>
<p>Use morning and evening. Apply to wet hands and massage into the skin, then rinse thoroughly.</p>
<h2>Product Features &amp; Benefits</h2><h3>3 Essential Ceramides</h3><p>To help protect the natural skin barrier</p>
<h3>Hyaluronic Acid</h3><p>Helps retain skin's natural moisture</p><h3>Fragrance Free</h3><p>To avoid fragrance irritation</p>
<h2>Products you may like</h2><p>Moisturising Lotion</p><p>Apply liberally to the body as often as needed.</p></body></html>`;

const claryDistributor = `<html><head><title>Clary Hair Shampoo 300 ml</title></head><body><h1>Clary Hair Shampoo 300 ml</h1>
<p>Key Benefits:</p><p>Reduces Hair Loss</p><p>Strengthens Hair from the Root</p><p>Ideal For:</p><p>All hair types, especially thinning or weak hair</p>
<p>Hair Type: All hair types</p><p>How to Use:</p><p>Apply a generous amount to wet hair.</p><p>Rinse thoroughly.</p>
<h2>Ingredients</h2><p>Procapil</p><p>Argan Oil</p><p>Green Coffee</p><p>Keravis PE</p></body></html>`;

const storeWithNoise = `<html><head><title>Capixy Shampoo 250ml</title></head><body><h1>Capixy Shampoo 250ml</h1>
<a>2 Vacation Original Unscented Whitening Deodorant 50 ml</a><p>Capixy Anti-Hair Loss Shampoo is a sulfate-free, paraben-free formula.</p>
<p>How to Use</p><p>Wet your hair thoroughly.</p><p>Rinse thoroughly with water.</p></body></html>`;

describe('fact extraction on real page shapes (2026-11-06)', () => {
  it('tabbed layout: the real instruction is found after the tab contents; marketing under the tab label is not usage', () => {
    const r = extractProductFacts(ceraveTabbed, 'https://africa.cerave.com/en/our-products/cleansers/hydrating-cleanser', { brand: 'CeraVe', productName: 'CeraVe Hydrating Cleanser', size: 236, sizeUnit: 'ml', barcode: null });
    const field = (name: string) => r.facts.find(f => f.field === name)?.value;
    expect(field('usage.instructions')).toEqual(['Use morning and evening. Apply to wet hands and massage into the skin, then rinse thoroughly.']);
    expect(field('usage.routinePeriod')).toBe('BOTH');
    // Another product's instruction below "Products you may like" is never read as this product's.
    expect(JSON.stringify(field('usage.instructions'))).not.toContain('liberally');
    expect(field('composition.keyIngredients')).toEqual([{ name: 'Ceramides', function: 'To help protect the natural skin barrier' }, { name: 'Hyaluronic Acid', function: "Helps retain skin's natural moisture" }]);
    expect(field('composition.fragrance')).toBe('FREE');
    expect(field('composition.inci')).toEqual(expect.arrayContaining(['CERAMIDE NP', 'SODIUM HYALURONATE']));
  });

  it('a short ingredients list that is not a formula is recorded as key ingredients, never as INCI; benefit lines are kept as claims', () => {
    const r = extractProductFacts(claryDistributor, 'https://eparkville.com/products/clary-hair-shampoo-300ml', { brand: 'Clary Corporation', brandAliases: ['clary'], productName: 'Clary Hair Shampoo', size: 300, sizeUnit: 'ml', barcode: null });
    const field = (name: string) => r.facts.find(f => f.field === name)?.value;
    expect(field('composition.inci')).toBeUndefined();
    expect((field('composition.keyIngredients') as Array<{ name: string }>).map(k => k.name)).toEqual(['Procapil', 'Argan Oil', 'Green Coffee', 'Keravis PE']);
    expect(field('claims.manufacturerStated')).toEqual(expect.arrayContaining(['Reduces Hair Loss', 'All hair types, especially thinning or weak hair']));
    expect(field('suitability.hairTypes')).toEqual(['all']);
  });

  it('another product named on the page never gives this product a fragrance-free claim', () => {
    const r = extractProductFacts(storeWithNoise, 'https://e-majestic.com/products/capixy-shampoo-250ml', { brand: 'capixy', productName: 'Capixy Shampoo', size: 250, sizeUnit: 'ml', barcode: null });
    expect(r.facts.find(f => f.field === 'composition.fragrance')).toBeUndefined();
    expect(r.facts.find(f => f.field === 'usage.instructions')?.value).toEqual(['Wet your hair thoroughly.', 'Rinse thoroughly with water.']);
  });
});
