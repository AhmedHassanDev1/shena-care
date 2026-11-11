const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../../apps/api/.env'), quiet: true });
const { PrismaClient } = require('@prisma/client');
const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
async function main() {
  const prisma = new PrismaClient();
  try {
    const phases = {};
    for (const [phase, name] of [['before', 'dev-apply-results.jsonl'], ['after', 'enrichment-apply-results.jsonl']]) {
      const input = read(name);
      const rows = [];
      for (const item of input) {
        const run = await prisma.productResearchRun.findUniqueOrThrow({ where: { id: item.runId },
          select: { startedAt: true, completedAt: true, status: true, sources: true, providerStatuses: true } });
        const sources = run.sources || [];
        rows.push({ id: item.id, status: run.status, durationMs: run.completedAt ? run.completedAt.getTime() - run.startedAt.getTime() : null,
          directReads: sources.filter(source => source.origin === 'ADMIN').length,
          providerDiscovered: sources.filter(source => source.origin === 'PROVIDER').length,
          pageReads: sources.filter(source => source.outcome === 'OK').length,
          failedReads: sources.filter(source => ['RATE_LIMITED', 'CIRCUIT_OPEN', 'TIMEOUT', 'HTTP_5xx'].includes(source.outcome)).length,
          applied: item.applied });
      }
      phases[phase] = { count: rows.length, totalDurationMs: rows.reduce((sum, row) => sum + (row.durationMs || 0), 0),
        directReads: rows.reduce((sum, row) => sum + row.directReads, 0),
        providerDiscovered: rows.reduce((sum, row) => sum + row.providerDiscovered, 0),
        pageReads: rows.reduce((sum, row) => sum + row.pageReads, 0),
        failedReads: rows.reduce((sum, row) => sum + row.failedReads, 0), rows };
    }
    fs.writeFileSync(path.join(__dirname, 'enrichment-run-metrics.json'), JSON.stringify({ at: new Date().toISOString(), phases }, null, 2));
    console.log(JSON.stringify(Object.fromEntries(Object.entries(phases).map(([phase, data]) => [phase, {
      count: data.count, totalDurationMs: data.totalDurationMs, directReads: data.directReads,
      providerDiscovered: data.providerDiscovered, pageReads: data.pageReads, failedReads: data.failedReads,
    }]))));
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
