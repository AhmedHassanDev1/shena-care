// Reproducible manufacturer discovery; no database or selling-price writes.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
process.env.TS_NODE_PROJECT = path.join(root, 'apps/api/tsconfig.json');
process.env.NODE_ENV = 'test';
process.env.RESEARCH_HOST_INTERVAL_MS = '1500';
require('ts-node/register/transpile-only');
const { ResearchSourceFetcher } = require('../src/modules/catalog/research/research-source-fetcher');
const { readMeasures } = require('../src/modules/intake/lib/intake-text');
const { readProductType } = require('../src/modules/catalog/research/product-type');
const { ScopeGate, BrandDetector } = require('../src/modules/intake/lib/matching');
const fetcher = new ResearchSourceFetcher();
const policy = JSON.parse(fs.readFileSync(path.resolve(process.argv[2] ?? path.join(__dirname, 'data/catalog-evaluation-20261115/policy-snapshot.json'))));
const variantFile = path.join(__dirname, 'data/catalog-evaluation-20261115/input-variants.json');
const inputVariants = fs.existsSync(variantFile) ? JSON.parse(fs.readFileSync(variantFile, 'utf8')) : [];
const document = policy.policy.document;
const snapshot = { policyMode: document.mode, policyCategories: document.categories, brandCategoryRules: document.brandCategoryRules,
  excludedTerms: document.excludedTerms, disabledExcludedClasses: document.disabledExcludedClasses, skus: [],
  brands: policy.brands.map(b => ({ ...b, aliases: document.brands.find(r => r.id === b.id)?.aliases ?? [], policyEffect: document.brands.find(r => r.id === b.id)?.effect ?? null })),
  deniedLabels: document.brands.filter(b => b.effect === 'DENY').flatMap(b => [b.name, ...(b.aliases ?? [])]),
  allowedLabels: document.brands.filter(b => b.effect === 'ALLOW').flatMap(b => [b.name, ...(b.aliases ?? [])]) };
