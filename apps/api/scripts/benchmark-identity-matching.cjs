#!/usr/bin/env node
// GLO-285 matching benchmark against an isolated local *_test PostgreSQL. Synthetic corpus: regression evidence, not production accuracy.
//
//   DATABASE_URL=... DIRECT_URL=... node scripts/benchmark-identity-matching.cjs --out <dir> [--before <dir of service snapshots>] [--seeds 1] [--noise 0] [--big-brand 0]
//
// --before compiles product-identity/row-normalization/eligibility-policy snapshots so both versions classify the same rows on the same database.
const { assertLocalTestDatabase } = require('./local-test-database.cjs');
assertLocalTestDatabase(process.env);
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { performance } = require('node:perf_hooks');
const apiRoot = path.join(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(apiRoot, 'tsconfig.json') });
const ts = require('typescript');
const { PrismaClient, Prisma } = require('@prisma/client');

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const outDir = arg('out');
if (!outDir) throw new Error('--out is required');
const beforeDir = arg('before', null);
const seeds = arg('seeds', '1').split(',').map(Number);
const noiseProducts = Number(arg('noise', 0));
const bigBrandProducts = Number(arg('big-brand', 0));
const label = arg('label', 'run');
const heldOutVocabulary = process.argv.includes('--held-out-vocabulary');
const compareRetrieval = process.argv.includes('--compare-retrieval');
const focusBrand = arg('focus-brand', null);
fs.mkdirSync(outDir, { recursive: true });

const services = path.join(apiRoot, 'src/modules/ingestion/services');
const { BrandService } = require(path.join(apiRoot, 'src/modules/catalog/services/brand.service.ts'));
const { CatalogService } = require(path.join(apiRoot, 'src/modules/catalog/services/catalog.service.ts'));
const { buildCatalog, buildRows, buildPolicyRows, BRANDS, HELD_OUT_FAMILIES, HELD_OUT_LINES } = require(path.join(apiRoot, 'test/fixtures/glo285-matching-corpus.ts'));
const { retrievalQuery } = require(path.join(services, 'identity-text.ts'));
const { normalizeSearchText } = require(path.join(apiRoot, 'src/modules/catalog/search/search-text.ts'));

// Compile a snapshot as if it lived at its real path, so its relative imports resolve; identity-text does not exist for it.
function compileSnapshot(name) {
  const filename = path.join(services, `${name}.ts`);
  const source = fs.readFileSync(path.join(beforeDir, `${name}.ts`), 'utf8');
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, emitDecoratorMetadata: false } }).outputText, filename);
  return mod.exports;
}
const versions = {};
versions.after = {
  Identity: require(path.join(services, 'product-identity.service.ts')).ProductIdentityService,
  Normalizer: require(path.join(services, 'row-normalization.service.ts')).RowNormalizationService,
  compilePolicy: require(path.join(services, 'ingestion-eligibility.policy.ts')).compileEligibilityPolicy,
};
if (beforeDir) versions.before = {
  Identity: compileSnapshot('product-identity.service').ProductIdentityService,
  Normalizer: compileSnapshot('row-normalization.service').RowNormalizationService,
  compilePolicy: compileSnapshot('ingestion-eligibility.policy').compileEligibilityPolicy,
};

const quantile = (values, p) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : null; };
const round = (value, digits = 3) => value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits;
const pct = (a, b) => b ? round(100 * a / b, 2) : null;

