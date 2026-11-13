const fs = require('fs'), path = require('path'), { performance } = require('perf_hooks');
require('ts-node/register/transpile-only');
const { CandidateIndex } = require('../src/modules/intake/lib/matching'), { readMeasures, identityFingerprint } = require('../src/modules/intake/lib/intake-text'), { curatedBrandAlias } = require('../src/modules/catalog/research/brand-aliases');
const out = path.resolve(__dirname, '../../../output/catalog-improvements-2026-11-13'), snapshot = JSON.parse(fs.readFileSync(process.argv[2] ?? path.join(out, 'snapshot.json')));
snapshot.skus = snapshot.skus.filter(s => s.identityStatus === 'EVIDENCE_VERIFIED');
snapshot.brands = snapshot.brands.filter(b => snapshot.skus.some(s => s.brandId === b.id));
const index = new CandidateIndex(snapshot, new Map(), new Map());
const pick = word => snapshot.skus.find(s => s.productName.toLowerCase().includes(word)).skuId;
const oracle = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../test/fixtures/intake/nahar-oracle.json')));
const cases = [];
for (const r of oracle['nahar-price-list-1.xlsx']) {
    if (r.expect === 'MATCH:CeraVe|Hydrating|236')
        cases.push({ name: r.name, expected: pick('hydrating') });
    if (r.expect === 'MATCH:CeraVe|Foaming|236')
        cases.push({ name: r.name, expected: pick('foaming') });
    if (r.expect === 'MATCH:CeraVe|Cream|454')
        cases.push({ name: r.name, expected: pick('cream') });
    if (r.expect === 'MATCH_OR_CRITICAL:CeraVe|SA|236')
        cases.push({ name: r.name, expected: pick('smoothing') });
}
for (const [name, word] of [['CeraVe Hydrating Facial Cleanser 236ml', 'hydrating'], ['Cervae Hydrating Facial Cleanser 236ml', 'hydrating'], ['CeraVe Foaming Facial Cleanser 236ml', 'foaming'], ['بيوديرما سينسيبيو H2O 250 مل', 'sensibio'], ['The Ordinary Niacinamide 10% + Zinc 1% 30ml', 'niacinamide'], ['CeraVe SA Smoothing Cleanser 236ml', 'smoothing']])
    cases.push({ name, expected: pick(word) });
for (const name of ['CeraVe Hydrating Facial Cleanser 473ml', 'CeraVe Hydrating Facial Cleanser', 'CeraVe Moisturizing Cream 340g', 'CeraVe Foaming Facial Cleanser 2 x 236ml', 'The Ordinary Niacinamide 5% + Zinc 1% 30ml', 'Bioderma Niacinamide 10% + Zinc 1% 30ml', 'CeraVe غسول 236 مل'])
    cases.push({ name, expected: null });
const row = c => { const m = readMeasures(c.name); return { name: c.name, barcode: null, code: null, measure: m.measures[0] ? { size: m.measures[0].size, unit: m.measures[0].unit } : null, measureConflict: m.measures.length > 1, packCount: m.packCount, fingerprint: identityFingerprint(c.name, m.measures[0] ?? null, m.packCount) }; };
const values = cases.map(c => ({ ...c, row: row(c) }));
const samples = [];
for (let pass = 0; pass < 100; pass++)
    for (const c of values) {
        const t = performance.now();
        index.match(c.row);
        samples.push(performance.now() - t);
    }
samples.sort((a, b) => a - b);
const results = values.map(c => { const v = index.match(c.row); return { name: c.name, expected: c.expected, actual: v.kind === 'MATCH' ? v.skuId : null, kind: v.kind, reason: v.reasonCode, basis: v.basis, candidates: v.candidates }; });
const trueMatches = results.filter(r => r.actual && r.actual === r.expected).length, falseMatches = results.filter(r => r.actual && r.actual !== r.expected).length, positives = results.filter(r => r.expected).length;
const aliases = [['سِيـرَافِي', 'CeraVe'], ['Cera Ve', 'CeraVe'], ['La Roche–Posay', 'La Roche-Posay'], ['ذا أورديناري', 'The Ordinary'], ['فيشى', 'Vichy'], ['unknown brand', null]].map(([input, expected]) => ({ input, expected, actual: curatedBrandAlias(input)?.canonicalName ?? null }));
const report = { scope: 'six real persisted pilot SKUs; retained Nahar cases plus explicitly constructed typo/negative probes; not a production accuracy estimate', rows: results.length, trueMatches, falseMatches, positives, precision: trueMatches / (trueMatches + falseMatches), recall: trueMatches / positives, latencyMs: { p50: samples[Math.floor(samples.length * .5)], p95: samples[Math.floor(samples.length * .95)] }, aliasesCorrect: aliases.filter(r => r.actual === r.expected).length, aliases, results };
fs.writeFileSync(process.argv[3] ?? path.join(out, 'matching-after.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, results: report.results.map(r => ({ name: r.name, expected: r.expected, actual: r.actual, kind: r.kind })) }));
