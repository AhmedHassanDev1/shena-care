const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const datasetDirectory = path.resolve(process.argv[2] ?? path.join(__dirname, 'data/catalog-evaluation-20261115'));
const archiveDirectory = path.resolve(process.argv[3] ?? 'output/catalog-evaluation-discovery/sources');
const output = path.resolve(process.argv[4] ?? path.join(datasetDirectory, 'source-binding-audit.json'));
const dataset = JSON.parse(fs.readFileSync(path.join(datasetDirectory, 'dataset.json'), 'utf8'));
const decode = value => value.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
const text = value => decode(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const fold = value => text(value).normalize('NFKC').toLowerCase();
const normalizeUrl = (url, base) => { const parsed = new URL(url, base); return parsed.origin + parsed.pathname.replace(/\/$/, ''); };
const rows = dataset.rows.map(row => {
  if (!/^[a-f0-9]{64}$/.test(row.source.contentHash)) throw new Error('Invalid archive hash');
  const bytes = fs.readFileSync(path.join(archiveDirectory, row.source.contentHash + '.html'));
  const hashMatches = crypto.createHash('sha256').update(bytes).digest('hex') === row.source.contentHash;
  const html = bytes.toString('utf8');
  const h1 = text(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '');
  const nodes = [];
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if ([node['@type']].flat().some(type => ['Product', 'ProductGroup'].includes(type))) nodes.push(node);
    if (node['@graph']) walk(node['@graph']);
  }
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(match[1])); } catch { /* invalid metadata is not proof */ }
  }
  const native = nodes.find(node => typeof node.name === 'string' && fold(node.name) === fold(row.expected.name));
  const h1Matches = fold(h1) === fold(row.expected.name);
  const urls = native ? [native.url, native['@id'], ...[native.offers].flat().map(offer => offer?.url)].filter(value => typeof value === 'string') : [];
  const nativeUrlBound = urls.some(url => { try { return normalizeUrl(url, row.source.url) === normalizeUrl(row.source.url); } catch { return false; } });
  return { id: row.id, url: row.source.url, contentHash: row.source.contentHash, hashMatches, h1, h1Matches, nativeProductName: native?.name ?? null,
    nativeProductBrand: typeof native?.brand === 'string' ? native.brand : native?.brand?.name ?? null, nativeUrlBound,
    sourceBound: hashMatches && !!native && (h1Matches || nativeUrlBound) };
});
const report = { schema: 1, seed: dataset.seed, rows: rows.length, sourceBound: rows.filter(row => row.sourceBound).length,
  boundary: 'Recorded manufacturer HTML, hash integrity and primary page/Product metadata binding. Not a GTIN, medical-claim or formulation approval.', products: rows };
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ rows: report.rows, sourceBound: report.sourceBound, unresolved: rows.filter(row => !row.sourceBound).map(row => row.id) }));
if (report.sourceBound !== report.rows) process.exitCode = 1;
