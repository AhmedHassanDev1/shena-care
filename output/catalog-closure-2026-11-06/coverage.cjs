// Field coverage for the verified SKUs, read through the Admin profile API (localhost scratch API only). Writes coverage.json + coverage.md.
const fs = require('node:fs');
const path = require('node:path');
const API = 'http://localhost:3073';
const token = fs.readFileSync(path.join(__dirname, '.session'), 'utf8').trim();
const get = async url => { const r = await fetch(API + url, { headers: { Authorization: `Bearer ${token}` } }); if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json(); };
const S = { VERIFIED: 'V', UNKNOWN: 'U', CONFLICT: 'C', UNVERIFIED: 'u', RULE_DERIVED: 'R' };

(async () => {
  const first = JSON.parse(fs.readFileSync(path.join(__dirname, 'result-final-original10.json'), 'utf8'));
  const ids = first.rows.map(r => r.skuId).filter(Boolean);
  const out = [];
  for (const id of ids) {
    const p = await get(`/catalog/workbench/skus/${id}/profile`);
    const f = Object.fromEntries(Object.values(p.coverage).flat().map(x => [x.field, x]));
    const r = p.routine ?? {};
    out.push({ skuId: id, name: `${p.identity.brand.name} ${p.identity.product} ${p.identity.size}${p.identity.sizeUnit}`, identity: p.identity.identityStatus, barcode: p.identity.barcode.status,
      category: p.classification.category?.name, type: p.classification.productType, subtype: p.classification.productSubtype,
      fields: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, { status: v.status, reason: v.reason, sources: v.evidence.map(e => e.url) }])),
      routine: { role: r.primaryRole, roleStatus: r.primaryRoleStatus, step: r.stepOrder, rinse: `${r.rinseMode}/${r.rinseModeStatus}`, period: `${r.routinePeriod}/${r.routinePeriodStatus}`, cadence: `${r.cadenceUnit}/${r.cadenceStatus}`,
        contact: r.contactMinutes, actives: (r.activeIngredients ?? []).map(a => `${a.family}:${a.concentrationStatus}`), featured: (r.featuredIngredients ?? []).map(a => `${a.concept}:${a.status}`), conflicts: r.conflicts ?? [] },
      media: p.media.filter(m => !m.parent).map(m => `${m.role}:${m.review}${m.width ? ` ${m.width}x${m.height}` : ''}`).concat(p.media.filter(m => m.parent).map(m => `EDITORIAL:${m.review}${m.note ? ` (${m.note})` : ''}`)),
      blockers: p.publication.blockers, openExceptions: p.openExceptions.map(e => e.reasonCode), summary: p.summary });
  }
  fs.writeFileSync(path.join(__dirname, 'coverage.json'), JSON.stringify(out, null, 2));
  const cols = ['identity.size', 'identity.gtin', 'composition.inci', 'composition.activeConcentrations', 'composition.fragrance', 'attributes.texture', 'usage.instructions', 'usage.routinePeriod', 'usage.targetArea', 'suitability.skinTypes', 'suitability.hairTypes', 'safety.warnings', 'marketing.description'];
  const short = { 'identity.size': 'size', 'identity.gtin': 'GTIN', 'composition.inci': 'INCI', 'composition.activeConcentrations': 'conc.', 'composition.fragrance': 'fragr.', 'attributes.texture': 'texture', 'usage.instructions': 'usage', 'usage.routinePeriod': 'AM/PM', 'usage.targetArea': 'area', 'suitability.skinTypes': 'skin', 'suitability.hairTypes': 'hair', 'safety.warnings': 'warn.', 'marketing.description': 'descr.' };
  let md = `| SKU | identity | type | ${cols.map(c => short[c]).join(' | ')} | role (R) | rinse | period | cadence | conflicts |\n|${'---|'.repeat(cols.length + 8)}\n`;
  for (const o of out) md += `| ${o.name} | ${o.identity} | ${o.type}${o.subtype ? `/${o.subtype}` : ''} | ${cols.map(c => S[o.fields[c]?.status] ?? '?').join(' | ')} | ${o.routine.role} #${o.routine.step} | ${o.routine.rinse} | ${o.routine.period} | ${o.routine.cadence} | ${o.routine.conflicts.length} |\n`;
  md += '\nV = VERIFIED, u = read but not verified (retailer-only / not applied), U = UNKNOWN (no source stated it), C = CONFLICT, R = RULE_DERIVED.\n';
  fs.writeFileSync(path.join(__dirname, 'coverage.md'), md);
  console.log(md);
  for (const o of out) console.log(o.name, '| media:', o.media.join(', '), '| blockers:', o.blockers.join(','), '| reasons UNKNOWN:', [...new Set(Object.values(o.fields).filter(f => f.status === 'UNKNOWN').map(f => f.reason))].join(','));
})().catch(e => { console.error(e.message); process.exit(1); });
