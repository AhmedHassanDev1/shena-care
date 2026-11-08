/* eslint-disable @typescript-eslint/no-explicit-any -- HTTP response bodies are asserted structurally */
process.env.SOURCING_MODE = 'BROADCAST_ON_DEMAND';
process.env.RESEARCH_ALLOWED_HOSTS = 'eparkville.example,e-majestic.example';
process.env.MEDIA_TRUSTED_SOURCE_HOSTS = 'eparkville.example,e-majestic.example,cerave.example';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { RESEARCH_TRANSPORT, ResearchTransport } from '../../src/modules/ingestion/public';
import { ResearchSourceFetcher } from '../../src/modules/ingestion/services/research-source-fetcher';
import { IngestionEligibilityService } from '../../src/modules/ingestion/services/ingestion-eligibility.service';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AiClient } from '../../src/platform/ai';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { createActor, Actor } from '../fixtures/actors';

/** Recorded pages: the real fetcher (host, robots and size guards) and the real extractor run; only the network is replaced. */
class RecordedSite implements ResearchTransport {
  pages = new Map<string, { status: number; body?: string | Buffer; type?: string }>();
  async resolve() { return ['93.184.216.34']; }
  async get(url: string) {
    if (url.endsWith('/robots.txt')) return this.respond({ status: 404 });
    return this.respond(this.pages.get(url) ?? { status: 404 });
  }
  private respond(page: { status: number; body?: string | Buffer; type?: string }) {
    return { status: page.status, headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? page.type ?? 'text/html' : null) },
      arrayBuffer: async () => { const bytes = Buffer.from(page.body ?? ''); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer; } };
  }
}

/**
 * Final catalog pipeline closure: the owner's 15-row supplier list (empty category column, Arabic name, misspelt brand, collection URL, placeholder barcode, new sizes)
 * against the approved leaf-allowlist policy, plus routine-ready profiles. Taxonomy names are the real ones, so product types resolve to real leaves.
 * Needs a fresh *_test database (category names are matched by name).
 */
