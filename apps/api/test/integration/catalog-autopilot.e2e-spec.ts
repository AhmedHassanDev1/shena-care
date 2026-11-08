/* eslint-disable @typescript-eslint/no-explicit-any -- HTTP response bodies are asserted structurally */
process.env.SOURCING_MODE = 'BROADCAST_ON_DEMAND';
process.env.RESEARCH_ALLOWED_HOSTS = 'distributor.example';
process.env.MEDIA_TRUSTED_SOURCE_HOSTS = 'distributor.example,cerave.example';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { RESEARCH_TRANSPORT, ResearchTransport } from '../../src/modules/ingestion/public';
import { ResearchSourceFetcher } from '../../src/modules/ingestion/services/research-source-fetcher';
import { IngestionEligibilityService } from '../../src/modules/ingestion/services/ingestion-eligibility.service';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AiClient } from '../../src/platform/ai';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { createActor, Actor } from '../fixtures/actors';

/** EAN-13 with a correct check digit. */
const ean13 = (body: string) => `${body}${(10 - body.split('').reverse().reduce((t, d, i) => t + Number(d) * (i % 2 === 0 ? 3 : 1), 0) % 10) % 10}`;
const run = randomUUID().slice(0, 6).replace(/[0-9]/g, c => 'abcdefghij'[Number(c)]);

/** Recorded websites: the real fetcher, its host, robots and size guards and the real extractor run; only the network is replaced. */
class RecordedSite implements ResearchTransport {
  pages = new Map<string, { status: number; body?: string | Buffer; type?: string }>();
  failing = new Map<string, number>();
  async resolve() { return ['93.184.216.34']; }
  async get(url: string) {
    const left = this.failing.get(url) ?? 0;
    if (left > 0) { this.failing.set(url, left - 1); throw new Error('connection reset'); }
    if (url.endsWith('/robots.txt')) return this.respond({ status: 404 });
    return this.respond(this.pages.get(url) ?? { status: 404 });
  }
  private respond(page: { status: number; body?: string | Buffer; type?: string }) {
    return {
      status: page.status,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? page.type ?? 'text/html' : null) },
      arrayBuffer: async () => { const bytes = Buffer.from(page.body ?? ''); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer; },
    };
  }
}

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, '../fixtures/media', name));

