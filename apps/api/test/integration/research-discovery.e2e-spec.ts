import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AiClient } from '../../src/platform/ai';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { CanonicalResearchService } from '../../src/modules/catalog/research/canonical-research.service';
import { ProductResearchService } from '../../src/modules/catalog/research/product-research.service';
import { ResearchSourceFetcher } from '../../src/modules/catalog/research/research-source-fetcher';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { Actor, createActor } from '../fixtures/actors';

const nonce = randomUUID().slice(0, 8);
const brandName = `Sourcecare${nonce}`;
const host = `${brandName.toLowerCase()}.example`;
const title = (name: string, size: number) => `${brandName} ${name} ${size} ml`;
const source = (slug: string) => `https://${host}/products/${slug}`;

describe('configured product discovery with PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let research: CanonicalResearchService;
  let provider: ProductResearchService;
  let admin: Actor;
  let brandId: string;
  let categoryId: string;
  const originalFetch = global.fetch;
  const originalExa = process.env.EXA_API_KEY;
  const originalFirecrawl = process.env.FIRECRAWL_API_KEY;

  const api = () => request(app.getHttpServer());
  const intake = async (name: string) => (await api().post('/catalog/workbench/intake').set(admin.auth).send({
    brandId, categoryId, name, variantName: '50 ml', skuCode: `RESEARCH-${randomUUID()}`, size: 50, sizeUnit: 'ml',
  }).expect(201)).body as { skuId: string; productId: string };
  const run = async (skuId: string) => (await api().post(`/catalog/workbench/skus/${skuId}/research`).set(admin.auth)
    .send({ useConfiguredProviders: true }).expect(201)).body as { id: string; status: string; sources: Array<{ url: string; outcome: string }> };
  const pages = (name: string, first: string, second: string, preamble = '') => {
    const firstUrl = source(`${name.toLowerCase()}-a`);
    const secondUrl = source(`${name.toLowerCase()}-b`);
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('api.exa.ai')) return { ok: true, json: async () => ({ results: [
        { title: brandName, url: source('brand') },
        { title: title(name, 100), url: source(`${name.toLowerCase()}-100`) },
        { title: title(name, 50), url: firstUrl },
        { title: title(name, 50), url: secondUrl },
      ] }) } as Response;
      if (String(url).includes('api.firecrawl.dev')) {
        const pageUrl = (JSON.parse(String(init?.body)) as { url: string }).url;
        return { ok: true, json: async () => ({ data: { markdown: `${pageUrl === firstUrl ? preamble : ''}# ${title(name, 50)}\n${pageUrl === firstUrl ? first : second}` } }) } as Response;
      }
      throw new Error(`Unexpected network request: ${String(url)}`);
    }) as typeof fetch;
    return { firstUrl, secondUrl };
  };

  beforeAll(async () => {
    process.env.EXA_API_KEY = 'local-test-exa';
    process.env.FIRECRAWL_API_KEY = 'local-test-firecrawl';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient).useClass(DeterministicAiClient).compile();
    app = moduleRef.createNestApplication();
    app.useLogger(false);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    research = app.get(CanonicalResearchService);
    provider = app.get(ProductResearchService);
    admin = await createActor(prisma, 'ADMIN');
    brandId = (await prisma.brand.create({ data: { name: brandName, slug: brandName.toLowerCase(), websiteUrl: `https://${host}` } })).id;
    categoryId = (await prisma.category.create({ data: { name: `Creams ${nonce}`, slug: `creams-${nonce}` } })).id;
  }, 90000);

  afterAll(async () => {
    global.fetch = originalFetch;
    if (originalExa === undefined) delete process.env.EXA_API_KEY; else process.env.EXA_API_KEY = originalExa;
    if (originalFirecrawl === undefined) delete process.env.FIRECRAWL_API_KEY; else process.env.FIRECRAWL_API_KEY = originalFirecrawl;
    if (app) await app.close();
  });

  it('persists only exact SKU facts with source-specific evidence and deduplicates a repeated run', async () => {
    const name = `Hydra${nonce} Cream`;
    const { skuId, productId } = await intake(name);
    const { firstUrl, secondUrl } = pages(name, 'Ingredients: Aqua, Glycerin, Niacinamide',
      'Directions: Apply to clean skin every evening', '[Related 60 ml](https://example.com/other)\nIngredients: Parfum\n');

    const firstRun = await run(skuId);
    expect(firstRun.status).toBe('COMPLETE');
    expect(firstRun.sources.map(item => item.url)).toEqual([firstUrl, secondUrl]);
    expect(firstRun.sources.every(item => item.outcome === 'OK')).toBe(true);
    const initial = await prisma.productFactProposal.findMany({ where: { skuId } });
    const ingredients = initial.find(item => item.field === 'composition.keyIngredients');
    const usage = initial.find(item => item.field === 'usage.instructions');
    expect((ingredients?.evidence as unknown as Array<{ sourceUrl: string }>)[0].sourceUrl).toBe(firstUrl);
    expect(ingredients?.value).toEqual([{ name: 'Aqua', function: null }, { name: 'Glycerin', function: null }, { name: 'Niacinamide', function: null }]);
    expect((usage?.evidence as unknown as Array<{ sourceUrl: string }>)[0].sourceUrl).toBe(secondUrl);
    expect(initial.some(item => JSON.stringify(item.evidence).includes('/brand') || JSON.stringify(item.evidence).includes('-100'))).toBe(false);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).usage).toBeNull();

    await run(skuId);
    const repeated = await prisma.productFactProposal.findMany({ where: { skuId } });
    expect(repeated).toHaveLength(initial.length);
    const size = repeated.find(item => item.field === 'identity.size');
    expect(size?.value).toEqual({ value: 50, unit: 'ml' });
    expect((size?.evidence as unknown as Array<{ sourceUrl: string }>).map(item => item.sourceUrl)).toEqual([firstUrl, secondUrl]);

    const verified = await research.autoVerify(skuId, admin.id);
    expect(verified.applied).toContain('usage.instructions');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).usage).toBe('Apply to clean skin every evening');
    expect((await research.autoVerify(skuId, admin.id)).applied).toEqual([]);
    expect(provider.usage.searches).toBe(1);
  }, 60000);

  it('preserves an existing reviewed ingredient claim when a new page names fewer ingredients', async () => {
    const name = `Guard${nonce} Cream`;
    const { skuId, productId } = await intake(name);
    const original = { keyIngredients: { items: [{ name: 'Panthenol', function: null }], sourceUrl: source('reviewed'),
      sourceTier: 'OFFICIAL_MANUFACTURER', excerpt: 'Panthenol', appliedAt: '2026-11-09T00:00:00.000Z' } };
    await prisma.product.update({ where: { id: productId }, data: { claimsEvidence: original } });
    pages(name, 'Ingredients: Niacinamide', 'Directions: Apply to clean skin daily');

    await run(skuId);
    const verified = await research.autoVerify(skuId, admin.id);

    expect(verified.unverified).toContain('composition.keyIngredients');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).claimsEvidence).toEqual(original);
  }, 60000);

  it('holds contradictory official directions for critical review without changing the catalog', async () => {
    const name = `Calm${nonce} Cream`;
    const { skuId, productId } = await intake(name);
    pages(name, 'Directions: Apply and leave on until absorbed', 'Directions: Apply to skin and rinse thoroughly');

    expect((await run(skuId)).status).toBe('COMPLETE');
    const facts = await prisma.productFactProposal.findMany({ where: { skuId, field: 'usage.instructions' } });
    expect(facts).toHaveLength(2);
    expect(facts.every(item => item.status === 'PROPOSED')).toBe(true);
    const verified = await research.autoVerify(skuId, admin.id);
    expect(verified.holds.some(item => item.field === 'usage.instructions')).toBe(true);
    expect((await prisma.productFactProposal.findMany({ where: { skuId, field: 'usage.instructions' } })).every(item => item.status === 'CONFLICT')).toBe(true);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).usage).toBeNull();
  }, 60000);

  it('completes a run when provider evidence recovers a rate-limited direct source', async () => {
    const name = `Recover${nonce} Cream`;
    const { skuId } = await intake(name);
    pages(name, 'Ingredients: Glycerin', 'Directions: Apply to clean skin daily');
    const direct = jest.spyOn(app.get(ResearchSourceFetcher), 'fetch').mockResolvedValue({ outcome: 'RATE_LIMITED', detail: 'HTTP 429' });
    try {
      const result = (await api().post(`/catalog/workbench/skus/${skuId}/research`).set(admin.auth)
        .send({ sourceUrls: [source('old-page')], useConfiguredProviders: true }).expect(201)).body;
      expect(result.sources.some((item: { outcome: string }) => item.outcome === 'RATE_LIMITED')).toBe(true);
      expect(result.sources.some((item: { outcome: string }) => item.outcome === 'OK')).toBe(true);
      expect(result.status).toBe('COMPLETE');
    } finally { direct.mockRestore(); }
  }, 60000);
});
