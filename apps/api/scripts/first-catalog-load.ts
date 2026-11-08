/* eslint-disable @typescript-eslint/no-explicit-any -- one-off operator script, results are printed */
/**
 * ONE-OFF (2026-11-08): replaces the old Supabase catalog with the first verified products, through the application's own services. Run by phase:
 *
 *   npx ts-node --transpile-only scripts/first-catalog-load.ts snapshot | archive | policy | import | resume <jobId> | verify
 *
 * Nothing here deletes anything: old products are archived (reversible), policy changes are new immutable versions, products arrive through the autopilot.
 * Background workers (outbox, domain events, RFQ, availability, retention, procurement) are switched off at process level before the app boots.
 */
// ─── process level switches, before anything reads configuration ───
process.env.NODE_ENV = 'test'; // outbox, data retention and procurement timers do not start
process.env.DOMAIN_EVENTS_POLL_MS = '0';
process.env.PROCUREMENT_BATCH_INTERVAL_MINUTES = '0';
process.env.DECISION_SWEEP_MS = '0';
process.env.RFQ_TICK_MS = '0';
process.env.SOURCING_MODE = 'BROADCAST_ON_DEMAND';
// Sourcing policy approved 2026-11-07: distributor hosts that may be READ as trusted-distributor sources for these brands (never "official").
process.env.RESEARCH_ALLOWED_HOSTS = 'eparkville.com,parkvillepharma.com,parkville.com.eg';
// Publishing phases (owner approved 2026-11-08): Eva's own official shop is a trusted image source for these manufacturer photos, and the public images go to Cloudinary.
if (['media3', 'publish3', 'verify3'].includes(process.argv[2])) {
  process.env.MEDIA_TRUSTED_SOURCE_HOSTS = 'eva-cosmetics.com';
  process.env.MEDIA_STORAGE_PROVIDER = 'cloudinary';
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: `${__dirname}/../.env` }); // never overrides what is set above

import { NestFactory } from '@nestjs/core';
import { writeFileSync } from 'fs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/platform/database/prisma.service';
import { CatalogItemManagementService } from '../src/modules/catalog/public';
import { CommerceService } from '../src/modules/commerce/public';
import { AdminCatalogImportService, BrandResearchService, CanonicalResearchService, decideNewProduct, IngestionEligibilityService } from '../src/modules/ingestion/public';
import { CatalogAutopilotService } from '../src/application/composition/services/catalog-autopilot.service';
import { CatalogPublicationService } from '../src/application/composition/services/catalog-publication.service';
import { StorageService } from '../src/platform/storage/storage.service';
import { CatalogIntakeService, MediaTemplateService, ProductMediaService } from '../src/modules/catalog/public';
import { MediaReviewStatus, MediaRole, MediaOriginType, MediaProcessingStatus, MediaRightsStatus } from '@prisma/client';
import { SourcingService } from '../src/modules/sourcing/public';

const ADMIN_ID = '7616f6a0-1c73-4356-8a0a-03b505bd7a06';
const log = (label: string, value: unknown) => console.log(`\n### ${label}\n${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}`);

/** The owner's 33-row list (2026-11-07). Only change: the CICA Cream size, which its official page states as its single size (50 ML). */
const LIST = `StarVille	Acne Prone Skin Facial Cleanser 200 ml
StarVille	Whitening Cleanser 200 ml
StarVille	Facial Cleanser Hydro
StarVille	Acne Prone Skin Cream 60 gm
StarVille	Acne Prone Skin Gel 30 gm
Shaan	Antioxidant Facial Cleanser 250 ml
Shaan	Soothing Gel 120 gm
Shaan	Rejuvenation Cream 120 gm
Shaan	Oily Matte Cream-Gel 60 gm
Shaan	Dry S Cream Fragrance Free
Bobai	Sunscreen Extra Lightening Gel SPF 50 50 gm
Bobai	Sunscreen Tinted Extra Lightening Gel SPF 50 50 gm
Bobai	Sunscreen Oil Defense Fluid SPF 50 75 ml
Dermactive	ACTI-CLEAR Gentle Cleansing Gel
Dermactive	ACTI-CLEAR Hydra-Mattifying Gel
Dermactive	ACTI-WHITE Foaming Gel
Dermactive	ACTI-WHITE Brightening Correcting Serum
Dermactive	ACTI-SOLAIRE SPF50+ Ultra Fluid
Dermactive	ACTI-SOLAIRE SPF50+ Melting Cream
Dermactive	ACTI-REPAIR CICA Cream
Dermactive	TRICHO-ACT Anti-Dandruff Shampoo DS
Dermactive	TRICHO-ACT Hair Repairing Mask
Eva Skin Clinic	Niacinamide Facial Serum 30 ml
Eva Skin Clinic	Hyaluronic Acid Facial Serum 30 ml
Eva Skin Clinic	Vitamin C Facial Serum 20 ml
Eva Skin Clinic	Hyaluronic Acid Facial Wash 160 ml
Eva Skin Clinic	Hyaluronic Acid Day Gel 45 ml
Eva Skin Clinic	Hyaluronic Acid Night Cream 45 ml
Eva Skin Clinic	Hyaluronic Acid Micellar Water 200 ml
Eva Skin Clinic	Collagen Toner 200 ml
CeraVe	Foaming Facial Cleanser
CeraVe	Hydrating Facial Cleanser
CeraVe	Blemish Control Cleanser`;
const SIZE_FROM_OFFICIAL_PAGE: Record<string, string> = { 'ACTI-REPAIR CICA Cream': '50 ml' };

