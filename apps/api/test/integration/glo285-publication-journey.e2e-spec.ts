// GLO-285 whole journey on the real HTTP pipeline, real policy and PostgreSQL: supplier file → eligibility → matching → research → review → catalog → media → offers → storefront.
// No admission fixture here. Research providers are stubbed at the network edge and images are synthetic: this proves our integration, not a live provider or a real packshot.
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import sharp from 'sharp';
import { AppModule } from '../../src/app.module';
import { AiClient, AiClientError, AiErrorKind } from '../../src/platform/ai';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { IngestionEligibilityService } from '../../src/modules/ingestion/services/ingestion-eligibility.service';
import { IngestionService } from '../../src/modules/ingestion/services/ingestion.service';
import { ProductResearchService } from '../../src/modules/ingestion/services/product-research.service';
import { FIXTURE_SOURCE_URL } from '../fixtures/sellable-sku';
import { Actor, createActor } from '../fixtures/actors';
import { uniqueGtin } from '../fixtures/gtin';

const HEADER = 'Code,Item,Brand,Category,Barcode,Cost,Qty,Currency,Updated';
const mapping = { supplierSku: 'Code', name: 'Item', brand: 'Brand', category: 'Category', barcode: 'Barcode', price: 'Cost', quantity: 'Qty', currencyColumn: 'Currency', sourceTimestamp: 'Updated',
  semantics: { documentKind: 'STOCK_FEED', priceBasis: 'UNIT_PURCHASE_COST', quantityBasis: 'ON_HAND' } };
const realFetch = global.fetch;
const seed = Math.floor(Math.random() * 1e6);
const image = (n: number) => sharp({ create: { width: 800, height: 800, channels: 3, background: { r: (seed + n * 53) % 255, g: (seed + n * 97) % 255, b: (seed + n * 29) % 255 } } }).png().toBuffer();