(async () => {
  const db = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
  let sql = 0;
  db.$on('query', event => { if (!/^(BEGIN|COMMIT|ROLLBACK|SET )/.test(event.query)) sql++; });
  await db.$connect();
  const database = (await db.$queryRawUnsafe('SELECT current_database() AS name, version() AS version'))[0];
  if (!/_test$/.test(database.name) || !/^PostgreSQL 17/.test(database.version)) throw new Error(`Refusing to run on ${database.name}`);
  if (await db.product.count()) throw new Error('Benchmark database must start empty of products');

  // Catalog -----------------------------------------------------------------------------------------------------------
  const catalog = heldOutVocabulary ? buildCatalog(HELD_OUT_FAMILIES, HELD_OUT_LINES) : buildCatalog();
  const brandIds = new Map();
  for (const brand of BRANDS) brandIds.set(brand.name, (await db.brand.create({ data: { name: brand.name, slug: brand.name.toLowerCase().replace(/[^a-z]+/g, '-') } })).id);
  const productIds = new Map();
  for (const sku of catalog) if (!productIds.has(sku.productKey)) {
    productIds.set(sku.productKey, (await db.product.create({ data: { name: sku.product, slug: `p-${productIds.size}`, brandId: brandIds.get(sku.brand) } })).id);
  }
  const skuIds = new Map();
  for (const sku of catalog) {
    skuIds.set(sku.key, (await db.sku.create({ data: { productId: productIds.get(sku.productKey), code: `C-${skuIds.size}`, variantName: 'Default', size: sku.size, sizeUnit: sku.unit, packCount: sku.pack, barcode: sku.barcode } })).id);
  }
  // Scale: distractor products in the corpus brands' block and in other brands. Same name shapes, different line words.
  const syllables = ['ka', 'lo', 'mi', 'ra', 'ze', 'tu', 'no', 'vi', 'sa', 'de', 'po', 'ri'];
  const fake = i => [0, 1, 2].map(n => syllables[(i >> (n * 3)) % syllables.length]).join('');
  const forms = ['Cleanser', 'Serum', 'Cream', 'Lotion', 'Shampoo', 'Conditioner', 'Toner', 'Mask', 'Gel', 'Oil'];
  const insertNoise = async (brandId, count, prefix) => {
    for (let offset = 0; offset < count; offset += 1000) {
      const batch = Array.from({ length: Math.min(1000, count - offset) }, (_, i) => offset + i);
      const products = batch.map(i => ({ name: `${fake(i)} ${fake(i * 7 + 3)} ${forms[i % forms.length]}`, slug: `${prefix}-${i}`, brandId }));
      await db.product.createMany({ data: products });
      const created = await db.product.findMany({ where: { slug: { in: products.map(p => p.slug) } }, select: { id: true, slug: true } });
      await db.sku.createMany({ data: created.map(p => ({ productId: p.id, code: p.slug, variantName: 'Default', size: [30, 50, 100, 200, 236, 400][Number(p.slug.split('-').pop()) % 6], sizeUnit: 'ml' })) });
    }
  };
  if (bigBrandProducts) await insertNoise(brandIds.get('CeraVe'), bigBrandProducts, 'big');
  if (noiseProducts) {
    const noiseBrands = [];
    for (let i = 0; i < 200; i++) noiseBrands.push((await db.brand.create({ data: { name: `Noise ${fake(i)} ${i}`, slug: `noise-${i}` } })).id);
    const each = Math.floor(noiseProducts / noiseBrands.length);
    for (const [i, id] of noiseBrands.entries()) await insertNoise(id, each, `n${i}`);
  }
  await db.$executeRawUnsafe('ANALYZE');
  const scale = { products: await db.product.count(), skus: await db.sku.count(), brands: await db.brand.count(), largestBrandProducts: bigBrandProducts + catalog.filter(s => s.brand === 'CeraVe').length };

  const supplierIds = { A: (await db.supplier.create({ data: { name: 'Bench A', slug: 'bench-a' } })).id, B: (await db.supplier.create({ data: { name: 'Bench B', slug: 'bench-b' } })).id };
  const sampled = focusBrand ? catalog.filter(sku => sku.brand === focusBrand) : catalog;
  const rows = seeds.flatMap(seed => buildRows(sampled, seed));
  await db.supplierSkuAlias.createMany({ data: rows.filter(r => r.alias).map(r => ({ supplierId: supplierIds[r.supplier], supplierSkuCode: r.code, skuId: skuIds.get(r.alias) })), skipDuplicates: true });

  // Policy ------------------------------------------------------------------------------------------------------------
  const policyDoc = { resolutionVersion: 2,
    brands: [...BRANDS.map(b => ({ id: b.name, name: b.name, aliases: [b.arabic], isActive: true, effect: 'ALLOW' })), { id: 'x', name: 'Excluded Brand', aliases: [], isActive: true, effect: 'DENY' }],
    categories: [{ id: 'root', name: 'Skin Care', parentId: null, isActive: true, effect: null }, { id: 'c', name: 'Cleansers', aliases: ['غسول الوجه'], parentId: 'root', isActive: true, effect: 'ALLOW' }, { id: 'p', name: 'Perfume', parentId: null, isActive: true, effect: 'DENY' }],
    mappings: [] };
  const policyRows = buildPolicyRows();
  const results = { provenance: 'SYNTHETIC corpus; rule-derived labels written by the implementer. Not production accuracy.', database, scale, label, seeds, versions: {} };

  for (const [version, impl] of Object.entries(versions)) {
    const policy = impl.compilePolicy({ id: 'bench', version: 1, document: policyDoc });
    const decisions = policyRows.map(row => ({ row, decision: policy.evaluate(supplierIds.A, row.brand, row.category), suggestions: policy.suggestBrands(row.brand) }));
    const unreviewed = decisions.filter(d => d.row.kind === 'unreviewed_spelling');
    const policySummary = {
      rows: decisions.length, correct: decisions.filter(d => d.decision.outcome === d.row.expected).length,
      allow: decisions.filter(d => d.decision.outcome === 'ALLOW').length, hold: decisions.filter(d => d.decision.outcome === 'HOLD').length, skip: decisions.filter(d => d.decision.outcome === 'SKIP').length,
      holdRatePct: pct(decisions.filter(d => d.decision.outcome === 'HOLD').length, decisions.length),
      falseSkips: decisions.filter(d => d.row.expected !== 'SKIP' && d.decision.outcome === 'SKIP').length,
      falseAllows: decisions.filter(d => d.row.expected !== 'ALLOW' && d.decision.outcome === 'ALLOW').length,
      falseHolds: decisions.filter(d => d.row.expected === 'ALLOW' && d.decision.outcome === 'HOLD').map(d => d.row.brand),
      misspellingAdmissions: unreviewed.filter(d => d.decision.outcome === 'ALLOW').length,
      misspellings: unreviewed.length,
      suggestionRecallAt3: unreviewed.filter(d => d.suggestions.some(s => s.brandId === d.row.brandName)).length,
      suggestionMisses: unreviewed.filter(d => !d.suggestions.some(s => s.brandId === d.row.brandName)).map(d => d.row.brand),
    };

    // Classification, row by row ------------------------------------------------------------------------------------
    const normalizer = new impl.Normalizer();
    const brandService = new BrandService(db);
    const catalogService = new CatalogService(db, undefined);
    const service = new impl.Identity(db, catalogService, brandService, normalizer);
    const toInput = row => {
      const { size, unit, packCount } = normalizer.extractSizeAndPack(row.name);
      const barcode = normalizer.normalizeBarcode(row.barcode);
      return { eligibilityApproved: true, brandId: brandIds.get(row.brand), supplierId: supplierIds[row.supplier], supplierSkuCode: row.code, name: row.name, brand: row.brand,
        barcode: row.barcode ? (barcode.isValid ? barcode.barcode : row.barcode) : null, size, sizeUnit: unit, packageCount: packCount };
    };
    const measured = [];
    for (let pass = 0; pass < 2; pass++) for (const row of rows) {
      const before = sql;
      const start = performance.now();
      const result = await service.classifyCandidateMatch(toInput(row));
      const ms = performance.now() - start;
      if (pass === 1) measured.push({ row, result, ms, queries: sql - before });
    }

    // Batched, as the matching loop runs it -------------------------------------------------------------------------
    let batched = null;
    if (service.prepareBatch) {
      const before = sql;
      const start = performance.now();
      let matches = 0;
      for (let offset = 0; offset < rows.length; offset += 200) {
        const chunk = rows.slice(offset, offset + 200);
        const bySupplier = { A: chunk.filter(r => r.supplier === 'A'), B: chunk.filter(r => r.supplier === 'B') };
        for (const group of Object.values(bySupplier)) {
          if (!group.length) continue;
          const inputs = group.map(toInput);
          const batch = await service.prepareBatch(inputs);
          for (const input of inputs) { const result = await service.classifyCandidateMatch(input, batch); if (result.matchedSkuId) matches++; }
        }
      }
      batched = { rows: rows.length, totalMs: round(performance.now() - start, 1), msPerRow: round((performance.now() - start) / rows.length), sqlPerRow: round((sql - before) / rows.length), autoLinks: matches };
    }

    const idToKey = new Map([...skuIds].map(([key, id]) => [id, key]));
    // Second import: what one reviewer decision saves. The reviewer confirms the true SKU, the same row returns under the same code.
    const replayable = measured.filter(({ row, result }) => row.knownSku && !result.matchedSkuId);
    const jobs = {};
    for (const supplier of ['A', 'B']) jobs[supplier] = (await db.ingestionJob.create({ data: { supplierId: supplierIds[supplier], status: 'approved' } })).id;
    let confirmable = 0; let replayAuto = 0;
    for (const { row } of replayable) {
      const code = `R-${version}-${row.code}`;
      const input = { ...toInput(row), supplierSkuCode: code };
      const skuId = skuIds.get(row.knownSku);
      try { await service.assertSkuAssociation(input, skuId, db, true); } catch { continue; }
      confirmable++;
      await db.supplierSkuAlias.create({ data: { supplierId: supplierIds[row.supplier], supplierSkuCode: code, skuId } });
      if (service.wordingKeyFor) await db.ingestionItem.create({ data: { jobId: jobs[row.supplier], supplierSkuCode: code, name: row.name, brand: row.brand, price: 1, currency: 'EGP', status: 'approved', matchedSkuId: skuId,
        enrichment: { identityReview: { decision: 'EXISTING_SKU', skuId, reviewedBy: 'benchmark', reviewedAt: new Date().toISOString(), wordingKey: service.wordingKeyFor(input) } } } });
      const again = await service.classifyCandidateMatch(input);
      if (again.matchedSkuId === skuId) replayAuto++;
    }
    const replay = { unresolvedKnownRows: replayable.length, reviewerConfirmable: confirmable, secondImportAutoLinked: replayAuto };
    const listed = result => [...new Set([result.matchedSkuId, result.suggestedSkuId, result.canonicalSku?.id, ...(result.candidates ?? []).map(c => c.skuId)].filter(Boolean))].map(id => idToKey.get(id));
    const routeOf = result => result.route ?? (result.classification === 'EXACT_MATCH' ? 'VERIFIED' : result.classification === 'CONFLICT' ? 'CONFLICT' : result.classification === 'LIKELY_MATCH' ? 'AMBIGUOUS' :
      result.classification === 'NO_MATCH' ? (result.existingCandidateId || result.possibleDuplicateCandidateIds?.length ? 'AMBIGUOUS' : 'NEW') : 'INVALID');
    const scored = measured.map(({ row, result, ms, queries }) => {
      const auto = result.matchedSkuId ? idToKey.get(result.matchedSkuId) : null;
      const list = listed(result);
      return { id: row.id, kind: row.kind, brand: row.brand, name: row.name, supplier: row.supplier, code: row.code, alias: row.alias ?? null, barcode: row.barcode ?? null, knownSku: row.knownSku, autoSku: row.autoSku, allowed: row.allowed,
        classification: result.classification, route: routeOf(result) === 'INVALID' || result.classification === 'INVALID' ? 'INVALID' : routeOf(result), reason: result.reason, conflicts: result.conflicts, auto, list, rank: row.knownSku ? list.indexOf(row.knownSku) + 1 : null, ms: round(ms), queries };
    });
    const known = scored.filter(r => r.knownSku);
    const autoEligible = scored.filter(r => r.autoSku);
    const autos = scored.filter(r => r.auto);
    const falseAutos = autos.filter(r => r.auto !== r.autoSku);
    const newRows = scored.filter(r => r.allowed.includes('NEW'));
    const byKind = {};
    for (const row of scored) {
      const entry = byKind[row.kind] ??= { rows: 0, routeOk: 0, autoCorrect: 0, falseAuto: 0, top1: 0, top5: 0, known: 0 };
      entry.rows++;
      if (row.allowed.includes(row.route)) entry.routeOk++;
      if (row.auto && row.auto === row.autoSku) entry.autoCorrect++;
      if (row.auto && row.auto !== row.autoSku) entry.falseAuto++;
      if (row.knownSku) { entry.known++; if (row.rank === 1) entry.top1++; if (row.rank >= 1 && row.rank <= 5) entry.top5++; }
    }
    const routes = {};
    for (const row of scored) routes[row.route] = (routes[row.route] ?? 0) + 1;
    const provablyNew = scored.filter(r => r.classification === 'NO_MATCH' && r.reason === 'no_canonical_match_found' && !r.conflicts.includes('missing_net_content'));
    results.versions[version] = {
      policy: policySummary,
      rows: scored.length, unique: new Set(scored.map(r => r.name)).size, routes, byKind,
      autoLinks: autos.length, correctAutoLinks: autos.length - falseAutos.length, falseAutoLinks: falseAutos.length,
      autoLinkPrecisionPct: pct(autos.length - falseAutos.length, autos.length),
      autoLinkRecallPct: pct(autoEligible.filter(r => r.auto === r.autoSku).length, autoEligible.length),
      recallAt1Pct: pct(known.filter(r => r.rank === 1).length, known.length), recallAt5Pct: pct(known.filter(r => r.rank >= 1 && r.rank <= 5).length, known.length), knownRows: known.length,
      routeAccuracyPct: pct(scored.filter(r => r.allowed.includes(r.route)).length, scored.length),
      manualReviewPct: pct(scored.filter(r => r.route === 'AMBIGUOUS' || r.route === 'CONFLICT').length, scored.length),
      falseNewPct: pct(known.filter(r => r.route === 'NEW').length, known.length), knownRoutedNew: known.filter(r => r.route === 'NEW').length,
      newRowsCorrect: newRows.filter(r => r.route === 'NEW').length, newRows: newRows.length,
      aiResearchCalls: provablyNew.length, aiResearchCallsOnKnownSkus: provablyNew.filter(r => r.knownSku).length, identityLlmCalls: 0,
      largestBrandBlock: (() => {
        const block = scored.filter(r => r.brand === 'CeraVe' && !r.alias && !r.barcode);
        return { rows: block.length, p50ms: round(quantile(block.map(r => r.ms), 0.5)), p95ms: round(quantile(block.map(r => r.ms), 0.95)), meanSql: block.length ? round(block.reduce((n, r) => n + r.queries, 0) / block.length) : null };
      })(),
      perRow: { p50ms: round(quantile(scored.map(r => r.ms), 0.5)), p95ms: round(quantile(scored.map(r => r.ms), 0.95)), meanSql: round(scored.reduce((n, r) => n + r.queries, 0) / scored.length), minSql: Math.min(...scored.map(r => r.queries)), maxSql: Math.max(...scored.map(r => r.queries)) },
      batched, replay,
      falseAutoExamples: falseAutos.slice(0, 40).map(r => ({ id: r.id, kind: r.kind, name: r.name, auto: r.auto, reason: r.reason })),
    };
    fs.writeFileSync(path.join(outDir, `${label}-${version}-rows.json`), JSON.stringify(scored, null, 1));
  }
  if (compareRetrieval) results.retrieval = await compareRetrievalVariants();
  fs.writeFileSync(path.join(outDir, `${label}-summary.json`), JSON.stringify(results, null, 2));
  // Raw candidate recall per retrieval strategy, before ranking: is pg_trgm worth using? ---------------------------------
  async function compareRetrievalVariants() {
    const K = 20;
    const normalizer = new versions.after.Normalizer();
    const known = rows.filter(row => row.knownSku && !row.alias && !row.barcode);
    const score = query => Prisma.sql`public.similarity(catalog.search_normalize(p.name), ${normalizeSearchText(query)})`;
    const skuProbe = Prisma.sql`CROSS JOIN LATERAL (SELECT s.id FROM catalog.skus s WHERE s.product_id = p.id OFFSET 0) s`;
    const packagingProbe = (size, unit) => Prisma.sql`CROSS JOIN LATERAL (SELECT s.id FROM catalog.skus s WHERE s.product_id = p.id AND s.size = ${size} AND lower(s.size_unit) = lower(${unit}) OFFSET 0) s`;
    const shipped = new CatalogService(db, undefined);
    const strategies = {
      // What the matcher did before: every product and SKU of the brand comes back to the application.
      full_brand_load: async ({ brand }) => db.$queryRaw(Prisma.sql`SELECT s.id AS "skuId", p.name FROM catalog.products p ${skuProbe} WHERE p.brand_id = ${brand}::uuid`),
      // No text ordering at all: the packaging block, then arbitrary stable products of the brand.
      attribute_block_only: async ({ brand, size, unit }) => db.$queryRaw(Prisma.sql`
        ${size === null ? Prisma.empty : Prisma.sql`(SELECT s.id AS "skuId" FROM catalog.products p ${packagingProbe(size, unit)} WHERE p.brand_id = ${brand}::uuid ORDER BY p.id, s.id LIMIT ${K}) UNION ALL`}
        (SELECT s.id AS "skuId" FROM (SELECT p.id FROM catalog.products p WHERE p.brand_id = ${brand}::uuid ORDER BY p.id LIMIT ${K}) p ${skuProbe})`),
      // Shipped: the service method, both blocks ordered by trigram similarity inside the brand. No new index or extension.
      trigram_order_in_brand: async ({ brand, query, size, unit }) => (await shipped.findSkuIdentityCandidates([{ key: 'k', brandId: brand, query, size, sizeUnit: unit }], K)).get('k') ?? [],
      // The % operator at a low threshold, without the packaging block. SET LOCAL costs two more round trips per statement.
      trigram_threshold_operator: async ({ brand, query }) => db.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SET LOCAL pg_trgm.similarity_threshold = 0.1`);
        return tx.$queryRaw(Prisma.sql`SELECT s.id AS "skuId" FROM (SELECT p.id FROM catalog.products p WHERE p.brand_id = ${brand}::uuid AND catalog.search_normalize(p.name) OPERATOR(public.%) ${normalizeSearchText(query)} ORDER BY ${score(query)} DESC, p.id LIMIT ${K}) p ${skuProbe}`);
      }),
    };
    const report = {};
    for (const [name, run] of Object.entries(strategies)) {
      const timings = []; const largest = []; let hits = 0; let returned = 0;
      for (let pass = 0; pass < 2; pass++) for (const row of known) {
        const extracted = normalizer.extractSizeAndPack(row.name);
        const request = { brand: brandIds.get(row.brand), query: retrievalQuery(extracted.cleanTitle, [row.brand]), size: extracted.size, unit: extracted.unit };
        const start = performance.now();
        const found = await run(request);
        const ms = performance.now() - start;
        if (pass === 1) { timings.push(ms); if (row.brand === 'CeraVe') largest.push(ms); returned += found.length; if (found.some(c => c.skuId === skuIds.get(row.knownSku))) hits++; }
      }
      report[name] = { rows: known.length, recallPct: pct(hits, known.length), meanRowsReturned: round(returned / known.length, 1), p50ms: round(quantile(timings, 0.5)), p95ms: round(quantile(timings, 0.95)), largestBrandRows: largest.length, largestBrandP50ms: round(quantile(largest, 0.5)), largestBrandP95ms: round(quantile(largest, 0.95)) };
    }
    return report;
  }

  const brief = v => ({ rows: v.rows, autos: v.autoLinks, falseAuto: v.falseAutoLinks, precision: v.autoLinkPrecisionPct, autoRecall: v.autoLinkRecallPct, r1: v.recallAt1Pct, r5: v.recallAt5Pct, routeAcc: v.routeAccuracyPct, review: v.manualReviewPct, falseNew: v.falseNewPct, newOk: `${v.newRowsCorrect}/${v.newRows}`, ai: v.aiResearchCalls, aiKnown: v.aiResearchCallsOnKnownSkus, ...v.perRow, largestBrandBlock: v.largestBrandBlock, batched: v.batched, replay: v.replay, policy: { ok: v.policy.correct, n: v.policy.rows, hold: v.policy.holdRatePct, fSkip: v.policy.falseSkips, fAllow: v.policy.falseAllows, sugg: `${v.policy.suggestionRecallAt3}/${v.policy.misspellings}` } });
  if (results.retrieval) console.log(JSON.stringify(results.retrieval, null, 1));
  console.log(JSON.stringify({ label, scale, ...Object.fromEntries(Object.entries(results.versions).map(([k, v]) => [k, brief(v)])) }, null, 1));
  await db.$disconnect();
})().catch(error => { console.error(error); process.exit(1); });
