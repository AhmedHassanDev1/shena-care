/* eslint-disable @typescript-eslint/no-explicit-any -- operator script; results are written as JSON */
/**
 * Catalog Intake real-product run against a LOCAL scratch database only (refuses anything that is not localhost). Real web research, real product names,
 * realistic Arabic supplier files. Phases:
 *
 *   npx ts-node --transpile-only scripts/intake-real-run.ts setup | admin | supplier <file> [tag] | market | verify
 *
 * Background workers are switched off; this script drives the work itself so cost and timing are measured per phase.
 */
process.env.NODE_ENV = 'test';
process.env.INTAKE_WORKER = 'off';
process.env.DOMAIN_EVENTS_POLL_MS = '0';
process.env.PROCUREMENT_BATCH_INTERVAL_MINUTES = '0';
process.env.DECISION_SWEEP_MS = '0';
process.env.RFQ_TICK_MS = '0';
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
require('dotenv').config({ path: `${__dirname}/../.env` }); // never overrides what is already set

if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '') || process.env.DATABASE_URL !== process.env.DIRECT_URL) {
  throw new Error('Refusing to run: DATABASE_URL and DIRECT_URL must both point at the local scratch database');
}

import { NestFactory } from '@nestjs/core';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/platform/database/prisma.service';
import { AdminIntakeService } from '../src/application/composition/services/intake/admin-intake.service';
import { SupplierIntakeService } from '../src/application/composition/services/intake/supplier-intake.service';
import { IntakeRunnerService } from '../src/application/composition/services/intake/intake-runner.service';
import { MarketPriceResearchService } from '../src/application/composition/services/intake/market-price-research.service';
import { CatalogEnrichmentService } from '../src/application/composition/services/intake/catalog-enrichment.service';
import { CatalogIntakeService, CatalogService, ProductResearchService, ResearchSourceFetcher } from '../src/modules/catalog/public';
import { CatalogPublicationService } from '../src/application/composition/services/catalog-publication.service';
import { CatalogProfileService } from '../src/application/composition/services/catalog-profile.service';
import { ProductDetailService } from '../src/application/composition/services/product-detail.service';
import { DiscoveryService } from '../src/application/composition/services/discovery.service';
import { RecommendationValidatorService } from '../src/modules/guidance/services/recommendation-validator.service';

const OUT = join(__dirname, '..', '..', '..', 'output', 'intake-real-run-2026-11-09');
const ADMIN_ID = '9a1b0c4e-1111-4c4e-9a1b-0c4e11110001';
const SUPPLIER_ID = '9a1b0c4e-2222-4c4e-9a1b-0c4e22220002';
const SUPPLIER_USER = '9a1b0c4e-3333-4c4e-9a1b-0c4e33330003';
const save = (name: string, value: unknown) => { mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, name), JSON.stringify(value, null, 2)); };

/** Real products sold in Egypt, typed as an Admin would. The last three are deliberate traps: an invented product, an Arabic-only name, a respelled duplicate. */
export const ADMIN_NAMES = [
  'CeraVe Hydrating Facial Cleanser 236ml',
  'CeraVe Foaming Facial Cleanser 236ml',
  'CeraVe Moisturizing Cream 454g',
  'CeraVe SA Smoothing Cleanser 236ml',
  'The Ordinary Niacinamide 10% + Zinc 1% 30ml',
  'The Ordinary Hyaluronic Acid 2% + B5 30ml',
  'La Roche-Posay Effaclar Purifying Foaming Gel 200ml',
  'La Roche-Posay Cicaplast Baume B5+ 40ml',
  'Cetaphil Gentle Skin Cleanser 236ml',
  'Bioderma Sensibio H2O 250ml',
  'Eucerin DermoPurifyer Oil Control Cleansing Gel 200ml',
  'Vichy Mineral 89 50ml',
  'Garnier SkinActive Micellar Cleansing Water 400ml',
  'CeraVe Ultra Glow Night Elixir 50ml',
  'سيروم فيتامين سي للبشرة',
  'Cerave hydrating cleanser 236 ml',
];

