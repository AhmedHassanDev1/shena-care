/* eslint-disable @typescript-eslint/no-explicit-any -- HTTP response bodies are asserted structurally */
process.env.SOURCING_MODE = 'BROADCAST_ON_DEMAND';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import sharp from 'sharp';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AiClient } from '../../src/platform/ai';
import { RESEARCH_TRANSPORT, ResearchTransport } from '../../src/modules/ingestion/public';
import { ResearchSourceFetcher } from '../../src/modules/ingestion/services/research-source-fetcher';
import { ProductResearchService } from '../../src/modules/ingestion/services/product-research.service';
import { StorageService } from '../../src/platform/storage/storage.service';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { createActor, Actor } from '../fixtures/actors';

const run = randomUUID().slice(0, 8).replace(/[0-9]/g, c => 'abcdefghij'[Number(c)]);

/** A recorded website: the real fetcher, guards and robots handling run against it; only the network is replaced. Content is synthetic. */
class RecordedSite implements ResearchTransport {
  pages = new Map<string, { status: number; body?: string | Buffer; type?: string }>();
  down = false;
  async resolve() { return ['93.184.216.34']; }
  async get(url: string) {
    if (this.down) throw new Error('network down');
    const page = this.pages.get(url) ?? { status: 404 };
    return {
      status: page.status,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? page.type ?? 'text/html' : null) },
      arrayBuffer: async () => { const bytes = Buffer.from(page.body ?? ''); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer; },
    };
  }
}

/**
 * Smart Add Brand over real HTTP and PostgreSQL: local lookup → online research (recorded site) → review → one canonical Brand →
 * Catalog Policy → the SKIP / HOLD / ACCEPT decisions the supplier pipeline makes from it.
 */
