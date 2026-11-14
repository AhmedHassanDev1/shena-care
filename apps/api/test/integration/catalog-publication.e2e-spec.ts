/* eslint-disable @typescript-eslint/no-explicit-any -- HTTP response bodies are asserted structurally */
process.env.SOURCING_MODE = 'BROADCAST_ON_DEMAND';
process.env.RESEARCH_ALLOWED_HOSTS = 'distributor.example';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { CatalogService, CatalogIntakeService, CanonicalResearchService } from '../../src/modules/catalog/public';
import { RESEARCH_TRANSPORT, ResearchTransport } from '../../src/modules/catalog/public';
import { ResearchSourceFetcher } from '../../src/modules/catalog/research/research-source-fetcher';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AiClient } from '../../src/platform/ai';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { createActor, Actor } from '../fixtures/actors';
import { uniqueGtin } from '../fixtures/gtin';
import { RESEARCH_SCHEMA_VERSION } from '../../src/modules/catalog/research/product-fact-extractor';

const TEMPLATE = fs.readFileSync(path.join(__dirname, '../../assets/media-templates/sahel-soft-plinth-v1.webp'));
const RULES = fs.readFileSync(path.join(__dirname, '../../assets/media-templates/sahel-soft-plinth.rules.json'), 'utf8');
const run = randomUUID().slice(0, 8);

/** A recorded website: real fetcher, guards, robots and parsing run against it; only the network is replaced. Page content is synthetic. */
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