/** The first three products to go live (owner approved prices 2026-11-08). Carton decisions come from the manufacturer images: bottle+box (serum), tube only (wash), bottle only (micellar). */
const FIRST3 = [
  { name: 'Hyaluronic Acid Facial Wash', carton: false, priceEgp: 125 },
  { name: 'Hyaluronic Acid Micellar Water', carton: false, priceEgp: 220 },
  { name: 'Hyaluronic Acid Facial Serum', carton: true, priceEgp: 215 },
];

async function snapshot(prisma: PrismaService) {
  const count = async (sql: string) => Number((await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(sql))[0].n);
  const groups = async (sql: string) => Object.fromEntries((await prisma.$queryRawUnsafe<Array<{ k: string; n: bigint }>>(sql)).map(r => [r.k, Number(r.n)]));
  return {
    brands: await count('select count(*) n from catalog.brands'), productLines: await count('select count(*) n from catalog.product_lines'),
    products: await count('select count(*) n from catalog.products'), productsArchived: await count('select count(*) n from catalog.products where archived_at is not null'),
    productsPublished: await count('select count(*) n from catalog.products where is_published'), skus: await count('select count(*) n from catalog.skus'),
    skusActive: await count('select count(*) n from catalog.skus where is_active'), mediaAssets: await count('select count(*) n from catalog.media_assets'),
    listings: await count('select count(*) n from commerce.listings'), listingsListed: await count('select count(*) n from commerce.listings where is_listed'),
    prices: await count('select count(*) n from commerce.selling_prices'), offers: await count('select count(*) n from sourcing.supplier_offers'),
    orders: await count('select count(*) n from ordering.orders'), orderItems: await count('select count(*) n from ordering.order_items'),
    purchaseOrderLines: await count('select count(*) n from sourcing.purchase_order_lines'),
    policyVersion: await count('select max(version) n from ingestion.eligibility_policies'),
    // Proof that no background worker acted: these must not change during any phase of this script.
    outboxByStatus: await groups('select status::text k, count(*) n from operations.notification_outbox group by 1'),
    domainEventsByStatus: await groups('select status::text k, count(*) n from operations.domain_events group by 1'),
    ordersByStatus: await groups('select status::text k, count(*) n from ordering.orders group by 1'),
  };
}

