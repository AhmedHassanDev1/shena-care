// Drives the real 10-product journey over HTTP against the isolated local API (port 3063, localhost *_test database). Live product pages; no provider credits.
const fs = require('node:fs');
const path = require('node:path');
const API = 'http://localhost:3063';
const token = fs.readFileSync(path.join(__dirname, '.session'), 'utf8').trim();
const auth = { Authorization: `Bearer ${token}` };

async function call(method, url, body, isForm = false) {
  const res = await fetch(`${API}${url}`, { method, headers: { ...auth, ...(isForm || !body ? {} : { 'content-type': 'application/json' }) }, body: isForm ? body : body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${text.slice(0, 400)}`);
  return json;
}
async function upload(file, name) {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(file)], { type: 'text/csv' }), name);
  return call('POST', '/admin/catalog-imports', form, true);
}
const rowsOf = async jobId => (await call('GET', `/admin/catalog-imports/${jobId}/rows?limit=500`)).rows
  .map(r => ({ row: r.rowNumber, name: r.name, brand: r.brand, decision: r.decision, reason: r.reasonCode, skuId: r.matchedSkuId, stage: r.stage, attempts: r.attempts, lastError: r.lastError }));

(async () => {
  const step = process.argv[2] ?? 'first';
  const out = {};
  if (step === 'first') {
    const t0 = Date.now();
    const first = await upload(path.join(__dirname, '../policy-v14-corrected.csv'), 'policy-v14-corrected.csv');
    out.upload = { jobId: first.jobId, reused: first.reused, totalRows: first.totalRows };
    out.autopilot = (await call('POST', `/catalog/workbench/imports/${first.jobId}/autopilot`)).totals;
    out.seconds = Math.round((Date.now() - t0) / 1000);
    out.rows = await rowsOf(first.jobId);
    fs.writeFileSync(path.join(__dirname, '.first-job'), first.jobId);
  } else if (step === 'retry') {
    const jobId = fs.readFileSync(path.join(__dirname, '.first-job'), 'utf8').trim();
    out.autopilot = (await call('POST', `/catalog/workbench/imports/${jobId}/autopilot`)).totals;
    out.rows = await rowsOf(jobId);
  } else if (step === 'reimport') {
    const jobId = fs.readFileSync(path.join(__dirname, '.first-job'), 'utf8').trim();
    const same = await upload(path.join(__dirname, '../policy-v14-corrected.csv'), 'policy-v14-corrected.csv');
    out.sameFile = { jobId: same.jobId, reusedSameJob: same.jobId === jobId, reused: same.reused };
    const again = await upload(path.join(__dirname, 'reimport.csv'), 'reimport.csv');
    out.reimport = (await call('POST', `/catalog/workbench/imports/${again.jobId}/autopilot`)).totals;
    out.reimportRows = await rowsOf(again.jobId);
    const negative = await upload(path.join(__dirname, '../negative-gates.csv'), 'negative-gates.csv');
    out.negative = (await call('POST', `/catalog/workbench/imports/${negative.jobId}/autopilot`)).totals;
    out.negativeRows = await rowsOf(negative.jobId);
  } else if (step === 'exceptions') {
    out.exceptions = (await call('GET', '/catalog/workbench/exceptions')).items.map(e => ({ id: e.id, reason: e.reasonCode, severity: e.severity, field: e.field, row: e.evidence?.row?.name, summary: e.summary, recommended: e.recommended }));
    out.summary = await call('GET', '/catalog/workbench/autopilot/summary');
  } else if (step === 'readiness') {
    const jobId = fs.readFileSync(path.join(__dirname, '.first-job'), 'utf8').trim();
    out.readiness = [];
    for (const r of await rowsOf(jobId)) if (r.skuId) {
      const rd = await call('GET', `/catalog/workbench/skus/${r.skuId}/readiness`);
      out.readiness.push({ name: r.name, identity: rd.identity, blockers: rd.blockers, warnings: rd.warnings, media: rd.media, facts: { applied: rd.facts.applied.length, pending: rd.facts.pending, conflicts: rd.facts.conflicts } });
    }
  }
  const file = path.join(__dirname, `result-${step}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 1).slice(0, 6000));
})().catch(error => { console.error(error.message); process.exit(1); });