describe('Automatic catalog decisions: real HTTP, real PostgreSQL, adversarial lists (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor;
  let customer: Actor;
  const site = new RecordedSite();
  const leaf: Record<string, string> = {};
  const api = () => request(app.getHttpServer());
  const csv = (rows: string[][]) => Buffer.from(rows.map(row => row.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n'), 'utf-8');
  const header = ['Product Name', 'Brand', 'Size', 'Barcode', 'Category', 'URL'];
  const upload = (buffer: Buffer, name = 'list.csv') => api().post('/admin/catalog-imports').set(admin.auth).attach('file', buffer, { filename: name, contentType: 'text/csv' });
  const autopilot = async (jobId: string) => (await api().post(`/catalog/workbench/imports/${jobId}/autopilot`).set(admin.auth).expect(200)).body;
  const rowsOf = async (jobId: string) => (await api().get(`/admin/catalog-imports/${jobId}/rows?limit=500`).set(admin.auth).expect(200)).body.rows as any[];
  const byName = (rows: any[], name: string) => { const row = rows.find(r => r.name === name); if (!row) throw new Error(`no row ${name}`); return row; };
  const openExceptions = async () => (await api().get('/catalog/workbench/exceptions').set(admin.auth).expect(200)).body.items as any[];
  const commerce = async () => ({ offers: await prisma.supplierOffer.count(), listings: await prisma.listing.count(), prices: await prisma.sellingPrice.count(),
    published: await prisma.product.count({ where: { isPublished: true } }), publishedMedia: await prisma.mediaAsset.count({ where: { publishedMediaId: { not: null } } }) });

  const cerave = (slug: string) => `https://www.cerave.example/${run}/${slug}`;
  const dist = (slug: string) => `https://distributor.example/${run}/${slug}`;
  const page = (o: { brand: string; title: string; image?: string; inci?: string; usage?: string; warnings?: string; description?: string; gtin?: string; extra?: string }) => `<html><head><title>${o.title}</title>
    <script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: o.title, brand: { name: o.brand }, ...(o.image && { image: [o.image] }), ...(o.description && { description: o.description }), ...(o.gtin && { gtin13: o.gtin }) })}</script></head>
    <body><h1>${o.title}</h1>${o.inci ? `<h2>Ingredients</h2><p>${o.inci}</p>` : ''}${o.usage ? `<h2>How to use</h2><p>${o.usage}</p>` : ''}${o.warnings ? `<h2>Warnings</h2><p>${o.warnings}</p>` : ''}${o.extra ?? ''}</body></html>`;
  const pack = async (width: number, height: number, color: string, touchEdge = false) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" fill="#ffffff"/><rect x="${Math.round(width * 0.36)}" y="${touchEdge ? 0 : Math.round(height * 0.12)}" width="${Math.round(width * 0.28)}" height="${Math.round(height * (touchEdge ? 0.88 : 0.76))}" rx="18" fill="${color}"/>
    <rect x="${Math.round(width * 0.40)}" y="${Math.round(height * 0.4)}" width="${Math.round(width * 0.2)}" height="${Math.round(height * 0.2)}" fill="#f4f1ea"/></svg>`)).png().toBuffer();
  const INCI = 'AQUA, GLYCERIN, CETEARYL ALCOHOL, CERAMIDE NP, CERAMIDE AP, CERAMIDE EOP, CARBOMER, SODIUM HYALURONATE';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useClass(DeterministicAiClient)
      .overrideProvider(RESEARCH_TRANSPORT).useValue(site).compile();
    app = moduleRef.createNestApplication();
    app.useLogger(false);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    admin = await createActor(prisma, 'ADMIN');
    customer = await createActor(prisma, 'CUSTOMER');

    // Policy v14 shape: brands enabled for exact leaves only; one known brand left disabled.
    const skin = await prisma.category.create({ data: { name: `Skin ${run}`, slug: `skin-${run}` } });
    const hair = await prisma.category.create({ data: { name: `Hair ${run}`, slug: `hair-${run}` } });
    for (const [key, parent] of [['Cleansers', skin.id], ['Moisturizers', skin.id], ['Shampoos', hair.id], ['Conditioners', hair.id]] as const) {
      leaf[key] = (await prisma.category.create({ data: { name: `${key} ${run}`, slug: `${key.toLowerCase()}-${run}`, parentId: parent } })).id;
    }
    const brand = async (name: string, website?: string) => (await prisma.brand.findFirst({ where: { name } })) ?? prisma.brand.create({ data: { name, slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${run}`, websiteUrl: website ?? null } });
    const ceraveBrand = await brand('CeraVe', 'https://www.cerave.example');
    const clary = await brand('Clary Corporation');
    const capixy = await brand('Capixy');
    await brand(`Eva Cosmetics ${run}`);
    const policy = app.get(IngestionEligibilityService);
    const enable = async (id: string, leaves: string[], aliases: string[] = []) =>
      policy.updateBrand(id, { expectedVersion: (await policy.current())?.version ?? 0, enabled: true, categoryIds: leaves, ...(aliases.length && { addAliases: aliases }) }, admin.id);
    await enable(ceraveBrand.id, [leaf.Cleansers, leaf.Moisturizers]);
    await enable(clary.id, [leaf.Shampoos, leaf.Conditioners], ['clary']);
    await enable(capixy.id, [leaf.Shampoos, leaf.Conditioners]);

    const img = (url: string, body: Buffer) => site.pages.set(url, { status: 200, body, type: 'image/png' });
    // CeraVe official pages.
    site.pages.set(cerave('hydrating'), { status: 200, body: page({ brand: 'CeraVe', title: 'CeraVe Hydrating Cleanser 236 ml', image: cerave('img/hydrating.png'), inci: INCI,
      usage: 'Wet skin with lukewarm water. Massage cleanser into skin in a gentle, circular motion. Rinse.', warnings: 'For external use only. Avoid contact with eyes.',
      description: 'A non-foaming daily face cleanser with three essential ceramides and hyaluronic acid for normal to dry skin.' }) });
    img(cerave('img/hydrating.png'), await pack(900, 900, '#2b6cb0'));
    site.pages.set(cerave('hydrating-473'), { status: 200, body: page({ brand: 'CeraVe', title: 'CeraVe Hydrating Cleanser 473 ml', image: cerave('img/hydrating-473.png'), inci: INCI }) });
    img(cerave('img/hydrating-473.png'), await pack(1000, 1000, '#2c5282'));
    site.pages.set(cerave('cream'), { status: 200, body: page({ brand: 'CeraVe', title: 'CeraVe Moisturising Cream 454 g', image: cerave('img/cream.png'), inci: INCI,
      description: 'A rich cream for dry to very dry skin of the face and body.' }) });
    img(cerave('img/cream.png'), await pack(300, 340, '#3182ce'));
    site.pages.set(cerave('cream-340'), { status: 200, body: page({ brand: 'CeraVe', title: 'CeraVe Moisturising Cream 340 g', inci: INCI }) });
    site.pages.set(cerave('sa'), { status: 200, body: page({ brand: 'CeraVe', title: 'CeraVe SA Smoothing Cleanser 473 ml', inci: INCI }) });
    site.pages.set(cerave('foaming'), { status: 200, body: page({ brand: 'CeraVe', title: 'CeraVe Foaming Cleanser 236 ml', gtin: '3337875597210', inci: INCI }) });
    site.pages.set(cerave('lotion'), { status: 200, body: page({ brand: 'CeraVe', title: 'CeraVe Moisturising Lotion 236 ml', image: cerave('img/lotion.png'), inci: INCI,
      description: 'A lightweight fragrance-free lotion for the face and body.' , extra: '' }) });
    img(cerave('img/lotion.png'), await pack(800, 800, '#1a365d', true));
    // Clary and Capixy through their authorised distributor, with the real product photographs that broke the old compositor.
    site.pages.set(dist('clary-conditioner'), { status: 200, body: page({ brand: 'Clary', title: 'Clary Hair Conditioner 300ml', image: dist('img/clary-conditioner.png'),
      usage: 'Apply to wet hair after shampooing, massage gently and rinse thoroughly with water.', description: 'Conditioner with Procapil for dry and damaged hair.' }) });
    img(dist('img/clary-conditioner.png'), fixture('clary-conditioner-300ml.png'));
    site.pages.set(dist('capixy-conditioner'), { status: 200, body: page({ brand: 'Capixy', title: 'Capixy Hair Hydrating Conditioner 250ml', image: dist('img/capixy-conditioner.png'),
      inci: 'AQUA, CETEARYL ALCOHOL, BEHENTRIMONIUM CHLORIDE, PARFUM, MENTHA PIPERITA OIL, PANTHENOL', usage: 'Apply after shampoo, leave for 2 minutes, then rinse well.',
      description: 'Anti hair loss treatment that stops hair loss and regrows hair.', extra: '<p>Fragrance-free formula.</p>' }) });
    img(dist('img/capixy-conditioner.png'), fixture('capixy-hydrating-conditioner-250ml.png'));
    // The same photograph published on a second product's page: identity proof cannot be reused.
    site.pages.set(dist('capixy-shampoo'), { status: 200, body: page({ brand: 'Capixy', title: 'Capixy Shampoo 250ml', image: dist('img/capixy-conditioner.png') }) });
    // Another seller's page and an unreachable official page.
    site.pages.set(`https://shop.example/${run}/clary-mask`, { status: 200, body: page({ brand: 'Clary', title: 'Clary Hair Mask 300ml' }) });
    app.get(ResearchSourceFetcher).reset();
  }, 180000);

  afterAll(async () => { await app.close(); });

  const N = {
    hydrating: 'CeraVe Hydrating Cleanser 236ml', hydratingBig: 'CeraVe Hydrating Cleanser 473ml', cream: 'CeraVe Moisturising Cream 454g', sa: 'CeraVe SA Smoothing Cleanser 236ml',
    foaming: 'CeraVe Foaming Cleanser 236ml', lotion: 'CeraVe Moisturising Lotion 236ml', claryConditioner: 'Clary Hair Conditioner 300ml', capixyConditioner: 'Capixy Hair Hydrating Conditioner 250ml',
    capixyShampoo: 'Capixy Shampoo 250ml', claryMask: 'Clary Hair Mask 300ml', claryShampoo: 'Clary Hair Shampoo 300ml', eva: `Eva Gentle Wash ${run} 100ml`,
    ceraveShampoo: 'CeraVe Anti-Dandruff Shampoo 250ml', unknown: `Zorblax Night Serum ${run} 30ml`, misspelt: 'Capixxy Shampoo 250ml',
  };
  const firstList = () => csv([header,
    [N.hydrating, 'Cerave', '236 ml', '', 'Cleansers ' + run, cerave('hydrating')],
    [N.hydrating, 'CeraVe', '236 ml', '', 'Cleansers ' + run, ''], // same product twice in one file
    [N.hydratingBig, 'CeraVe', '473 ml', '', 'Cleansers ' + run, cerave('hydrating-473')], // another size of the same product
    [N.cream, 'CeraVe', '454 g', '', 'Moisturizers ' + run, cerave('cream')], // official image too small
    [N.sa, 'CeraVe', '236 ml', '', 'Cleansers ' + run, cerave('sa')], // page states another size
    [N.foaming, 'CeraVe', '236 ml', ean13('622400807366'), 'Cleansers ' + run, cerave('foaming')], // stated barcode vs manufacturer GTIN
    [N.lotion, 'CeraVe', '236 ml', '', 'Moisturizers ' + run, cerave('lotion')], // image that cannot be composed cleanly
    [N.claryConditioner, 'clary', '300 ml', '6224008073667', 'Conditioners ' + run, dist('clary-conditioner')], // alias brand + merchant code in barcode column
    [N.capixyConditioner, 'capixy', '250 ml', '', 'Conditioners ' + run, dist('capixy-conditioner')], // medical description, fragrance claim vs INCI
    [N.capixyShampoo, 'Capixy', '250 ml', '', 'Shampoos ' + run, dist('capixy-shampoo')], // reused photograph
    [N.claryMask, 'Clary Corporation', '300 ml', '', 'Conditioners ' + run, `https://shop.example/${run}/clary-mask`], // untrusted fallback only
    [N.claryShampoo, 'Clary Corporation', '300 ml', '', 'Shampoos ' + run, dist('clary-shampoo-missing')], // unavailable page
    [N.eva, `Eva Cosmetics ${run}`, '100 ml', '', 'Cleansers ' + run, ''], // brand known but not allowed
    [N.ceraveShampoo, 'CeraVe', '250 ml', '', 'Shampoos ' + run, ''], // leaf not allowed for this brand
    [N.unknown, 'Zorblax', '30 ml', '', 'Cleansers ' + run, ''], // brand not on the allowlist
    [N.misspelt, 'Capixxy', '250 ml', '', 'Shampoos ' + run, ''], // probable misspelling of an allowed brand
  ]);

  let firstJob: string;

  it('is Admin-only', async () => {
    await api().post(`/catalog/workbench/imports/${randomUUID()}/autopilot`).set(customer.auth).expect(403);
    await api().get('/catalog/workbench/exceptions').set(customer.auth).expect(403);
    await api().get('/catalog/workbench/exceptions').expect(401);
  });

  it('decides every row of an adversarial list: zero clicks for normal products, holds only real risks, never invents commerce', async () => {
    const before = await commerce();
    const products = await prisma.product.count();
    const upload1 = (await upload(firstList(), 'first.csv').expect(201)).body;
    firstJob = upload1.jobId;
    const result = await autopilot(firstJob);
    const rows = await rowsOf(firstJob);
    const decision = (name: string) => byName(rows, name).decision;
    const reason = (name: string) => byName(rows, name).reasonCode;

    // Every row ends in exactly one of the five states.
    expect(rows.every(row => ['AUTO_ACCEPT', 'AUTO_LINK', 'SKIP', 'HOLD_CRITICAL', 'RETRY_AUTOMATIC'].includes(row.decision))).toBe(true);
    expect(result.totals.UNDECIDED).toBe(0);

    // Normal products: verified by the official or distributor page, no barcode needed, no clicks.
    for (const name of [N.hydrating, N.hydratingBig, N.cream, N.lotion, N.claryConditioner, N.capixyConditioner, N.capixyShampoo]) expect([name, decision(name)]).toEqual([name, 'AUTO_ACCEPT']);
    // The repeated row links to the product its first row created.
    const dupes = rows.filter(row => row.name === N.hydrating);
    expect(dupes.map(row => row.decision).sort()).toEqual(['AUTO_ACCEPT', 'AUTO_LINK']);
    expect(new Set(dupes.map(row => row.matchedSkuId)).size).toBe(1);

    // Deterministic policy skips: no person.
    expect([decision(N.eva), reason(N.eva)]).toEqual(['SKIP', 'POLICY_BRAND_NOT_ALLOWED']);
    expect([decision(N.ceraveShampoo), reason(N.ceraveShampoo)]).toEqual(['SKIP', 'POLICY_CATEGORY_NOT_ALLOWED_FOR_BRAND']);
    // A brand the catalog does not hold is looked up, not skipped (owner decision 2026-11-07); with no official site found it is one hold, and no brand is created.
    expect([decision(N.unknown), reason(N.unknown)]).toEqual(['HOLD_CRITICAL', 'BRAND_NOT_VERIFIED']);
    expect(await prisma.brand.count({ where: { name: 'Zorblax' } })).toBe(0);

    // Genuine risks: held, with the reason.
    expect([decision(N.sa), reason(N.sa)]).toEqual(['HOLD_CRITICAL', 'SOURCE_CONTRADICTS_IDENTITY']);
    expect([decision(N.foaming), reason(N.foaming)]).toEqual(['HOLD_CRITICAL', 'BARCODE_CONFLICT']);
    expect([decision(N.claryMask), reason(N.claryMask)]).toEqual(['HOLD_CRITICAL', 'SOURCE_NOT_TRUSTED']);
    expect([decision(N.claryShampoo), reason(N.claryShampoo)]).toEqual(['HOLD_CRITICAL', 'NO_IDENTITY_SOURCE']);
    expect([decision(N.misspelt), reason(N.misspelt)]).toEqual(['HOLD_CRITICAL', 'BRAND_SPELLING_UNCONFIRMED']);

    // Held, skipped and contradicted rows created nothing.
    for (const name of [N.sa, N.foaming, N.claryMask, N.claryShampoo, N.eva, N.ceraveShampoo, N.unknown, N.misspelt]) expect(byName(rows, name).matchedSkuId).toBeNull();
    // Another size of the same product is a new SKU under the same product, never merged.
    const small = await prisma.sku.findUniqueOrThrow({ where: { id: byName(rows, N.hydrating).matchedSkuId } });
    const big = await prisma.sku.findUniqueOrThrow({ where: { id: byName(rows, N.hydratingBig).matchedSkuId } });
    expect(small.id).not.toBe(big.id);
    expect(small.productId).toBe(big.productId);
    expect([small.size?.toNumber(), big.size?.toNumber()]).toEqual([236, 473]);
    // Identity verified by evidence; the barcode is honestly unknown, and a merchant code in the barcode column never became a GTIN.
    expect(small).toMatchObject({ identityStatus: 'EVIDENCE_VERIFIED', barcode: null, barcodeStatus: 'UNKNOWN' });
    const claryConditioner = await prisma.sku.findUniqueOrThrow({ where: { id: byName(rows, N.claryConditioner).matchedSkuId } });
    expect(claryConditioner).toMatchObject({ identityStatus: 'EVIDENCE_VERIFIED', barcode: null });
    expect(byName(rows, N.claryConditioner).invalidBarcode).toBe('6224008073667');

    // Nothing commercial was invented and nothing went live.
    expect(await commerce()).toEqual(before);
    expect(await prisma.product.count()).toBe(products + 6);
  }, 300000);

  it('verifies facts field by field: consistent official facts applied with no clicks, contradictions settled by rule, unknown stays unknown', async () => {
    const rows = await rowsOf(firstJob);
    const facts = async (name: string) => prisma.productFactProposal.findMany({ where: { skuId: byName(rows, name).matchedSkuId } });
    const hydrating = await facts(N.hydrating);
    const field = (list: any[], name: string) => list.filter(fact => fact.field === name);
    expect(field(hydrating, 'composition.inci')[0]).toMatchObject({ status: 'APPLIED', verification: 'VERIFIED', decidedBy: 'AUTO' });
    expect(field(hydrating, 'identity.size')[0]).toMatchObject({ status: 'APPLIED', verification: 'VERIFIED' });
    expect(field(hydrating, 'usage.instructions')[0]).toMatchObject({ status: 'APPLIED' });
    expect(field(hydrating, 'identity.name')[0]).toMatchObject({ verification: 'UNVERIFIED', decisionRule: expect.stringContaining('EVIDENCE_ONLY_FIELD') });
    for (const fact of hydrating) expect((fact.evidence as any[])[0]).toMatchObject({ sourceUrl: cerave('hydrating'), sourceTier: 'OFFICIAL_MANUFACTURER', extractor: expect.any(String) });
    const product = await prisma.product.findUniqueOrThrow({ where: { id: (await prisma.sku.findUniqueOrThrow({ where: { id: byName(rows, N.hydrating).matchedSkuId } })).productId } });
    expect(product.usage).toContain('Rinse');
    expect(await prisma.productIngredient.count({ where: { productId: product.id } })).toBeGreaterThanOrEqual(8);
    const run1 = await prisma.productResearchRun.findFirstOrThrow({ where: { skuId: byName(rows, N.hydrating).matchedSkuId }, orderBy: { startedAt: 'desc' } });
    expect((run1.fieldCoverage as any)['composition.inci']).toBe('VERIFIED');
    // Missing information stays unknown, never a negative fact.
    expect((run1.fieldCoverage as any)['composition.activeConcentrations']).toBe('UNKNOWN');

    // Capixy: the ingredient list (parfum) outranks a "fragrance-free" line; treatment claims never reach the description. No person needed.
    const capixy = await facts(N.capixyConditioner);
    expect(field(capixy, 'composition.fragrance').find(f => f.value === 'PRESENT')).toMatchObject({ status: 'APPLIED' });
    expect(field(capixy, 'composition.fragrance').find(f => f.value === 'FREE')).toMatchObject({ status: 'REJECTED', decisionRule: expect.stringContaining('CLAIM_CONTRADICTED_BY_INCI') });
    expect(field(capixy, 'marketing.description')[0]).toMatchObject({ status: 'REJECTED', decisionRule: expect.stringContaining('MEDICAL_CLAIM_NOT_PUBLISHED') });
    const capixyProduct = await prisma.product.findFirstOrThrow({ where: { skus: { some: { id: byName(rows, N.capixyConditioner).matchedSkuId } } } });
    expect(capixyProduct).toMatchObject({ isFragranceFree: false, description: null });
  });

  it('prepares authentic media with no clicks on the clean template; damaged, too-small and reused images are refused with documented causes', async () => {
    const rows = await rowsOf(firstJob);
    const assets = async (name: string) => prisma.mediaAsset.findMany({ where: { skuId: byName(rows, name).matchedSkuId }, orderBy: { createdAt: 'asc' } });
    const template = await prisma.mediaTemplate.findFirstOrThrow({ where: { templateKey: 'sahel-clean', isActive: true } });
    expect(template.rules).toMatchObject({ shadow: { enabled: false }, placement: { centerY: 0.5 }, output: { size: 1254 } });

    for (const name of [N.hydrating, N.claryConditioner, N.capixyConditioner]) {
      const list = await assets(name);
      const original = list.find(asset => asset.role === 'PRIMARY_PACKSHOT');
      const editorial = list.find(asset => asset.role === 'CATEGORY_EDITORIAL');
      expect([name, original?.reviewStatus, original?.reviewedAutomatically]).toEqual([name, 'APPROVED', true]);
      expect([name, editorial?.reviewStatus, editorial?.templateId, editorial?.width, editorial?.height]).toEqual([name, 'APPROVED', template.id, 1254, 1254]);
      // Original and editorial stay distinct records; the original is untouched.
      expect(editorial?.parentAssetId).toBe(original?.id);
      expect(original?.contentHash).not.toBe(editorial?.contentHash);
    }
    // The real Clary source had its cast shadow removed, the real Capixy source kept its cap: both pass the damage checks on the clean template.
    const claryEditorial = (await assets(N.claryConditioner)).find(asset => asset.role === 'CATEGORY_EDITORIAL')!;
    expect((claryEditorial.qualityReport as any).warnings).toContain('SOURCE_SHADOW_REMOVED');
    expect((claryEditorial.qualityReport as any).warnings).not.toContain('DETACHED_PART');

    // A pack cut by the frame: the derivative is rejected automatically, the product is still accepted and keeps its approved original.
    const lotion = await assets(N.lotion);
    expect(lotion.find(asset => asset.role === 'PRIMARY_PACKSHOT')?.reviewStatus).toBe('APPROVED');
    expect(lotion.find(asset => asset.role === 'CATEGORY_EDITORIAL')).toMatchObject({ reviewStatus: 'REJECTED', reviewedAutomatically: true, reviewNote: expect.stringContaining('TOUCHES_IMAGE_EDGE') });
    // Too small to be identity proof: no asset, never upscaled to pass.
    expect(await assets(N.cream)).toHaveLength(0);
    const creamTrail = (await api().get(`/catalog/workbench/decisions/${byName(rows, N.cream).matchedSkuId}`).set(admin.auth).expect(200)).body;
    expect(creamTrail.find((d: any) => d.decision === 'MEDIA_MISSING').evidence.rejectedSources[0].reason).toMatch(/^RESOLUTION_TOO_LOW/);
    // The same photograph on another product's page is not accepted as that product's proof.
    expect((await assets(N.capixyShampoo)).filter(asset => asset.role === 'PRIMARY_PACKSHOT')).toHaveLength(0);
    // Nothing was published.
    expect(await prisma.mediaAsset.count({ where: { skuId: { in: rows.map(r => r.matchedSkuId).filter(Boolean) }, publishedMediaId: { not: null } } })).toBe(0);
  });

  it('separates verification from publication: verified products are not sellable without commercial data, a barcode is a warning, not a blocker', async () => {
    const rows = await rowsOf(firstJob);
    const readiness = (await api().get(`/catalog/workbench/skus/${byName(rows, N.claryConditioner).matchedSkuId}/readiness`).set(admin.auth).expect(200)).body;
    expect(readiness.identity).toMatchObject({ status: 'EVIDENCE_VERIFIED', barcodeStatus: 'UNKNOWN' });
    expect(readiness.blockers).not.toContain('IDENTITY_NOT_VERIFIED');
    expect(readiness.blockers).not.toContain('PRIMARY_PACKSHOT_NOT_APPROVED');
    expect(readiness.blockers).toEqual(expect.arrayContaining(['LISTING_NOT_ACTIVE', 'SELLING_PRICE_MISSING', 'CARTON_DECISION_MISSING']));
    expect(readiness.warnings).toContain('BARCODE_MISSING');
    expect(readiness.isPublished).toBe(false);
    // Publishing without a price or carton decision is refused.
    const refused = await api().post(`/catalog/workbench/skus/${byName(rows, N.claryConditioner).matchedSkuId}/publish`).set(admin.auth).send({});
    expect(refused.status).toBe(409);
  });

  it('shows only critical exceptions, each with evidence, sources and a precomputed resolution, and records an audit trail', async () => {
    const items = await openExceptions();
    const mine = items.filter(item => item.evidence?.row?.name && Object.values(N).includes(item.evidence.row.name));
    expect(mine.map(item => item.evidence.row.name).sort()).toEqual([N.claryMask, N.claryShampoo, N.foaming, N.misspelt, N.sa, N.unknown].sort());
    for (const item of mine) {
      expect(item).toMatchObject({ status: 'OPEN', severity: expect.stringMatching(/^(CRITICAL|HIGH)$/), summary: expect.any(String), recommended: { action: expect.any(String), label: expect.any(String) } });
    }
    const foaming = mine.find(item => item.evidence.row.name === N.foaming);
    expect(foaming.recommended.payload).toMatchObject({ official: '3337875597210', url: cerave('foaming') });
    const spelling = mine.find(item => item.evidence.row.name === N.misspelt);
    expect(spelling.recommended).toMatchObject({ action: 'CORRECT', payload: { correction: { brand: 'Capixy' } } });
    // Normal products produced decisions, never exceptions.
    const rows = await rowsOf(firstJob);
    const trail = (await api().get(`/catalog/workbench/decisions/${byName(rows, N.hydratingBig).id}`).set(admin.auth).expect(200)).body;
    expect(trail.map((d: any) => d.decision)).toEqual(expect.arrayContaining(['SOURCE_AUTO_ACCEPT', 'AUTO_ACCEPT']));
    expect(trail.every((d: any) => d.actorType === 'SYSTEM' && d.ruleVersion === 'autopilot@1')).toBe(true);
    // The audit trail cannot be rewritten.
    await expect(prisma.catalogDecisionRecord.updateMany({ where: { id: trail[0].id }, data: { decision: 'X' } })).rejects.toThrow(/append-only/);
  });

  it('re-import: the same file reuses its job; a new file with the same products links them (no duplicates, no ambiguity), incl. an Arabic misspelt brand', async () => {
    const skus = await prisma.sku.count();
    const again = (await upload(firstList(), 'first.csv').expect(201)).body;
    expect(again).toMatchObject({ jobId: firstJob, reused: true });
    await autopilot(firstJob);
    expect(await prisma.sku.count()).toBe(skus);

    const second = (await upload(csv([header,
      [N.hydrating, 'سيرافى', '236 ml', '', 'Cleansers ' + run, ''], // Arabic brand, misspelt (ى), no URL
      [N.claryConditioner, 'Clary Corporation', '300 ml', '', 'Conditioners ' + run, ''], // canonical name instead of the alias used before
      [N.capixyConditioner, 'capixy', '250 ml', '', 'Conditioners ' + run, dist('capixy-conditioner')],
      ['CeraVe Cleanser', 'CeraVe', '236 ml', '', 'Cleansers ' + run, ''], // generic wording, same size as a known cleanser: never linked silently
      [N.claryConditioner, 'clary', '300 ml', ean13('622400807366'), 'Conditioners ' + run, ''], // alias label + a merchant-style code in the barcode column
      ['CeraVe Moisturising Cream 340g', 'CeraVe', '340 g', '', 'Moisturizers ' + run, cerave('cream-340')], // a new size of a known product, with its page
      ['CeraVe Moisturising Cream 177ml', 'CeraVe', '177 ml', '', 'Moisturizers ' + run, ''], // a new size with no page
    ]), 'second.csv').expect(201)).body;
    await autopilot(second.jobId);
    const rows = await rowsOf(second.jobId);
    const first = await rowsOf(firstJob);
    for (const name of [N.hydrating, N.claryConditioner, N.capixyConditioner]) {
      expect([name, byName(rows, name).decision, byName(rows, name).matchedSkuId]).toEqual([name, 'AUTO_LINK', byName(first, name).matchedSkuId]);
      expect(byName(rows, name).reasonCode).toMatch(/^AUTO_LINK_/);
    }
    expect(byName(rows, 'CeraVe Cleanser').decision).toBe('HOLD_CRITICAL');
    const alias = rows.filter(r => r.name === N.claryConditioner && r.brand === 'clary')[0];
    expect([alias.decision, alias.matchedSkuId]).toEqual(['AUTO_LINK', byName(first, N.claryConditioner).matchedSkuId]);
    // The claimed barcode was not written to the SKU: a list value is a claim, not a verified GTIN.
    expect(await prisma.sku.findUniqueOrThrow({ where: { id: alias.matchedSkuId } })).toMatchObject({ barcode: null, barcodeStatus: 'UNKNOWN' });
    const bigger = byName(rows, 'CeraVe Moisturising Cream 340g');
    expect([bigger.decision, bigger.reasonCode]).toEqual(['AUTO_ACCEPT', 'IDENTITY_VERIFIED_BY_SOURCE']);
    const cream = await prisma.sku.findUniqueOrThrow({ where: { id: byName(first, N.cream).matchedSkuId } });
    const cream340 = await prisma.sku.findUniqueOrThrow({ where: { id: bigger.matchedSkuId } });
    expect([cream340.productId, cream340.size?.toNumber(), cream340.id === cream.id]).toEqual([cream.productId, 340, false]);
    expect([byName(rows, 'CeraVe Moisturising Cream 177ml').decision, byName(rows, 'CeraVe Moisturising Cream 177ml').reasonCode]).toEqual(['HOLD_CRITICAL', 'NO_IDENTITY_SOURCE']);
    expect(byName(rows, 'CeraVe Cleanser').matchedSkuId).toBeNull();
    expect(await prisma.sku.count()).toBe(skus + 1); // only the verified 340 g size
    // Facts confirmed earlier are preserved, not reset or duplicated.
    const sku = byName(first, N.hydrating).matchedSkuId;
    expect(await prisma.productFactProposal.count({ where: { skuId: sku, field: 'composition.inci', status: 'APPLIED' } })).toBe(1);
  }, 180000);

  it('concurrent imports of one new product create exactly one SKU', async () => {
    site.pages.set(cerave('night'), { status: 200, body: page({ brand: 'CeraVe', title: 'CeraVe Skin Renewing Night Cream 48 g', inci: INCI }) });
    const name = 'CeraVe Skin Renewing Night Cream 48g';
    const files = [0, 1, 2].map(i => csv([header, [name, 'CeraVe', '48 g', '', 'Moisturizers ' + run, cerave('night')], [`Filler ${i} ${run}`, 'Zorblax', '1 ml', '', '', '']]));
    const jobs = await Promise.all(files.map((file, i) => upload(file, `concurrent-${i}.csv`).then(res => res.body.jobId as string)));
    await Promise.all(jobs.map(jobId => api().post(`/catalog/workbench/imports/${jobId}/autopilot`).set(admin.auth)));
    for (const jobId of jobs) await autopilot(jobId); // settle any row that lost a lease race
    const decided = (await Promise.all(jobs.map(rowsOf))).flat().filter(row => row.name === name);
    expect(decided.map(row => row.decision).sort()).toEqual(['AUTO_ACCEPT', 'AUTO_LINK', 'AUTO_LINK']);
    expect(new Set(decided.map(row => row.matchedSkuId)).size).toBe(1);
    expect(await prisma.sku.count({ where: { product: { name: 'CeraVe Skin Renewing Night Cream' } } })).toBe(1);
  }, 180000);

  it('interrupted extraction retries automatically and resumes without duplicates', async () => {
    const url = cerave('interrupted');
    site.pages.set(url, { status: 200, body: page({ brand: 'CeraVe', title: 'CeraVe Eye Repair Cream 14 ml', inci: INCI }) });
    site.failing.set(url, 6); // the fetcher's own retries all fail on this first attempt
    const job = (await upload(csv([header, ['CeraVe Eye Repair Cream 14ml', 'CeraVe', '14 ml', '', 'Moisturizers ' + run, url]]), 'interrupted.csv').expect(201)).body.jobId;
    await autopilot(job);
    let [row] = await rowsOf(job);
    expect(row).toMatchObject({ decision: 'RETRY_AUTOMATIC', attempts: 1, matchedSkuId: null });
    expect(row.nextAttemptAt).toBeTruthy();
    site.failing.delete(url);
    app.get(ResearchSourceFetcher).reset();
    await prisma.adminCatalogImportRow.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    await autopilot(job);
    [row] = await rowsOf(job);
    expect(row.decision).toBe('AUTO_ACCEPT');
    expect(await prisma.sku.count({ where: { product: { name: 'CeraVe Eye Repair Cream' } } })).toBe(1);
  }, 120000);

  it('Admin resolves exceptions with one action each; corrections go back through the same checks', async () => {
    const items = await openExceptions();
    const find = (name: string) => items.find(item => item.evidence?.row?.name === name);
    // Correct: give the unavailable product a real page. It is verified and accepted automatically.
    site.pages.set(dist('clary-shampoo'), { status: 200, body: page({ brand: 'Clary', title: 'Clary Hair Shampoo 300ml', usage: 'Apply to wet hair, lather and rinse.' }) });
    const corrected = (await api().post(`/catalog/workbench/exceptions/${find(N.claryShampoo).id}/resolve`).set(admin.auth)
      .send({ action: 'CORRECT', note: 'Distributor page found', correction: { sourceUrl: dist('clary-shampoo') } }).expect(200)).body;
    expect(corrected.row).toMatchObject({ decision: 'AUTO_ACCEPT' });
    // Precomputed correction: use the suggested allowed brand.
    const spelling = find(N.misspelt);
    const fixed = (await api().post(`/catalog/workbench/exceptions/${spelling.id}/resolve`).set(admin.auth)
      .send({ action: 'CORRECT', note: 'Typo in the list', correction: spelling.recommended.payload.correction }).expect(200)).body;
    // The name still carries the typo, so it is not yet the accepted product and it has no page: a new, more precise hold, never a silent pass.
    expect(fixed.row).toMatchObject({ decision: 'HOLD_CRITICAL' });
    const next = (await openExceptions()).find(item => item.subjectId === spelling.subjectId);
    const named = (await api().post(`/catalog/workbench/exceptions/${next.id}/resolve`).set(admin.auth)
      .send({ action: 'CORRECT', note: 'Name typo too', correction: { name: 'Capixy Shampoo 250ml' } }).expect(200)).body;
    // Now the same brand, name and size as the product accepted from its distributor page: linked, not duplicated.
    expect(named.row).toMatchObject({ decision: 'AUTO_LINK', matchedSkuId: byName(await rowsOf(firstJob), N.capixyShampoo).matchedSkuId });
    // Reject: the untrusted listing is dropped.
    const rejected = (await api().post(`/catalog/workbench/exceptions/${find(N.claryMask).id}/resolve`).set(admin.auth).send({ action: 'REJECT', note: 'Only a reseller page exists' }).expect(200)).body;
    expect(rejected.row).toMatchObject({ decision: 'SKIP', reasonCode: 'ADMIN_REJECTED' });
    // A settled exception cannot be settled twice.
    await api().post(`/catalog/workbench/exceptions/${find(N.claryMask).id}/resolve`).set(admin.auth).send({ action: 'REJECT', note: 'again' }).expect(409);
    // The barcode conflict stays until someone settles it: it never silently passes.
    expect((await openExceptions()).some(item => item.id === find(N.foaming).id)).toBe(true);
  }, 120000);

  it('materially inconsistent usage instructions from two trusted sources open one critical exception; keeping the manufacturer text settles it', async () => {
    const rows = await rowsOf(firstJob);
    const skuId = byName(rows, N.claryConditioner).matchedSkuId;
    site.pages.set(dist('clary-conditioner-leave-in'), { status: 200, body: page({ brand: 'Clary', title: 'Clary Hair Conditioner 300ml', usage: 'Apply to towel-dried hair. Leave in, do not rinse.' }) });
    const refreshed = (await api().post(`/catalog/workbench/skus/${skuId}/refresh`).set(admin.auth).send({ sourceUrls: [dist('clary-conditioner-leave-in')] }).expect(200)).body;
    const usage = refreshed.openExceptions.find((item: any) => item.reasonCode === 'USAGE_INSTRUCTIONS_CONTRADICT' || item.field === 'usage.instructions');
    // The rinse instruction was already applied, so the contradiction is between the catalog text and the new source: it must surface, not overwrite.
    expect(usage).toBeTruthy();
    const product = await prisma.product.findFirstOrThrow({ where: { skus: { some: { id: skuId } } } });
    expect(product.usage).toContain('rinse thoroughly');
    const settled = (await api().post(`/catalog/workbench/exceptions/${usage.id}/resolve`).set(admin.auth).send({ action: 'REJECT', note: 'Leave-in text belongs to another product' }).expect(200)).body;
    expect(settled.exception.status).toBe('REJECTED');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).usage).toContain('rinse thoroughly');
  }, 120000);

  it('reports automatic versus manual counts without forcing any rate', async () => {
    const summary = (await api().get('/catalog/workbench/autopilot/summary').set(admin.auth).expect(200)).body;
    expect(summary.decisions.length).toBeGreaterThan(0);
    expect(summary.decisions.some((d: any) => d.actorType === 'ADMIN')).toBe(true);
    expect(summary.decisions.some((d: any) => d.actorType === 'SYSTEM' && d.decision === 'AUTO_ACCEPT')).toBe(true);
  });
});
