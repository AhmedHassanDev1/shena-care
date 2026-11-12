/** One-off guarded operator run through the real Admin Intake workflow. */
process.env.INTAKE_WORKER = 'off';
process.env.DOMAIN_EVENTS_POLL_MS = '0';
process.env.PROCUREMENT_BATCH_INTERVAL_MINUTES = '0';
process.env.DECISION_SWEEP_MS = '0';
process.env.RFQ_TICK_MS = '0';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
require('dotenv').config({ path: `${__dirname}/../.env` });
// The API normally runs from apps/api; keep its local media store stable when this operator script runs from the monorepo root.
process.env.STORAGE_LOCAL_PATH = `${__dirname}/../uploads`;
const pooled = new URL(process.env.DATABASE_URL ?? '');
const direct = new URL(process.env.DIRECT_URL ?? '');
if (pooled.hostname !== 'aws-0-eu-west-1.pooler.supabase.com' || direct.hostname !== pooled.hostname ||
    pooled.pathname !== '/postgres' || direct.pathname !== pooled.pathname || pooled.port !== '6543' || direct.port !== '5432') {
  throw new Error('Refusing to run against an unexpected database target');
}
process.env.DATABASE_URL = process.env.DIRECT_URL;

import { NestFactory } from '@nestjs/core';
import { readFileSync } from 'fs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/platform/database/prisma.service';
import { AdminIntakeService } from '../src/application/composition/services/intake/admin-intake.service';
import { IntakeRunnerService } from '../src/application/composition/services/intake/intake-runner.service';
import { CatalogEnrichmentService } from '../src/application/composition/services/intake/catalog-enrichment.service';
import { CanonicalResearchService } from '../src/modules/catalog/public';
import { SourcingService } from '../src/modules/sourcing/services/sourcing.service';
import { SupplierIntakeService } from '../src/application/composition/services/intake/supplier-intake.service';
import { CatalogPublicationService } from '../src/application/composition/services/catalog-publication.service';
import { CatalogService } from '../src/modules/catalog/services/catalog.service';
import { CatalogProfileService } from '../src/application/composition/services/catalog-profile.service';
import { CatalogDecisionLogService } from '../src/modules/catalog/research/catalog-decision-log.service';
import { ProductMediaService } from '../src/modules/catalog/services/product-media.service';
import { CatalogIntakeService } from '../src/modules/catalog/services/catalog-intake.service';
import { MediaOriginType, MediaRole, MediaReviewStatus } from '@prisma/client';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const admin = await prisma.customer.findFirst({ where: { roles: { has: 'ADMIN' } }, select: { id: true } });
    if (!admin) throw new Error('No existing admin account');
    if (process.argv[2] === 'media') {
      const rows = await prisma.intakeRow.findMany({ where: { jobId: 'be29142b-a331-4191-9d55-76750e0881f9', matchedSkuId: { not: null } }, orderBy: { rowNumber: 'asc' },
        select: { rowNumber: true, matchedSkuId: true } });
      const enrichment = app.get(CatalogEnrichmentService);
      for (const row of rows) {
        const media = await enrichment.prepareMedia(row.matchedSkuId!, admin.id);
        const readiness = await enrichment.readiness(row.matchedSkuId!);
        console.log(JSON.stringify({ row: row.rowNumber, skuId: row.matchedSkuId, media, readiness }));
      }
      return;
    }
    if (process.argv[2] === 'loreal-media') {
      for (const rowNumber of [10, 11]) {
        const row = await prisma.intakeRow.findFirstOrThrow({ where: { jobId: 'be29142b-a331-4191-9d55-76750e0881f9', rowNumber }, select: { matchedSkuId: true } });
        const sku = await prisma.sku.findUniqueOrThrow({ where: { id: row.matchedSkuId! }, select: { identityEvidence: true } });
        const urls = (sku.identityEvidence as { sourceUrls?: string[] } | null)?.sourceUrls ?? [];
        const run = await app.get(CanonicalResearchService).startRun(row.matchedSkuId!, { sourceUrls: urls }, admin.id);
        const media = await app.get(CatalogEnrichmentService).prepareMedia(row.matchedSkuId!, admin.id);
        console.log(JSON.stringify({ rowNumber, run: run.status, media }));
      }
      return;
    }
    if (process.argv[2] === 'supplier') {
      if (await prisma.product.count() !== 10 || await prisma.sku.count() !== 10) throw new Error('The canonical catalog must have exactly 10 products and SKUs');
      const slug = 'mvp-dev-only-fixture-20261109';
      let supplier = await prisma.supplier.findUnique({ where: { slug }, select: { id: true } });
      if (!supplier) supplier = await app.get(SourcingService).createSupplier({ name: 'DEV TEST ONLY - synthetic supplier, prices and stock', slug,
        isActive: true, rfqEnrolled: false }, { actorId: admin.id, reason: 'MVP integration fixture; synthetic commercial values' });
      const intake = app.get(SupplierIntakeService);
      for (const filename of ['mvp-dev-only-supplier.csv', 'mvp-dev-only-supplier.csv', 'mvp-dev-only-supplier-update.csv']) {
        const buffer = readFileSync(`${__dirname}/../test/fixtures/intake/${filename}`);
        const result = await intake.submit({ supplierId: supplier.id, actorId: admin.id,
          file: { buffer, originalname: filename, mimetype: 'text/csv', size: buffer.length }, wait: true });
        const rows = await prisma.intakeRow.findMany({ where: { jobId: result.jobId }, orderBy: { rowNumber: 'asc' },
          select: { rowNumber: true, rawName: true, outcome: true, reasonCode: true, matchedSkuId: true, purchasePrice: true, consumerPrice: true, parsed: true } });
        console.log(JSON.stringify({ filename, replay: result.replay, jobId: result.jobId, totals: result.totals,
          rows: rows.map(row => ({ ...row, purchasePrice: row.purchasePrice?.toString(), consumerPrice: row.consumerPrice?.toString() })) }));
      }
      console.log(JSON.stringify({ products: await prisma.product.count(), skus: await prisma.sku.count(), supplierOffers: await prisma.supplierOffer.count({ where: { supplierId: supplier.id } }) }));
      return;
    }
    if (process.argv[2] === 'status') {
      const rows = await prisma.intakeRow.findMany({ where: { jobId: 'be29142b-a331-4191-9d55-76750e0881f9' }, orderBy: { rowNumber: 'asc' },
        select: { rowNumber: true, rawName: true, matchedSkuId: true } });
      for (const row of rows) {
        const sku = await prisma.sku.findUniqueOrThrow({ where: { id: row.matchedSkuId! }, select: { productId: true, product: { select: { name: true, isPublished: true, categoryId: true } } } });
        const intake = await app.get(CatalogEnrichmentService).readiness(row.matchedSkuId!);
        const publication = await app.get(CatalogPublicationService).readiness(row.matchedSkuId!);
        console.log(JSON.stringify({ row: row.rowNumber, name: row.rawName, skuId: row.matchedSkuId, productId: sku.productId,
          published: sku.product.isPublished, category: Boolean(sku.product.categoryId), intake, publication: { blockers: publication.blockers, warnings: publication.warnings } }));
      }
      return;
    }
    if (process.argv[2] === 'publish-ready') {
      if (await prisma.product.count() !== 10 || await prisma.sku.count() !== 10) throw new Error('Expected exactly 10 canonical products');
      const supplier = await prisma.supplier.findUniqueOrThrow({ where: { slug: 'mvp-dev-only-fixture-20261109' }, select: { id: true, name: true } });
      if (!supplier.name.startsWith('DEV TEST ONLY')) throw new Error('Synthetic supplier marker missing');
      const rows = await prisma.intakeRow.findMany({ where: { jobId: 'be29142b-a331-4191-9d55-76750e0881f9' }, orderBy: { rowNumber: 'asc' },
        select: { rowNumber: true, matchedSkuId: true } });
      for (const row of rows) {
        const skuId = row.matchedSkuId!;
        const offer = await prisma.supplierOffer.findUniqueOrThrow({ where: { supplierId_skuId: { supplierId: supplier.id, skuId } }, select: { consumerPrice: true } });
        if (!offer.consumerPrice) throw new Error(`Missing synthetic consumer price for row ${row.rowNumber}`);
        const publication = app.get(CatalogPublicationService);
        const before = await publication.readiness(skuId);
        if (before.isPublished && before.ready) { console.log(JSON.stringify({ row: row.rowNumber, skuId, published: true, alreadyReady: true })); continue; }
        const pending = before.blockers.filter(blocker => !['LISTING_NOT_ACTIVE', 'SELLING_PRICE_MISSING'].includes(blocker));
        if (pending.length) { console.log(JSON.stringify({ row: row.rowNumber, skuId, published: false, blockers: pending })); continue; }
        await app.get(CatalogDecisionLogService).record({ subjectType: 'SKU', subjectId: skuId, skuId, decision: 'DEV_TEST_PRICE_SELECTED',
          reasonCode: 'SYNTHETIC_FIXTURE_NOT_MARKET_PRICE', actorType: 'ADMIN', actorId: admin.id,
          evidence: { supplierId: supplier.id, consumerPrice: offer.consumerPrice.toString(), currency: 'EGP',
            note: 'Development-only synthetic value for end-to-end validation; not a verified market price or a real supplier offer.' } });
        const after = await publication.publish(skuId, admin.id, { priceEgp: Number(offer.consumerPrice) });
        console.log(JSON.stringify({ row: row.rowNumber, skuId, published: after.isPublished, blockers: after.blockers,
          price: after.commerce.price, priceBasis: 'DEV_TEST_ONLY_SYNTHETIC_FIXTURE' }));
      }
      return;
    }
    if (process.argv[2] === 'starville-research') {
      const skuId = 'ae5ffcaf-1bca-466b-aff5-240bcd466890';
      const sku = await prisma.sku.findUniqueOrThrow({ where: { id: skuId }, select: { identityEvidence: true } });
      const urls = (sku.identityEvidence as { sourceUrls?: string[] } | null)?.sourceUrls ?? [];
      const research = app.get(CanonicalResearchService);
      const run = await research.startRun(skuId, { sourceUrls: urls }, admin.id);
      const facts = await prisma.productFactProposal.findMany({ where: { skuId, field: 'usage.instructions' },
        select: { id: true, runId: true, status: true, value: true, evidence: true } });
      console.log(JSON.stringify({ runId: run.id, status: run.status, sources: run.sources,
        facts: facts.map(fact => ({ id: fact.id, runId: fact.runId, status: fact.status, value: fact.value,
          evidence: (fact.evidence as Array<{ sourceUrl: string; excerpt: string }>).map(e => ({ url: e.sourceUrl, excerpt: e.excerpt })) })) }));
      return;
    }
    if (process.argv[2] === 'starville-resolve') {
      const skuId = 'ae5ffcaf-1bca-466b-aff5-240bcd466890';
      const research = app.get(CanonicalResearchService);
      const facts = await prisma.productFactProposal.findMany({ where: { skuId, field: 'usage.instructions' },
        select: { id: true, status: true, value: true } });
      const mixed = facts.find(fact => ['CONFLICT', 'REJECTED'].includes(fact.status) && JSON.stringify(fact.value).includes('until fully absorbed'));
      const rinse = facts.find(fact => ['PROPOSED', 'APPLIED'].includes(fact.status) && JSON.stringify(fact.value).includes('rinse your skin with lukewarm water') && !JSON.stringify(fact.value).includes('fully absorbed'));
      if (!mixed || !rinse) throw new Error('Expected the conflicting mixed directions and the new product-named rinse directions');
      if (mixed.status === 'CONFLICT') await research.review(mixed.id, { decision: 'REJECTED', note: 'Manufacturer page mixes leave-on lotion copy with cleanser instructions; product-named rinse directions are the applicable section.' }, admin.id);
      const verification = await research.autoVerify(skuId, admin.id);
      const applied = await prisma.productFactProposal.findUniqueOrThrow({ where: { id: rinse.id }, select: { status: true } });
      if (applied.status !== 'APPLIED') throw new Error(`Rinse instruction was not applied: ${applied.status}`);
      const exceptions = await app.get(CatalogDecisionLogService).openForSku(skuId);
      for (const exception of exceptions) {
        if (exception.reasonCode !== 'USAGE_INSTRUCTIONS_CONTRADICT') throw new Error(`Unexpected open exception ${exception.reasonCode}`);
        await app.get(CatalogDecisionLogService).settle(exception.id, { status: 'RESOLVED', resolution: 'OFFICIAL_RINSE',
          note: 'Re-read the official manufacturer page. Its cleanser-named How to use section says to rinse with lukewarm water. Rejected the mixed lotion/cleanser reading; applied only the product-named direction.', actorId: admin.id });
      }
      console.log(JSON.stringify({ skuId, rejectedFactId: mixed.id, appliedFactId: rinse.id, verification, settledExceptions: exceptions.map(e => e.id) }));
      return;
    }
    if (process.argv[2] === 'starville-brand-check') {
      const research = app.get(CanonicalResearchService);
      const result = await research.checkSource({ brand: 'StarVille', productName: 'StarVille Acne Prone Skin Facial Cleanser',
        size: 200, sizeUnit: 'ml', barcode: null, websiteUrl: 'https://www.parkvillepharma.com' },
        'https://www.parkvillepharma.com/brand/starville');
      console.log(JSON.stringify(result));
      return;
    }
    if (process.argv[2] === 'starville-correct-content') {
      const skuId = 'ae5ffcaf-1bca-466b-aff5-240bcd466890';
      const productId = 'a39b04e9-21f7-4e36-a897-30493e589314';
      const description = await prisma.productFactProposal.findFirstOrThrow({ where: { skuId, field: 'marketing.description', status: 'APPLIED' } });
      if (typeof description.value !== 'string' || !description.value.includes('Oily & Mixed Skin Lotion') || !description.value.includes('until fully absorbed'))
        throw new Error('The applied description does not match the verified product-type conflict');
      await app.get(CanonicalResearchService).invalidateAppliedDescription(description.id,
        'Official product page gives a leave-on lotion overview for a rinse-off cleanser; the manufacturer brand page describes a cleanser. Withhold this mixed overview.', admin.id);
      const usage = await prisma.productFactProposal.findFirstOrThrow({ where: { skuId, field: 'usage.instructions', status: 'APPLIED' } });
      const value = usage.value;
      const evidence = (usage.evidence as Array<{ sourceUrl: string }>)[0];
      if (!Array.isArray(value) || value.length !== 1 || typeof value[0] !== 'string' || !value[0].includes('rinse your skin with lukewarm water') || !evidence?.sourceUrl)
        throw new Error('No product-named rinse direction to correct the usage rule');
      const oldRule = await prisma.productUsageRule.findFirstOrThrow({ where: { skuId } });
      if (!oldRule.evidenceText.includes('until fully absorbed')) throw new Error('Usage rule no longer has the contradictory old evidence');
      const changed = await app.get(CatalogIntakeService).correctUsageRuleIf(skuId, oldRule.evidenceText,
        { evidenceText: value[0], sourceUrl: evidence.sourceUrl, reviewedBy: admin.id });
      if (!changed) throw new Error('Usage rule compare-and-set failed');
      await app.get(CatalogDecisionLogService).record({ subjectType: 'SKU', subjectId: skuId, skuId, decision: 'MIXED_COPY_WITHHELD',
        reasonCode: 'PRODUCT_TYPE_CONFLICT', actorType: 'ADMIN', actorId: admin.id,
        evidence: { descriptionFactId: description.id, usageFactId: usage.id, productId,
          productPage: evidence.sourceUrl, corroboratingBrandPage: 'https://www.parkvillepharma.com/brand/starville',
          note: 'Official product page has a lotion overview but product-named cleanser rinse directions. Description withdrawn; usage rule corrected to rinse off.' } });
      console.log(JSON.stringify({ skuId, descriptionWithdrawn: description.id, usageRuleCorrected: oldRule.id }));
      return;
    }
    if (process.argv[2] === 'starville-refresh-profile') {
      const profile = await app.get(CatalogProfileService).refresh('ae5ffcaf-1bca-466b-aff5-240bcd466890', admin.id);
      console.log(JSON.stringify({ skuId: 'ae5ffcaf-1bca-466b-aff5-240bcd466890', rinseMode: profile.rinseMode,
        primaryRole: profile.primaryRole, routinePeriod: profile.routinePeriod }));
      return;
    }
    if (process.argv[2] === 'soothing-category') {
      const skuId = '5565f305-d897-44ad-8d34-3f94e6289468';
      const sku = await prisma.sku.findUniqueOrThrow({ where: { id: skuId }, select: { productId: true } });
      const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'moisturizers' }, select: { id: true } });
      await app.get(CatalogService).updateProduct(sku.productId, { categoryId: category.id });
      await app.get(CatalogDecisionLogService).record({ subjectType: 'SKU', subjectId: skuId, skuId, decision: 'CATEGORY_RESEARCHED',
        reasonCode: 'OFFICIAL_PRODUCT_PAGE_CATEGORY', actorType: 'ADMIN', actorId: admin.id,
        evidence: { sourceUrl: 'https://shop.parkvillepharma.com/collections/beauty-friday/products/shaan-soothing-gel-120-gm',
          label: 'Face Creams & Moisturizers', categoryId: category.id } });
      const profile = await app.get(CatalogProfileService).refresh(skuId, admin.id);
      console.log(JSON.stringify({ categoryId: category.id, productType: profile.productType, role: profile.primaryRole }));
      return;
    }
    if (process.argv[2] === 'carton') {
      const cartonRows = new Set([4, 5, 6, 8, 9]);
      const rows = await prisma.intakeRow.findMany({ where: { jobId: 'be29142b-a331-4191-9d55-76750e0881f9' }, orderBy: { rowNumber: 'asc' },
        select: { rowNumber: true, matchedSkuId: true } });
      const media = app.get(ProductMediaService);
      const catalog = app.get(CatalogIntakeService);
      const decisions = app.get(CatalogDecisionLogService);
      for (const row of rows) {
        const skuId = row.matchedSkuId!;
        const withCarton = cartonRows.has(row.rowNumber);
        const assets = await media.listForSku(skuId);
        const packshot = assets.find(asset => asset.role === MediaRole.PRIMARY_PACKSHOT && asset.reviewStatus === MediaReviewStatus.APPROVED && !asset.parentAssetId);
        if (!packshot || !packshot.sourceUrl || !packshot.sourcePublisher || !packshot.sourceType) throw new Error(`No verified packshot for row ${row.rowNumber}`);
        let proofId: string | null = null;
        if (withCarton) {
          let proof = assets.find(asset => asset.role === MediaRole.PACKAGING_PROOF && asset.reviewStatus === MediaReviewStatus.APPROVED);
          if (!proof) {
            const original = await media.readAssetFile(packshot.id);
            const ext = original.mimeType.includes('png') ? 'png' : original.mimeType.includes('webp') ? 'webp' : 'jpg';
            const registered = await media.registerOriginal({ skuId, role: MediaRole.PACKAGING_PROOF, originType: MediaOriginType.verified,
              sourceUrl: packshot.sourceUrl, sourcePublisher: packshot.sourcePublisher, sourceType: packshot.sourceType as 'OFFICIAL_MANUFACTURER' | 'TRUSTED_DISTRIBUTOR',
              rightsStatus: packshot.rightsStatus, capturedAt: packshot.capturedAt?.toISOString() },
              { buffer: original.buffer, mimetype: original.mimeType, originalname: `carton-source.${ext}`, size: original.buffer.length,
                fieldname: 'file', encoding: '7bit' } as Express.Multer.File, admin.id);
            proof = await media.autoReview(registered.id, { approve: true, reason: 'CARTON_VISIBLE_IN_OFFICIAL_PRODUCT_IMAGE' }, admin.id);
          }
          if (proof.reviewStatus !== MediaReviewStatus.APPROVED) throw new Error(`Carton proof not approved for row ${row.rowNumber}`);
          proofId = proof.id;
        }
        await catalog.setOuterCarton(skuId, withCarton);
        await decisions.record({ subjectType: 'SKU', subjectId: skuId, skuId, decision: 'CARTON_DECIDED',
          reasonCode: withCarton ? 'CARTON_VISIBLE_IN_OFFICIAL_IMAGE' : 'CARTON_NOT_SHOWN_IN_OFFICIAL_PACKSHOT', actorType: 'ADMIN', actorId: admin.id,
          evidence: { sourceUrl: packshot.sourceUrl, sourceAssetId: packshot.id, proofAssetId: proofId, hasOuterCarton: withCarton,
            basis: withCarton ? 'The official product image visibly includes the outer box.' : 'The official packshot shows the bottle or tube without an outer box; this is a visual inference.' } });
        console.log(JSON.stringify({ row: row.rowNumber, skuId, hasOuterCarton: withCarton, proofId }));
      }
      return;
    }
    const path = `${__dirname}/data/catalog-intake-mvp-10.csv`;
    const buffer = readFileSync(path);
    const result = await app.get(AdminIntakeService).submit({ actorId: admin.id,
      file: { buffer, originalname: 'catalog-intake-mvp-10.csv', mimetype: 'text/csv', size: buffer.length }, researchPrices: false });
    console.log(JSON.stringify({ phase: 'submit', jobId: result.jobId, replay: result.replay, totals: result.totals }));
    const runner = app.get(IntakeRunnerService);
    for (let n = 0; n < 30; n++) {
      const worked = await runner.drain(result.jobId, 1);
      const rows = await prisma.intakeRow.findMany({ where: { jobId: result.jobId }, orderBy: { rowNumber: 'asc' },
        select: { rowNumber: true, rawName: true, outcome: true, reasonCode: true, lastError: true, attempts: true, matchedSkuId: true, nextAttemptAt: true } });
      console.log(JSON.stringify({ phase: 'drain', worked, rows }));
      const pending = rows.filter(row => row.outcome === 'PENDING');
      if (!pending.length) break;
      if (!worked) {
        const due = Math.min(...pending.map(row => row.nextAttemptAt?.getTime() ?? Date.now()));
        await new Promise(resolve => setTimeout(resolve, Math.max(1000, Math.min(30000, due - Date.now() + 250))));
      }
    }
  } finally { await app.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
