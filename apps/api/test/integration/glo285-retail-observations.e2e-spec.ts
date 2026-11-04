// GLO-285 read-only retail evidence: attribution, rejection of unusable observations and proof it cannot reach cost, stock or selling price.
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { Actor, createActor } from '../fixtures/actors';

const realFetch = global.fetch;
const day = (offset: number) => new Date(Date.now() - offset * 86400000).toISOString();

describe('GLO-285 retail price observations', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor;
  let hub: Actor;
  let supplier: Actor;
  let skuId: string;
  const run = randomUUID().slice(0, 8);
  const supplierId = randomUUID();
  const brandName = `Retail Brand ${run}`;
  const server = () => app.getHttpServer();
  const observe = (overrides: Record<string, unknown>, actor = admin) => request(server()).post('/ingestion/retail-prices').set(actor.auth).send({
    skuId, sourceUrl: `https://seller-a.example.com/p/${randomUUID()}`, sellerName: 'Seller A', priceEgp: 100, currency: 'EGP',
    observedAt: day(1), packText: `${brandName} Cleanser 200 ml`, confidence: 0.8, ...overrides,
  });

  beforeAll(async () => {
    delete process.env.RETAIL_OBSERVATION_MAX_AGE_DAYS;
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    admin = await createActor(prisma, 'ADMIN');
    hub = await createActor(prisma, 'HUB_OPERATOR');
    await prisma.supplier.create({ data: { id: supplierId, name: `Retail ${run}`, slug: `retail-${run}` } });
    supplier = await createActor(prisma, 'SUPPLIER', supplierId);
    const brand = await prisma.brand.create({ data: { name: brandName, slug: `retail-${run}` } });
    const product = await prisma.product.create({ data: { brandId: brand.id, name: `${brandName} Cleanser`, slug: `retail-${run}` } });
    skuId = (await prisma.sku.create({ data: { productId: product.id, code: `RETAIL-${run}`, variantName: 'Default', size: 200, sizeUnit: 'ml' } })).id;
  }, 60000);

  afterAll(async () => {
    global.fetch = realFetch;
    delete process.env.RETAIL_RESEARCH_ALLOWED_HOSTS;
    await app.close();
  });

  it('admin only', async () => {
    await request(server()).post('/ingestion/retail-prices').send({}).expect(401);
    await observe({}, hub).expect(403);
    await observe({}, supplier).expect(403);
    await request(server()).get(`/ingestion/retail-prices/sku/${skuId}`).set(supplier.auth).expect(403);
  });

  it('accepts an attributable observation and is idempotent for the same listing and day', async () => {
    const url = `https://seller-a.example.com/p/${run}`;
    const first = await observe({ sourceUrl: url, regularPriceEgp: 120, inStock: true }).expect(201);
    expect(first.body).toMatchObject({ status: 'ACCEPTED', sellerDomain: 'seller-a.example.com', rejectReason: null });
    const again = await observe({ sourceUrl: url, regularPriceEgp: 120, inStock: true }).expect(201);
    expect(again.body.id).toBe(first.body.id);
  });

  it.each([
    ['another size', { packText: `${'x'} Cleanser 400 ml` }, 'WRONG_PACK_SIZE'],
    ['another pack count', { packText: 'Cleanser 2 x 200 ml' }, 'WRONG_PACK_COUNT'],
    ['no stated pack', { packText: 'Cleanser' }, 'PACK_NOT_STATED'],
    ['another currency', { currency: 'USD' }, 'NOT_EGP'],
    ['a free item', { priceEgp: 0 }, 'INVALID_PRICE'],
    ['a sale price above regular', { priceEgp: 130, regularPriceEgp: 120 }, 'SALE_PRICE_ABOVE_REGULAR'],
    ['an observation from the future', { observedAt: new Date(Date.now() + 86400000).toISOString() }, 'OBSERVED_IN_FUTURE'],
    ['a stale observation', { observedAt: day(400) }, 'EXPIRED'],
  ])('keeps %s as a rejected record with its reason, outside the benchmark', async (_label, overrides, reason) => {
    const res = await observe(overrides).expect(201);
    expect(res.body).toMatchObject({ status: 'REJECTED', rejectReason: reason });
  });

  it.each(['http://seller.example.com/p', 'https://169.254.169.254/latest', 'https://localhost/p', 'https://10.0.0.1/p'])('refuses unsafe source %s', async sourceUrl => {
    await observe({ sourceUrl }).expect(400);
  });

  it('flags a contradiction from one seller on one day, and an outlier against the sample', async () => {
    const domain = `https://seller-b.example.com/p/${run}`;
    await observe({ sourceUrl: `${domain}/1`, sellerName: 'Seller B', priceEgp: 110, observedAt: day(2) }).expect(201);
    const conflict = await observe({ sourceUrl: `${domain}/2`, sellerName: 'Seller B', priceEgp: 115, observedAt: day(2) }).expect(201);
    expect(conflict.body).toMatchObject({ status: 'REJECTED', rejectReason: 'CONTRADICTS_SAME_SELLER_SAME_DAY' });
    await observe({ sourceUrl: `https://seller-c.example.com/p/${run}`, sellerName: 'Seller C', priceEgp: 105, observedAt: day(3) }).expect(201);
    const outlier = await observe({ sourceUrl: `https://seller-d.example.com/p/${run}`, sellerName: 'Seller D', priceEgp: 999, observedAt: day(3) }).expect(201);
    expect(outlier.body).toMatchObject({ status: 'REJECTED', rejectReason: 'OUTLIER' });
  });

  it('benchmarks only accepted observations, each attributable, and never calls it the market price', async () => {
    const { body } = await request(server()).get(`/ingestion/retail-prices/sku/${skuId}`).set(admin.auth).expect(200);
    expect(body.sampleSize).toBe(3);
    expect(body).toMatchObject({ minEgp: 100, medianEgp: 105, maxEgp: 110 });
    expect(body.statement).toContain('Not a market price');
    expect(body.observations.every((o: { sourceUrl: string; sellerName: string; observedAt: string }) => o.sourceUrl && o.sellerName && o.observedAt)).toBe(true);
    const unknown = await request(server()).get(`/ingestion/retail-prices/sku/${randomUUID()}`).set(admin.auth).expect(200);
    expect(unknown.body).toMatchObject({ sampleSize: 0, medianEgp: null });
  });

  it('automated collection needs an owner-approved host list and a provider, and never guesses', async () => {
    const research = () => request(server()).post(`/ingestion/retail-prices/sku/${skuId}/research`).set(admin.auth).expect(200);
    delete process.env.RETAIL_RESEARCH_ALLOWED_HOSTS;
    expect((await research()).body.status).toBe('NOT_CONFIGURED');

    process.env.RETAIL_RESEARCH_ALLOWED_HOSTS = 'allowed-shop.example.com';
    const savedExa = process.env.EXA_API_KEY;
    const savedFirecrawl = process.env.FIRECRAWL_API_KEY;
    process.env.EXA_API_KEY = '';
    expect((await research()).body.status).toBe('PROVIDER_UNAVAILABLE');

    process.env.EXA_API_KEY = 'stub';
    process.env.FIRECRAWL_API_KEY = 'stub';
    const fetched: string[] = [];
    global.fetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('exa.ai')) return new Response(JSON.stringify({ results: [
        { url: `https://allowed-shop.example.com/a-${run}`, title: `${brandName} Cleanser 200 ml` },
        { url: `https://allowed-shop.example.com/b-${run}`, title: `${brandName} Cleanser 200 ml` },
        { url: 'https://not-allowed.example.com/c', title: `${brandName} Cleanser 200 ml` },
      ] }), { status: 200 });
      if (url.includes('firecrawl')) {
        const target = JSON.parse(String(init?.body)).url as string;
        fetched.push(target);
        const markdown = target.includes('/a-') ? `${brandName} Cleanser 200 ml price 108 EGP` : `${brandName} many offers 10 EGP 20 EGP 30 EGP`;
        return new Response(JSON.stringify({ data: { markdown } }), { status: 200 });
      }
      return realFetch(input as string);
    }) as typeof fetch;
    const result = await research();
    expect(result.body).toMatchObject({ status: 'COMPLETED', pagesRead: 2, recorded: 1, skipped: 1 });
    expect(fetched.some(url => url.includes('not-allowed'))).toBe(false);
    expect((await research()).body.status).toBe('COOLDOWN');
    process.env.EXA_API_KEY = savedExa ?? '';
    process.env.FIRECRAWL_API_KEY = savedFirecrawl ?? '';
  });

  it('has no code path to cost, stock or selling price', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../src/modules/ingestion/services/retail-price-observation.service.ts'), 'utf8');
    expect(source).not.toMatch(/supplierOffer|sellingPrice|SourcingService|modules\/commerce|modules\/sourcing/);
    const writes = source.match(/prisma\.\w+\.(create|update|upsert|delete)\w*/g) ?? [];
    expect(new Set(writes)).toEqual(new Set(['prisma.retailPriceObservation.create']));
  });
});
