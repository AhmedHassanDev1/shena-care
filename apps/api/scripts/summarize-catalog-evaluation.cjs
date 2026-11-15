const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
process.env.TS_NODE_PROJECT = path.join(root, 'apps/api/tsconfig.json');
require('ts-node/register/transpile-only');
const { compareEvaluationIdentity } = require('./lib/catalog-evaluation-oracle');
const datasetDirectory = path.resolve(process.argv[2] ?? path.join(__dirname, 'data/catalog-evaluation-20261115'));
const runtimeDirectory = path.resolve(process.argv[3] ?? path.join(root, 'output/catalog-evaluation-runtime'));
const dataset = JSON.parse(fs.readFileSync(path.join(datasetDirectory, 'dataset.json'), 'utf8'));
const runtime = JSON.parse(fs.readFileSync(path.join(runtimeDirectory, 'runtime.json'), 'utf8'));
const inputHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(datasetDirectory, 'input.csv'))).digest('hex');
if (runtime.inputSha256 !== inputHash) throw new Error('Runtime report does not belong to this exact input batch');
if (runtime.job?.status !== 'COMPLETED' || runtime.rows.some(row => row.outcome === 'PENDING')) throw new Error('Evaluation job is incomplete; pending retries are not measured outcomes');
if (runtime.rows.length !== dataset.rows.length || new Set(runtime.rows.map(r => r.expectedId)).size !== dataset.rows.length) throw new Error('Incomplete or duplicated runtime outcomes');
if (runtime.codeChangedDuringRun) throw new Error('Source changed during the run; this is not a fixed-code evaluation');
const countBy = (items, key) => items.reduce((counts, item) => { const value = key(item); counts[value] = (counts[value] ?? 0) + 1; return counts; }, {});
const rows = runtime.rows.map(row => {
  const expected = dataset.rows.find(r => r.id === row.expectedId);
  if (!expected) throw new Error('Runtime row has no expected identity');
  return { ...row, identityComparison: row.actual ? compareEvaluationIdentity(expected.expected, row.actual) : null };
});
const identified = rows.filter(r => r.actual), correct = identified.filter(r => r.identityComparison.correct);
const wrong = identified.filter(r => !r.identityComparison.correct);
const unresolved = rows.filter(r => r.outcome === 'UNRESOLVED');
const readinessHolds = identified.filter(r => !r.readiness?.pdp.ready || r.readiness?.criticalOpen?.length);
const usage = (runtime.observations ?? rows).reduce((counts, row) => { for (const [key, value] of Object.entries(row.cost ?? {})) counts[key] = (counts[key] ?? 0) + value; return counts; }, {});
const report = {
  schema: 1, seed: dataset.seed, policyVersion: dataset.policyVersion, inputSha256: inputHash,
  code: runtime.code ?? null, codeAfter: runtime.codeAfter ?? null, codeChangedDuringRun: runtime.codeChangedDuringRun ?? null,
  lane: runtime.lane, database: runtime.database, startedAt: runtime.startedAt, finishedAt: runtime.finishedAt,
  elapsedMs: Date.parse(runtime.finishedAt) - Date.parse(runtime.startedAt), rowProcessingMs: rows.reduce((sum, r) => sum + (r.processingMs ?? 0), 0),
  population: { requested: dataset.requested, evaluated: rows.length, brands: countBy(dataset.rows, r => r.brand),
    languages: countBy(dataset.rows, r => r.inputLanguage), categories: countBy(dataset.rows, r => r.categoryType),
    distinctPhysicalSizes: new Set(dataset.rows.map(r => `${r.expected.size}:${r.expected.sizeUnit}`)).size,
    knownMultipacks: dataset.rows.filter(r => r.expected.packCount > 1).length },
  identities: { identified: identified.length, correct: correct.length, incorrect: wrong.length,
    precision: identified.length ? correct.length / identified.length : null,
    coverage: correct.length / rows.length,
    oracle: 'Literal manufacturer title after brand/measurement formatting removal, canonical brand, net content, unit and pack count. This is not an independent expert formulation or GTIN audit.' },
  outcomes: countBy(rows, r => r.outcome), holds: countBy(unresolved, r => r.reasonCode),
  technicalPdpReady: rows.filter(r => r.readiness?.pdp.ready).length,
  guidanceReady: rows.filter(r => r.readiness?.chatbot.ready && r.readiness?.routine.ready).length,
  commercialEligibility: { ready: rows.filter(r => r.readiness?.selling.ready).length, published: runtime.publishedProducts, sellingPrices: runtime.sellingPrices,
    boundary: 'Draft-only evaluation; no price research in this lane and no approved automatic selling-price policy. PDP readiness is not commercial publication approval.' },
  intervention: { unresolvedRows: unresolved.length, additionalPdpOrCriticalRows: readinessHolds.length,
    minimumReviewRows: new Set([...unresolved, ...readinessHolds].map(r => r.rowId)).size,
    boundary: 'Lower bound on review demand, not a timed human-labeling study. Pricing approval and missing guidance evidence are separate.' },
  cost: { usage, paidDiscoveryRequests: usage.searches ?? 0, llmRequests: 0, currencyCost: null,
    observationBasis: runtime.observations ? 'Recorded attempt outcomes including retry observations' : 'Latest row costs only; earlier retry usage may be absent',
    boundary: 'No paid discovery or LLM calls configured. Network/compute/storage costs were not metered; an unknown monetary cost is not reported as zero.' },
  mismatches: wrong.map(r => ({ id: r.expectedId, input: r.input, actual: r.actual, dimensions: r.identityComparison })),
};
fs.writeFileSync(path.join(runtimeDirectory, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