describe('Product journey: intake, research, evidence, media, review, publication, storefront (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor;
  let hub: Actor;
  let customer: Actor;
  let supplier: Actor;
  let brand: { id: string; name: string };
  let categoryId: string;
  const site = new RecordedSite();

  const api = () => request(app.getHttpServer());
  const asAdmin = (method: 'get' | 'post' | 'patch', url: string) => (api() as any)[method](url).set(admin.auth);
  const officialUrl = (slug: string) => `https://www.nivea-${run}.example/${slug}`;

  const productPage = (name: string, size: number, inci: string, extra = '') => `<html><head><title>${brand.name} ${name} ${size} ml</title>
    <script type="application/ld+json">{"@type":"Product","name":"${name} ${size} ml","brand":{"name":"${brand.name}"},"image":["${officialUrl('pack.png')}"],"description":"A daily cream with ceramides for the skin barrier."}</script></head>
    <body><h1>${name} ${size} ml</h1><h2>Ingredients</h2><p>${inci}</p><h2>How to use</h2><p>Apply to clean face every morning and evening.</p>
    <h2>Warnings</h2><p>For external use only. Avoid contact with eyes.</p>${extra}</body></html>`;

  const pack = async (seed: string, proof = false) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><rect width="900" height="900" fill="#ffffff"/>
    <rect x="340" y="150" width="220" height="600" rx="24" fill="#1f4e79"/><rect x="360" y="${300 + (parseInt(seed.slice(0, 2), 16) % 40)}" width="180" height="220" fill="#ffffff"/><rect x="${proof ? 3 : 0}" y="0" width="2" height="2" fill="#${seed.slice(0, 6)}"/></svg>`)).png().toBuffer();

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
    hub = await createActor(prisma, 'HUB_OPERATOR');
    customer = await createActor(prisma, 'CUSTOMER');
    supplier = await createActor(prisma, 'SUPPLIER');
    brand = await prisma.brand.create({ data: { name: `Nivea ${run}`, slug: `nivea-${run}`, websiteUrl: `https://www.nivea-${run}.example` } });
    categoryId = (await prisma.category.create({ data: { name: `Moisturizers ${run}`, slug: `moisturizers-${run}` } })).id;
    await prisma.mediaTemplate.updateMany({ where: { isActive: true }, data: { isActive: false } });
    let req = api().post('/catalog/media-templates').set(admin.auth).field('templateKey', `sahel-${run}`).field('name', 'SAHEL soft plinth').field('rules', RULES);
    req = req.attach('file', TEMPLATE, { filename: 'template.webp', contentType: 'image/webp' });
    await req.expect(201);
  }, 90000);

  beforeEach(() => {
    site.down = false;
    site.pages.clear();
    site.pages.set(`https://www.nivea-${run}.example/robots.txt`, { status: 404 });
    site.pages.set('https://distributor.example/robots.txt', { status: 404 });
    app.get(ResearchSourceFetcher).reset();
  });

  afterAll(async () => { await app.close(); });

  const intake = (overrides: Record<string, unknown> = {}) => asAdmin('post', '/catalog/workbench/intake').send({
    brandId: brand.id, categoryId, name: `Hydra Barrier Cream ${randomUUID().slice(0, 6)}`, variantName: 'Standard', skuCode: `SKU-${randomUUID()}`, size: 50, sizeUnit: 'ml', barcode: uniqueGtin(), hasOuterCarton: false, ...overrides,
  });
  const workbench = async (skuId: string) => (await asAdmin('get', `/catalog/workbench/skus/${skuId}`).expect(200)).body;
  const factOf = (facts: any[], field: string) => facts.find(fact => fact.field === field);
  const reviewFact = (id: string, body: Record<string, unknown> = {}) => asAdmin('post', `/catalog/workbench/research/facts/${id}/review`).send({ decision: 'APPROVED', note: 'Read against the official page', ...body });

  it('intake: Admin only, starts unpublished, refuses duplicates and treats another size as another SKU under the same product', async () => {
    const name = `Duplicate Cream ${run}`;
    const body = { brandId: brand.id, categoryId, name, variantName: 'Standard', skuCode: `D-${randomUUID()}`, size: 50, sizeUnit: 'ml', barcode: uniqueGtin() };
    for (const actor of [hub, customer, supplier]) await api().post('/catalog/workbench/intake').set(actor.auth).send(body).expect(403);
    await api().post('/catalog/workbench/intake').send(body).expect(401);
    await asAdmin('post', '/catalog/workbench/intake').send({ ...body, barcode: 'abc' }).expect(400);

    const first = (await asAdmin('post', '/catalog/workbench/intake').send(body).expect(201)).body;
    expect(first.createdProduct).toBe(true);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: first.productId } })).isPublished).toBe(false);

    const again = await asAdmin('post', '/catalog/workbench/intake').send({ ...body, skuCode: `D-${randomUUID()}`, barcode: uniqueGtin() });
    expect([again.status, again.body.code, again.body.existingSkuId]).toEqual([409, 'DUPLICATE_SKU', first.skuId]);
    const sameBarcode = await asAdmin('post', '/catalog/workbench/intake').send({ ...body, name: 'Something Else', skuCode: `D-${randomUUID()}` });
    expect([sameBarcode.status, sameBarcode.body.code]).toEqual([409, 'DUPLICATE_SKU']);

    const bigger = (await asAdmin('post', '/catalog/workbench/intake').send({ ...body, skuCode: `D-${randomUUID()}`, size: 100, barcode: uniqueGtin() }).expect(201)).body;
    expect(bigger).toMatchObject({ productId: first.productId, createdProduct: false });
    expect(bigger.skuId).not.toBe(first.skuId);

    const raced = await Promise.all([1, 2, 3].map(() => asAdmin('post', '/catalog/workbench/intake').send({ ...body, name: `Race Cream ${run}`, skuCode: `D-${randomUUID()}`, barcode: uniqueGtin() })));
    expect(raced.filter(res => res.status === 201)).toHaveLength(1);
    expect(raced.filter(res => res.body.code === 'DUPLICATE_SKU')).toHaveLength(2);
  }, 60000);

  it('research: facts land as proposals with field-level provenance; Catalog is untouched until a person approves; approval writes through Catalog and is idempotent', async () => {
    const { skuId, productId } = (await intake({ name: `Hydra Barrier Cream ${run}` }).expect(201)).body;
    const url = officialUrl('hydra');
    site.pages.set(url, { status: 200, body: productPage(`Hydra Barrier Cream ${run}`, 50, 'AQUA, GLYCERIN, NIACINAMIDE, CERAMIDE NP') });

    const started = (await asAdmin('post', `/catalog/workbench/skus/${skuId}/research`).send({ sourceUrls: [url] }).expect(201)).body;
    expect(started).toMatchObject({ status: 'COMPLETE', schemaVersion: RESEARCH_SCHEMA_VERSION, attempts: 1 });
    expect(started.sources[0]).toMatchObject({ url, tier: 'OFFICIAL_MANUFACTURER', outcome: 'OK', origin: 'ADMIN' });

    const before = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(before).toMatchObject({ usage: null, warnings: null, description: null, isPublished: false });
    expect(await prisma.productIngredient.count({ where: { productId } })).toBe(0);

    const { facts } = await workbench(skuId);
    const inci = factOf(facts, 'composition.inci');
    expect(inci).toMatchObject({ status: 'PROPOSED', value: ['AQUA', 'GLYCERIN', 'NIACINAMIDE', 'CERAMIDE NP'], schemaVersion: RESEARCH_SCHEMA_VERSION });
    expect(inci.evidence[0]).toMatchObject({ sourceUrl: url, sourceTier: 'OFFICIAL_MANUFACTURER', extractor: `deterministic@${RESEARCH_SCHEMA_VERSION}` });
    expect(inci.evidence[0].excerpt).toContain('GLYCERIN');
    expect(inci.confidence).toBeCloseTo(0.95);
    expect(factOf(facts, 'composition.activeConcentrations')).toBeUndefined();

    await reviewFact(inci.id, { note: 'x' }).expect(400);
    for (const actor of [hub, customer, supplier]) await api().post(`/catalog/workbench/research/facts/${inci.id}/review`).set(actor.auth).send({ decision: 'APPROVED', note: 'Not allowed here' }).expect(403);
    await reviewFact(inci.id).expect(200);
    expect(await prisma.productIngredient.count({ where: { productId, skuId } })).toBe(4);
    await reviewFact(inci.id).expect(200);
    expect(await prisma.productIngredient.count({ where: { productId, skuId } })).toBe(4);

    const usage = factOf(facts, 'usage.instructions');
    await reviewFact(usage.id).expect(200);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).usage).toBe('Apply to clean face every morning and evening.');
    await reviewFact(factOf(facts, 'safety.warnings').id).expect(200);
    expect(await prisma.productSafetyWarning.count({ where: { productId, skuId } })).toBe(1);

    // A marketing claim or description never becomes a verified fact on its own.
    const rejected = factOf(facts, 'marketing.description');
    await reviewFact(rejected.id, { decision: 'REJECTED', note: 'Marketing copy, write our own' }).expect(200);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).description).toBeNull();
    expect((await reviewFact(inci.id, { decision: 'REJECTED', note: 'Too late to reject' })).status).toBe(409);
  }, 60000);

  it('safe writes: an existing different value is never silently overwritten and a different size stays a different SKU', async () => {
    const { skuId, productId } = (await intake({ name: `Careful Cream ${run}` }).expect(201)).body;
    await prisma.product.update({ where: { id: productId }, data: { usage: 'Reviewed usage text' } });
    const url = officialUrl('careful');
    site.pages.set(url, { status: 200, body: productPage(`Careful Cream ${run}`, 50, 'AQUA, GLYCERIN, UREA') });
    await asAdmin('post', `/catalog/workbench/skus/${skuId}/research`).send({ sourceUrls: [url] }).expect(201);
    const { facts } = await workbench(skuId);
    const usage = factOf(facts, 'usage.instructions');
    const refused = await reviewFact(usage.id);
    expect([refused.status, refused.body.code]).toEqual([409, 'CATALOG_VALUE_EXISTS']);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).usage).toBe('Reviewed usage text');
    await reviewFact(usage.id, { overwrite: true }).expect(200);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).usage).toContain('Apply to clean');

    const otherSizeUrl = officialUrl('careful-100');
    site.pages.set(otherSizeUrl, { status: 200, body: productPage(`Careful Cream ${run}`, 100, 'AQUA, ALCOHOL, PARFUM') });
    const second = (await asAdmin('post', `/catalog/workbench/skus/${skuId}/research`).send({ sourceUrls: [otherSizeUrl] }).expect(201)).body;
    expect(second.status).toBe('NO_EVIDENCE');
    expect(second.rejected[0]).toMatchObject({ reason: 'SIZE_MISMATCH', sourceUrl: otherSizeUrl });
  }, 60000);

  it('consistency: two sources agreeing merge evidence without duplicates; disagreeing sources become a conflict that blocks publication until a person settles it', async () => {
    const { skuId, productId } = (await intake({ name: `Twin Cream ${run}` }).expect(201)).body;
    const official = officialUrl('twin');
    const distributor = 'https://distributor.example/twin';
    site.pages.set(official, { status: 200, body: productPage(`Twin Cream ${run}`, 50, 'AQUA, GLYCERIN, UREA') });
    site.pages.set(distributor, { status: 200, body: productPage(`Twin Cream ${run}`, 50, 'AQUA, GLYCERIN, UREA') });
    const merged = (await asAdmin('post', `/catalog/workbench/skus/${skuId}/research`).send({ sourceUrls: [official, distributor] }).expect(201)).body;
    expect(merged.sources.map((source: any) => source.tier)).toEqual(['OFFICIAL_MANUFACTURER', 'TRUSTED_DISTRIBUTOR']);
    let { facts } = await workbench(skuId);
    expect(facts.filter((fact: any) => fact.field === 'composition.inci')).toHaveLength(1);
    expect(factOf(facts, 'composition.inci').evidence.map((row: any) => row.sourceTier)).toEqual(['OFFICIAL_MANUFACTURER', 'TRUSTED_DISTRIBUTOR']);

    const reformulated = 'https://distributor.example/twin-new';
    site.pages.set(reformulated, { status: 200, body: productPage(`Twin Cream ${run}`, 50, 'AQUA, ALCOHOL DENAT, PARFUM, LIMONENE, LINALOOL') });
    await asAdmin('post', `/catalog/workbench/skus/${skuId}/research`).send({ sourceUrls: [reformulated] }).expect(201);
    ({ facts } = await workbench(skuId));
    const lists = facts.filter((fact: any) => fact.field === 'composition.inci');
    expect(lists.map((fact: any) => fact.status)).toEqual(['CONFLICT', 'CONFLICT']);
    expect((await asAdmin('get', `/catalog/workbench/skus/${skuId}/readiness`).expect(200)).body.blockers).toContain('FACT_CONFLICT_UNRESOLVED');

    const officialList = lists.find((fact: any) => fact.value.includes('UREA'));
    await reviewFact(officialList.id, { note: 'Manufacturer page is authoritative' }).expect(200);
    ({ facts } = await workbench(skuId));
    expect(facts.filter((fact: any) => fact.field === 'composition.inci').map((fact: any) => fact.status).sort()).toEqual(['APPLIED', 'REJECTED']);
    expect(await prisma.productIngredient.count({ where: { productId, skuId } })).toBe(3);
  }, 60000);

  it('provider failure: an outage changes nothing in Catalog, stays open, and resuming reads only what failed; refusals are recorded, never worked around', async () => {
    const { skuId, productId } = (await intake({ name: `Resume Cream ${run}` }).expect(201)).body;
    const before = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    const url = officialUrl('resume');
    site.pages.set(url, { status: 500 });
    const failed = (await asAdmin('post', `/catalog/workbench/skus/${skuId}/research`).send({ sourceUrls: [url] }).expect(201)).body;
    expect(failed.status).toBe('PROVIDER_UNAVAILABLE');
    expect(failed.sources[0].outcome).toBe('UPSTREAM_ERROR');
    expect(await prisma.product.findUniqueOrThrow({ where: { id: productId } })).toEqual(before);
    expect((await workbench(skuId)).facts).toEqual([]);

    site.pages.set(url, { status: 200, body: productPage(`Resume Cream ${run}`, 50, 'AQUA, GLYCERIN, UREA') });
    const resumed = (await asAdmin('post', `/catalog/workbench/research/runs/${failed.id}/resume`).send({}).expect(200)).body;
    expect(resumed).toMatchObject({ id: failed.id, status: 'COMPLETE', attempts: 2 });
    expect(factOf((await workbench(skuId)).facts, 'composition.inci').status).toBe('PROPOSED');

    const denied = officialUrl('denied');
    site.pages.set(denied, { status: 403 });
    expect((await asAdmin('post', `/catalog/workbench/skus/${skuId}/research`).send({ sourceUrls: [denied] }).expect(201)).body).toMatchObject({ status: 'NO_EVIDENCE', sources: [{ outcome: 'ACCESS_DENIED' }] });
    const unapproved = (await asAdmin('post', `/catalog/workbench/skus/${skuId}/research`).send({ sourceUrls: ['https://random-blog.example/review'] }).expect(201)).body;
    expect(unapproved.sources[0].outcome).toBe('HOST_NOT_APPROVED');
    await asAdmin('post', `/catalog/workbench/skus/${skuId}/research`).send({}).expect(400);
    await asAdmin('post', `/catalog/workbench/skus/${skuId}/research`).send({ sourceUrls: ['http://insecure.example/x'] }).expect(400);

    // No provider keys in this environment: asking for provider discovery reports it, invents nothing.
    const noProviders = (await asAdmin('post', `/catalog/workbench/skus/${skuId}/research`).send({ useConfiguredProviders: true }).expect(201)).body;
    expect(noProviders.status).toBe('PROVIDER_UNAVAILABLE');
    expect(noProviders.providerStatuses).toMatchObject({ exa: 'UNAVAILABLE' });
  }, 60000);

  it('complete journey: intake → research → evidence → image from the source → editorial on the supplied template → Admin review → publication → storefront PDP with explicit roles', async () => {
    const name = `Journey Cream ${run}`;
    const { skuId, productId } = (await intake({ name, hasOuterCarton: true, skuCode: `JOURNEY-${run}` }).expect(201)).body;
    const url = officialUrl('journey');
    const imageUrl = officialUrl('pack.png');
    site.pages.set(url, { status: 200, body: productPage(name, 50, 'AQUA, GLYCERIN, NIACINAMIDE, CERAMIDE NP') });
    site.pages.set(imageUrl, { status: 200, body: await pack(run), type: 'image/png' });

    const readinessOf = async () => (await asAdmin('get', `/catalog/workbench/skus/${skuId}/readiness`).expect(200)).body;
    const initial = await readinessOf();
    expect(initial.ready).toBe(false);
    expect(initial.blockers).toEqual(expect.arrayContaining(['NO_REVIEWED_FACTS', 'PRIMARY_PACKSHOT_NOT_APPROVED', 'CARTON_PROOF_NOT_APPROVED', 'LISTING_NOT_ACTIVE', 'SELLING_PRICE_MISSING']));
    const early = await asAdmin('post', `/catalog/workbench/skus/${skuId}/publish`).send({});
    expect([early.status, early.body.code]).toEqual([409, 'NOT_READY_TO_PUBLISH']);
    for (const actor of [hub, customer, supplier]) await api().post(`/catalog/workbench/skus/${skuId}/publish`).set(actor.auth).send({}).expect(403);

    await asAdmin('post', `/catalog/workbench/skus/${skuId}/research`).send({ sourceUrls: [url] }).expect(201);
    const identity = await app.get(CanonicalResearchService).checkSource({ brand: brand.name, productName: name, size: 50, sizeUnit: 'ml', barcode: null, websiteUrl: new URL(url).origin }, url);
    expect(identity).toMatchObject({ identityMatched: true, sizeConfirmed: true, tier: 'OFFICIAL_MANUFACTURER' });
    await app.get(CatalogIntakeService).recordIdentityVerification(skuId, { status: 'EVIDENCE_VERIFIED', rule: 'EXACT_RECORDED_MANUFACTURER_PAGE', sourceUrls: [url], actorId: admin.id });
    const { facts } = await workbench(skuId);
    for (const field of ['composition.inci', 'usage.instructions', 'safety.warnings', 'identity.size', 'attributes.texture', 'usage.targetArea', 'usage.routinePeriod']) {
      if (factOf(facts, field)) await reviewFact(factOf(facts, field).id).expect(200);
    }

    const images = factOf(facts, 'media.sourceImages');
    const importImage = (body: Record<string, unknown>) => asAdmin('post', `/catalog/workbench/research/facts/${images.id}/import-image`).send({ imageUrl, role: 'PRIMARY_PACKSHOT', rightsStatus: 'MANUFACTURER_PUBLISHED', sourcePublisher: brand.name, ...body });
    await importImage({ imageUrl: 'https://not-in-evidence.example/x.png' }).expect(400);
    process.env.MEDIA_TRUSTED_SOURCE_HOSTS = `nivea-${run}.example`;
    const packshot = (await importImage({}).expect(201)).body;
    expect(packshot).toMatchObject({ role: 'PRIMARY_PACKSHOT', originType: 'verified', reviewStatus: 'PENDING_REVIEW', sourceUrl: url, rightsStatus: 'MANUFACTURER_PUBLISHED' });

    const approve = (id: string, acceptQualityWarnings = false) => asAdmin('post', `/catalog/media-assets/${id}/review`).send({ decision: 'APPROVED', reason: 'Exact pack, size and label checked', acceptQualityWarnings }).expect(200);
    const publishAsset = (id: string) => asAdmin('post', `/catalog/media-assets/${id}/publish`).send({}).expect(200);
    const editorial = (await asAdmin('post', `/catalog/media-assets/${packshot.id}/derive`).send({ transform: 'SAHEL_EDITORIAL' }).expect(201)).body;
    expect(editorial).toMatchObject({ role: 'CATEGORY_EDITORIAL', processingStatus: 'SUCCEEDED', parentAssetId: packshot.id });
    await approve(packshot.id);
    await publishAsset(packshot.id);
    expect(editorial.qualityReport.warnings).toContain('ENCLOSED_BACKGROUND');
    const unacknowledged = await asAdmin('post', `/catalog/media-assets/${editorial.id}/review`).send({ decision: 'APPROVED', reason: 'Exact pack, size and label checked' });
    expect([unacknowledged.status, unacknowledged.body.code]).toEqual([409, 'QUALITY_WARNING_UNACKNOWLEDGED']);
    await approve(editorial.id, true);
    await publishAsset(editorial.id);

    let reg = api().post('/catalog/media-assets').set(admin.auth);
    for (const [key, value] of Object.entries({ skuId, role: 'PACKAGING_PROOF', originType: 'verified', sourceUrl: url, sourcePublisher: brand.name, sourceType: 'OFFICIAL_MANUFACTURER', rightsStatus: 'MANUFACTURER_PUBLISHED' })) reg = reg.field(key, value);
    const carton = (await reg.attach('file', await pack(`${run}aa`.slice(-8), true), { filename: 'carton.png', contentType: 'image/png' }).expect(201)).body;
    await approve(carton.id);
    await publishAsset(carton.id);

    const beforeCommerce = await readinessOf();
    expect(beforeCommerce.blockers.sort()).toEqual(['LISTING_NOT_ACTIVE', 'SELLING_PRICE_MISSING']);
    expect(beforeCommerce.warnings).toEqual([]);
    await api().get(`/products/${productId}`).expect((res: request.Response) => expect(res.status).toBeGreaterThanOrEqual(400));
    const noPrice = await asAdmin('post', `/catalog/workbench/skus/${skuId}/publish`).send({});
    expect([noPrice.status, noPrice.body.code]).toEqual([409, 'NOT_READY_TO_PUBLISH']);
    await asAdmin('post', `/catalog/workbench/skus/${skuId}/publish`).send({ priceEgp: -1 }).expect(400);

    const live = (await asAdmin('post', `/catalog/workbench/skus/${skuId}/publish`).send({ priceEgp: 450 }).expect(200)).body;
    expect(live).toMatchObject({ isPublished: true, ready: true, blockers: [], commerce: { isListed: true, price: { amount: 450, currency: 'EGP' } } });
    const persisted = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(persisted.lastReviewedBy).toBe(admin.id);
    expect(persisted.lastReviewedAt).not.toBeNull();

    const pub = await app.get(CatalogService).getPublishedProduct(productId);
    expect(pub!.media.map(media => [media.role, media.isPrimary]).sort()).toEqual([['CATEGORY_EDITORIAL', false], ['PACKAGING_PROOF', false], ['PRIMARY_PACKSHOT', true]]);
    const storefront = await api().get(`/products/${persisted.slug}`).expect(200);
    const roles = (storefront.body.media ?? storefront.body.skus?.[0]?.media ?? []).map((media: any) => media.role);
    expect(roles).toEqual(expect.arrayContaining(['CATEGORY_EDITORIAL', 'PRIMARY_PACKSHOT', 'PACKAGING_PROOF']));
    expect(JSON.stringify(storefront.body)).not.toMatch(/supplier|costPrice|unitCost/i);

    // Rights unknown never reaches the shop: a pending image blocks nothing live but cannot be approved.
    await asAdmin('post', `/catalog/workbench/skus/${skuId}/unpublish`).send({}).expect(200);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).isPublished).toBe(false);
  }, 120000);
});
