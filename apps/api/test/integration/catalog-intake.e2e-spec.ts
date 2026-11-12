import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { IntakeRunnerService } from '../../src/application/composition/services/intake/intake-runner.service';

/**
 * Catalog Intake over HTTP: supplier price files link only to existing canonical SKUs, are idempotent, keep price history, stay private to their supplier,
 * and never touch the catalog; critical rows are settled by an Admin and the wording is learned; Admin names without a verifiable source stay unresolved.
 */
describe('Catalog Intake (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = randomUUID().slice(0, 8);
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const session = async (roles: Array<'ADMIN' | 'SUPPLIER'>, supplierId?: string) => {
    const customer = await prisma.customer.create({ data: { name: `intake-${tag}`, email: `intake-${randomUUID()}@example.test`, roles, supplierId: supplierId ?? null } });
    const token = randomUUID();
    await prisma.session.create({ data: { token, customerId: customer.id, isValid: true, expiresAt: new Date(Date.now() + 3_600_000) } });
    return token;
  };
  const csv = (lines: string[]) => Buffer.from(`\ufeff${lines.join('\n')}\n`, 'utf8');
  const upload = (token: string, body: Buffer, name = 'list.csv', mapping?: string) => {
    const req = request(app.getHttpServer()).post('/supplier/intake/files').set('Authorization', `Bearer ${token}`).attach('file', body, { filename: name, contentType: 'text/csv' });
    return mapping ? req.field('mapping', mapping) : req;
  };
  const waitFor = async (token: string, jobId: string) => {
    for (let i = 0; i < 100; i++) {
      const res = await request(app.getHttpServer()).get(`/supplier/intake/jobs/${jobId}`).set('Authorization', `Bearer ${token}`);
      if (res.body.job?.status === 'COMPLETED' || res.body.job?.status === 'FAILED') return res.body;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('job did not finish');
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const brand = await prisma.brand.create({ data: { name: `CeraVe ${tag}`, slug: `cerave-${tag}` } });
    // The brand as suppliers write it; an approved policy carries the Arabic alias.
    const latest = await prisma.ingestionEligibilityPolicy.findFirst({ where: { status: 'APPROVED' }, orderBy: { version: 'desc' } });
    await prisma.ingestionEligibilityPolicy.create({ data: { version: (latest?.version ?? 0) + 1, baseVersion: latest?.version ?? 0, status: 'APPROVED', approvedAt: new Date(),
      actorId: randomUUID(), reason: 'intake e2e', impact: {}, document: { brands: [{ id: brand.id, name: brand.name, isActive: true, effect: 'ALLOW', aliases: ['سيرافي'] }], categories: [], mappings: [] } } });
    const make = async (name: string, size: number, unit: string, key: string) => {
      const product = await prisma.product.create({ data: { brandId: brand.id, name, slug: `${key}-${tag}` } });
      const sku = await prisma.sku.create({ data: { productId: product.id, code: `${key}-${tag}`, variantName: `${size} ${unit}`, size, sizeUnit: unit, identityStatus: 'EVIDENCE_VERIFIED' } });
      ids[key] = sku.id;
    };
    await make('Hydrating Facial Cleanser', 236, 'ml', 'hydrating');
    await make('Foaming Facial Cleanser', 236, 'ml', 'foaming');
    await make('Moisturizing Cream', 454, 'g', 'cream');
    const supplier = await prisma.supplier.create({ data: { name: `Nahar ${tag}`, slug: `nahar-${tag}` } });
    const other = await prisma.supplier.create({ data: { name: `Other ${tag}`, slug: `other-${tag}` } });
    ids.supplier = supplier.id;
    tokens.supplier = await session(['SUPPLIER'], supplier.id);
    tokens.other = await session(['SUPPLIER'], other.id);
    tokens.admin = await session(['ADMIN']);
  });

  afterAll(async () => { await app?.close(); });

  const FILE = [
    'الكود,اسم الصنف,سعر الجمهور,خصم %,الرصيد',
    `A1,سيرافي غسول مرطب للبشرة الجافة 236 مل,٨٥٠,20,12`,
    `A2,سيرافي كريم مرطب 454 جم,"1,250",20,0`,
    `A3,سيرافي غسول 236 مل,850,20,3`,
    `A4,بانادول اكسترا 24 قرص,75,10,100`,
    `A5,نيفيا كريم مرطب 200 مل,210,20,50`,
    `A6,سيرافي غسول رغوي 236 مل,سعر خاص,20,5`,
  ];

  let firstJob: string;
  it('links supplier rows to existing SKUs only, with a reason for every other row', async () => {
    const productsBefore = await prisma.product.count();
    const res = await upload(tokens.supplier, csv(FILE)).expect(201);
    firstJob = res.body.jobId;
    const done = await waitFor(tokens.supplier, firstJob);
    expect(done.totals).toMatchObject({ total: 6, UPDATED: 2, CRITICAL: 1, SKIPPED: 1, UNMATCHED: 1, INVALID: 1 });
    expect(await prisma.product.count()).toBe(productsBefore);

    const offer = await prisma.supplierOffer.findUniqueOrThrow({ where: { supplierId_skuId: { supplierId: ids.supplier, skuId: ids.hydrating } } });
    expect(offer.costPrice.toNumber()).toBe(680);
    expect(offer.consumerPrice?.toNumber()).toBe(850);
    expect(offer.availableQuantity).toBe(12);
    expect(offer.lastConfirmedAt).toBeNull();
    const cream = await prisma.supplierOffer.findUniqueOrThrow({ where: { supplierId_skuId: { supplierId: ids.supplier, skuId: ids.cream } } });
    expect(cream.isAvailable).toBe(false);
    expect(await prisma.supplierOfferPriceEvent.count({ where: { offerId: offer.id } })).toBe(1);
    expect(await prisma.supplierSkuAlias.findFirst({ where: { supplierId: ids.supplier, supplierSkuCode: 'A1' } })).toMatchObject({ skuId: ids.hydrating });
  });

  it('shows the supplier its own rows without catalog candidates, and hides them from other suppliers', async () => {
    const rows = await request(app.getHttpServer()).get(`/supplier/intake/jobs/${firstJob}/rows`).set('Authorization', `Bearer ${tokens.supplier}`).expect(200);
    expect(rows.body.items).toHaveLength(6);
    expect(rows.body.items[0]).not.toHaveProperty('candidates');
    await request(app.getHttpServer()).get(`/supplier/intake/jobs/${firstJob}`).set('Authorization', `Bearer ${tokens.other}`).expect(404);
    await request(app.getHttpServer()).get(`/catalog/intake/review`).set('Authorization', `Bearer ${tokens.supplier}`).expect(403);
  });

  it('replays an identical file as the same job, writing nothing twice', async () => {
    const events = await prisma.supplierOfferPriceEvent.count();
    const res = await upload(tokens.supplier, csv(FILE)).expect(201);
    expect(res.body).toMatchObject({ jobId: firstJob, replay: true });
    expect(await prisma.supplierOfferPriceEvent.count()).toBe(events);
  });

  it('records a price change as history and leaves unchanged offers MATCHED', async () => {
    const changed = [FILE[0], `A1,سيرافي غسول مرطب للبشرة الجافة 236 مل,900,20,12`, `A2,سيرافي كريم مرطب 454 جم,"1,250",20,0`];
    const res = await upload(tokens.supplier, csv(changed), 'week2.csv').expect(201);
    const done = await waitFor(tokens.supplier, res.body.jobId);
    expect(done.totals).toMatchObject({ total: 2, UPDATED: 1, MATCHED: 1 });
    const offer = await prisma.supplierOffer.findUniqueOrThrow({ where: { supplierId_skuId: { supplierId: ids.supplier, skuId: ids.hydrating } } });
    expect(offer.costPrice.toNumber()).toBe(720);
    expect(await prisma.supplierOfferPriceEvent.count({ where: { offerId: offer.id } })).toBe(2);
  });

  it('lets an Admin settle a critical row; the wording is learned for the next file', async () => {
    const critical = await prisma.intakeRow.findFirstOrThrow({ where: { jobId: firstJob, outcome: 'CRITICAL' } });
    expect((critical.candidates as Array<{ skuId: string }>).map(c => c.skuId)).toEqual(expect.arrayContaining([ids.hydrating, ids.foaming]));
    await request(app.getHttpServer()).post(`/catalog/intake/rows/${critical.id}/supplier-resolution`).set('Authorization', `Bearer ${tokens.admin}`)
      .send({ action: 'LINK', skuId: ids.foaming }).expect(200);
    expect(await prisma.intakeRow.findUniqueOrThrow({ where: { id: critical.id } })).toMatchObject({ outcome: 'UPDATED', matchedSkuId: ids.foaming });
    const next = await upload(tokens.supplier, csv([FILE[0], `B9,سيرافي غسول 236 مل,860,20,3`]), 'week3.csv').expect(201);
    const done = await waitFor(tokens.supplier, next.body.jobId);
    expect(done.totals).toMatchObject({ total: 1, UPDATED: 1 });
    const row = await prisma.intakeRow.findFirstOrThrow({ where: { jobId: next.body.jobId } });
    expect(row).toMatchObject({ matchedSkuId: ids.foaming });
    expect(row.reasonCode).toContain('LEARNED_ALIAS');
  });

  it('asks which price a lone price column is, and accepts an explicit mapping', async () => {
    const body = csv(['Product,Price', 'CeraVe Moisturizing Cream 454g,950']);
    const refused = await upload(tokens.supplier, body, 'single-price.csv').expect(400);
    expect(refused.body).toMatchObject({ code: 'PRICE_TYPE_AMBIGUOUS', headers: ['Product', 'Price'] });
    const accepted = await upload(tokens.supplier, body, 'single-price.csv', JSON.stringify({ purchasePrice: 1 })).expect(201);
    const done = await waitFor(tokens.supplier, accepted.body.jobId);
    expect(done.totals.total).toBe(1);
  });

  it('leaves an Admin name unresolved, with a review item, when no official source can be read', async () => {
    const res = await request(app.getHttpServer()).post('/catalog/intake/names').set('Authorization', `Bearer ${tokens.admin}`)
      .send({ names: [`CeraVe ${tag} Hydrating Facial Cleanser 473ml`], researchPrices: false }).expect(201);
    await app.get(IntakeRunnerService).drain(res.body.jobId);
    const row = await prisma.intakeRow.findFirstOrThrow({ where: { jobId: res.body.jobId } });
    expect(row).toMatchObject({ outcome: 'UNRESOLVED', reasonCode: 'NO_IDENTITY_SOURCE', matchedSkuId: null });
    expect(await prisma.catalogException.count({ where: { importRowId: row.id, status: 'OPEN' } })).toBe(1);
    const queue = await request(app.getHttpServer()).get('/catalog/intake/review').set('Authorization', `Bearer ${tokens.admin}`).expect(200);
    expect(queue.body.map((item: { id: string }) => item.id)).toContain(row.id);
  });
});
