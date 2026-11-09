// Drives the isolated local API over HTTP (localhost only, *_test database). Usage: node run.cjs <step> [label]
// Steps: original10 | test15 | file <csv> | exceptions | coverage | counts
const fs = require('node:fs');
const path = require('node:path');
const API = process.env.API ?? 'http://localhost:3073';
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(API)) throw new Error('Refusing: local API only');
const token = fs.readFileSync(path.join(__dirname, '.session'), 'utf8').trim();
const auth = { Authorization: `Bearer ${token}` };

async function call(method, url, body, isForm = false) {
  const res = await fetch(`${API}${url}`, { method, headers: { ...auth, ...(isForm || !body ? {} : { 'content-type': 'application/json' }) }, body: isForm ? body : body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${text.slice(0, 400)}`);
  return json;
}
async function upload(file) {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(file)], { type: 'text/csv' }), path.basename(file));
  return call('POST', '/admin/catalog-imports', form, true);
}
const rowsOf = async jobId => (await call('GET', `/admin/catalog-imports/${jobId}/rows?limit=500`)).rows
  .map(r => ({ row: r.rowNumber, name: r.name, brand: r.brand, size: r.size && `${r.size}${r.sizeUnit}`, outcome: r.outcome, decision: r.decision, reason: r.reasonCode,
    category: r.identity?.category ?? null, policy: r.identity?.policy?.reason ?? null, skuId: r.matchedSkuId, stage: r.stage }));

async function runFile(file) {
  const t0 = Date.now();
  const job = await upload(file);
  const autopilot = (await call('POST', `/catalog/workbench/imports/${job.jobId}/autopilot`)).totals;
  return { jobId: job.jobId, reused: job.reused, seconds: Math.round((Date.now() - t0) / 1000), totals: autopilot, rows: await rowsOf(job.jobId) };
}

(async () => {
  const [step, arg, label] = process.argv.slice(2);
  let out;
  if (step === 'original10') out = await runFile(path.join(__dirname, 'original-10.csv'));
  else if (step === 'test15') out = await runFile(path.join(__dirname, 'test-15.csv'));
  else if (step === 'file') out = await runFile(path.resolve(arg));
  else if (step === 'exceptions') out = (await call('GET', '/catalog/workbench/exceptions')).items.map(e => ({ reason: e.reasonCode, severity: e.severity, field: e.field, row: e.evidence?.row?.name, summary: e.summary, recommended: e.recommended?.label }));
  else if (step === 'detail') out = await call('GET', `/catalog/workbench/skus/${arg}/profile`);
  else throw new Error(`unknown step ${step}`);
  const name = `result-${label ?? arg ?? step}.json`.replace(/[^\w.-]+/g, '_');
  fs.writeFileSync(path.join(__dirname, name), JSON.stringify(out, null, 2));
  if (out.rows) {
    console.log(JSON.stringify(out.totals));
    for (const r of out.rows) console.log([r.row, r.name, r.brand, r.size, r.outcome, r.decision, r.reason, r.category ?? ''].join(' | '));
  } else console.log(JSON.stringify(out, null, 1).slice(0, 8000));
})().catch(error => { console.error(error.message); process.exit(1); });
