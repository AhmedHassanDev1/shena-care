/* eslint-disable @typescript-eslint/no-explicit-any -- HTTP response bodies are asserted structurally */
process.env.SOURCING_MODE = 'BROADCAST_ON_DEMAND';
process.env.RESEARCH_ALLOWED_HOSTS = '';
process.env.MEDIA_TRUSTED_SOURCE_HOSTS = '';
// Search is "configured" but never called: discoverPages is replaced below, so no real provider is reached.
process.env.EXA_API_KEY = 'test-key-never-sent';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { RESEARCH_TRANSPORT, ResearchTransport } from '../../src/modules/ingestion/public';
import { ResearchSourceFetcher } from '../../src/modules/ingestion/services/research-source-fetcher';
import { IngestionEligibilityService } from '../../src/modules/ingestion/services/ingestion-eligibility.service';
import { ProductResearchService } from '../../src/modules/ingestion/services/product-research.service';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AiClient } from '../../src/platform/ai';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { createActor, Actor } from '../fixtures/actors';

/** Recorded pages: the real fetcher (host, robots and size guards) and the real extractors run; only the network is replaced. */
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
 * Supplier/Admin pipeline closure (owner decisions 2026-11-07): a list row whose brand the catalog does not hold makes the pipeline verify that brand on its official
 * website and create it from verified fields only, enabled for exactly the leaves its rows need; the product line comes from the brand's own page; SPF, broad spectrum,
 * water resistance, UV filter type and non-comedogenic are filled only when the page states them; nothing is duplicated and nothing is invented.
 */
