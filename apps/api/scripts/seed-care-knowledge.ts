/**
 * Seeds the care knowledge base (care.knowledge_entries) and the extra launch concerns. Idempotent: upserts by key.
 * A row a professional has already reviewed or rejected is left exactly as it is.
 *
 *   npm run seed:knowledge                 write the statements
 *   npm run seed:knowledge -- --verify     first re-fetch every source and require its key terms; a source that no longer
 *                                          resolves or no longer says it is reported and its statements are NOT written
 *
 * Refuses NODE_ENV=production.
 */
import { PrismaClient } from '@prisma/client';
import { EXTRA_CONCERNS, KNOWLEDGE, RETRIEVED_AT, SOURCES, SourceKey } from '../src/modules/guidance/knowledge/knowledge-seed.data';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function verifySources(): Promise<Set<SourceKey>> {
  const failed = new Set<SourceKey>();
  for (const [key, source] of Object.entries(SOURCES) as Array<[SourceKey, (typeof SOURCES)[SourceKey]]>) {
    if (!source.url) continue;
    try {
      const response = await fetch(source.url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = (await response.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
        .replace(/[‐‑–]/g, '-').replace(/\s+/g, ' ').toLowerCase();
      const missing = source.mustMention.filter(term => !text.includes(term.toLowerCase()));
      if (missing.length) throw new Error(`page no longer mentions: ${missing.join(', ')}`);
      console.log(`ok       ${key}`);
    } catch (error) {
      failed.add(key);
      console.log(`FAILED   ${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return failed;
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed care knowledge with NODE_ENV=production');
  const failed = process.argv.includes('--verify') ? await verifySources() : new Set<SourceKey>();
  const prisma = new PrismaClient();
  try {
    for (const concern of EXTRA_CONCERNS) {
      await prisma.concern.upsert({ where: { slug: concern.slug }, update: { name: concern.name, careArea: concern.careArea },
        create: { slug: concern.slug, name: concern.name, careArea: concern.careArea } });
    }
    let written = 0, kept = 0, skipped = 0;
    for (const entry of KNOWLEDGE) {
      if (failed.has(entry.source)) { skipped++; continue; }
      const source = SOURCES[entry.source];
      const existing = await prisma.knowledgeEntry.findUnique({ where: { key: entry.key }, select: { reviewStatus: true } });
      // A human decision outranks the seed.
      if (existing && (existing.reviewStatus === 'PROFESSIONALLY_REVIEWED' || existing.reviewStatus === 'REJECTED')) { kept++; continue; }
      const data = {
        subjectType: entry.subjectType, subjectKey: entry.subjectKey, topic: entry.topic, concernSlug: entry.concernSlug ?? null,
        careArea: entry.careArea ?? null, strength: entry.strength ?? null, statementEn: entry.en, statementAr: entry.ar,
        evidenceClass: entry.evidenceClass ?? 'EVIDENCE_SUPPORTED', sourceTitle: source.title, sourceUrl: source.url, sourceType: source.type,
        retrievedAt: new Date(RETRIEVED_AT), reviewStatus: entry.autoAccept ? 'AUTO_ACCEPTED' : 'PENDING_PROFESSIONAL_REVIEW',
        confidence: entry.confidence ?? 0.75, isActive: true,
      };
      await prisma.knowledgeEntry.upsert({ where: { key: entry.key }, update: data, create: { key: entry.key, ...data } });
      written++;
    }
    console.log(`care knowledge: ${written} statements written, ${kept} kept (already reviewed), ${skipped} skipped (source failed), ${EXTRA_CONCERNS.length} extra concerns`);
    if (failed.size) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