describe('Smart Add Brand (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor;
  const site = new RecordedSite();
  let search: jest.SpyInstance;
  let leaf: { id: string; name: string };

  const api = () => request(app.getHttpServer());
  const csv = (rows: string[][]) => Buffer.from(rows.map(row => row.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n'), 'utf-8');
  const version = async () => (await api().get('/ingestion/eligibility/catalog-policy').set(admin.auth).expect(200)).body.version as number;
  const logo = (shade: number) => sharp({ create: { width: 160, height: 60, channels: 3, background: { r: shade, g: 80, b: 120 } } }).png().toBuffer();
  const home = (host: string, name: string, extra = '') => `<html><head><title>${name}</title>
    <script type="application/ld+json">{"@type":"Organization","name":"${name}","alternateName":["لومورا ${name}"],"description":"Gentle dermatologist-tested skincare for sensitive skin.",
      "logo":"https://${host}/logo.png","parentOrganization":{"name":"Northwind Beauty Group"},"foundingLocation":{"name":"France"}}</script>${extra}</head><body></body></html>`;
  const publish = async (host: string, name: string, shade = 200) => {
    site.pages.set(`https://${host}/robots.txt`, { status: 404 });
    site.pages.set(`https://${host}/`, { status: 200, body: home(host, name) });
    site.pages.set(`https://${host}/logo.png`, { status: 200, body: await logo(shade), type: 'image/png' });
  };
  /** A fresh Admin per call: lookups are rate-limited per person, and a suite should not spend one person's allowance. */
  const research = async (name: string, websiteUrl?: string, actor = admin) =>
    api().post('/ingestion/eligibility/brands/research').set(actor.auth).send({ name, ...(websiteUrl && { websiteUrl }) });
  // Read the version before opening the request: supertest binds its server when the request is created.
  const save = async (body: Record<string, unknown>, actor = admin) => {
    const expectedVersion = await version();
    return api().post('/ingestion/eligibility/brands/from-research').set(actor.auth).send({ expectedVersion, ...body });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useClass(DeterministicAiClient).overrideProvider(RESEARCH_TRANSPORT).useValue(site).compile();
    app = moduleRef.createNestApplication();
    app.useLogger(false);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    admin = await createActor(prisma, 'ADMIN');
    const root = await prisma.category.create({ data: { name: `Care ${run}`, slug: `care-${run}-${randomUUID().slice(0, 4)}` } });
    leaf = await prisma.category.create({ data: { name: `Creams ${run}`, slug: `creams-${run}-${randomUUID().slice(0, 4)}`, parentId: root.id } });
    search = jest.spyOn(app.get(ProductResearchService), 'discoverPages');
  }, 120000);

  beforeEach(() => {
    site.down = false;
    site.pages.clear();
    search.mockReset();
    app.get(ResearchSourceFetcher).reset();
  });

  afterAll(async () => { search.mockRestore(); await app.close(); });

  it('is Admin-only', async () => {
    const hub = await createActor(prisma, 'HUB_OPERATOR');
    const customer = await createActor(prisma, 'CUSTOMER');
    await api().post('/ingestion/eligibility/brands/research').send({ name: 'Anything' }).expect(401);
    for (const actor of [hub, customer]) {
      await research('Anything', undefined, actor).then(r => expect(r.status).toBe(403));
      await save({ name: 'Anything' }, actor).then(r => expect(r.status).toBe(403));
    }
    expect(search).not.toHaveBeenCalled();
  });

  it('adds an unknown brand end to end: sourced research, review, one canonical Brand, policy, then intake decisions', async () => {
    const name = `Lumora${run}`;
    const host = `www.lumora${run}.example`;
    await publish(host, name);
    search.mockResolvedValue([{ url: 'https://en.wikipedia.org/wiki/Lumora', title: 'Lumora - Wikipedia' }, { url: `https://${host}/products/cream`, title: `${name} Cream` }]);
    const before = { brands: await prisma.brand.count(), drafts: await prisma.brandDraft.count() };

    const found = await research(name).then(r => { expect(r.status).toBe(201); return r.body; });
    const r = found.research;
    expect(r).toMatchObject({ outcome: 'FOUND', site: { host, verifiedOfficial: true, origin: 'SEARCH' } });
    expect(r.name).toMatchObject({ value: name, status: 'VERIFIED', sourceUrl: `https://${host}/` });
    expect(r.description).toMatchObject({ status: 'VERIFIED', value: 'Gentle dermatologist-tested skincare for sensitive skin.' });
    expect(r.country).toMatchObject({ value: 'France', status: 'VERIFIED' });
    expect(r.parentCompany).toMatchObject({ value: 'Northwind Beauty Group', status: 'VERIFIED' });
    expect(r.aliases).toEqual([expect.objectContaining({ value: `لومورا ${name}`, status: 'VERIFIED', origin: 'PAGE' })]);
    expect(r.logo).toMatchObject({ status: 'VERIFIED', mediaType: 'image/png', value: `https://${host}/logo.png` });
    expect(r.references.map((x: any) => x.host)).toContain('en.wikipedia.org'); // listed for reference, never read as the brand's own site
    // Research alone creates no Brand.
    expect(await prisma.brand.count()).toBe(before.brands);
    expect(await prisma.brandDraft.count()).toBe(before.drafts + 1);

    // The Admin edits the description (so it stops being a verified quote), drops the parent company and keeps the logo.
    const saved = await save({ draftId: found.draftId, name, websiteUrl: r.website.value, description: 'Our own softer wording for the shelf.',
      countryOfOrigin: 'France', aliases: [`لومورا ${name}`], useLogo: true });
    expect(saved.status).toBe(201);
    expect(saved.body).toMatchObject({ changed: true, logoSaved: true, fields: { name: 'VERIFIED', description: 'ADMIN_ENTERED', country: 'VERIFIED', parentCompany: null, aliases: ['VERIFIED'] } });

    // One canonical Brand, carrying the reviewed identity and the logo's provenance.
    const brands = await prisma.brand.findMany({ where: { name: name } });
    expect(brands).toHaveLength(1);
    expect(brands[0]).toMatchObject({ websiteUrl: `https://${host}/`, countryOfOrigin: 'France', description: 'Our own softer wording for the shelf.', isActive: true });
    expect(brands[0].logoUrl).toMatch(/\/storage\/public\/brand-logos\/.+\.png$/);
    expect(brands[0].logoMetadata).toMatchObject({ isVerifiedOfficial: true, sourceDomain: host, licenseType: 'EDITORIAL_BRAND_LOGO', mediaType: 'image/png' });
    // The same draft record now ties research evidence to the canonical id.
    const draft = await prisma.brandDraft.findUniqueOrThrow({ where: { id: found.draftId } });
    expect(draft).toMatchObject({ status: 'APPROVED', canonicalBrandId: brands[0].id, reviewedBy: admin.id });
    expect((draft.evidence as any).research.site.host).toBe(host);
    // Identity read-back for the UI.
    const identity = (await api().get(`/ingestion/eligibility/brands/${brands[0].id}/identity`).set(admin.auth).expect(200)).body;
    expect(identity.fields.description).toMatchObject({ status: 'ADMIN_ENTERED' });
    expect(identity.fields.name).toMatchObject({ status: 'VERIFIED', sourceUrl: `https://${host}/` });

    // Policy: enabled by the same canonical id, with NO categories until an Admin chooses them.
    const policy = (await api().get('/ingestion/eligibility/catalog-policy').set(admin.auth).expect(200)).body;
    const entry = policy.brands.find((b: any) => b.id === brands[0].id);
    expect(entry).toMatchObject({ enabled: true, categoryIds: [], aliases: [`لومورا ${name}`], productCount: 0 });

    // Intake: nothing is admitted until a leaf is allowed; then the next import accepts. Products are never published by any of this.
    const rows = [['Name', 'Brand', 'Size', 'Category'], [`${name} Silk Cream`, `لومورا ${name}`, '50 ml', leaf.name]];
    const importList = async (extra: string) => {
      const res = await api().post('/admin/catalog-imports').set(admin.auth).attach('file', csv([...rows, ['Filler', name, '10 ml', leaf.name + extra]]), { filename: `${extra || 'a'}.csv`, contentType: 'text/csv' }).expect(201);
      return (await api().get(`/admin/catalog-imports/${res.body.jobId}/rows`).set(admin.auth).expect(200)).body.rows as any[];
    };
    const skipped = await importList('');
    expect(skipped[0]).toMatchObject({ outcome: 'REJECTED' });
    expect(String(skipped[0].reasonCode)).toMatch(/^POLICY_CATEGORY_NOT_ALLOWED/);
    const expectedVersion = await version();
    await api().patch(`/ingestion/eligibility/brands/${brands[0].id}`).set(admin.auth).send({ expectedVersion, categoryIds: [leaf.id] }).expect(200);
    const accepted = await importList(' ');
    expect(accepted[0]).toMatchObject({ outcome: 'NEW_CANDIDATE' }); // the Arabic alias resolved to the same canonical Brand
    expect(await prisma.product.count({ where: { brandId: brands[0].id } })).toBe(0);
  }, 120000);

  it('refuses a second record: a typed name or an official name that is already a Brand returns the existing one', async () => {
    const existing = await prisma.brand.create({ data: { name: `Orbella${run}`, slug: `orbella-${run}-${randomUUID().slice(0, 4)}` } });
    const count = await prisma.brand.count();
    const direct = await research(`orbella ${run}`.replace(' ', ''), undefined, await createActor(prisma, 'ADMIN'));
    expect([direct.status, direct.body.code, direct.body.brandId]).toEqual([409, 'BRAND_EXISTS', existing.id]);
    expect(search).not.toHaveBeenCalled(); // found locally: no online lookup is spent

    // A different spelling whose official name turns out to be an existing Brand.
    const host = `www.orbella${run}.example`;
    await publish(host, `Orbella${run}`);
    search.mockResolvedValue([{ url: `https://${host}/`, title: 'Orbella' }]);
    const viaOfficial = await research(`Orbella${run} Skincare`, undefined, await createActor(prisma, 'ADMIN'));
    expect([viaOfficial.status, viaOfficial.body.brandId]).toEqual([409, existing.id]);
    expect(await prisma.brand.count()).toBe(count);
  });

  it('marks everything unverified when the site is not the brand\'s own domain, and the server will not upgrade it', async () => {
    const name = `Zenvia${run}`;
    await publish('shop.reseller-hub.example', name);
    search.mockResolvedValue([{ url: 'https://shop.reseller-hub.example/zenvia', title: 'Zenvia at the reseller' }]);
    const attempt = await research(name, undefined, await createActor(prisma, 'ADMIN'));
    expect([attempt.status, attempt.body.code, attempt.body.message]).toEqual([201, undefined, undefined]);
    const found = attempt.body;
    expect(found.research).toMatchObject({ outcome: 'FOUND', site: { verifiedOfficial: false }, notes: expect.arrayContaining(['DOMAIN_NOT_BRAND']) });
    for (const key of ['name', 'website', 'description', 'country', 'parentCompany']) expect(found.research[key].status).toBe('UNVERIFIED');
    expect(found.research.logo.status).toBe('UNVERIFIED');

    // The Admin accepts the researched values as they are; they are still only "entered by an Admin", never "verified".
    const saved = await save({ draftId: found.draftId, name, websiteUrl: found.research.website.value, description: found.research.description.value, countryOfOrigin: 'France', useLogo: true });
    expect(saved.status).toBe(201);
    expect(saved.body.fields).toMatchObject({ name: 'ADMIN_ENTERED', website: 'ADMIN_ENTERED', description: 'ADMIN_ENTERED', country: 'ADMIN_ENTERED' });
    const brand = await prisma.brand.findFirstOrThrow({ where: { name } });
    expect(brand.logoMetadata).toMatchObject({ isVerifiedOfficial: false });
  }, 60000);

  it('falls back to manual entry when research is unavailable, never inventing anything', async () => {
    const name = `Maneva${run}`;
    search.mockResolvedValue(null); // search provider did not answer
    const none = (await research(name, undefined, await createActor(prisma, 'ADMIN'))).body;
    expect(none.research).toMatchObject({ outcome: 'UNAVAILABLE', site: null, name: null, logo: null, notes: expect.arrayContaining(['SEARCH_UNAVAILABLE']) });

    // The site is down for a named website.
    site.down = true;
    const down = (await research(`Nevara${run}`, `https://www.nevara${run}.example`, await createActor(prisma, 'ADMIN'))).body;
    expect(down.research.outcome).toBe('UNAVAILABLE');
    expect(down.research.notes.some((n: string) => n.startsWith('SITE_'))).toBe(true);
    site.down = false;

    // Robots.txt forbids it: an answer to respect, not to work around.
    const robotsHost = `www.robotic${run}.example`;
    site.pages.set(`https://${robotsHost}/robots.txt`, { status: 200, body: 'User-agent: *\nDisallow: /', type: 'text/plain' });
    const refused = (await research(`Robotic${run}`, `https://${robotsHost}`, await createActor(prisma, 'ADMIN'))).body;
    expect(refused.research.notes).toContain('SITE_ROBOTS_DISALLOWED');

    // Saving by hand still works and records that nothing was verified.
    const saved = await save({ draftId: none.draftId, name, websiteUrl: `https://www.maneva${run}.example/`, countryOfOrigin: 'Egypt' });
    expect(saved.status).toBe(201);
    expect(saved.body.fields).toMatchObject({ name: 'ADMIN_ENTERED', website: 'ADMIN_ENTERED', country: 'ADMIN_ENTERED', description: null });
    expect(saved.body.logoSaved).toBe(false);
    const manual = await save({ name: `Handmade${run}` });
    expect(manual.status).toBe(201);
    const brand = await prisma.brand.findFirstOrThrow({ where: { name: `Handmade${run}` } });
    expect([brand.logoUrl, brand.websiteUrl, brand.description]).toEqual([null, null, null]);
  }, 60000);

  it('does not guess a site for an Arabic-only name: it asks for the English name, then keeps the Arabic as an alias', async () => {
    // Arabic letters only (a Latin letter anywhere would make the name researchable).
    const arabic = `ماركة ${[...run].map(c => 'ابتثجحخدذرز'[c.charCodeAt(0) - 97]).join('')}`;
    const none = (await research(arabic, undefined, await createActor(prisma, 'ADMIN'))).body;
    expect(none.research).toMatchObject({ outcome: 'NOT_FOUND', site: null, candidates: [], notes: ['NEEDS_LATIN_NAME'] });

    const name = `Valmora${run}`;
    const host = `www.valmora${run}.example`;
    await publish(host, name);
    search.mockResolvedValue([{ url: `https://${host}/`, title: name }]);
    const found = await api().post('/ingestion/eligibility/brands/research').set((await createActor(prisma, 'ADMIN')).auth).send({ name, alias: arabic });
    expect(found.status).toBe(201);
    expect(found.body.research.site.verifiedOfficial).toBe(true);
    expect(found.body.research.aliases).toEqual(expect.arrayContaining([expect.objectContaining({ value: arabic, origin: 'ADMIN', status: 'UNVERIFIED' })]));
    const saved = await save({ draftId: found.body.draftId, name, aliases: [arabic] });
    expect(saved.status).toBe(201);
    const policy = (await api().get('/ingestion/eligibility/catalog-policy').set(admin.auth).expect(200)).body;
    expect(policy.brands.find((b: any) => b.name === name).aliases).toEqual([arabic]);
    // The Arabic spelling now resolves to the same Brand: it cannot be added again.
    const again = await research(arabic, undefined, await createActor(prisma, 'ADMIN'));
    expect([again.status, again.body.code]).toEqual([409, 'BRAND_EXISTS']);
  }, 60000);

  it('offers candidates for an Arabic-only name, reads nothing on its own, and lets the Admin choose', async () => {
    // Its own letters: the previous test already turned its Arabic name into a Brand alias.
    const arabic = `ماركة ${[...run].map(c => 'سشصضطظعغفق'[c.charCodeAt(0) - 97]).join('')}`;
    const candidate = `Candora${run}`;
    const host = `www.candora${run}.example`;
    await publish(host, candidate);
    search.mockResolvedValue([
      { url: 'https://ar.wikipedia.org/wiki/x', title: 'ويكيبيديا' },
      { url: `https://shop.other-reseller${run}.example/`, title: 'متجر' },
      { url: `https://${host}/ar/products`, title: `${arabic} - ${candidate}` },
    ]);
    const found = (await research(arabic, undefined, await createActor(prisma, 'ADMIN'))).body.research;
    expect(found).toMatchObject({ outcome: 'NOT_FOUND', site: null, name: null, logo: null, notes: ['NEEDS_LATIN_NAME'] });
    // The page that states the Arabic name leads; a marketplace-style page and an encyclopedia are never offered as a brand site.
    expect(found.candidates[0]).toMatchObject({ name: candidate, nameSource: 'TITLE', host, url: `https://${host}/`, arabicMatch: true });
    expect(found.candidates.map((c: any) => c.host)).not.toContain('ar.wikipedia.org');
    expect(found.candidates[1]).toMatchObject({ nameSource: 'DOMAIN', arabicMatch: false });
    expect(search).toHaveBeenCalledTimes(1);

    // Choosing a candidate runs the normal research on that site; the Arabic spelling is kept as the Admin's own alias.
    const chosen = await api().post('/ingestion/eligibility/brands/research').set((await createActor(prisma, 'ADMIN')).auth).send({ name: candidate, websiteUrl: `https://${host}/`, alias: arabic });
    expect(chosen.status).toBe(201);
    expect(chosen.body.research).toMatchObject({ outcome: 'FOUND', site: { verifiedOfficial: true, origin: 'ADMIN' } });
    expect(chosen.body.research.aliases).toEqual(expect.arrayContaining([expect.objectContaining({ value: arabic, origin: 'ADMIN', status: 'UNVERIFIED' })]));
    expect((await save({ draftId: chosen.body.draftId, name: candidate, aliases: [arabic] })).status).toBe(201);
    const again = await research(arabic, undefined, await createActor(prisma, 'ADMIN'));
    expect([again.status, again.body.code]).toEqual([409, 'BRAND_EXISTS']);
  }, 60000);

  it('resolves a reviewed Arabic spelling to the brand we already hold before searching anything', async () => {
    const held = (await prisma.brand.findFirst({ where: { name: 'CeraVe' } })) ?? (await prisma.brand.create({ data: { name: 'CeraVe', slug: `cerave-${run}-${randomUUID().slice(0, 4)}` } }));
    const res = await research('سيرافي', undefined, await createActor(prisma, 'ADMIN'));
    expect([res.status, res.body.code, res.body.brandId]).toEqual([409, 'BRAND_EXISTS', held.id]);
    expect(search).not.toHaveBeenCalled();
    // Search being down never blocks the manual path.
    search.mockResolvedValue(null);
    const down = (await research(`ماركة ${[...run].map(c => 'ابتثجحخدذرز'[c.charCodeAt(0) - 97]).join('')}ي`, undefined, await createActor(prisma, 'ADMIN'))).body;
    expect(down.research).toMatchObject({ outcome: 'UNAVAILABLE', candidates: [], notes: expect.arrayContaining(['NEEDS_LATIN_NAME', 'SEARCH_UNAVAILABLE']) });
  });

  it('stores an SVG-only logo as a rasterized PNG, and never keeps an unsafe SVG', async () => {
    const publishSvg = (host: string, name: string, svg: string) => {
      site.pages.set(`https://${host}/robots.txt`, { status: 404 });
      site.pages.set(`https://${host}/`, { status: 200, body: `<html><head><script type="application/ld+json">{"@type":"Organization","name":"${name}","description":"Skincare made for sensitive skin.","logo":"https://${host}/logo.svg"}</script></head></html>` });
      site.pages.set(`https://${host}/logo.svg`, { status: 200, body: svg, type: 'image/svg+xml' });
    };
    const name = `Svgora${run}`;
    const host = `www.svgora${run}.example`;
    publishSvg(host, name, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80" width="200" height="80"><rect width="200" height="80" fill="#14507a"/><circle cx="40" cy="40" r="24" fill="#fff"/></svg>');
    search.mockResolvedValue([{ url: `https://${host}/`, title: name }]);
    const found = (await research(name, undefined, await createActor(prisma, 'ADMIN'))).body;
    expect(found.research.logo).toMatchObject({ status: 'VERIFIED', mediaType: 'image/svg+xml', storedAs: 'image/png', value: `https://${host}/logo.svg` });
    const saved = await save({ draftId: found.draftId, name, useLogo: true });
    expect(saved.body).toMatchObject({ logoSaved: true });
    const brand = await prisma.brand.findFirstOrThrow({ where: { name } });
    expect(brand.logoUrl).toMatch(/\/storage\/public\/brand-logos\/.+\.png$/);
    expect(brand.logoMetadata).toMatchObject({ mediaType: 'image/png', sourceMediaType: 'image/svg+xml', isVerifiedOfficial: true });
    const stored = await app.get(StorageService).getFileBuffer(brand.logoUrl!.slice(brand.logoUrl!.indexOf('/storage/') + '/storage/'.length));
    expect(stored.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(stored.includes(Buffer.from('<svg'))).toBe(false);

    // A hostile SVG is not a logo: the rest of the research still works and the brand is saved without one.
    const hostile = `Evilgo${run}`;
    const hostileHost = `www.evilgo${run}.example`;
    publishSvg(hostileHost, hostile, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9"><script>alert(1)</script><image href="https://evil.example/x.png" width="9" height="9"/></svg>');
    search.mockResolvedValue([{ url: `https://${hostileHost}/`, title: hostile }]);
    const refused = (await research(hostile, undefined, await createActor(prisma, 'ADMIN'))).body;
    expect(refused.research.logo).toBeNull();
    expect(refused.research.notes).toContain('LOGO_UNUSABLE');
    expect(refused.research.description).toMatchObject({ status: 'VERIFIED' });
  }, 60000);

  it('keeps unsafe input out: non-https and private websites are refused before any request', async () => {
    const actor = await createActor(prisma, 'ADMIN');
    for (const websiteUrl of ['http://www.plain.example', 'https://localhost/admin', 'https://10.0.0.5/', 'https://user:pass@www.cred.example/', 'ftp://x.example']) {
      const res = await research(`Safeone${run}`, websiteUrl, actor);
      expect([res.status, res.body.code]).toEqual([400, 'INVALID_WEBSITE']);
    }
    const bad = await save({ name: `Badsite${run}`, websiteUrl: 'http://www.plain.example' });
    expect(bad.status).toBe(400);
    expect(await prisma.brand.count({ where: { name: `Badsite${run}` } })).toBe(0);
  });

  it('writes nothing when the save cannot complete: alias conflicts, stale policy and a changed logo', async () => {
    const other = await prisma.brand.create({ data: { name: `Kelvora${run}`, slug: `kelvora-${run}-${randomUUID().slice(0, 4)}` } });
    const count = await prisma.brand.count();
    const conflict = await save({ name: `Torvane${run}`, aliases: [`kelvora${run}`] });
    expect([conflict.status, conflict.body.code, conflict.body.brandId]).toEqual([409, 'ALIAS_CONFLICT', other.id]);
    const staleVersion = (await version()) - 1;
    const stale = await api().post('/ingestion/eligibility/brands/from-research').set(admin.auth).send({ expectedVersion: staleVersion, name: `Torvane${run}` });
    expect([stale.status, stale.body.code]).toEqual([409, 'POLICY_CHANGED']);
    expect(await prisma.brand.count()).toBe(count);

    // The logo changes between research and save: it is not stored, but the reviewed brand still is.
    const name = `Quillo${run}`;
    const host = `www.quillo${run}.example`;
    await publish(host, name, 200);
    search.mockResolvedValue([{ url: `https://${host}/`, title: name }]);
    const found = (await research(name, undefined, await createActor(prisma, 'ADMIN'))).body;
    expect(found.research.logo.status).toBe('VERIFIED');
    site.pages.set(`https://${host}/logo.png`, { status: 200, body: await logo(40), type: 'image/png' });
    app.get(ResearchSourceFetcher).reset();
    const saved = await save({ draftId: found.draftId, name, useLogo: true });
    expect(saved.body).toMatchObject({ logoSaved: false, logoNote: 'LOGO_CHANGED_OR_UNREACHABLE' });
    expect((await prisma.brand.findFirstOrThrow({ where: { name } })).logoUrl).toBeNull();

    // And once a name is taken, a second save of it is refused rather than duplicated.
    const again = await save({ name: name.toLowerCase() });
    expect([again.status, again.body.code]).toEqual([409, 'BRAND_EXISTS']);
    expect(await prisma.brand.count({ where: { name: { equals: name, mode: 'insensitive' } } })).toBe(1);
  }, 60000);

  it('rate-limits lookups per Admin', async () => {
    const actor = await createActor(prisma, 'ADMIN');
    search.mockResolvedValue([]);
    const statuses: number[] = [];
    for (let i = 0; i < 14; i++) statuses.push((await research(`Throttle${run}${'abcdefghijklmnop'[i]}`, undefined, actor)).status);
    expect(statuses.slice(0, 12).every(code => code === 201)).toBe(true);
    expect(statuses.slice(12)).toEqual([429, 429]);
  }, 60000);
});