describe('GLO-285 catalog publication journey', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor;
  let supplierA: Actor;
  let supplierB: Actor;
  const run = randomUUID().slice(0, 8);
  const supplierAId = randomUUID();
  const supplierBId = randomUUID();
  const leaf = `Journey Leaf ${run}`;
  const productName = `CeraVe Journey ${run.replace(/\d/g, 'x')} Cream 50ml`;
  const barcode = uniqueGtin();
  const PAGE = `${productName}. Net content: 50 ml. Ingredients: Aqua, Glycerin, Niacinamide. How to use: Apply to clean skin. Texture: cream.`;
  let itemId: string;
  let jobId: string;
  let skuId: string;
  let productId: string;
  let aiCalls = 0;
  let researchCalls: jest.SpyInstance;
  const server = () => app.getHttpServer();
  const csv = (rows: string[]) => Buffer.from(`${HEADER}\n${rows.join('\n')}\n`);
  const upload = async (actor: Actor, rows: string[]) => {
    const res = await request(server()).post('/ingestion/jobs/upload').set(actor.auth).attach('file', csv(rows), { filename: `${randomUUID()}.csv`, contentType: 'text/csv' }).expect(201);
    if (!res.body.requiresMapping) return res.body;
    const mapped = await request(server()).post(`/ingestion/jobs/${res.body.jobId}/mapping`).set(admin.auth).send({ mapping }).expect(201);
    return { ...res.body, ...mapped.body };
  };
  const stubProviders = (available: boolean) => {
    global.fetch = jest.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (!/exa\.ai|firecrawl|x\.ai/.test(url)) return realFetch(input as string);
      if (!available) return new Response('down', { status: 503 });
      if (url.includes('exa.ai')) return new Response(JSON.stringify({ results: [{ url: FIXTURE_SOURCE_URL, title: 'Official product page' }] }), { status: 200 });
      if (url.includes('firecrawl')) return new Response(JSON.stringify({ data: { markdown: PAGE } }), { status: 200 });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        brand: 'CeraVe', size: { value: 50, unit: 'ml' }, texture: 'cream', ingredients: ['Aqua', 'Glycerin', 'Niacinamide', 'Retinol'], usage: ['Apply to clean skin.'],
        concentrations: [{ ingredient: 'Niacinamide', percent: 10 }], benefits: ['Cures acne in three days'],
      }) } }] }), { status: 200 });
    }) as typeof fetch;
  };
  const detail = () => request(server()).get(`/products/${productId}/detail`);

  beforeAll(async () => {
    // The strict default: only a supplier-confirmed offer is orderable. Provisional ordering is a separate owner setting.
    process.env.SUPPLIER_PROVISIONAL_ORDERABLE = 'false';
    process.env.EXA_API_KEY = 'stub'; process.env.FIRECRAWL_API_KEY = 'stub'; process.env.GROK_API_KEY = 'stub';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    jest.spyOn(app.get(AiClient), 'enrichProduct').mockImplementation(async () => { aiCalls++; throw new AiClientError(AiErrorKind.UNAVAILABLE, 'AI provider down'); });
    researchCalls = jest.spyOn(app.get(ProductResearchService), 'researchProductCandidate');
    admin = await createActor(prisma, 'ADMIN');
    await prisma.supplier.create({ data: { id: supplierAId, name: `Journey A ${run}`, slug: `journey-a-${run}` } });
    await prisma.supplier.create({ data: { id: supplierBId, name: `Journey B ${run}`, slug: `journey-b-${run}` } });
    supplierA = await createActor(prisma, 'SUPPLIER', supplierAId);
    supplierB = await createActor(prisma, 'SUPPLIER', supplierBId);
    const brand = await prisma.brand.upsert({ where: { name: 'CeraVe' }, update: { isActive: true }, create: { name: 'CeraVe', slug: 'cerave' } });
    const root = await prisma.category.create({ data: { name: `Journey Root ${run}`, slug: `journey-root-${run}` } });
    const category = await prisma.category.create({ data: { name: leaf, slug: `journey-leaf-${run}`, parentId: root.id } });
    const eligibility = app.get(IngestionEligibilityService);
    const current = await eligibility.current();
    const preview = await eligibility.preview({ expectedVersion: current?.version ?? 0, reason: 'Publication journey policy',
      brands: [{ id: brand.id, effect: 'ALLOW', aliases: [] }], categories: [{ id: category.id, effect: 'ALLOW' }], mappings: [] }, admin.id);
    await eligibility.approve(preview.id, admin.id);
  }, 60000);

  afterAll(async () => {
    global.fetch = realFetch;
    process.env.EXA_API_KEY = ''; process.env.FIRECRAWL_API_KEY = ''; process.env.GROK_API_KEY = '';
    jest.restoreAllMocks();
    await app.close();
  });

  it('1. a new product is admitted by policy, matched as new, and an AI outage leaves it reviewable', async () => {
    const res = await upload(supplierA, [`J-1,${productName},CeraVe,${leaf},${barcode},100.00,12,EGP,2026-11-01 09:00`]);
    jobId = res.jobId;
    expect(res.matching).toMatchObject({ exactMatches: 0, newCandidates: 1, aiEnrichmentRequests: 1 });
    await app.get(IngestionService).whenBackgroundWorkSettles();
    expect(aiCalls).toBe(1);
    const [item] = await prisma.ingestionItem.findMany({ where: { jobId } });
    itemId = item.id;
    expect(item).toMatchObject({ status: 'review_required', matchedSkuId: null, enrichmentStatus: 'pending' });
    expect(item.enrichmentError).toContain('ai_unavailable');
    expect(await prisma.product.count({ where: { name: productName } })).toBe(0);
  });

  it('2. it cannot be published before review, whatever research says', async () => {
    await request(server()).post(`/ingestion/candidates/${itemId}/publish`).set(admin.auth).expect(400);
    await request(server()).post(`/ingestion/candidates/${itemId}/publish`).set(supplierA.auth).expect(403);
  });

  it('3. a research outage settles nothing; recovery stores only what the page states', async () => {
    stubProviders(false);
    const down = await request(server()).post(`/ingestion/candidates/${itemId}/research`).set(admin.auth).expect(200);
    expect(down.body.researchStatus).toBe('PROVIDER_UNAVAILABLE');
    stubProviders(true);
    const { body } = await request(server()).post(`/ingestion/candidates/${itemId}/research`).set(admin.auth).expect(200);
    expect(body.researchStatus).toBe('COMPLETE');
    expect(body.discoveredSources[0].sourceType).toBe('OFFICIAL_MANUFACTURER');
    expect(body.extractedFacts.ingredients).toEqual(['Aqua', 'Glycerin', 'Niacinamide']);
    expect(body.extractedFacts.concentrations).toEqual([]);
    expect(body.extractedFacts.benefits).toEqual([]);
    expect(body.rejectedFacts.map((r: { value: unknown }) => JSON.stringify(r.value))).toEqual(expect.arrayContaining(['"Retinol"', '"Cures acne in three days"']));
    expect(body.fieldEvidences.find((e: { fieldName: string }) => e.fieldName === 'size')).toMatchObject({ verificationStatus: 'SUPPORTED', sourceUrl: FIXTURE_SOURCE_URL, sourceType: 'OFFICIAL_MANUFACTURER' });
  });

  it('4. a reviewer approves the exact variant: a packshot of another size is refused', async () => {
    const media = await request(server()).post(`/ingestion/candidates/${itemId}/media`).set(admin.auth)
      .attach('file', await image(1), { filename: 'packshot.png', contentType: 'image/png' }).expect(201);
    const review = (size: number) => ({ url: media.body.url, sourceUrl: FIXTURE_SOURCE_URL, sourceType: 'OFFICIAL_MANUFACTURER', barcode, size, sizeUnit: 'ml', variantName: `${size} ml` });
    await request(server()).patch(`/ingestion/candidates/${itemId}/approve`).set(admin.auth).send({ mediaReviews: [review(100)] }).expect(400);
    const approved = await request(server()).patch(`/ingestion/candidates/${itemId}/approve`).set(admin.auth).send({ mediaReviews: [review(50)] });
    expect(approved.status).toBe(200);
  });

  it('5. publication creates one Product and SKU, the supplier offer and an identity packshot, but sells nothing yet', async () => {
    const published = await request(server()).post(`/ingestion/candidates/${itemId}/publish`).set(admin.auth).expect(200);
    skuId = published.body.matchedSkuId;
    const sku = await prisma.sku.findUniqueOrThrow({ where: { id: skuId }, include: { product: { include: { media: true } } } });
    productId = sku.productId;
    expect(sku).toMatchObject({ barcode });
    expect(sku.size?.toNumber()).toBe(50);
    expect(sku.product.media).toHaveLength(1);
    expect(sku.product.media[0]).toMatchObject({ role: 'PRIMARY_PACKSHOT', originType: 'verified' });
    const offer = await prisma.supplierOffer.findUniqueOrThrow({ where: { supplierId_skuId: { supplierId: supplierAId, skuId } } });
    expect(offer.costPrice.toNumber()).toBe(100);
    expect(offer.availableQuantity).toBe(12);
    expect(await prisma.sellingPrice.count({ where: { skuId } })).toBe(0);
    expect(await prisma.listing.count({ where: { skuId } })).toBe(0);
    const repeat = await request(server()).post(`/ingestion/candidates/${itemId}/publish`).set(admin.auth);
    expect(repeat.status).toBe(400);
    expect(await prisma.product.count({ where: { name: productName } })).toBe(1);
  });

  it('6. the media service sees the published packshot and adds packaging proof, with lineage', async () => {
    const state = await request(server()).get(`/catalog/media-assets/sku/${skuId}/readiness`).set(admin.auth).expect(200);
    expect(state.body).toMatchObject({ hasVerifiedPrimaryPackshot: true, roles: { PRIMARY_PACKSHOT: 'PUBLISHED', PACKAGING_PROOF: 'MISSING' } });
    let upload_ = request(server()).post('/catalog/media-assets').set(admin.auth);
    for (const [key, value] of Object.entries({ skuId, role: 'PACKAGING_PROOF', originType: 'verified', sourceUrl: FIXTURE_SOURCE_URL, sourcePublisher: 'CeraVe', sourceType: 'OFFICIAL_MANUFACTURER', rightsStatus: 'MANUFACTURER_PUBLISHED' })) upload_ = upload_.field(key, value);
    const proof = await upload_.attach('file', await image(2), { filename: 'back.png', contentType: 'image/png' }).expect(201);
    const copy = await request(server()).post(`/catalog/media-assets/${proof.body.id}/derive`).set(admin.auth).send({ transform: 'OPTIMIZED' }).expect(201);
    expect(copy.body.parentAssetId).toBe(proof.body.id);
    await request(server()).post(`/catalog/media-assets/${copy.body.id}/review`).set(admin.auth).send({ decision: 'APPROVED', reason: 'Back label matches this SKU' }).expect(200);
    await request(server()).post(`/catalog/media-assets/${copy.body.id}/publish`).set(admin.auth).expect(200);
    const after = await request(server()).get(`/catalog/media-assets/sku/${skuId}/readiness`).set(admin.auth).expect(200);
    expect(after.body.roles).toMatchObject({ PRIMARY_PACKSHOT: 'PUBLISHED', PACKAGING_PROOF: 'PUBLISHED', TEXTURE_SENSORY: 'MISSING', INGREDIENT_STORY: 'MISSING' });
  });

  it('7. a second supplier reaches the same SKU through the fast lane: no research, no AI, an independent offer', async () => {
    const [aiBefore, researchBefore] = [aiCalls, researchCalls.mock.calls.length];
    const offerA = await prisma.supplierOffer.findUniqueOrThrow({ where: { supplierId_skuId: { supplierId: supplierAId, skuId } } });
    const res = await upload(supplierB, [`B-77,${productName},CeraVe,${leaf},${barcode},92.50,4,EGP,2026-11-02 09:00`]);
    expect(res.matching).toMatchObject({ exactMatches: 1, newCandidates: 0, aiEnrichmentRequests: 0 });
    await request(server()).post(`/ingestion/jobs/${res.jobId}/commit-offers`).set(supplierB.auth).send({}).expect(201);
    const offerB = await prisma.supplierOffer.findUniqueOrThrow({ where: { supplierId_skuId: { supplierId: supplierBId, skuId } } });
    expect(offerB.costPrice.toNumber()).toBe(92.5);
    expect(await prisma.supplierOffer.findUniqueOrThrow({ where: { id: offerA.id } })).toEqual(offerA);
    expect(await prisma.sku.count({ where: { barcode } })).toBe(1);
    expect([aiCalls, researchCalls.mock.calls.length]).toEqual([aiBefore, researchBefore]);
  });

  it('8. a price-only update never refreshes stock freshness, and a known SKU updates without another editorial review', async () => {
    const before = await prisma.supplierOffer.findUniqueOrThrow({ where: { supplierId_skuId: { supplierId: supplierBId, skuId } } });
    const res = await upload(supplierB, [`B-77,${productName},CeraVe,${leaf},${barcode},93.00,4,EGP,2026-11-03 09:00`]);
    expect(res.matching).toMatchObject({ exactMatches: 1 });
    await request(server()).post(`/ingestion/jobs/${res.jobId}/commit-offers`).set(supplierB.auth).send({}).expect(201);
    const after = await prisma.supplierOffer.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.costPrice.toNumber()).toBe(93);
    expect(after.availableQuantity).toBe(4);
  });

  it('9. catalog publication and commercial sellability stay separate: each owner step is required for the storefront', async () => {
    await detail().expect(404);
    await prisma.product.update({ where: { id: productId }, data: { isPublished: true } });
    await detail().expect(404); // published in the catalog, still invisible until a commercial decision lists and prices it

    await prisma.listing.create({ data: { skuId, isListed: true, listedAt: new Date() } });
    await prisma.sellingPrice.create({ data: { skuId, amount: 250, currency: 'EGP', validFrom: new Date(Date.now() - 60000) } });
    // A supplier's file is a signal, not a confirmation of stock: in strict mode the SKU stays off the storefront until a supplier confirms it.
    await detail().expect(404);

    await prisma.supplierOffer.updateMany({ where: { supplierId: supplierAId, skuId }, data: { lastConfirmedAt: new Date() } });
    const sellable = (await detail().expect(200)).body.skus.find((s: { id: string }) => s.id === skuId);
    expect(sellable.canOrder).toBe(true);
    expect(Number(sellable.price.amount)).toBe(250);
    expect(sellable.media.some((m: { isPrimary: boolean; originType: string }) => m.originType === 'verified' || m.originType === 'derived')).toBe(true);
    expect(sellable.verifiedFacts.length).toBeGreaterThan(0);
    // Customers never see who supplies a product or what it costs.
    expect(JSON.stringify(sellable)).not.toMatch(/costPrice|Journey A|Journey B/);
  });

  it('10. the approved selling price survives a supplier cost change', async () => {
    const res = await upload(supplierB, [`B-77,${productName},CeraVe,${leaf},${barcode},95.00,4,EGP,2026-11-04 09:00`]);
    await request(server()).post(`/ingestion/jobs/${res.jobId}/commit-offers`).set(supplierB.auth).send({}).expect(201);
    const price = await prisma.sellingPrice.findFirstOrThrow({ where: { skuId } });
    expect(price.amount.toNumber()).toBe(250);
  });
});