const scopeGate = new ScopeGate(snapshot), brandDetector = new BrandDetector(snapshot.brands);
const out = path.resolve(process.argv[3] ?? path.join(root, 'output/catalog-evaluation')); fs.mkdirSync(path.join(out, 'sources'), { recursive: true });
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const decode = value => value.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
const text = value => decode(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const sources = [
  { brand: 'capixy', sourceBrand: 'Capixy', collection: 'https://e-majestic.com/pages/capixy', pages: 1, manufacturerProof: 'https://e-majestic.com/pages/capixy' },
  { brand: 'StarVille', collection: 'https://shop.parkvillepharma.com/collections/starville', pages: 3, manufacturerProof: 'https://www.parkvillepharma.com/brand/starville' },
  { brand: 'shaan', collection: 'https://shop.parkvillepharma.com/collections/shaan', pages: 3, manufacturerProof: 'https://www.parkvillepharma.com/brand/shaan' },
  { brand: 'Bobai', collection: 'https://shop.parkvillepharma.com/collections/bobai', pages: 2, manufacturerProof: 'https://www.parkvillepharma.com/brand/bobai' },
  { brand: 'Clary Corporation', sourceBrand: 'Clary', collection: 'https://shop.parkvillepharma.com/collections/clary', pages: 2, manufacturerProof: 'https://www.parkvillepharma.com/brand/clary' },
  { brand: 'Eva Cosmetics', sourceBrand: 'Eva', collection: 'https://www.shop.eva-cosmetics.com/collections/all', pages: 10, manufacturerProof: 'https://eva-cosmetics.com/' },
];
for (const source of sources) {
  if (!policy.policy.document.brands.some(b => b.name.toLowerCase() === source.brand.toLowerCase() && b.effect === 'ALLOW')) throw new Error('Source brand is not in the current explicit allowlist');
}
const allowedTypes = new Set(['cleanser', 'moisturizer', 'body-moisturizer', 'serum', 'sunscreen', 'shampoo', 'conditioner', 'leave-in', 'hair-mask', 'hair-oil', 'hair-treatment', 'hair-styling', 'toner', 'exfoliant', 'face-mask', 'eye-care', 'lip-care']);
const stateFile = path.join(out, 'discovery.json');
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile)) : { schema: 1, seed: 'shinacare-eligible-20261115-v1', startedAt: new Date().toISOString(), policyVersion: policy.policy.version, sources, collections: [], pages: [], candidates: [] };
state.sources = sources;
state.seed = 'shinacare-eligible-20261115-v2';
function save() { fs.writeFileSync(stateFile, JSON.stringify(state, null, 2)); }
async function read(url) {
  const host = new URL(url).hostname.replace(/^www\./, '');
  const response = await fetcher.fetch(url, { kind: 'page', isApprovedHost: actual => actual.replace(/^www\./, '') === host });
  const record = { url, finalUrl: response.finalUrl, outcome: response.outcome, fetchedAt: response.fetchedAt, contentHash: response.contentHash };
  if (response.body) fs.writeFileSync(path.join(out, 'sources', response.contentHash + '.html'), response.body);
  return { record, html: response.body?.toString('utf8') ?? '' };
}
function productNodes(html) {
  const nodes = [];
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(walk); return; }
    const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
    if (types.includes('Product') || types.includes('ProductGroup')) nodes.push(value);
    if (value['@graph']) walk(value['@graph']);
  };
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(match[1])); } catch { /* malformed markup is not an oracle */ }
  }
  return nodes;
}
const fold = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function classify(record, html) {
  const node = productNodes(html)[0];
  const title = typeof node?.name === 'string' ? text(node.name) : text(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '');
  const statedBrand = typeof node?.brand === 'string' ? node.brand : typeof node?.brand?.name === 'string' ? node.brand.name : null;
  const approved = sources.filter(source => new URL(source.collection).hostname.replace(/^www\./, '') === new URL(record.finalUrl).hostname.replace(/^www\./, ''));
  const aliases = source => [source.brand, source.sourceBrand, ...(policy.policy.document.brands.find(b => b.name.toLowerCase() === source.brand.toLowerCase())?.aliases ?? [])].filter(Boolean).map(fold);
  const byBrand = statedBrand ? approved.filter(source => aliases(source).includes(fold(statedBrand))) : [];
  const byTitle = approved.filter(source => aliases(source).some(alias => (' ' + fold(title) + ' ').includes(' ' + alias + ' ')));
  const matches = byBrand.length ? byBrand : byTitle;
  const source = matches.length === 1 && (!byBrand.length || !byTitle.length || byTitle.some(s => s.brand === byBrand[0].brand)) ? matches[0] : null;
  const reading = readMeasures(title), types = readProductType(title).types.filter(t => allowedTypes.has(t.key));
  const reason = record.outcome !== 'OK' ? record.outcome : !title ? 'NO_NATIVE_PRODUCT_TITLE' : !source ? 'NATIVE_BRAND_NOT_UNAMBIGUOUS'
    : reading.measures.length !== 1 ? 'NET_CONTENT_NOT_UNAMBIGUOUS_IN_TITLE' : !types.length ? 'NO_CONFIRMED_ELIGIBLE_CARE_TYPE' : null;
  const page = { ...record, brand: source?.brand ?? null, statedBrand, title, eligibilityReason: reason };
  if (reason) return { page, candidate: null };
  const size = reading.measures[0];
  const ampoules = title.match(/\b(\d{1,2})\s*ampoules?\b/i);
  const packCount = reading.packCount ?? (ampoules ? Number(ampoules[1]) : null);
  return { page, candidate: { ...record, brand: source.brand, manufacturerProof: source.manufacturerProof, categoryType: types[0].key,
    expected: { name: title, brand: source.brand, sourceBrand: source.sourceBrand ?? source.brand, size: size.size, sizeUnit: size.unit,
      packCount, packText: reading.packText ?? ampoules?.[0] ?? null,
      manufacturerProductCode: typeof node?.sku === 'string' ? node.sku : null, barcode: null } } };
}
function selectDataset() {
  // Selection is independent of pipeline success: round-robin brand/type strata,
  // fixed seeded URL order. Every excluded/discovered record stays in the ledger.
  const unique = new Map();
  const scopeExclusions = [];
  for (const c of state.candidates) {
    const scope = scopeGate.decide({ name: c.expected.name, catalogBrands: brandDetector.detect(c.expected.name), hardIdentifier: false });
    if (scope.decision === 'SKIP') { scopeExclusions.push({ url: c.url, title: c.expected.name, scope }); continue; }
    const identityName = fold(c.expected.name.replace(/\(\s*special offer[^)]*\)/gi, ''));
    const key = JSON.stringify([c.brand.toLowerCase(), identityName, c.expected.size, c.expected.sizeUnit, c.expected.packCount]);
    if (!unique.has(key)) unique.set(key, c);
  }
  const strata = new Map();
  for (const candidate of unique.values()) {
    const key = candidate.brand + ':' + candidate.categoryType;
    if (!strata.has(key)) strata.set(key, []);
    strata.get(key).push(candidate);
  }
  for (const group of strata.values()) group.sort((a, b) => digest(state.seed + a.url).localeCompare(digest(state.seed + b.url)));
  const selected = [];
  for (let index = 0; selected.length < 100; index++) {
    let added = false;
    for (const key of [...strata.keys()].sort()) {
      if (strata.get(key)[index] && selected.length < 100) { selected.push(strata.get(key)[index]); added = true; }
    }
    if (!added) break;
  }
  const rows = selected.map((c, i) => {
    const mixed = i % 3 === 0;
    // Only the input spelling changes. The expected identity remains the exact
    // manufacturer's title and stated net content, never a translated fact.
    const quantity = new Intl.NumberFormat('ar-EG', { useGrouping: false, maximumFractionDigits: 3 }).format(c.expected.size);
    const unit = c.expected.sizeUnit === 'ml' ? 'مل' : c.expected.sizeUnit === 'g' ? 'جم' : c.expected.sizeUnit;
    const variant = inputVariants.find(v => v.sourceUrl === c.url && v.expectedManufacturerTitle === c.expected.name);
    const inputName = variant?.inputName ?? (mixed && !c.expected.packCount ? `${c.expected.name.replace(/\d+(?:[.,]\d+)?\s*(?:ml|gm|g|l|litres?|liters?)\b/gi, '').trim()} ${quantity} ${unit}` : c.expected.name);
    return { id: 'SC-EVAL-' + String(i + 1).padStart(3, '0'), inputName, inputLanguage: variant?.inputLanguage ?? (mixed ? 'MIXED_AR_EN' : 'EN'),
      inputTransformation: variant?.method ?? (mixed ? 'Arabic digits and net-content unit spelling; same manufacturer identity' : 'Exact manufacturer title'),
      expected: c.expected, brand: c.brand, categoryType: c.categoryType, source: { url: c.url, manufacturerProof: c.manufacturerProof, observedAt: c.fetchedAt, contentHash: c.contentHash }, selectionKey: digest(state.seed + c.url) };
  });
  const report = { schema: 1, createdAt: new Date().toISOString(), policyVersion: policy.policy.version, seed: state.seed,
    selectionMethod: 'All discovered native manufacturer product titles with an explicit unambiguous size and an eligible care type; apply current scope exclusions; deduplicate exact identities including packs and promotional-title duplicates; deterministic round-robin brand/type strata. No pipeline success filter. URL-and-title-bound Arabic input spellings preserve the expected manufacturer identity.',
    oracleBoundary: 'Manufacturer title and net-content ground truth only. Barcode, ingredients, medical claims, media approval, prices and publication remain independent pipeline checks.',
    discoveredPages: state.pages.length, scopeExclusions, eligibleDistinctCandidates: unique.size, requested: 100, actual: rows.length, complete: rows.length >= 100, rows };
  fs.writeFileSync(path.join(out, 'dataset.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(out, 'input.csv'), '\ufeff' + ['evaluation_id,name,url', ...rows.map(r => [r.id, r.inputName, r.source.url].map(value => '"' + value.replace(/"/g, '""') + '"').join(','))].join('\n') + '\n');
  return report;
}
(async () => {
  if (process.argv.includes('--rebuild')) {
    state.candidates = [];
    state.pages = state.pages.map(record => {
      const html = /^[a-f0-9]{64}$/.test(record.contentHash ?? '') ? fs.readFileSync(path.join(out, 'sources', record.contentHash + '.html'), 'utf8') : '';
      const result = classify(record, html);
      if (result.candidate) state.candidates.push(result.candidate);
      return result.page;
    });
    save(); selectDataset();
  }
  for (const source of sources) {
    for (let page = 1; page <= source.pages; page++) {
      const url = source.collection + (page === 1 ? '' : '?page=' + page);
      if (state.collections.some(c => c.url === url)) continue;
      const { record, html } = await read(url);
      const urls = [...html.matchAll(/<a\b[^>]*href=["']([^"']*\/products\/[^"']+)["']/gi)].flatMap(match => {
        try {
          const product = new URL(decode(match[1]), record.finalUrl);
          if (product.hostname.replace(/^www\./, '') !== new URL(source.collection).hostname.replace(/^www\./, '')) return [];
          product.pathname = product.pathname.replace(/^\/collections\/[^/]+(\/products\/[^/]+)\/?$/, '$1'); product.search = ''; product.hash = '';
          return [product.href];
        } catch { return []; }
      });
      state.collections.push({ ...record, brand: source.brand, productUrls: [...new Set(urls)] }); save();
      console.log(JSON.stringify({ stage: 'collection', brand: source.brand, page, outcome: record.outcome, links: new Set(urls).size }));
      if (record.outcome !== 'OK' || !urls.length) break;
    }
  }
  for (const source of sources) {
    const urls = [...new Set(state.collections.filter(c => c.brand === source.brand).flatMap(c => c.productUrls))].sort();
    for (const url of urls) {
      if (state.pages.some(p => p.url === url)) continue;
      const { record, html } = await read(url);
      const result = classify(record, html);
      state.pages.push(result.page);
      if (result.candidate) state.candidates.push(result.candidate);
      save(); const dataset = selectDataset();
      console.log(JSON.stringify({ stage: 'product', brand: result.page.brand, title: result.page.title, outcome: record.outcome, eligibilityReason: result.page.eligibilityReason, distinctEligible: dataset.eligibleDistinctCandidates }));
    }
  }
  const dataset = selectDataset();
  console.log(JSON.stringify({ stage: 'finished', actual: dataset.actual, eligibleDistinctCandidates: dataset.eligibleDistinctCandidates, complete: dataset.complete, usage: fetcher.usage }));
})().catch(error => { save(); selectDataset(); console.error(String(error.message).slice(-1000)); process.exitCode = 1; });