describe('Supplier pipeline closure: new brand onboarding, product line, schema fields, no duplicates (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor;
  let discover: jest.SpyInstance;
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
  // Brand names unique per run, so the brand-domain rule sees "<brand>.example".
  const lumora = `Lumora${run}`;
  const nomara = `Nomara${run}`;
  const velora = `Velora${run}`;
  const home = `https://www.${lumora.toLowerCase()}.example/`;
  const lumoraPage = (slug: string) => `https://www.${lumora.toLowerCase()}.example/products/${slug}`;
  const product = (o: { title: string; crumbs?: string[]; inci?: string; usage?: string; description?: string }) => `<html><head><title>${o.title}</title>
    <script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: o.title, brand: { name: lumora }, ...(o.description && { description: o.description }) })}</script>
    ${o.crumbs ? `<script type="application/ld+json">${JSON.stringify({ '@type': 'BreadcrumbList', itemListElement: o.crumbs.map((name, i) => ({ '@type': 'ListItem', position: i + 1, name })) })}</script>` : ''}
    </head><body><h1>${o.title}</h1>${o.inci ? `<h2>Ingredients</h2><p>${o.inci}</p>` : ''}${o.usage ? `<h2>How to use</h2><p>${o.usage}</p>` : ''}</body></html>`;
  const leaf: Record<string, string> = {};
  let brandsBefore = 0;

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
    for (const [name, parent] of [['Cleansers', skin.id], ['Moisturizers', skin.id], ['Sunscreens', skin.id], ['Serums & Treatments', skin.id], ['Shampoos', hair.id], ['Conditioners', hair.id]] as const) {
      leaf[name] = (await category(name, parent)).id;
    }
    // One existing allowed brand, so a Catalog Policy exists; none of its leaves is Sunscreens, so that leaf is one no brand brings in yet.
    const cerave = (await prisma.brand.findFirst({ where: { name: 'CeraVe' } })) ?? await prisma.brand.create({ data: { name: 'CeraVe', slug: `cerave-${run}` } });
    const policy = app.get(IngestionEligibilityService);
    await policy.updateBrand(cerave.id, { expectedVersion: (await policy.current())?.version ?? 0, enabled: true, categoryIds: [leaf.Cleansers, leaf.Moisturizers] }, admin.id);

    // Lumora's own site: an Organization that states its name, a description and where it was founded; no logo is published, so none may be stored.
    site.pages.set(home, { status: 200, body: `<html><head><title>${lumora} | Official site</title><meta property="og:site_name" content="${lumora}">
      <script type="application/ld+json">${JSON.stringify({ '@type': 'Organization', name: lumora, description: `${lumora} makes hair and sun care in Cairo.`, foundingLocation: { '@type': 'Place', address: { addressCountry: 'Egypt' } } })}</script>
      </head><body><h1>${lumora}</h1></body></html>` });
    site.pages.set(lumoraPage('silk-repair-shampoo'), { status: 200, body: product({ title: `${lumora} Silk Repair Shampoo 250ml`,
      crumbs: ['Home', 'Hair Care', 'Silk Repair', `${lumora} Silk Repair Shampoo 250ml`], inci: 'Aqua, Sodium Laureth Sulfate, Cocamidopropyl Betaine, Glycerin, Hydrolyzed Silk, Parfum',
      usage: 'Apply to wet hair, massage into a lather, then rinse thoroughly.' }) });
    site.pages.set(lumoraPage('sun-shield-fluid'), { status: 200, body: product({ title: `${lumora} Sun Shield Fluid SPF 50 50ml`,
      inci: 'Aqua, Zinc Oxide, Octocrylene, Glycerin, Dimethicone, Tocopherol',
      description: 'A light broad spectrum sun fluid for face. Water resistant (80 minutes). Non-comedogenic.' }) });
    // Velora: the only site the search finds is a shop, not the brand's own domain.
    site.pages.set('https://www.beautyshop.example/', { status: 200, body: `<html><head><title>Beauty Shop</title><meta property="og:site_name" content="Beauty Shop"></head><body>Velora and more</body></html>` });
    app.get(ResearchSourceFetcher).reset();

    // Product pages found only by search (no URL on the row).
    site.pages.set(lumoraPage('volume-shampoo'), { status: 200, body: product({ title: `${lumora} Volume Shampoo 300ml`, usage: 'Apply to wet hair, lather and rinse.' }) });
    site.pages.set(lumoraPage('hydra-shampoo'), { status: 200, body: product({ title: `${lumora} Hydra Shampoo 400ml`, usage: 'Apply to wet hair, lather and rinse.' }) });
    site.pages.set(lumoraPage('duo-shampoo'), { status: 200, body: product({ title: `${lumora} Duo Shampoo`, description: 'Available in 250ml and 500ml.' }) });

    discover = jest.spyOn(app.get(ProductResearchService), 'discoverPages').mockImplementation(async (query: string) => {
      // A retailer hit comes first: it must never be read as a source.
      if (query.includes('Volume Shampoo')) return [{ url: 'https://www.amazon.example/dp/123', title: 'Volume Shampoo' }, { url: lumoraPage('volume-shampoo'), title: 'Volume Shampoo' }];
      if (query.includes('Hydra Shampoo')) return [{ url: lumoraPage('hydra-shampoo'), title: 'Hydra Shampoo' }];
      if (query.includes('Duo Shampoo')) return [{ url: lumoraPage('duo-shampoo'), title: 'Duo Shampoo' }];
      if (query.startsWith(lumora)) return [{ url: home, title: `${lumora} | Official site` }];
      if (query.startsWith(velora)) return [{ url: 'https://www.beautyshop.example/', title: 'Beauty Shop' }];
      return [];
    });
    brandsBefore = await prisma.brand.count();
  }, 180000);

  afterAll(async () => { discover?.mockRestore(); await app.close(); });

  let firstJob: string;

  it('creates the new brand from its verified official site, adds it for exactly the leaves its rows need, and accepts its products', async () => {
    const before = await commerce();
    const received = await upload(csv([header,
      [`${lumora} Silk Repair Shampoo 250ml`, lumora, '250 ml', '', '', lumoraPage('silk-repair-shampoo')],
      [`${lumora} Sun Shield Fluid SPF 50 50ml`, lumora, '50 ml', '', '', lumoraPage('sun-shield-fluid')],
      [`${lumora.toUpperCase()} SILK REPAIR SHAMPOO 250ML`, lumora.toUpperCase(), '250ml', '', '', lumoraPage('silk-repair-shampoo')],
      [`${nomara} Face Cream 50ml`, nomara, '50 ml', '', '', ''],
      [`${nomara} Gel Cleanser 150ml`, nomara, '150 ml', '', '', ''],
      [`${velora} Hydrating Serum 30ml`, velora, '30 ml', '', '', ''],
    ]), `closure-${run}.csv`).expect(201);
    firstJob = received.body.jobId;
    const matched = await rowsOf(firstJob);
    expect(matched.filter(row => row.reasonCode === 'POLICY_BRAND_NEW').length).toBeGreaterThanOrEqual(5);

    await autopilot(firstJob);
    const rows = await rowsOf(firstJob);
    const byNumber = (n: number) => rows.find(row => row.rowNumber === n)!;
    expect([byNumber(2).decision, byNumber(3).decision]).toEqual(['AUTO_ACCEPT', 'AUTO_ACCEPT']);
    // The same product spelt in capitals is one SKU, linked, never a second product.
    expect(byNumber(4).decision).toBe('AUTO_LINK');
    expect(byNumber(4).matchedSkuId).toBe(byNumber(2).matchedSkuId);
    // No verified site: the brand is not created, and each of its rows says why.
    for (const n of [5, 6, 7]) expect([byNumber(n).decision, byNumber(n).reasonCode]).toEqual(['HOLD_CRITICAL', 'BRAND_NOT_VERIFIED']);
    // Nomara's site was looked for once for both of its rows, not once per row.
    expect(discover.mock.calls.filter(([query]) => String(query).startsWith(nomara)).length).toBe(1);

    // Exactly one brand added, from verified fields only; no logo was published, so none is stored.
    expect(await prisma.brand.count()).toBe(brandsBefore + 1);
    const brand = await prisma.brand.findFirstOrThrow({ where: { name: lumora } });
    expect(brand).toMatchObject({ websiteUrl: home, countryOfOrigin: 'Egypt', logoUrl: null, isActive: true });
    expect(brand.description).toContain('hair and sun care');
    expect(await prisma.brand.count({ where: { name: { in: [nomara, velora] } } })).toBe(0);
    const rule = ((await app.get(IngestionEligibilityService).current())!.document as any).brands.find((b: any) => b.id === brand.id);
    expect(rule.effect).toBe('ALLOW');
    expect([...rule.categoryIds].sort()).toEqual([leaf.Shampoos, leaf.Sunscreens].sort());
    const audit = await prisma.catalogDecisionRecord.findMany({ where: { subjectType: 'BRAND', subjectId: brand.id, decision: 'BRAND_AUTO_ONBOARDED' } });
    expect(audit).toHaveLength(1);

    // Two SKUs, unpublished, nothing commercial.
    const products = await prisma.product.findMany({ where: { brandId: brand.id }, include: { productLine: true, skus: true } });
    expect(products).toHaveLength(2);
    expect(products.flatMap(p => p.skus)).toHaveLength(2);
    expect(await commerce()).toEqual(before);

    // Shampoo: the brand's breadcrumb names its line; no sun claim is invented for it.
    const shampoo = products.find(p => p.name.includes('Shampoo'))!;
    expect(shampoo.productLine?.name).toBe('Silk Repair');
    expect(shampoo.productLine?.description ?? null).toBeNull();
    expect(shampoo.categoryId).toBe(leaf.Shampoos);
    expect({ spf: shampoo.spf, broadSpectrum: shampoo.broadSpectrum, water: shampoo.waterResistanceMinutes, uv: shampoo.uvFilterType, nonComedogenic: shampoo.isNonComedogenic })
      .toEqual({ spf: null, broadSpectrum: null, water: null, uv: null, nonComedogenic: null });
    expect(shampoo.isFragranceFree).toBe(false);

    // Sunscreen: every sun field the page states, with its evidence; no line, because the page names none.
    const sun = products.find(p => p.name.includes('Sun'))!;
    expect(sun.categoryId).toBe(leaf.Sunscreens);
    expect({ spf: sun.spf, broadSpectrum: sun.broadSpectrum, water: sun.waterResistanceMinutes, uv: sun.uvFilterType, nonComedogenic: sun.isNonComedogenic })
      .toEqual({ spf: 50, broadSpectrum: true, water: 80, uv: 'HYBRID', nonComedogenic: true });
    expect((sun.claimsEvidence as any).spf.sourceUrl).toBe(lumoraPage('sun-shield-fluid'));
    expect(sun.productLineId).toBeNull();
    expect(sun.skus[0].barcode).toBeNull();
    expect(sun.skus[0].barcodeStatus).toBe('UNKNOWN');

    // Every unverifiable brand row is one open exception with its reason.
    const open = await prisma.catalogException.findMany({ where: { status: 'OPEN', importRowId: { in: [5, 6, 7].map(n => byNumber(n).id) } } });
    expect(open.map(item => item.reasonCode).sort()).toEqual(['BRAND_NOT_VERIFIED', 'BRAND_NOT_VERIFIED', 'BRAND_NOT_VERIFIED']);
  }, 300000);

  it('a later file links the same products, never creates a second brand or SKU, and admits other leaves only through the Catalog Policy', async () => {
    const skus = await prisma.sku.count();
    const lines = await prisma.productLine.count();
    const brands = await prisma.brand.count();
    const received = await upload(csv([header,
      [`${lumora} silk repair shampoo`, lumora.toLowerCase(), '250 ml', '', 'Shampoos', lumoraPage('silk-repair-shampoo')],
      [`${lumora} Silk Repair Conditioner 250ml`, lumora, '250 ml', '', '', ''],
    ]), `closure-second-${run}.csv`).expect(201);
    await autopilot(received.body.jobId);
    const rows = await rowsOf(received.body.jobId);
    expect(rows.find(row => row.rowNumber === 2)).toMatchObject({ decision: 'AUTO_LINK' });
    // The brand is known now: a leaf it was not added for is a policy decision, not an automatic addition (here no brand allows Conditioners at all).
    expect(rows.find(row => row.rowNumber === 3)).toMatchObject({ decision: 'SKIP' });
    expect(rows.find(row => row.rowNumber === 3).reasonCode).toMatch(/^POLICY_CATEGORY_NOT_ALLOWED/);
    expect([await prisma.sku.count(), await prisma.productLine.count(), await prisma.brand.count()]).toEqual([skus, lines, brands]);

    // Re-uploading the first file is the same job: nothing is redone or duplicated.
    const again = await upload(csv([header,
      [`${lumora} Silk Repair Shampoo 250ml`, lumora, '250 ml', '', '', lumoraPage('silk-repair-shampoo')],
      [`${lumora} Sun Shield Fluid SPF 50 50ml`, lumora, '50 ml', '', '', lumoraPage('sun-shield-fluid')],
      [`${lumora.toUpperCase()} SILK REPAIR SHAMPOO 250ML`, lumora.toUpperCase(), '250ml', '', '', lumoraPage('silk-repair-shampoo')],
      [`${nomara} Face Cream 50ml`, nomara, '50 ml', '', '', ''],
      [`${nomara} Gel Cleanser 150ml`, nomara, '150 ml', '', '', ''],
      [`${velora} Hydrating Serum 30ml`, velora, '30 ml', '', '', ''],
    ]), `closure-${run}.csv`).expect(201);
    expect(again.body).toMatchObject({ jobId: firstJob, reused: true });
    await autopilot(firstJob);
    expect([await prisma.sku.count(), await prisma.productLine.count(), await prisma.brand.count()]).toEqual([skus, lines, brands]);
  }, 300000);

  it('rows with no link find their page on the brand site; a missing size comes only from a page that states exactly one', async () => {
    const brand = await prisma.brand.findFirstOrThrow({ where: { name: lumora } });
    const received = await upload(csv([header,
      [`${lumora} Volume Shampoo 300 ml`, lumora, '', '', '', ''],
      [`${lumora} Hydra Shampoo`, lumora, '', '', '', ''],
      [`${lumora} Duo Shampoo`, lumora, '', '', '', ''],
    ]), `closure-discovery-${run}.csv`).expect(201);
    // The size written in the name is the row's size.
    const matched = await rowsOf(received.body.jobId);
    expect(matched.find(row => row.rowNumber === 2)).toMatchObject({ size: '300', sizeUnit: 'ml' });
    await autopilot(received.body.jobId);
    const rows = await rowsOf(received.body.jobId);
    const at = (n: number) => rows.find(row => row.rowNumber === n)!;
    expect(at(2)).toMatchObject({ decision: 'AUTO_ACCEPT' });
    const volume = await prisma.sku.findUniqueOrThrow({ where: { id: at(2).matchedSkuId } });
    expect((volume.identityEvidence as any).sourceUrls).toEqual([lumoraPage('volume-shampoo')]);
    // No size on the row: the page title states one (400 ml), so the SKU is 400 ml, verified by that page.
    expect(at(3)).toMatchObject({ decision: 'AUTO_ACCEPT', size: '400', sizeUnit: 'ml' });
    expect((await prisma.sku.findUniqueOrThrow({ where: { id: at(3).matchedSkuId } })).size?.toNumber()).toBe(400);
    // Two sizes on the page and none in its title: the size stays unknown and nothing is created.
    expect([at(4).decision, at(4).reasonCode]).toEqual(['HOLD_CRITICAL', 'MISSING_NET_CONTENT']);
    expect(at(4).matchedSkuId).toBeNull();
    expect(await prisma.product.count({ where: { brandId: brand.id } })).toBe(4);
  }, 300000);
});
