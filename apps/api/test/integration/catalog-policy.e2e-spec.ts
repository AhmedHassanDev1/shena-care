/* eslint-disable @typescript-eslint/no-explicit-any -- HTTP response bodies are asserted structurally */
process.env.SOURCING_MODE = 'BROADCAST_ON_DEMAND';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AiClient } from '../../src/platform/ai';
import { DeterministicAiClient } from '../fixtures/deterministic-ai';
import { createActor, Actor } from '../fixtures/actors';

const ean13 = (body: string) => {
  const sum = body.split('').reverse().reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return `${body}${(10 - sum % 10) % 10}`;
};
const barcode = () => ean13(String(Math.floor(100000000000 + Math.random() * 899999999999)));

/**
 * Catalog Policy over real HTTP and PostgreSQL: one canonical Brand record per brand, brand-scoped exact leaves,
 * explicit product exclusions, immutable versions, and the SKIP / HOLD / ACCEPT decisions they drive at intake.
 */
describe('Catalog Policy (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor;
  let hub: Actor;
  let customer: Actor;
  const run = randomUUID().slice(0, 8).replace(/[0-9]/g, c => 'abcdefghij'[Number(c)]);
  const ids = {} as Record<'skin' | 'cleanser' | 'serum' | 'other' | 'existingBrand' | 'offBrand' | 'keptProduct' | 'excludedProduct' | 'foreignProduct', string>;
  const codes = { kept: barcode(), excluded: barcode() };
  const api = () => request(app.getHttpServer());
  const csv = (rows: string[][]) => Buffer.from(rows.map(row => row.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n'), 'utf-8');
  const policy = async () => (await api().get('/ingestion/eligibility/catalog-policy').set(admin.auth).expect(200)).body;
  const brandOf = async (id: string) => (await policy()).brands.find((b: any) => b.id === id);
  // Read the version before opening the request: supertest binds its server when the request is created.
  const patch = async (brandId: string, body: Record<string, unknown>) => {
    const expectedVersion = (await policy()).version;
    return api().patch(`/ingestion/eligibility/brands/${brandId}`).set(admin.auth).send({ expectedVersion, ...body });
  };
  const addBrand = async (name: string) => {
    const expectedVersion = (await policy()).version;
    return api().post('/ingestion/eligibility/brands').set(admin.auth).send({ expectedVersion, name });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(AiClient).useClass(DeterministicAiClient).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    admin = await createActor(prisma, 'ADMIN');
    hub = await createActor(prisma, 'HUB_OPERATOR');
    customer = await createActor(prisma, 'CUSTOMER');
    const slug = (s: string) => `${s}-${run}-${randomUUID().slice(0, 6)}`;
    ids.skin = (await prisma.category.create({ data: { name: `Skin ${run}`, slug: slug('skin') } })).id;
    ids.cleanser = (await prisma.category.create({ data: { name: `Cleansers ${run}`, slug: slug('cleansers'), parentId: ids.skin } })).id;
    ids.serum = (await prisma.category.create({ data: { name: `Serums ${run}`, slug: slug('serums'), parentId: ids.skin } })).id;
    ids.other = (await prisma.category.create({ data: { name: `Fragrance ${run}`, slug: slug('fragrance') } })).id;
    ids.existingBrand = (await prisma.brand.create({ data: { name: `Dermora ${run}`, slug: slug('dermora') } })).id;
    ids.offBrand = (await prisma.brand.create({ data: { name: `Nivoro ${run}`, slug: slug('nivoro') } })).id;
    const product = (brandId: string, name: string, code: string) => prisma.product.create({ data: { brandId, categoryId: ids.cleanser, name, slug: slug('p'), isPublished: true,
      skus: { create: { code: `${code}-${run}-${randomUUID().slice(0, 6)}`, variantName: '200 ml', size: 200, sizeUnit: 'ml', barcode: code === 'KEEP' ? codes.kept : code === 'EXCL' ? codes.excluded : null } } } });
    ids.keptProduct = (await product(ids.existingBrand, `Dermora Foaming Cleanser ${run}`, 'KEEP')).id;
    ids.excludedProduct = (await product(ids.existingBrand, `Dermora Old Formula Cleanser ${run}`, 'EXCL')).id;
    ids.foreignProduct = (await product(ids.offBrand, `Nivoro Gel ${run}`, 'FOREIGN')).id;
  }, 120000);

  afterAll(async () => { await app.close(); });

  it('is Admin-only', async () => {
    await api().get('/ingestion/eligibility/catalog-policy').expect(401);
    for (const actor of [customer, hub]) {
      await api().get('/ingestion/eligibility/catalog-policy').set(actor.auth).expect(403);
      await api().patch(`/ingestion/eligibility/brands/${ids.existingBrand}`).set(actor.auth).send({ expectedVersion: 0, enabled: true }).expect(403);
      await api().post('/ingestion/eligibility/brands').set(actor.auth).send({ expectedVersion: 0, name: `Hack ${run}` }).expect(403);
    }
  });

  it('adds a brand once: a second spelling of the same canonical brand is refused with the existing record', async () => {
    const before = await prisma.brand.count();
    const created = await addBrand(`  Aurelle   ${run} `);
    expect([created.status, created.body]).toMatchObject([201, { changed: true, brandId: expect.any(String) }]);
    const again = await addBrand(`AURELLE-${run}`);
    expect([again.status, again.body]).toMatchObject([409, { code: 'BRAND_EXISTS', brandId: created.body.brandId }]);
    const existing = await addBrand(`dermora ${run}`);
    expect([existing.status, existing.body.brandId]).toEqual([409, ids.existingBrand]);
    expect(await prisma.brand.count()).toBe(before + 1);
    expect(await prisma.brand.count({ where: { name: `Aurelle ${run}` } })).toBe(1);
    // A new brand is enabled with no categories: nothing is admitted until an Admin chooses leaves.
    expect(await brandOf(created.body.brandId)).toMatchObject({ enabled: true, categoryIds: [], productCount: 0 });
  });

  it('allows exact leaves per brand, refuses parents and stale edits, and keeps every version', async () => {
    const start = (await policy()).version;
    expect((await patch(ids.existingBrand, { enabled: true, categoryIds: [ids.skin] })).status).toBe(400);
    const ok = await patch(ids.existingBrand, { enabled: true, categoryIds: [ids.cleanser] });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ changed: true, version: start + 1 });
    await api().patch(`/ingestion/eligibility/brands/${ids.existingBrand}`).set(admin.auth).send({ expectedVersion: start, enabled: false }).expect(409);
    expect(await brandOf(ids.existingBrand)).toMatchObject({ enabled: true, categoryIds: [ids.cleanser], productCount: 2 });
    // Re-sending the same state is not a new version.
    expect((await patch(ids.existingBrand, { enabled: true, categoryIds: [ids.cleanser] })).body).toMatchObject({ changed: false, version: start + 1 });
    const history = (await api().get('/ingestion/eligibility/history').set(admin.auth).expect(200)).body;
    expect(history[0]).toMatchObject({ version: start + 1, status: 'APPROVED', actorId: admin.id });
    expect(history[0].reason).toContain(`Dermora ${run}`);
  });

  it('disables and re-enables a brand without touching its products, and remembers its categories', async () => {
    const products = await prisma.product.findMany({ where: { brandId: ids.existingBrand }, orderBy: { id: 'asc' } });
    expect((await patch(ids.existingBrand, { enabled: false })).status).toBe(200);
    expect(await brandOf(ids.existingBrand)).toMatchObject({ enabled: false, categoryIds: [ids.cleanser] });
    expect(await prisma.product.findMany({ where: { brandId: ids.existingBrand }, orderBy: { id: 'asc' } })).toEqual(products);
    expect((await patch(ids.existingBrand, { enabled: true })).status).toBe(200);
    expect(await brandOf(ids.existingBrand)).toMatchObject({ enabled: true, categoryIds: [ids.cleanser] });
  });

  it('excludes only canonical products of the same brand, and restores them', async () => {
    expect((await patch(ids.existingBrand, { excludeProductId: ids.foreignProduct })).status).toBe(400);
    const found = (await api().get(`/ingestion/eligibility/brands/${ids.existingBrand}/products`).query({ q: 'old formula' }).set(admin.auth).expect(200)).body;
    expect(found.map((p: any) => p.id)).toEqual([ids.excludedProduct]);
    expect((await patch(ids.existingBrand, { excludeProductId: ids.excludedProduct, reason: 'Discontinued formula' })).status).toBe(200);
    expect((await brandOf(ids.existingBrand)).exclusions).toEqual([expect.objectContaining({ productId: ids.excludedProduct, reason: 'Discontinued formula', actorId: admin.id })]);
    // Excluding is an intake rule: the product itself is never deleted or unpublished.
    expect(await prisma.product.findUniqueOrThrow({ where: { id: ids.excludedProduct } })).toMatchObject({ isPublished: true });
  });

  it('drives intake: SKIP early, HOLD the unknown, SKIP excluded products after identity, ACCEPT the rest', async () => {
    const aurelle = (await policy()).brands.find((b: any) => b.name === `Aurelle ${run}`);
    expect((await patch(aurelle.id, { categoryIds: [ids.serum] })).status).toBe(200);
    expect((await patch(ids.offBrand, { enabled: false })).status).toBe(200);
    const offers = await prisma.supplierOffer.count();
    const file = csv([
      ['Name', 'Brand', 'Size', 'Barcode', 'Category'],
      [`Aurelle Peptide Serum ${run}`, `Aurelle ${run}`, '30 ml', '', `Serums ${run}`], // 2: allowed new product
      [`Aurelle Gel Wash ${run}`, `Aurelle ${run}`, '150 ml', '', `Cleansers ${run}`], // 3: leaf not allowed for this brand
      [`Nivoro Night Cream ${run}`, `Nivoro ${run}`, '50 ml', '', `Cleansers ${run}`], // 4: disabled brand
      [`Unheard Toner ${run}`, `Unheard ${run}`, '100 ml', '', `Cleansers ${run}`], // 5: unknown brand
      [`Aurelle Body Spray ${run}`, `Aurelle ${run}`, '100 ml', '', `Skin ${run}`], // 6: parent category
      [`Dermora Old Formula Cleanser ${run}`, `Dermora ${run}`, '200 ml', codes.excluded, `Cleansers ${run}`], // 7: excluded product
      [`Dermora Foaming Cleanser ${run}`, `Dermora ${run}`, '200 ml', codes.kept, `Cleansers ${run}`], // 8: existing allowed product
      [`Aurelle Eau ${run}`, `Aurelle ${run}`, '50 ml', '', `Fragrance ${run}`], // 9: leaf no brand allows
    ]);
    const res = await api().post('/admin/catalog-imports').set(admin.auth).attach('file', file, { filename: 'policy.csv', contentType: 'text/csv' }).expect(201);
    const rows = (await api().get(`/admin/catalog-imports/${res.body.jobId}/rows`).set(admin.auth).expect(200)).body.rows as any[];
    const row = (n: number) => rows.find(r => r.rowNumber === n);
    expect(row(2)).toMatchObject({ outcome: 'NEW_CANDIDATE', reasonCode: 'UNKNOWN_PRODUCT' });
    expect(row(3)).toMatchObject({ outcome: 'REJECTED', reasonCode: 'POLICY_CATEGORY_NOT_ALLOWED_FOR_BRAND', fingerprint: null });
    expect(row(4)).toMatchObject({ outcome: 'REJECTED', reasonCode: 'POLICY_BRAND_NOT_ALLOWED', fingerprint: null });
    expect(row(5)).toMatchObject({ outcome: 'HOLD', reasonCode: 'POLICY_BRAND_UNKNOWN' });
    expect(row(6)).toMatchObject({ outcome: 'HOLD', reasonCode: 'POLICY_CATEGORY_REQUIRES_LEAF' });
    expect(row(7)).toMatchObject({ outcome: 'REJECTED', reasonCode: 'POLICY_PRODUCT_EXCLUDED', matchedSkuId: null });
    expect(row(8)).toMatchObject({ outcome: 'LINKED_EXISTING' });
    expect(row(9)).toMatchObject({ outcome: 'REJECTED', reasonCode: 'POLICY_CATEGORY_NOT_ALLOWED', fingerprint: null });
    const version = (await policy()).version;
    for (const n of [2, 3, 7, 8]) expect(row(n).identity.policy).toMatchObject({ version });

    // A manual link cannot bypass an exclusion.
    const excludedSku = await prisma.sku.findFirstOrThrow({ where: { productId: ids.excludedProduct } });
    const hold = row(5);
    const link = await api().post(`/admin/catalog-imports/rows/${hold.id}/resolve`).set(admin.auth).send({ action: 'LINK_SKU', skuId: excludedSku.id, note: 'Trying to link it' });
    expect(link.status).toBe(409);

    // Restoring the product and rechecking settles the earlier policy skip; nothing else moved.
    expect((await patch(ids.existingBrand, { restoreProductId: ids.excludedProduct })).status).toBe(200);
    await api().post(`/admin/catalog-imports/${res.body.jobId}/match`).set(admin.auth).send({ recheck: true }).expect(200);
    const after = (await api().get(`/admin/catalog-imports/${res.body.jobId}/rows`).set(admin.auth).expect(200)).body.rows as any[];
    expect(after.find(r => r.rowNumber === 7)).toMatchObject({ outcome: 'LINKED_EXISTING', matchedSkuId: excludedSku.id });
    expect(after.find(r => r.rowNumber === 4)).toMatchObject({ outcome: 'REJECTED', reasonCode: 'POLICY_BRAND_NOT_ALLOWED' });
    expect(await prisma.supplierOffer.count()).toBe(offers);
  }, 120000);
});
