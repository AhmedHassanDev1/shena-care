import { extractProductFacts } from '../../src/modules/catalog/research/product-fact-extractor';
import { rinseMode } from '../../src/modules/catalog/research/catalog-decision-engine';

describe('literal micellar-water instructions from the pilot manufacturer page', () => {
  const expected = { brand: 'Bioderma', productName: 'Sensibio H2O', size: 250, sizeUnit: 'ml', barcode: null };
  const html = '<title>Bioderma Sensibio H2O 250 ml</title><h1>Sensibio H2O</h1><p>250 ml</p>';
  it('retains the soak, cleanse and no-rinse instructions without inventing ingredients', () => {
    const result = extractProductFacts(html + '<h2>How to use</h2><p>Soak a reusable cotton-pad with Sensibio H2O.</p><p>Cleanse and remove makeup from face and eyes.</p><p>No need to rinse-off for skincare benefits.</p>', 'https://www.bioderma.co.uk/p/sensibio-h2o-micellar-water', expected);
    const usage = result.facts.find(f => f.field === 'usage.instructions')?.value as string[];
    expect(usage).toEqual(['Soak a reusable cotton-pad with Sensibio H2O.', 'Cleanse and remove makeup from face and eyes.', 'No need to rinse-off for skincare benefits.']);
    expect(rinseMode(usage)).toBe('LEAVE_ON');
    expect(result.facts.some(f => f.field === 'composition.inci')).toBe(false);
  });
  it('does not use instructions from a related product or navigation prose', () => {
    const result = extractProductFacts(html + '<h2>How to use</h2><p>Discover how to cleanse your skin?</p><h2>Related products</h2><p>Soak a pad with another product.</p>', 'https://www.bioderma.co.uk/p/sensibio-h2o-micellar-water', expected);
    expect(result.facts.some(f => f.field === 'usage.instructions')).toBe(false);
  });
});