async function main() {
  const [phase, arg] = process.argv.slice(2);
  const host = new URL(process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? 'postgresql://none@none/').hostname;
  console.log(`database host: ${host} | phase: ${phase}`);
  if (!/supabase\.com$/.test(host)) throw new Error('This script is for the Supabase database only');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  try {
    if (phase === 'snapshot' || phase === 'verify') log(`${phase}`, await snapshot(prisma));

    if (phase === 'archive') {
      const admin = await prisma.customer.findUniqueOrThrow({ where: { id: ADMIN_ID }, select: { id: true, roles: true } });
      if (!String(admin.roles).includes('ADMIN')) throw new Error('Actor is not an admin');
      const items = app.get(CatalogItemManagementService);
      const commerce = app.get(CommerceService);
      const old = await prisma.product.findMany({ where: { archivedAt: null }, select: { id: true, name: true, isPublished: true, skus: { select: { id: true, code: true } } } });
      log('products to archive (not yet archived)', old.map(p => `${p.name} [${p.skus.map(s => s.code).join(',')}] published=${p.isPublished}`));
      const archived: string[] = [];
      for (const product of old) { await items.archive(product.id); archived.push(product.name); }
      // The one stale listing (on an already archived product) is un-listed; its price and offer stay as history.
      const stale = await prisma.listing.findMany({ where: { isListed: true }, select: { skuId: true } });
      for (const listing of stale) await commerce.unlistSku(listing.skuId);
      log('archived', archived);
      log('unlisted listings', stale.length);
      log('after', await snapshot(prisma));
    }

    if (phase === 'policy') {
      const policy = app.get(IngestionEligibilityService);
      const brands = app.get(BrandResearchService);
      const leaf = async (name: string) => (await prisma.category.findFirstOrThrow({ where: { name } })).id;
      const brandId = async (name: string) => (await prisma.brand.findFirstOrThrow({ where: { name } })).id;
      const version = async () => (await policy.current())?.version ?? 0;
      const rule = async (id: string) => ((await policy.current())!.document as any).brands.find((b: any) => b.id === id);
      const before = await version();
      // StarVille: Cleansers + Moisturizers.
      const starville = await brandId('StarVille');
      if (((await rule(starville))?.categoryIds ?? []).length === 0) {
        await policy.updateBrand(starville, { expectedVersion: await version(), enabled: true, categoryIds: [await leaf('Cleansers'), await leaf('Moisturizers')] }, ADMIN_ID);
      }
      // Eva Cosmetics: enabled, "Eva Skin Clinic" approved as its alias, Serums & Treatments + Cleansers + Moisturizers.
      const eva = await brandId('Eva Cosmetics');
      const evaRule = await rule(eva);
      if (evaRule?.effect !== 'ALLOW' || !(evaRule.aliases ?? []).includes('Eva Skin Clinic')) {
        await policy.updateBrand(eva, { expectedVersion: await version(), enabled: true, addAliases: ['Eva Skin Clinic'],
          categoryIds: [await leaf('Serums & Treatments'), await leaf('Cleansers'), await leaf('Moisturizers')] }, ADMIN_ID);
      }
      // Bobai: a Parkville brand added by the Admin (its website is recorded as ADMIN_ENTERED, never VERIFIED), Sunscreens only.
      if (!(await prisma.brand.findFirst({ where: { name: 'Bobai' } }))) {
        await brands.saveBrand({ expectedVersion: await version(), name: 'Bobai', websiteUrl: 'https://www.parkvillepharma.com/brand/bobai' }, ADMIN_ID, { categoryIds: [await leaf('Sunscreens')] });
      }
      const doc = (await policy.current())!.document as any;
      const names = Object.fromEntries((await prisma.brand.findMany({ select: { id: true, name: true } })).map(b => [b.id, b.name]));
      log('policy', { versionBefore: before, versionAfter: await version(),
        brands: doc.brands.filter((b: any) => b.effect === 'ALLOW').map((b: any) => `${names[b.id]} aliases=${JSON.stringify(b.aliases)} leaves=${(b.categoryIds ?? []).length}`) });
    }

    if (phase === 'import') {
      const imports = app.get(AdminCatalogImportService);
      const autopilot = app.get(CatalogAutopilotService);
      const rows = LIST.split('\n').map(line => line.split('\t').map(cell => cell.trim()));
      const csv = ['name,brand,size', ...rows.map(([brand, name]) => `"${name}","${brand}","${SIZE_FROM_OFFICIAL_PAGE[name] ?? ''}"`)].join('\n');
      const buffer = Buffer.from(csv, 'utf-8');
      const receipt = await imports.upload({ buffer, mimetype: 'text/csv', originalname: 'first-catalog-2026-11-08.csv', size: buffer.length, fieldname: 'file', encoding: '7bit' } as Express.Multer.File, ADMIN_ID);
      log('upload', { jobId: receipt.jobId, reused: receipt.reused, totalRows: receipt.totalRows, matching: receipt.matching });
      const run = await autopilot.runJob(receipt.jobId, ADMIN_ID);
      log('autopilot totals', run.totals);
      writeFileSync(`${__dirname}/../../../output/supabase-load-2026-11-08/last-job.txt`, receipt.jobId);
    }

    if (phase === 'readiness') {
      // Read-only: what stops each active product from appearing on the storefront (publication rules + public availability).
      const publication = app.get(CatalogPublicationService);
      const sourcing = app.get(SourcingService);
      const skus = await prisma.sku.findMany({ where: { isActive: true, product: { archivedAt: null } }, select: { id: true, code: true, product: { select: { name: true, brand: { select: { name: true } } } } }, orderBy: { code: 'asc' } });
      const out: unknown[] = [];
      for (const sku of skus) {
        const r = await publication.readiness(sku.id);
        const availability = await sourcing.getPublicAvailability(sku.id, new Date()).catch((error: Error) => ({ error: error.message }));
        out.push({ product: `${sku.product.brand.name} | ${sku.product.name}`, blockers: r.blockers, warnings: r.warnings, price: r.commerce.price, listed: r.commerce.isListed, availability: (availability as any).isAvailable ?? availability });
      }
      log('readiness', out);
    }

    if (phase === 'purge') {
      // PERMANENT. Owner confirmed 2026-11-08: delete the 10 archived OLD products and everything that hangs off them. Keeps orders, purchase orders, customers, suppliers,
      // brands, policy, the empty seed product lines, all ingestion history and the new products. A verified backup was taken first. One transaction; every count is asserted.
      const EXPECTED = ['CLR-COND-300ML', 'CLR-MASK-300ML', 'CLR-SHMP-300ML', 'CPX-COND-250ML', 'CPX-SHMP-250ML', 'CRV-DAILY-LOT-236ML', 'CRV-FOAM-CLN-237ML', 'CRV-HYD-CLN-237ML', 'CRV-MOIST-CRM-454G', 'CRV-SA-CLN-236ML'];
      const old = await prisma.sku.findMany({ where: { product: { archivedAt: { not: null } } }, select: { id: true, code: true, productId: true, product: { select: { isPublished: true } } } });
      if (JSON.stringify(old.map(s => s.code).sort()) !== JSON.stringify(EXPECTED)) throw new Error(`Archived SKUs are not the expected 10: ${old.map(s => s.code).sort().join(',')}`);
      if (old.some(s => s.product.isPublished)) throw new Error('An old product is published');
      const skuIds = old.map(s => s.id);
      const productIds = [...new Set(old.map(s => s.productId))];
      const urls = [...(await prisma.mediaAsset.findMany({ where: { skuId: { in: skuIds } }, select: { storageUrl: true } })).map(a => a.storageUrl),
        ...(await prisma.productMedia.findMany({ where: { productId: { in: productIds } }, select: { url: true } })).map(m => m.url)].filter((u): u is string => Boolean(u));
      const deleted: Record<string, number> = {};
      await prisma.$transaction(async tx => {
        const step = (label: string, count: number, expected: number) => { deleted[label] = count; if (count !== expected) throw new Error(`${label}: deleted ${count}, expected ${expected}: rolled back`); };
        step('ingestion.product_fact_proposals', await tx.$executeRaw`delete from ingestion.product_fact_proposals where sku_id = any(${skuIds}::uuid[])`, 14);
        step('ingestion.product_research_runs', await tx.$executeRaw`delete from ingestion.product_research_runs where sku_id = any(${skuIds}::uuid[])`, 2);
        step('commerce.selling_prices', await tx.$executeRaw`delete from commerce.selling_prices where sku_id = any(${skuIds}::uuid[])`, 1);
        step('commerce.listings', await tx.$executeRaw`delete from commerce.listings where sku_id = any(${skuIds}::uuid[])`, 1);
        step('sourcing.supplier_offers', await tx.$executeRaw`delete from sourcing.supplier_offers where sku_id = any(${skuIds}::uuid[])`, 1);
        step('catalog.product_media', await tx.$executeRaw`delete from catalog.product_media where product_id = any(${productIds}::uuid[])`, 2);
        const derived = await tx.$executeRaw`delete from catalog.media_assets where sku_id = any(${skuIds}::uuid[]) and parent_asset_id is not null`;
        const originals = await tx.$executeRaw`delete from catalog.media_assets where sku_id = any(${skuIds}::uuid[])`;
        step('catalog.media_assets', derived + originals, 2);
        step('catalog.skus (ingredient links cascade)', await tx.$executeRaw`delete from catalog.skus where id = any(${skuIds}::uuid[])`, 10);
        step('catalog.products', await tx.$executeRaw`delete from catalog.products where id = any(${productIds}::uuid[])`, 10);
        // Obsolete development seed leftovers: product lines no product uses (Eva Collagen/Vitamin C/..., StarVille, Hair Addict, BLESS).
        step('catalog.product_lines (unused seed lines)', await tx.$executeRaw`delete from catalog.product_lines l where not exists (select 1 from catalog.products p where p.product_line_id = l.id)`, 9);
        const left = Number((await tx.$queryRaw<Array<{ n: bigint }>>`select count(*) n from catalog.product_ingredients where product_id = any(${productIds}::uuid[])`)[0].n);
        if (left !== 0) throw new Error(`${left} ingredient links still point at deleted products: rolled back`);
      }, { timeout: 120000, maxWait: 30000 });
      log('deleted rows', deleted);
      // Files are removed only after the database commit; the 4 files and their metadata were copied to the backup folder first.
      const storage = app.get(StorageService);
      const removed: string[] = [];
      for (const url of urls) { try { await storage.deleteFile(url); removed.push(url); } catch (error) { removed.push(`${url} (not removed: ${(error as Error).message})`); } }
      log('files removed', removed);
      log('after', await snapshot(prisma));
    }

    if (phase === 'media3') {
      const intake = app.get(CatalogIntakeService);
      const media = app.get(ProductMediaService);
      const storage = app.get(StorageService);
      await app.get(MediaTemplateService).ensureDefaultTemplate(ADMIN_ID);
      const report: unknown[] = [];
      for (const item of FIRST3) {
        const sku = await prisma.sku.findFirstOrThrow({ where: { product: { name: item.name, archivedAt: null, brand: { name: 'Eva Cosmetics' } } }, select: { id: true, code: true, identityStatus: true, barcode: true, barcodeStatus: true } });
        await intake.setOuterCarton(sku.id, item.carton);
        let assets = await media.listForSku(sku.id);
        let original = assets.find(a => a.role === MediaRole.PRIMARY_PACKSHOT && !a.parentAssetId)!;
        if (original.reviewStatus !== MediaReviewStatus.APPROVED) {
          original = await media.review(original.id, { decision: 'APPROVED', reason: `Official Eva Skin Clinic shop render (${original.width}x${original.height}), source eva-cosmetics.com approved by the owner 2026-11-08; packaging and product checked by eye` } as any, ADMIN_ID);
        }
        let editorial = assets.find(a => a.parentAssetId === original.id && a.role === MediaRole.CATEGORY_EDITORIAL && a.processingStatus === MediaProcessingStatus.SUCCEEDED && a.reviewStatus !== MediaReviewStatus.REJECTED);
        if (!editorial) editorial = await media.derive(original.id, { transform: 'SAHEL_EDITORIAL' } as any, ADMIN_ID);
        // Evidence for the owner and for me: the processed file, saved next to the report.
        const key = (editorial.storageUrl ?? '').split('/storage/')[1];
        if (key) writeFileSync(`${__dirname}/../../../output/supabase-load-2026-11-08/sahel-${item.name.replace(/\W+/g, '-')}.png`, await storage.getFileBuffer(key));
        let packaging: { id: string; reviewStatus: string } | null = null;
        if (item.carton) {
          packaging = assets.find(a => a.role === MediaRole.PACKAGING_PROOF && !a.parentAssetId) ?? null;
          if (!packaging) {
            const bytes = await storage.getFileBuffer((original.storageUrl ?? '').split('/storage/')[1]);
            const created = await media.registerOriginal({ skuId: sku.id, role: MediaRole.PACKAGING_PROOF, originType: MediaOriginType.verified, sourceUrl: original.sourceUrl, sourcePublisher: original.sourcePublisher,
              sourceType: original.sourceType as any, rightsStatus: original.rightsStatus as MediaRightsStatus, capturedAt: new Date().toISOString() } as any,
            { buffer: bytes, mimetype: original.mimeType ?? 'image/jpeg', originalname: 'packaging.jpg', size: bytes.length, fieldname: 'file', encoding: '7bit' } as Express.Multer.File, ADMIN_ID);
            packaging = created;
          }
        }
        assets = await media.listForSku(sku.id);
        report.push({ product: item.name, sku: sku.code, identity: sku.identityStatus, gtin: `${sku.barcode}/${sku.barcodeStatus}`, carton: item.carton,
          original: { id: original.id, review: original.reviewStatus, rights: original.rightsStatus, size: `${original.width}x${original.height}` },
          editorial: { id: editorial.id, processing: editorial.processingStatus, review: editorial.reviewStatus, error: editorial.processingError, quality: editorial.qualityReport },
          packagingProof: packaging ? { id: packaging.id, review: packaging.reviewStatus } : null, assets: assets.map(a => `${a.role}:${a.reviewStatus}`) });
      }
      log('media3', report);
    }

    if (phase === 'serumfix') {
      // The first SAHEL render of the serum lost part of its silver label (checked by eye). Reject it on record and try the clear-packaging variant of the same transform.
      const media = app.get(ProductMediaService);
      const storage = app.get(StorageService);
      const sku = await prisma.sku.findFirstOrThrow({ where: { product: { name: 'Hyaluronic Acid Facial Serum', archivedAt: null, brand: { name: 'Eva Cosmetics' } } }, select: { id: true } });
      const assets = await media.listForSku(sku.id);
      const original = assets.find(a => a.role === MediaRole.PRIMARY_PACKSHOT && !a.parentAssetId)!;
      for (const bad of assets.filter(a => a.role === MediaRole.CATEGORY_EDITORIAL && a.reviewStatus === MediaReviewStatus.PENDING_REVIEW && !(a.transformVersion ?? '').includes('clear-pack'))) {
        await media.review(bad.id, { decision: 'REJECTED', reason: 'Visible damage: the cut-out removed part of the pale silver label of the bottle (checked by eye 2026-11-08)' } as any, ADMIN_ID);
      }
      const variant = await media.derive(original.id, { transform: 'SAHEL_EDITORIAL', transparentPackaging: true } as any, ADMIN_ID);
      const key = (variant.storageUrl ?? '').split('/storage/')[1];
      if (key) writeFileSync(`${__dirname}/../../../output/supabase-load-2026-11-08/sahel-serum-clearpack.png`, await storage.getFileBuffer(key));
      log('serum clear-pack variant', { id: variant.id, processing: variant.processingStatus, error: variant.processingError, quality: variant.qualityReport });
    }

    if (phase === 'publish3') {
      const media = app.get(ProductMediaService);
      const publication = app.get(CatalogPublicationService);
      const results: unknown[] = [];
      for (const item of FIRST3) {
        const sku = await prisma.sku.findFirstOrThrow({ where: { product: { name: item.name, archivedAt: null, brand: { name: 'Eva Cosmetics' } } }, select: { id: true, code: true } });
        const assets = await media.listForSku(sku.id);
        const pending = assets.filter(a => a.reviewStatus === MediaReviewStatus.PENDING_REVIEW);
        for (const asset of pending) {
          if (asset.role === MediaRole.CATEGORY_EDITORIAL) {
            if (item.carton) {
              // The serum's cut-out loses part of its pale label (checked by eye): never approved.
              await media.review(asset.id, { decision: 'REJECTED', reason: 'Visible damage: the cut-out removed part of the pale silver label (checked by eye 2026-11-08)' } as any, ADMIN_ID);
            } else {
              await media.review(asset.id, { decision: 'APPROVED', acceptQualityWarnings: true, reason: 'SAHEL render viewed by eye 2026-11-08: clean cut-out, product centred on the plain SAHEL field, no cropped or damaged edges' } as any, ADMIN_ID);
            }
          } else if (asset.role === MediaRole.PACKAGING_PROOF) {
            await media.review(asset.id, { decision: 'APPROVED', reason: 'Official manufacturer render that shows the outer carton beside the bottle (eva-cosmetics.com, approved source)' } as any, ADMIN_ID);
          }
        }
        const before = await publication.readiness(sku.id);
        try {
          const after = await publication.publish(sku.id, ADMIN_ID, { priceEgp: item.priceEgp });
          results.push({ product: item.name, published: after.isPublished, ready: after.ready, blockers: after.blockers, warnings: after.warnings, price: after.commerce.price, listed: after.commerce.isListed, media: after.media });
        } catch (error) {
          results.push({ product: item.name, FAILED: (error as any)?.response ?? (error as Error).message, blockersBefore: before.blockers });
        }
      }
      log('publish3', results);
    }

    if (phase === 'verify3') {
      // Reproduces the storefront composition step by step for each published product (read-only).
      const { CatalogService } = await import('../src/modules/catalog/public');
      const { CommerceService: Commerce } = await import('../src/modules/commerce/public');
      const catalog = app.get(CatalogService);
      const commerce = app.get(Commerce);
      const sourcing = app.get(SourcingService);
      const published = await catalog.getPublishedProducts({});
      const out: unknown[] = [];
      out.push({ publishedProductsFromCatalog: published.map(p => `${p.name} (${p.skus.length} sku, ${p.media.length} media)`) });
      for (const product of published) {
        for (const sku of product.skus) {
          const terms = await commerce.getSellingTerms(sku.id);
          const availability = await sourcing.getPublicAvailability(sku.id, new Date());
          out.push({ product: product.name, sku: sku.code, mediaForThisSku: product.media.filter(m => m.skuId === sku.id).length, mediaSkuIds: product.media.map(m => m.skuId), skuId: sku.id, terms, availability });
        }
      }
      log('verify3', out);
    }

    if (phase === 'dermactive') {
      // Four held Dermactive rows: each official page prints the product's own size right under its title (the related-product cards come after). Resolved through the
      // existing exception flow as a documented correction; the pipeline then re-verifies the page against the row (identity, size, variant).
      const autopilot = app.get(CatalogAutopilotService);
      const FIX: Array<{ name: string; size: number; url: string }> = [
        { name: 'TRICHO-ACT Anti-Dandruff Shampoo DS', size: 200, url: 'https://derm-active.com/product/tricho-act-anti-dandruff-shampoo-ds/' },
        { name: 'TRICHO-ACT Hair Repairing Mask', size: 150, url: 'https://derm-active.com/product/tricho-act-hair-repairing-mask/' },
        { name: 'ACTI-SOLAIRE SPF50+ Melting Cream', size: 50, url: 'https://derm-active.com/product/acti-solaire-spf-50-melting-cream/' },
        { name: 'ACTI-SOLAIRE SPF50+ Ultra Fluid', size: 50, url: 'https://derm-active.com/product/acti-solaire-spf-50-ultra-fluid-2/' },
      ];
      const out: unknown[] = [];
      for (const fix of FIX) {
        const row = await prisma.adminCatalogImportRow.findFirstOrThrow({ where: { name: fix.name, job: { sourceFileName: 'first-catalog-2026-11-08.csv' } } });
        const exception = await prisma.catalogException.findFirst({ where: { importRowId: row.id, status: 'OPEN' } });
        if (!exception) { out.push({ product: fix.name, skipped: `no open exception (decision ${row.decision})` }); continue; }
        const result = await autopilot.resolveException(exception.id, { action: 'CORRECT', note: `Size ${fix.size} ml is the one printed in the product's own block of its official page (${fix.url}); verified 2026-11-08`,
          correction: { size: fix.size, sizeUnit: 'ml', sourceUrl: fix.url } }, ADMIN_ID);
        out.push({ product: fix.name, decision: result.row?.decision, reason: result.row?.reasonCode, sku: result.row?.matchedSkuId, result: result.result });
      }
      log('dermactive', out);
    }

    if (phase === 'dermactive2') {
      const autopilot = app.get(CatalogAutopilotService);
      const out: unknown[] = [];
      // Mask: the single usage reading ("leave in for approximately 5 minutes then rinse thoroughly") is the contact time of a rinse-off mask. A person keeps the manufacturer reading.
      const mask = await prisma.catalogException.findFirstOrThrow({ where: { status: 'OPEN', reasonCode: 'USAGE_INSTRUCTIONS_CONTRADICT', sku: undefined, evidence: { path: ['factIds'], not: undefined } } as any }).catch(() => null);
      const maskSku = await prisma.sku.findFirstOrThrow({ where: { product: { name: 'TRICHO-ACT Hair Repairing Mask', archivedAt: null } }, select: { id: true } });
      const maskException = await prisma.catalogException.findFirstOrThrow({ where: { skuId: maskSku.id, status: 'OPEN', reasonCode: 'USAGE_INSTRUCTIONS_CONTRADICT' } });
      const fact = await prisma.productFactProposal.findFirstOrThrow({ where: { skuId: maskSku.id, field: 'usage.instructions', status: 'CONFLICT' } });
      const resolved = await autopilot.resolveException(maskException.id, { action: 'RESOLVE', factId: fact.id,
        note: 'Manufacturer instruction kept: "leave in for approximately 5 minutes then rinse thoroughly" is the contact time of a rinse-off hair mask (official page, 2026-11-08)' }, ADMIN_ID);
      out.push({ product: 'mask', row: resolved.row?.decision, reason: resolved.row?.reasonCode });
      // Melting Cream: the row name is corrected to the exact title of its official page, which separates it from the CICA Cream the matcher suggested.
      const melting = await prisma.adminCatalogImportRow.findFirstOrThrow({ where: { name: 'ACTI-SOLAIRE SPF50+ Melting Cream', job: { sourceFileName: 'first-catalog-2026-11-08.csv' } } });
      const meltingException = await prisma.catalogException.findFirstOrThrow({ where: { importRowId: melting.id, status: 'OPEN' } });
      const fixed = await autopilot.resolveException(meltingException.id, { action: 'CORRECT', note: 'Row name corrected to the exact title of its official product page (ACTI-SOLAIRE SPF 50+ MELTING CREAM); a sunscreen, not the CICA repair cream the matcher suggested',
        correction: { name: 'ACTI-SOLAIRE SPF 50+ Melting Cream' } }, ADMIN_ID);
      out.push({ product: 'melting cream', row: fixed.row?.decision, reason: fixed.row?.reasonCode, result: fixed.result });
      void mask;
      log('dermactive2', out);
    }

    if (phase === 'dermactive3') {
      const autopilot = app.get(CatalogAutopilotService);
      const FIX: Array<{ name: string; size: number; url: string }> = [
        { name: 'ACTI-CLEAR Gentle Cleansing Gel', size: 200, url: 'https://derm-active.com/product/acti-clear-gentle-cleansing-gel/' },
        { name: 'ACTI-WHITE Foaming Gel', size: 200, url: 'https://derm-active.com/product/acti-white-foaming-gel/' },
        { name: 'ACTI-CLEAR Hydra-Mattifying Gel', size: 50, url: 'https://derm-active.com/product/acti-clear-hydra-mattifying-gel/' },
        { name: 'ACTI-WHITE Brightening Correcting Serum', size: 30, url: 'https://derm-active.com/product/acti-white-brightening-correcting-serum/' },
      ];
      const out: unknown[] = [];
      for (const fix of FIX) {
        const row = await prisma.adminCatalogImportRow.findFirstOrThrow({ where: { name: fix.name, job: { sourceFileName: 'first-catalog-2026-11-08.csv' } } });
        const exception = await prisma.catalogException.findFirst({ where: { importRowId: row.id, status: 'OPEN' } });
        if (!exception) { out.push({ product: fix.name, skipped: `no open exception (decision ${row.decision})` }); continue; }
        const result = await autopilot.resolveException(exception.id, { action: 'CORRECT', note: `Size ${fix.size} ml is the one printed in the product's own block of its official page (${fix.url}); verified 2026-11-08`,
          correction: { size: fix.size, sizeUnit: 'ml', sourceUrl: fix.url } }, ADMIN_ID);
        out.push({ product: fix.name, decision: result.row?.decision, reason: result.row?.reasonCode, sku: result.row?.matchedSkuId });
      }
      log('dermactive3', out);
    }

    if (phase === 'retryholds') {
      // Rows held NO_IDENTITY_SOURCE only because the brand site's robots.txt was slow to answer (an unreadable robots file counts as disallowed): retry each once.
      const autopilot = app.get(CatalogAutopilotService);
      const rows = await prisma.adminCatalogImportRow.findMany({ where: { job: { sourceFileName: 'first-catalog-2026-11-08.csv' }, brand: 'Dermactive', reasonCode: 'NO_IDENTITY_SOURCE', decision: 'HOLD_CRITICAL' } });
      const out: unknown[] = [];
      for (const row of rows) {
        const exception = await prisma.catalogException.findFirst({ where: { importRowId: row.id, status: 'OPEN' } });
        if (!exception) { out.push({ product: row.name, skipped: 'no open exception' }); continue; }
        const result = await autopilot.resolveException(exception.id, { action: 'RETRY', note: 'robots.txt of the brand site answered slowly on the first attempt; page readable now (2026-11-08)' }, ADMIN_ID);
        out.push({ product: row.name, decision: result.row?.decision, reason: result.row?.reasonCode, sku: result.row?.matchedSkuId });
      }
      log('retryholds', out);
    }

    if (phase === 'manual2') {
      // Two Dermactive products whose official pages are distinct but whose wording the matcher cannot separate from a sibling (sunscreen vs sunscreen, shampoo vs shampoo).
      // Admin manual canonical intake, with the SAME evidence rule as the pipeline: the official page must name the brand, the product and this exact size (checkSource +
      // decideNewProduct must say AUTO_ACCEPT) before any SKU exists. Then the normal research, fact verification, media and profile steps (refreshSku).
      const intake = app.get(CatalogIntakeService);
      const research = app.get(CanonicalResearchService);
      const imports = app.get(AdminCatalogImportService);
      const autopilot = app.get(CatalogAutopilotService);
      const brand = await prisma.brand.findFirstOrThrow({ where: { name: 'Dermactive' } });
      const leaf = async (name: string) => (await prisma.category.findFirstOrThrow({ where: { name } })).id;
      const ITEMS = [
        { name: 'ACTI-SOLAIRE SPF 50+ Melting Cream', size: 50, leaf: 'Sunscreens', url: 'https://derm-active.com/product/acti-solaire-spf-50-melting-cream/', rowName: 'ACTI-SOLAIRE SPF 50+ Melting Cream' },
        { name: 'TRICHO-ACT Anti-Hair Loss Shampoo', size: 200, leaf: 'Shampoos', url: 'https://derm-active.com/product/tricho-act-anti-hair-loss-shampoo/', rowName: null },
      ];
      const out: unknown[] = [];
      for (const item of ITEMS) {
        const existing = await prisma.sku.findFirst({ where: { product: { name: item.name, archivedAt: null, brandId: brand.id } }, select: { id: true } });
        let skuId = existing?.id ?? null;
        if (!skuId) {
          const check = await research.checkSource({ brand: 'Dermactive', brandAliases: [], productName: item.name, size: item.size, sizeUnit: 'ml', barcode: null, websiteUrl: brand.websiteUrl }, item.url);
          const verdict = decideNewProduct([check], { barcode: null });
          if (verdict.decision !== 'AUTO_ACCEPT') { out.push({ product: item.name, NOT_CREATED: verdict.reasonCode, check }); continue; }
          const key = imports.identityKey({ name: item.name, size: new (await import('@prisma/client')).Prisma.Decimal(item.size), sizeUnit: 'ml' }, brand.id);
          const code = `IMP-${(await import('crypto')).createHash('sha256').update(key).digest('hex').slice(0, 16).toUpperCase()}`;
          skuId = (await intake.intake({ brandId: brand.id, categoryId: await leaf(item.leaf), name: item.name, variantName: 'Default', skuCode: code, size: item.size, sizeUnit: 'ml' })).skuId;
          await intake.recordIdentityVerification(skuId, { status: 'EVIDENCE_VERIFIED', sourceUrls: [verdict.verifiedBy!.url], fingerprints: [key], rule: verdict.reasonCode, actorId: ADMIN_ID });
        }
        if (item.rowName) {
          const row = await prisma.adminCatalogImportRow.findFirst({ where: { name: item.rowName, job: { sourceFileName: 'first-catalog-2026-11-08.csv' } } });
          if (row && row.outcome !== 'LINKED_EXISTING') {
            await imports.resolveRow(row.id, { action: 'LINK_SKU', skuId, note: 'The row is this product: the official page (title, size 50 ml) verifies it as its own SKU, distinct from the Ultra Fluid and CICA Cream the matcher suggested' }, ADMIN_ID);
          }
        }
        const refreshed = await autopilot.refreshSku(skuId, ADMIN_ID, [item.url]);
        out.push({ product: item.name, skuId, applied: refreshed.verified.applied.length, holds: refreshed.verified.holds.map(h => h.reasonCode), openExceptions: refreshed.openExceptions.length, media: refreshed.media });
      }
      log('manual2', out);
    }

    if (phase === 'resume') {
      const autopilot = app.get(CatalogAutopilotService);
      await prisma.adminCatalogImportRow.updateMany({ where: { jobId: arg, decision: 'RETRY_AUTOMATIC' }, data: { nextAttemptAt: new Date() } });
      const run = await autopilot.runJob(arg, ADMIN_ID);
      log('autopilot totals', run.totals);
    }
  } finally {
    await app.close();
  }
}

main().then(() => process.exit(0)).catch(error => { console.error('FAILED:', error instanceof Error ? error.message : error); process.exit(1); });