describe('Catalog pipeline closure: category from product type, identity by verified page, routine profiles (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor;
  const site = new RecordedSite();
  const run = randomUUID().slice(0, 6).replace(/[0-9]/g, c => 'abcdefghij'[Number(c)]);
  const api = () => request(app.getHttpServer());
  const csv = (rows: string[][]) => Buffer.from(rows.map(row => row.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n'), 'utf-8');
  const header = ['name', 'brand', 'size', 'barcode', 'category', 'url'];
  const upload = (buffer: Buffer, name: string) => api().post('/admin/catalog-imports').set(admin.auth).attach('file', buffer, { filename: name, contentType: 'text/csv' });
  const autopilot = async (jobId: string) => (await api().post(`/catalog/workbench/imports/${jobId}/autopilot`).set(admin.auth).expect(200)).body;
  const rowsOf = async (jobId: string) => (await api().get(`/admin/catalog-imports/${jobId}/rows?limit=500`).set(admin.auth).expect(200)).body.rows as any[];
  const commerce = async () => ({ offers: await prisma.supplierOffer.count(), listings: await prisma.listing.count(), prices: await prisma.sellingPrice.count(),
    published: await prisma.product.count({ where: { isPublished: true } }) });
  const cerave = (slug: string) => `https://www.cerave.example/${run}/${slug}`;
  const park = (slug: string) => `https://eparkville.example/products/${run}-${slug}`;
  const majestic = (slug: string) => `https://e-majestic.example/products/${run}-${slug}`;
  const page = (o: { brand: string; title: string; inci?: string; usage?: string; warnings?: string; sizes?: string }) => `<html><head><title>${o.title}</title>
    <script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: o.title, brand: { name: o.brand } })}</script></head>
    <body><h1>${o.title}</h1>${o.sizes ? `<p>Sizes available: ${o.sizes}.</p>` : ''}${o.inci ? `<h2>Ingredients</h2><p>${o.inci}</p>` : ''}${o.usage ? `<h2>How to use</h2><p>${o.usage}</p>` : ''}${o.warnings ? `<h2>Warnings</h2><p>${o.warnings}</p>` : ''}</body></html>`;
  const INCI = 'AQUA, GLYCERIN, CETEARYL ALCOHOL, CERAMIDE NP, CERAMIDE AP, CERAMIDE EOP, CARBOMER, SODIUM HYALURONATE';
  const brands: Record<string, string> = {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useClass(DeterministicAiClient).overrideProvider(RESEARCH_TRANSPORT).useValue(site).compile();
    app = moduleRef.createNestApplication();
    app.useLogger(false);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    admin = await createActor(prisma, 'ADMIN');

    const category = async (name: string, parentId: string | null) => (await prisma.category.findFirst({ where: { name } }))
      ?? prisma.category.create({ data: { name, slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${run}`, parentId } });
    const skin = await category('Skin Care', null);
    const hair = await category('Hair Care', null);
    const leaf: Record<string, string> = {};
    for (const [name, parent] of [['Cleansers', skin.id], ['Moisturizers', skin.id], ['Sunscreens', skin.id], ['Serums & Treatments', skin.id], ['Shampoos', hair.id], ['Conditioners', hair.id], ['Hair Treatments & Styling', hair.id]] as const) {
      leaf[name] = (await category(name, parent)).id;
    }
    const brand = async (name: string, website?: string) => (await prisma.brand.findFirst({ where: { name } })) ?? prisma.brand.create({ data: { name, slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${run}`, websiteUrl: website ?? null } });
    brands.cerave = (await brand('CeraVe', 'https://www.cerave.example')).id;
    brands.clary = (await brand('Clary Corporation')).id;
    brands.capixy = (await brand('Capixy')).id;
    await brand('Eva Cosmetics');
    const policy = app.get(IngestionEligibilityService);
    const enable = async (id: string, leaves: string[], aliases: string[] = []) =>
      policy.updateBrand(id, { expectedVersion: (await policy.current())?.version ?? 0, enabled: true, categoryIds: leaves, ...(aliases.length && { addAliases: aliases }) }, admin.id);
    await enable(brands.cerave, [leaf.Cleansers, leaf.Moisturizers]);
    await enable(brands.clary, [leaf.Shampoos, leaf.Conditioners, leaf['Hair Treatments & Styling']], ['clary']);
    await enable(brands.capixy, [leaf.Shampoos, leaf.Conditioners]);

    site.pages.set(cerave('foaming'), { status: 200, body: page({ brand: 'CeraVe', title: 'CeraVe Foaming Cleanser', sizes: '88ml, 236 ml, 473 ml', inci: INCI,
      usage: 'Wet skin with lukewarm water. Massage cleanser into skin in a gentle, circular motion. Rinse.' }) });
    site.pages.set(cerave('hydrating'), { status: 200, body: page({ brand: 'CeraVe', title: 'CeraVe Hydrating Cleanser', sizes: '88ml, 236 ml, 473 ml', inci: INCI,
      usage: 'A hydrating and soothing facial cleansing lotion for normal to dry skin on the face and body. Recommended use in conjunction with CeraVe Moisturizing Cream' }) });
    site.pages.set(cerave('cream'), { status: 200, body: page({ brand: 'CeraVe', title: 'CeraVe Moisturising Cream', sizes: '340g, 454g', inci: INCI }) });
    site.pages.set(park('clary-hair-shampoo-300ml'), { status: 200, body: page({ brand: 'Clary', title: 'Clary Hair Shampoo 300ml',
      usage: 'Apply a generous amount to wet hair. Massage gently into the scalp and hair for 2–3 minutes. Rinse thoroughly.' }) });
    site.pages.set(park('clary-hair-mask-300ml'), { status: 200, body: page({ brand: 'Clary', title: 'Clary Hair Mask 300ml',
      usage: 'Apply to clean, damp hair. Leave on for 10–15 minutes. Rinse thoroughly. Use 1–2 times per week for optimal results.' }) });
    site.pages.set(majestic('capixy-hair-hydrating-conditioner-250ml'), { status: 200, body: page({ brand: 'Capixy', title: 'Capixy Hair Hydrating Conditioner 250ml',
      usage: 'Apply after shampoo, leave for 2 minutes, then rinse well.' }) });
    site.pages.set(park('clary-argan-night-mask-150ml'), { status: 200, body: page({ brand: 'Clary', title: 'Clary Argan Night Hair Mask 150ml', usage: 'Apply to towel-dried hair. Do not rinse.' }) });
    app.get(ResearchSourceFetcher).reset();
  }, 180000);

  afterAll(async () => { await app.close(); });

  let seedJob: string;
  let testJob: string;
  const seedRows = () => csv([header,
    ['CeraVe Foaming Cleanser 236ml', 'Cerave', '236 ml', '', 'Cleansers', cerave('foaming')],
    ['CeraVe Hydrating Cleanser 236ml', 'Cerave', '236 ml', '', 'Cleansers', cerave('hydrating')],
    ['CeraVe Moisturising Cream 454g', 'Cerave', '454 g', '', 'Moisturizers', cerave('cream')],
    ['Clary Hair Shampoo 300ml', 'Clary Corporation', '300 ml', '', 'Shampoos', park('clary-hair-shampoo-300ml')],
    ['Clary Hair Mask 300ml', 'Clary Corporation', '300 ml', '', 'Hair Treatments & Styling', park('clary-hair-mask-300ml')],
    ['Capixy Hair Hydrating Conditioner 250ml', 'capixy', '250 ml', '', 'Conditioners', majestic('capixy-hair-hydrating-conditioner-250ml')],
  ]);
  /** The owner's 15-row file shape: no category at all. */
  const fifteen = () => csv([header,
    ['Clary Hair Shampoo', 'Clary', '300ml', '6224008073666', '', park('clary-hair-shampoo-300ml')],
    ['Clary Hair Mask', 'Clary', '300ml', '', '', `https://eparkville.example/collections/buy-one-get-one/products/${run}-clary-hair-mask-300ml`],
    ['Capixy Hair Hydrating Conditioner', 'Capixy', '250ml', '', '', majestic('capixy-hair-hydrating-conditioner-250ml')],
    ['Capixy Hair Mask', 'Capixy', '250ml', '', '', majestic('capixy-hair-mask-250ml')],
    ['CeraVe Foaming Cleanser', 'CeraVe', '236ml', '', '', cerave('foaming')],
    ['CeraVe Hydrating Cleanser', 'CeraVe', '236ml', '', '', cerave('hydrating')],
    ['CeraVe Moisturising Cream', 'CeraVe', '340g', '', '', cerave('cream')],
    ['CeraVe Foaming Cleanser', 'CeraVe', '473ml', '', '', cerave('foaming')],
    ['CeraVe Cleanser', 'CeraVe', '236ml', '', '', ''],
    ['CeraVe Hydrating Cleanser', 'CeraVe', '473ml', '', '', ''],
    ['Capixxy Hair Hydrating Conditioner', 'Capixxy', '250ml', '', '', majestic('capixy-hair-hydrating-conditioner-250ml')],
    ['CeraVe Shampoo', 'CeraVe', '250ml', '', '', ''],
    ['Eva Hyaluronic Serum', 'Eva', '30ml', '', '', ''],
    ['Unlisted Demo Face Cream', 'NotOnAllowlistDemo', '50ml', '', '', ''],
    ['كلاري شامبو شعر', 'Clary', '300ml', '0000000000000', '', park('clary-hair-shampoo-300ml')],
  ]);

  it('seeds the verified products the 15-row file refers to', async () => {
    seedJob = (await upload(seedRows(), `seed-${run}.csv`).expect(201)).body.jobId;
    const result = await autopilot(seedJob);
    expect(result.totals).toMatchObject({ AUTO_ACCEPT: 6, HOLD_CRITICAL: 0, SKIP: 0 });
  }, 300000);

  it('the 15-row file: no category column causes no hold; known products link, new sizes verify, disallowed skip, only the genuinely ambiguous row holds', async () => {
    const before = await commerce();
    const skus = await prisma.sku.count();
    testJob = (await upload(fifteen(), `fifteen-${run}.csv`).expect(201)).body.jobId;
    await autopilot(testJob);
    const rows = await rowsOf(testJob);
    const seeded = await rowsOf(seedJob);
    const at = (n: number) => rows.find(r => r.rowNumber === n + 1)!;
    const seededSku = (name: string) => seeded.find(r => r.name === name)!.matchedSkuId;
    const outcome = (n: number) => [at(n).decision, at(n).reasonCode];

    expect(rows.some(r => r.reasonCode === 'POLICY_CATEGORY_UNKNOWN')).toBe(false);
    // Known products link to their verified SKU; the category comes from the product type, never from a parent's allowance.
    expect(outcome(1)[0]).toBe('AUTO_LINK');
    expect(at(1).matchedSkuId).toBe(seededSku('Clary Hair Shampoo 300ml'));
    expect(at(1).identity.policy.category).toMatchObject({ basis: 'PRODUCT_TYPE', productType: 'shampoo' });
    expect([outcome(2)[0], at(2).matchedSkuId]).toEqual(['AUTO_LINK', seededSku('Clary Hair Mask 300ml')]); // same page under a storefront collection path
    expect([outcome(3)[0], at(3).matchedSkuId]).toEqual(['AUTO_LINK', seededSku('Capixy Hair Hydrating Conditioner 250ml')]);
    expect([outcome(5)[0], outcome(6)[0]]).toEqual(['AUTO_LINK', 'AUTO_LINK']);
    // The Arabic-named row and the misspelt brand point at an already verified page of exactly one SKU of that brand and size.
    expect([outcome(15)[0], at(15).matchedSkuId, outcome(15)[1]]).toEqual(['AUTO_LINK', seededSku('Clary Hair Shampoo 300ml'), 'AUTO_LINK_SAME_VERIFIED_SOURCE_PAGE']);
    expect([outcome(11)[0], at(11).matchedSkuId, outcome(11)[1]]).toEqual(['AUTO_LINK', seededSku('Capixy Hair Hydrating Conditioner 250ml'), 'AUTO_LINK_SAME_VERIFIED_SOURCE_PAGE_BRAND_CORRECTED']);
    // New sizes are distinct SKUs, verified by a manufacturer page that states that exact size (the 473 ml hydrating row by its sibling's verified page).
    for (const n of [7, 8, 10]) expect([n, ...outcome(n)]).toEqual([n, 'AUTO_ACCEPT', 'IDENTITY_VERIFIED_BY_SOURCE']);
    const cream340 = await prisma.sku.findUniqueOrThrow({ where: { id: at(7).matchedSkuId } });
    const cream454 = await prisma.sku.findUniqueOrThrow({ where: { id: seededSku('CeraVe Moisturising Cream 454g') } });
    expect([cream340.productId === cream454.productId, cream340.id === cream454.id, cream340.size?.toNumber()]).toEqual([true, false, 340]);
    // Disallowed: skipped early, nobody involved.
    expect(outcome(4)).toEqual(['SKIP', 'POLICY_CATEGORY_NOT_ALLOWED_FOR_BRAND']); // Capixy is not allowed hair treatments
    expect(outcome(12)).toEqual(['SKIP', 'POLICY_CATEGORY_NOT_ALLOWED_FOR_BRAND']); // CeraVe is not allowed shampoos
    // A brand the Catalog Policy does not hold ("Eva", "NotOnAllowlistDemo") is no longer skipped (owner decision 2026-11-07): the pipeline looks for its official
    // site, and with none (no search configured here) it is one hold each, and no brand is created.
    expect(outcome(13)).toEqual(['HOLD_CRITICAL', 'BRAND_NOT_VERIFIED']);
    expect(outcome(14)).toEqual(['HOLD_CRITICAL', 'BRAND_NOT_VERIFIED']);
    // A generic name with three 236 ml CeraVe cleansers competing stays a person's decision.
    expect(outcome(9)).toEqual(['HOLD_CRITICAL', 'COMPETING_IDENTITIES']);
    expect(rows.filter(r => r.decision === 'HOLD_CRITICAL').map(r => r.reasonCode).sort()).toEqual(['BRAND_NOT_VERIFIED', 'BRAND_NOT_VERIFIED', 'COMPETING_IDENTITIES']);

    // Barcode claims never become VERIFIED; a placeholder is not even a valid claim.
    expect(at(15).barcode).toBeNull();
    expect(await prisma.sku.count({ where: { barcode: { not: null } } })).toBe(0);
    expect(await prisma.sku.count({ where: { barcodeStatus: 'VERIFIED' } })).toBe(0);
    // Exactly three new SKUs, nothing commercial invented.
    expect(await prisma.sku.count()).toBe(skus + 3);
    expect(await commerce()).toEqual(before);
  }, 300000);

  it('re-import is idempotent and keeps verified facts', async () => {
    const skus = await prisma.sku.count();
    const facts = await prisma.productFactProposal.count({ where: { status: 'APPLIED' } });
    const again = (await upload(fifteen(), `fifteen-${run}.csv`).expect(201)).body;
    expect(again).toMatchObject({ jobId: testJob, reused: true });
    await autopilot(testJob);
    // The same rows in a new file: they link, nothing new is created, verified facts are untouched.
    const copy = (await upload(Buffer.concat([fifteen(), Buffer.from('\n')]), `fifteen-copy-${run}.csv`).expect(201)).body.jobId;
    await autopilot(copy);
    expect(await prisma.sku.count()).toBe(skus);
    expect(await prisma.productFactProposal.count({ where: { status: 'APPLIED' } })).toBe(facts);
    const rows = await rowsOf(copy);
    expect(rows.filter(r => r.decision === 'AUTO_LINK').length).toBeGreaterThanOrEqual(10);
  }, 300000);

  it('Admin profile API exposes persisted classification, routine metadata and honest coverage; marketing copy never becomes usage', async () => {
    const seeded = await rowsOf(seedJob);
    const id = (name: string) => seeded.find(r => r.name === name)!.matchedSkuId;
    const mask = (await api().get(`/catalog/workbench/skus/${id('Clary Hair Mask 300ml')}/profile`).set(admin.auth).expect(200)).body;
    expect(mask.classification).toMatchObject({ productType: 'hair-mask', category: { name: 'Hair Treatments & Styling' } });
    expect(mask.routine).toMatchObject({ primaryRole: 'HAIR_MASK', primaryRoleStatus: 'RULE_DERIVED', stepOrder: 3, rinseMode: 'RINSE_OFF', rinseModeStatus: 'VERIFIED',
      cadenceUnit: 'WEEK', cadenceMin: 1, cadenceMax: 2, cadenceStatus: 'VERIFIED', routinePeriod: 'UNKNOWN', routinePeriodStatus: 'UNKNOWN' });
    // Optional facts nobody stated are UNKNOWN and open no review task.
    expect(mask.summary.unknown).toEqual(expect.arrayContaining(['composition.inci', 'safety.warnings']));
    expect(mask.openExceptions).toEqual([]);
    expect(mask.publication.blockers).toEqual(expect.arrayContaining(['LISTING_NOT_ACTIVE', 'SELLING_PRICE_MISSING']));
    // Media failure is explicit: no source image, nothing invented.
    expect(mask.media).toEqual([]);
    expect(mask.publication.blockers).toContain('PRIMARY_PACKSHOT_NOT_APPROVED');

    const hydrating = (await api().get(`/catalog/workbench/skus/${id('CeraVe Hydrating Cleanser 236ml')}/profile`).set(admin.auth).expect(200)).body;
    expect(hydrating.coverage.usage.find((f: any) => f.field === 'usage.instructions').status).toBe('UNKNOWN');
    expect(hydrating.routine).toMatchObject({ primaryRole: 'CLEANSER', rinseModeStatus: 'UNKNOWN', cadenceStatus: 'UNKNOWN' });
    expect(hydrating.coverage.composition.find((f: any) => f.field === 'composition.inci')).toMatchObject({ status: 'VERIFIED', evidence: [expect.objectContaining({ url: cerave('hydrating') })] });

    const brand = (await api().get(`/catalog/workbench/brands/${brands.clary}/profile`).set(admin.auth).expect(200)).body;
    expect(brand.profile.identity.aliases.value).toContain('clary');
    // brand-profile@2 (the contract the Admin profile panel reads): what this catalog holds is `inShinaCare`, the brand's own range is `range`, and the range is never complete.
    expect(brand.profile.rule).toBe('brand-profile@2');
    expect(brand.profile.inShinaCare).toMatchObject({ basis: 'VERIFIED_CATALOG_SKUS' });
    expect(brand.profile.range).toMatchObject({ complete: false });
    expect(brand.profile.inShinaCare.productTypes.map((t: any) => t.value).sort()).toEqual(['hair-mask', 'shampoo']);
    expect(brand.profile.identity.parentCompany).toMatchObject({ status: 'UNKNOWN' });
    // Unpublished products are never exposed to routine consumers.
    await api().get(`/catalog/skus/${id('Clary Hair Mask 300ml')}/routine-profile`).expect(404);
  });

  it('a rinse-off product type whose official instructions say leave it in opens one critical exception', async () => {
    const job = (await upload(csv([header, ['Clary Argan Night Hair Mask', 'Clary', '150ml', '', '', park('clary-argan-night-mask-150ml')]]), `conflict-${run}.csv`).expect(201)).body.jobId;
    await autopilot(job);
    const [row] = await rowsOf(job);
    expect([row.decision, row.reasonCode]).toEqual(['HOLD_CRITICAL', 'APPLICATION_MODE_CONTRADICTS_PRODUCT_TYPE']);
    const profile = (await api().get(`/catalog/workbench/skus/${row.matchedSkuId}/profile`).set(admin.auth).expect(200)).body;
    expect(profile.routine).toMatchObject({ primaryRole: 'HAIR_MASK', primaryRoleStatus: 'CONFLICT', rinseMode: 'LEAVE_ON', rinseModeStatus: 'VERIFIED', expectedRinseMode: 'RINSE_OFF' });
    expect(profile.openExceptions).toEqual([expect.objectContaining({ reasonCode: 'APPLICATION_MODE_CONTRADICTS_PRODUCT_TYPE', severity: 'CRITICAL' })]);
  }, 180000);
});