async function main() {
  const phase = process.argv[2];
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const fetcher = app.get(ResearchSourceFetcher);
  const providers = app.get(ProductResearchService);
  const usage = () => ({ searches: providers.usage.searches, pageFetches: fetcher.usage.pageFetches, imageFetches: fetcher.usage.imageFetches });
  try {
    if (phase === 'setup') {
      await prisma.customer.upsert({ where: { id: ADMIN_ID }, update: {}, create: { id: ADMIN_ID, name: 'Intake Run Admin', email: 'intake-admin@example.test', roles: ['ADMIN'] } });
      await prisma.supplier.upsert({ where: { id: SUPPLIER_ID }, update: {}, create: { id: SUPPLIER_ID, name: 'صيدليات النهار للتوزيع', slug: 'nahar-distribution' } });
      await prisma.customer.upsert({ where: { id: SUPPLIER_USER }, update: {}, create: { id: SUPPLIER_USER, name: 'Supplier User', email: 'intake-supplier@example.test', roles: ['SUPPLIER'], supplierId: SUPPLIER_ID } });
      const skin = await prisma.category.upsert({ where: { slug: 'skin-care' }, update: {}, create: { name: 'Skin Care', slug: 'skin-care', sortOrder: 1 } });
      const hair = await prisma.category.upsert({ where: { slug: 'hair-care' }, update: {}, create: { name: 'Hair Care', slug: 'hair-care', sortOrder: 2 } });
      const leaves: Array<[string, string, string]> = [['Cleansers', 'cleansers', skin.id], ['Moisturizers', 'moisturizers', skin.id], ['Serums & Treatments', 'serums-treatments', skin.id],
        ['Sunscreens', 'sunscreens', skin.id], ['Toners', 'toners', skin.id], ['Eye Care', 'eye-care', skin.id], ['Shampoos', 'shampoos', hair.id], ['Conditioners', 'conditioners', hair.id]];
      for (const [name, slug, parentId] of leaves) await prisma.category.upsert({ where: { slug }, update: {}, create: { name, slug, parentId } });
      console.log('setup done');
    } else if (phase === 'admin') {
      const admin = app.get(AdminIntakeService);
      const runner = app.get(IntakeRunnerService);
      const before = usage();
      const t0 = Date.now();
      const submitted = await admin.submit({ actorId: ADMIN_ID, names: ADMIN_NAMES, researchPrices: false });
      const worked = await runner.drain(submitted.jobId);
      // Rows waiting for an automatic retry: wait them out (bounded) so the run ends with final outcomes.
      for (let round = 0; round < 6; round++) {
        const pending = await prisma.intakeRow.findMany({ where: { jobId: submitted.jobId, outcome: 'PENDING' }, select: { nextAttemptAt: true } });
        if (!pending.length) break;
        await prisma.intakeRow.updateMany({ where: { jobId: submitted.jobId, outcome: 'PENDING' }, data: { nextAttemptAt: null } });
        await runner.drain(submitted.jobId);
      }
      const rows = await prisma.intakeRow.findMany({ where: { jobId: submitted.jobId }, orderBy: { rowNumber: 'asc' } });
      const job = await prisma.intakeJob.findUnique({ where: { id: submitted.jobId } });
      const after = usage();
      save('admin-run.json', { jobId: submitted.jobId, worked, durationMs: Date.now() - t0, cost: { searches: after.searches - before.searches, pageFetches: after.pageFetches - before.pageFetches, imageFetches: after.imageFetches - before.imageFetches },
        job, rows: rows.map(row => ({ row: row.rowNumber, name: row.rawName, outcome: row.outcome, reasonCode: row.reasonCode, reason: row.reason, skuId: row.matchedSkuId, processingMs: row.processingMs, cost: row.cost,
          readiness: row.readiness, identity: (row.evidence as any)?.identity, enrichment: (row.evidence as any)?.enrichment, media: (row.evidence as any)?.media })) });
      console.table(rows.map(row => ({ row: row.rowNumber, name: row.rawName.slice(0, 48), outcome: row.outcome, reason: (row.reasonCode ?? '').slice(0, 40), ms: row.processingMs })));
    } else if (phase === 'supplier') {
      const file = process.argv[3];
      const tag = process.argv[4] ?? basename(file);
      const supplier = app.get(SupplierIntakeService);
      const buffer = readFileSync(file);
      const result = await supplier.submit({ supplierId: SUPPLIER_ID, actorId: SUPPLIER_USER, file: { buffer, originalname: basename(file), mimetype: file.endsWith('.csv') ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: buffer.length }, wait: true });
      const rows = await prisma.intakeRow.findMany({ where: { jobId: result.jobId }, orderBy: { rowNumber: 'asc' } });
      const skus = await prisma.sku.findMany({ select: { id: true, size: true, sizeUnit: true, product: { select: { name: true, brand: { select: { name: true } } } } } });
      const label = new Map(skus.map(sku => [sku.id, `${sku.product.brand.name} ${sku.product.name} ${sku.size}${sku.sizeUnit}`]));
      const job = await prisma.intakeJob.findUnique({ where: { id: result.jobId } });
      save(`supplier-${tag}.json`, { jobId: result.jobId, replay: result.replay, job, rows: rows.map(row => ({ row: row.rowNumber, name: row.rawName, purchase: row.purchasePrice, consumer: row.consumerPrice,
        outcome: row.outcome, reasonCode: row.reasonCode, reason: row.reason, matched: row.matchedSkuId ? label.get(row.matchedSkuId) : null, candidates: row.candidates, evidence: row.evidence })) });
      console.log(JSON.stringify({ totals: job?.totals, metrics: job?.metrics, snapshot: job?.snapshot }, null, 1));
    } else if (phase === 'market') {
      const market = app.get(MarketPriceResearchService);
      const skus = await prisma.sku.findMany({ where: { identityStatus: 'EVIDENCE_VERIFIED' }, select: { id: true, product: { select: { name: true, brand: { select: { name: true } } } } } });
      const results: any[] = [];
      for (const sku of skus) {
        const before = usage();
        const t0 = Date.now();
        const result: any = await market.research(sku.id, ADMIN_ID, { force: true });
        const after = usage();
        const observations = await prisma.retailPriceObservation.findMany({ where: { skuId: sku.id }, orderBy: { createdAt: 'desc' }, take: 20 });
        results.push({ sku: `${sku.product.brand.name} ${sku.product.name}`, ms: Date.now() - t0, cost: { searches: after.searches - before.searches, pageFetches: after.pageFetches - before.pageFetches },
          status: result.check?.status, reasonCode: result.check?.reasonCode, reference: result.reference, coverage: result.check?.coverage, pricing: result.pricing,
          observations: observations.map(o => ({ seller: o.sellerDomain, price: Number(o.priceEgp), regular: o.regularPriceEgp ? Number(o.regularPriceEgp) : null, status: o.status, reason: o.rejectReason, pack: o.packText, url: o.sourceUrl })) });
        console.log(sku.product.name, result.check?.status, result.check?.reasonCode ?? '', JSON.stringify(result.reference ?? {}));
      }
      save('market-run.json', results);
    } else if (phase === 'verify') {
      const enrichment = app.get(CatalogEnrichmentService);
      const skus = await prisma.sku.findMany({ select: { id: true, identityStatus: true, barcode: true, barcodeStatus: true, size: true, sizeUnit: true,
        product: { select: { id: true, name: true, isPublished: true, category: { select: { name: true } }, brand: { select: { name: true } } } } } });
      const out: any[] = [];
      for (const sku of skus) out.push({ sku: `${sku.product.brand.name} ${sku.product.name} ${sku.size}${sku.sizeUnit}`, skuId: sku.id, identity: sku.identityStatus, barcode: `${sku.barcode ?? '-'} (${sku.barcodeStatus})`,
        category: sku.product.category?.name ?? null, readiness: await enrichment.readiness(sku.id) });
      save('readiness.json', out);
      console.table(out.map(item => ({ sku: item.sku.slice(0, 50), cat: item.category, pdp: item.readiness.pdp.ready, chat: item.readiness.chatbot.ready, routine: item.readiness.routine.ready,
        missing: [...item.readiness.pdp.missing, ...item.readiness.routine.missing].join(',').slice(0, 60) })));
    } else if (phase === 'retailers') {
      // Which Egyptian retailers' product pages can be read (robots) and state a structured EGP price? Evidence for MARKET_TRUSTED_RETAILERS.
      const { extractPageOffers } = await import('../src/modules/intake/public');
      const queries = ['CeraVe Hydrating Cleanser 236ml', 'The Ordinary Niacinamide 10% Zinc 1% 30ml', 'La Roche-Posay Effaclar Purifying Foaming Gel 200ml'];
      const pages: Array<{ url: string; host: string }> = [];
      for (const query of queries) for (const suffix of ['سعر', 'price Egypt pharmacy']) {
        for (const page of (await providers.discoverPages(`${query} ${suffix}`, 10)) ?? []) {
          try { const host = new URL(page.url).hostname.replace(/^www\./, ''); if (!pages.some(item => item.url === page.url)) pages.push({ url: page.url, host }); } catch { /* skip */ }
        }
      }
      const hosts = new Map<string, any>();
      for (const page of pages) {
        const entry = hosts.get(page.host) ?? { host: page.host, pages: 0, read: 0, priced: 0, egp: 0, outcomes: {} as Record<string, number>, sample: null as unknown };
        hosts.set(page.host, entry);
        entry.pages++;
        if (entry.pages > 2) continue;
        const fetched = await fetcher.fetch(page.url, { kind: 'page', isApprovedHost: h => h.replace(/^www\./, '') === page.host });
        entry.outcomes[fetched.outcome] = (entry.outcomes[fetched.outcome] ?? 0) + 1;
        if (fetched.outcome !== 'OK' || !fetched.body) continue;
        entry.read++;
        const offers = extractPageOffers(fetched.body.toString('utf8'));
        if (offers.length) { entry.priced++; if (offers.some(offer => offer.currency === 'EGP')) entry.egp++; entry.sample ??= { url: page.url, offer: offers[0] }; }
      }
      const table = [...hosts.values()].sort((a, b) => b.egp - a.egp || b.pages - a.pages);
      save('retailer-probe.json', table);
      console.table(table.map(item => ({ host: item.host, pages: item.pages, read: item.read, priced: item.priced, egp: item.egp, outcomes: JSON.stringify(item.outcomes) })));
    } else if (phase === 'downstream') {
      // TEST-ONLY on the scratch DB: one intake draft published by an Admin decision (price stated here), then read back through every consumer.
      const enrichment = app.get(CatalogEnrichmentService);
      const publication = app.get(CatalogPublicationService);
      const intake = app.get(CatalogIntakeService);
      const rows = await prisma.intakeRow.findMany({ where: { outcome: 'DRAFT_CREATED' }, select: { matchedSkuId: true } });
      const out: any = { candidates: [] };
      let chosen: string | null = null;
      for (const row of rows) {
        const readiness = await enrichment.readiness(row.matchedSkuId!);
        out.candidates.push({ skuId: row.matchedSkuId, pdp: readiness.pdp, chatbot: readiness.chatbot, routine: readiness.routine });
        if (!chosen && readiness.pdp.ready && readiness.chatbot.ready) chosen = row.matchedSkuId;
      }
      if (!chosen) { save('downstream.json', { ...out, result: 'NO_SKU_READY_FOR_PDP_AND_CHATBOT' }); console.log('no SKU ready'); return; }
      await intake.setOuterCarton(chosen, false);
      const before = await publication.readiness(chosen);
      const market = await prisma.marketPriceCheck.findFirst({ where: { skuId: chosen }, orderBy: { startedAt: 'desc' } });
      const price = Math.round(Number((market?.reference as any)?.medianEgp ?? 500));
      const after = await publication.publish(chosen, ADMIN_ID, { priceEgp: price });
      const sku = await prisma.sku.findUniqueOrThrow({ where: { id: chosen }, include: { product: true } });
      const detail: any = await app.get(ProductDetailService).getDetail(sku.product.slug, chosen);
      const routine = await app.get(CatalogProfileService).publicRoutineProfile(chosen);
      const facts = await app.get(CatalogService).getRoutineProductFacts([sku.productId]);
      const search: any = await app.get(DiscoveryService).suggest({ q: sku.product.name.split(' ').slice(0, 2).join(' ') } as any);
      const chatbot = await app.get(RecommendationValidatorService).validateProposal({ title: 'Morning', careArea: 'skin',
        steps: [{ title: 'Cleanse', timing: 'am', isOptional: false, productQuery: sku.product.name }] });
      Object.assign(out, { chosen, price, blockersBefore: before.blockers, publishedReady: after.ready, product: sku.product.name,
        pdp: { name: detail?.name ?? detail?.product?.name, keys: Object.keys(detail ?? {}).slice(0, 30), media: (detail?.media ?? detail?.product?.media ?? []).length },
        routine, routineFacts: facts.map(f => ({ name: f.name, targetArea: f.targetArea, ingredients: (f as any).ingredients?.length ?? (f as any).activeIngredients?.length })),
        search: JSON.stringify(search).slice(0, 600), chatbot: chatbot.stepResults?.map((s: any) => ({ valid: s.isValid, errors: s.errors, resolved: s.productResolution?.resolved, availability: s.availabilityCheck })) });
      save('downstream.json', out);
      console.log(JSON.stringify(out, null, 1).slice(0, 4000));
    } else if (phase === 'score') {
      // Compares a supplier run with the oracle: link precision, recall on rows whose SKU exists, false skips, critical rate, outcome accuracy.
      const file = process.argv[3];
      const run = JSON.parse(readFileSync(join(OUT, `supplier-${process.argv[4] ?? file}.json`), 'utf8'));
      const oracle = JSON.parse(readFileSync(join(__dirname, '..', 'test', 'fixtures', 'intake', 'nahar-oracle.json'), 'utf8'))[file] as Array<{ line: number; name: string; expect: string }>;
      const skus = await prisma.sku.findMany({ select: { size: true, product: { select: { name: true, brand: { select: { name: true } } } } } });
      const exists = (key: string) => { const [brand, fragment, size] = key.split('|'); return skus.some(s => s.product.brand.name.toLowerCase() === brand.toLowerCase() && s.product.name.toLowerCase().includes(fragment.toLowerCase()) && Number(s.size) === Number(size)); };
      const is = (label: string | null, key: string) => { if (!label) return false; const [brand, fragment, size] = key.split('|'); return label.toLowerCase().startsWith(brand.toLowerCase()) && label.toLowerCase().includes(fragment.toLowerCase()) && label.includes(` ${size}`); };
      const linked = (outcome: string) => outcome === 'MATCHED' || outcome === 'UPDATED';
      const rows = oracle.map(item => {
        const got = run.rows.find((row: any) => row.row === item.line);
        const [kind, key] = [item.expect.split(':')[0], item.expect.split(':').slice(1).join(':')];
        // A product the Admin run did not create cannot be matched: its row should be UNMATCHED, and is scored that way.
        const effective = (kind === 'MATCH' || kind === 'MATCH_OR_CRITICAL') && !exists(key) ? 'UNMATCHED' : kind;
        let correct: boolean;
        if (effective === 'MATCH') correct = linked(got.outcome) && is(got.matched, key);
        else if (effective === 'MATCH_OR_CRITICAL') correct = (linked(got.outcome) && is(got.matched, key)) || got.outcome === 'CRITICAL';
        else if (effective === 'UNMATCHED') correct = got.outcome === 'UNMATCHED';
        else correct = got.outcome === effective;
        return { line: item.line, name: item.name, expect: item.expect, effective, outcome: got.outcome, reason: got.reasonCode, matched: got.matched, correct,
          falseLink: linked(got.outcome) && !((effective === 'MATCH' || effective === 'MATCH_OR_CRITICAL') && is(got.matched, key)),
          falseSkip: got.outcome === 'SKIPPED' && effective !== 'SKIPPED' };
      });
      const links = rows.filter(r => linked(r.outcome));
      const shouldLink = rows.filter(r => r.effective === 'MATCH' || r.effective === 'MATCH_OR_CRITICAL');
      const summary = { rows: rows.length, outcomeAccuracy: rows.filter(r => r.correct).length / rows.length, links: links.length, falseLinks: rows.filter(r => r.falseLink).length,
        linkPrecision: links.length ? (links.length - rows.filter(r => r.falseLink).length) / links.length : null,
        linkRecall: shouldLink.length ? shouldLink.filter(r => linked(r.outcome) && !r.falseLink).length / shouldLink.length : null,
        falseSkips: rows.filter(r => r.falseSkip).length, critical: rows.filter(r => r.outcome === 'CRITICAL').length, wrong: rows.filter(r => !r.correct) };
      save(`score-${process.argv[4] ?? file}.json`, { summary, rows });
      console.log(JSON.stringify({ ...summary, wrong: summary.wrong.map(r => `${r.line} ${r.name} | expect ${r.effective} got ${r.outcome} ${r.reason ?? ''} ${r.matched ?? ''}`) }, null, 1));
    } else {
      throw new Error('phase: setup | admin | supplier <file> [tag] | market | verify | score <file> [tag]');
    }
  } finally {
    await app.close();
  }
}

main().catch(error => { console.error(error); process.exit(1); });
