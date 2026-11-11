const fs = require('node:fs');
const path = require('node:path');
require('ts-node/register/transpile-only');
require('dotenv').config({ path: process.env.SHINACARE_API_ENV || path.join(__dirname, '../../apps/api/.env'), quiet: true });
const { ProductResearchService } = require('../../apps/api/src/modules/catalog/research/product-research.service');
const { extractProductFacts } = require('../../apps/api/src/modules/catalog/research/product-fact-extractor');

const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, 'dev-before.json'), 'utf8')).products;
const products = snapshot.map(actual => ({ id: actual.id, brand: actual.brand, name: actual.name,
  size: actual.size, sizeUnit: actual.sizeUnit, barcode: actual.barcode,
  missingFields: ['inci', 'usage'].filter(field => !actual.completeness[field]).map(field =>
    field === 'inci' ? 'composition.inci' : 'usage.instructions') }));

async function main() {
  const service = new ProductResearchService();
  const output = path.join(__dirname, process.argv[2] || 'before.jsonl');
  fs.writeFileSync(output, '');
  for (const product of products) {
    const start = Date.now();
    const startSearches = service.usage.searches;
    const startPages = service.usage.pageFetches;
    const startDirectPages = service.usage.directPageFetches ?? 0;
    try {
      const result = await service.researchProductCandidate({ candidateId: product.id, brand: product.brand, name: product.name,
        size: product.size, sizeUnit: product.sizeUnit, barcode: product.barcode,
        missingFields: product.missingFields ?? ['composition.inci', 'usage.instructions'] });
      const ranked = result.discoveredSources.map(source => {
        const html = `<h1>${source.title.replace(/[<>&]/g, ' ')}</h1>`;
        const checked = extractProductFacts(html, source.url, { brand: product.brand, productName: product.name, size: product.size, sizeUnit: product.sizeUnit, barcode: null });
        return { url: source.url, title: source.title, sourceType: source.sourceType, titleIdentityMatched: checked.identityMatched,
          sizeConfirmedInTitle: checked.facts.some(f => f.field === 'identity.size'), rejected: checked.rejected.map(r => r.reason) };
      });
      const row = { id: product.id, brand: product.brand, name: product.name, durationMs: Date.now() - start,
        searches: service.usage.searches - startSearches, status: result.researchStatus, providers: result.providerStatuses,
        pageFetches: service.usage.pageFetches - startPages, directPageFetches: (service.usage.directPageFetches ?? 0) - startDirectPages,
        verifiedSource: result.verifiedSource ?? null,
        discovered: ranked, evidenced: result.fieldEvidences.filter(e => e.verificationStatus === 'SUPPORTED').map(e => e.fieldName),
        supportedEvidence: result.fieldEvidences.filter(e => e.verificationStatus === 'SUPPORTED').map(e => ({ field: e.fieldName, url: e.sourceUrl, tier: e.sourceType })),
        supportedValues: result.fieldEvidences.filter(e => e.verificationStatus === 'SUPPORTED' && ['size', 'usage', 'ingredients'].includes(e.fieldName))
          .map(e => ({ field: e.fieldName, value: e.proposedValue })),
        rejectedCount: result.rejectedFacts?.length ?? 0, firstSourceFalseMatch: ranked.length > 0 && !ranked[0].titleIdentityMatched };
      fs.appendFileSync(output, JSON.stringify(row) + '\n');
      console.log(JSON.stringify({ id: row.id, durationMs: row.durationMs, searches: row.searches, status: row.status, sources: ranked.length, firstSourceFalseMatch: row.firstSourceFalseMatch, evidenced: row.evidenced.length }));
    } catch (error) {
      const row = { id: product.id, error: error.message, durationMs: Date.now() - start, searches: service.usage.searches - startSearches };
      fs.appendFileSync(output, JSON.stringify(row) + '\n');
      console.log(JSON.stringify(row));
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
