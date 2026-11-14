import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { ProductResearchService, RESEARCH_TRANSPORT, ResearchTransport } from '../../src/modules/catalog/public';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { MARKET_RULE_VERSION } from '../../src/modules/intake/public';
import { Actor, createActor } from '../fixtures/actors';

class PriceSite implements ResearchTransport {
  pages = new Map<string, string>();
  async resolve() { return ['93.184.216.34']; }
  async get(url: string) {
    const body = Buffer.from(this.pages.get(url) ?? '');
    return { status: this.pages.has(url) ? 200 : 404,
      headers: { get: () => 'text/html' },
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) as ArrayBuffer };
  }
}

describe('regular-price evidence persistence and Admin boundary', () => {
  let app: INestApplication, db: PrismaService, admin: Actor, customer: Actor, skuId: string, brandName: string;
  const site = new PriceSite(), run = randomUUID(), official = `https://brand-${run}.example/product`;
  const pharmacy = 'https://mainasrpharmacy.com/exact-30', sale = 'https://cosmostoreegypt.com/exact-30', marketplace = 'https://jumia.com.eg/unknown-seller', related = 'https://elghazawy.com/another-product';
  const page = (price: number, extra = '') => `<h1>${brandName} Niacinamide 10% Zinc 1% 30ml</h1><script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: `${brandName} Niacinamide 10% Zinc 1% 30ml`, offers: { '@type': 'Offer', price, priceCurrency: 'EGP' } })}</script>${extra}`;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(RESEARCH_TRANSPORT).useValue(site).compile();
    app = mod.createNestApplication(); app.useLogger(false); app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true })); await app.init();
    db = app.get(PrismaService); admin = await createActor(db, 'ADMIN'); customer = await createActor(db, 'CUSTOMER');
    const brand = await db.brand.create({ data: { name: `PriceBrand ${run}`, slug: `price-brand-${run}`, websiteUrl: new URL(official).origin } }); brandName = brand.name;
    const product = await db.product.create({ data: { name: 'Niacinamide 10% Zinc 1%', slug: `price-product-${run}`, brandId: brand.id } });
    const sku = await db.sku.create({ data: { productId: product.id, code: `PRICE-${run}`, variantName: '30 ml', size: 30, sizeUnit: 'ml', identityStatus: 'EVIDENCE_VERIFIED', identityEvidence: { sourceUrls: [official] } } }); skuId = sku.id;
    // Existing owner data must be untouched by research (not an approved commercial price for this fixture).
    await db.sellingPrice.create({ data: { skuId, amount: 1234, currency: 'EGP', validFrom: new Date() } });
    const providers = app.get(ProductResearchService);
    jest.spyOn(providers, 'discoveryConfigured').mockReturnValue(true);
    jest.spyOn(providers, 'discoverPages').mockImplementation(async (_query, _limit, options) => options?.includeDomains ? [{ url: pharmacy, title: '' }, { url: sale, title: '' }, { url: related, title: '' }] : [{ url: marketplace, title: '' }]);
    site.pages.set(official, page(20).replace('EGP', 'USD')); site.pages.set(pharmacy, page(650));
    site.pages.set(sale, page(500, '<p class="sale-price">Sale price 500 EGP</p>')); site.pages.set(marketplace, page(400));
    site.pages.set(related, page(400).replace(/<h1>.*?<\/h1>/, `<h1>${brandName} Caffeine Solution 5% EGCG 30ml</h1>`));
  }, 90000);
  afterAll(async () => { await app?.close(); });

  it('rejects customer/anonymous research and retains regular/promo evidence without commercial mutation', async () => {
    const api = request(app.getHttpServer()), url = `/catalog/intake/skus/${skuId}/market-price`;
    await api.post(url).send({ force: true }).expect(401); await api.post(url).set(customer.auth).send({ force: true }).expect(403);
    const before = await db.sellingPrice.findMany({ where: { skuId } });
    const result = await api.post(url).set(admin.auth).send({ force: true }).expect(200);
    expect(result.body).toMatchObject({ reference: { medianEgp: 650, regularMedianEgp: 650, confidence: 'MEDIUM', sellers: 1 } });
    expect(result.body.check.status).toBe('REFERENCE_READY');
    const observations = await db.retailPriceObservation.findMany({ where: { skuId } });
    expect(JSON.parse(observations.find(o => o.sourceUrl === official)!.evidenceExcerpt!)).toMatchObject({ currency: 'USD' });
    expect(observations.find(o => o.sourceUrl === pharmacy)).toMatchObject({ status: 'ACCEPTED' });
    expect(JSON.parse(observations.find(o => o.sourceUrl === sale)!.evidenceExcerpt!)).toMatchObject({ priceType: 'PROMOTIONAL', currency: 'EGP' });
    expect(observations.find(o => o.sourceUrl === marketplace)).toMatchObject({ status: 'REJECTED', rejectReason: 'SELLER_NOT_VERIFIED' });
    expect(observations.find(o => o.sourceUrl === related)).toMatchObject({ status: 'REJECTED', rejectReason: 'PAGE_TITLE_DIFFERS' });
    expect(await db.sellingPrice.findMany({ where: { skuId } })).toEqual(before);
    expect(await db.listing.count({ where: { skuId } })).toBe(0);
    await db.retailPriceObservation.create({ data: { skuId, sourceUrl: 'https://mainasrpharmacy.com/legacy-unclassified', sellerName: 'Historical evidence', sellerDomain: 'mainasrpharmacy.com',
      priceEgp: 50, regularPriceEgp: 50, observedAt: new Date(), retrievedAt: new Date(), status: 'ACCEPTED', packText: 'Legacy price', confidence: 0.85,
      evidenceExcerpt: JSON.stringify({ rule: 'market-price@2', priceType: 'REGULAR', sourceType: 'ESTABLISHED_PHARMACY', currency: 'EGP' }), collectedBy: admin.id, dedupeKey: randomUUID() } });
    const legacy = await db.marketPriceCheck.create({ data: { skuId, requestedBy: admin.id, status: 'REFERENCE_READY', coverage: {}, cost: { rule: 'market-price@1' },
      reference: { medianEgp: 50 }, startedAt: new Date(Date.now() + 60000) } });
    const current = await api.get(url).set(admin.auth).expect(200);
    expect(current.body.check.id).not.toBe(legacy.id);
    expect(current.body.observations.every((item: { evidenceExcerpt: string }) => JSON.parse(item.evidenceExcerpt).rule === MARKET_RULE_VERSION)).toBe(true);
    await api.post(url).set(admin.auth).send({ force: true }).expect(200);
    expect(await db.retailPriceObservation.count({ where: { skuId } })).toBe(observations.length + 1);
  });
});
