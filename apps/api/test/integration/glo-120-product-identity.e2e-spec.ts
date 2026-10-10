import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { ProductIdentityService, MatchClassification } from '../../src/modules/ingestion/services/product-identity.service';

describe('GLO-120 Product Identity & Deduplication (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let identityService: ProductIdentityService;
  let supplier1Id: string;
  let supplier2Id: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    identityService = app.get<ProductIdentityService>(ProductIdentityService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function cleanFixture() {
    const s1 = await prisma.supplier.findUnique({ where: { slug: 'glo120-supplier-1' } });
    if (s1) {
      await prisma.supplierSkuAlias.deleteMany({ where: { supplierId: s1.id } });
      await prisma.ingestionItem.deleteMany({ where: { job: { supplierId: s1.id } } });
      await prisma.ingestionJob.deleteMany({ where: { supplierId: s1.id } });
      await prisma.supplierOffer.deleteMany({ where: { supplierId: s1.id } });
      await prisma.supplier.delete({ where: { id: s1.id } });
    }
    const s2 = await prisma.supplier.findUnique({ where: { slug: 'glo120-supplier-2' } });
    if (s2) {
      await prisma.supplierSkuAlias.deleteMany({ where: { supplierId: s2.id } });
      await prisma.ingestionItem.deleteMany({ where: { job: { supplierId: s2.id } } });
      await prisma.ingestionJob.deleteMany({ where: { supplierId: s2.id } });
      await prisma.supplierOffer.deleteMany({ where: { supplierId: s2.id } });
      await prisma.supplier.delete({ where: { id: s2.id } });
    }

    const products = await prisma.product.findMany({
      where: { brand: { slug: { in: ['glo120-brand-a', 'glo120-brand-b'] } } },
    });
    for (const p of products) {
      await prisma.sku.deleteMany({ where: { productId: p.id } });
      await prisma.product.delete({ where: { id: p.id } });
    }
    await prisma.brand.deleteMany({ where: { slug: { in: ['glo120-brand-a', 'glo120-brand-b'] } } });
  }

  beforeEach(async () => {
    await cleanFixture();

    const s1 = await prisma.supplier.create({ data: { name: 'GLO120 Supplier 1', slug: 'glo120-supplier-1' } });
    supplier1Id = s1.id;

    const s2 = await prisma.supplier.create({ data: { name: 'GLO120 Supplier 2', slug: 'glo120-supplier-2' } });
    supplier2Id = s2.id;
  });

  afterEach(cleanFixture);

  it('generates deterministic identity fingerprints and normalizes brand/name/size', () => {
    const fp1 = identityService.generateFingerprint({ brand: 'CeraVe ', name: 'Moisturizing Cream', size: 340, sizeUnit: 'g' });
    const fp2 = identityService.generateFingerprint({ brand: 'cerave', name: 'moisturizing-cream', size: 340, sizeUnit: 'g' });

    expect(fp1).toBe(fp2);
    expect(fp1).toBe('v1:cerave:moisturizing-cream:default:340g');
  });

  it('never automatically merges different product sizes (50ml vs 100ml)', async () => {
    // 1. Create canonical product with 50ml SKU
    const brand = await prisma.brand.create({ data: { name: 'GLO120 Brand A', slug: 'glo120-brand-a' } });
    const product = await prisma.product.create({
      data: { name: 'Hydrating Lotion', slug: 'glo120-brand-a-hydrating-lotion', brandId: brand.id, isPublished: true },
    });
    await prisma.sku.create({
      data: { productId: product.id, code: 'SKU-50ML', variantName: 'Default', size: 50, sizeUnit: 'ml', barcode: '6221111111111', isActive: true },
    });

    // 2. Classify candidate with same product name but 100ml size
    const match = await identityService.classifyCandidateMatch({
      supplierId: supplier1Id,
      supplierSkuCode: 'SUP-100ML',
      name: 'Hydrating Lotion',
      brand: 'GLO120 Brand A',
      size: 100,
      sizeUnit: 'ml',
    });

    // Must NOT be EXACT_MATCH to 50ml SKU!
    expect(match.classification).not.toBe(MatchClassification.EXACT_MATCH);
    expect(match.matchedSkuId).toBeNull();
  });

  it('detects barcode conflicts when facts clash and triggers CONFLICT review', async () => {
    // 1. Existing canonical SKU registered to Brand A
    const brandA = await prisma.brand.create({ data: { name: 'GLO120 Brand A', slug: 'glo120-brand-a' } });
    const productA = await prisma.product.create({
      data: { name: 'Serum A', slug: 'glo120-brand-a-serum-a', brandId: brandA.id, isPublished: true },
    });
    await prisma.sku.create({
      data: { productId: productA.id, code: 'SERUM-A', variantName: 'Default', size: 30, sizeUnit: 'ml', barcode: '6229999999999', isActive: true },
    });

    // 2. Classify candidate uploading barcode 6229999999999 with Brand B (Conflicting facts!)
    const match = await identityService.classifyCandidateMatch({
      supplierId: supplier1Id,
      supplierSkuCode: 'SUP-CONFLICT',
      name: 'Shampoo B',
      brand: 'GLO120 Brand B', // Conflicting brand!
      barcode: '6229999999999',
    });

    expect(match.classification).toBe(MatchClassification.CONFLICT);
    expect(match.matchedSkuId).toBeNull();
    expect(match.conflicts.some((c) => c.includes('barcode_brand_mismatch'))).toBe(true);
  });

  it('allows two separate suppliers to sell the same canonical SKU with independent SupplierOffers', async () => {
    // 1. Supplier 1 imports and publishes candidate
    const createJob1 = await request(app.getHttpServer())
      .post('/ingestion/jobs')
      .send({
        supplierId: supplier1Id,
        items: [{ supplierSkuCode: 'SUP1-SKU', name: 'Shared Lotion', brand: 'GLO120 Brand A', barcode: '6228888888888', price: 200, currency: 'EGP' }],
      })
      .expect(201);

    const itemId1 = createJob1.body.items[0].id;
    await request(app.getHttpServer()).patch(`/ingestion/candidates/${itemId1}/approve`).send({}).expect(200);
    const pub1 = await request(app.getHttpServer()).post(`/ingestion/candidates/${itemId1}/publish`).expect(200);

    const canonicalSkuId = pub1.body.matchedSkuId;
    expect(canonicalSkuId).toBeDefined();

    // 2. Supplier 2 imports the same product with same barcode
    const createJob2 = await request(app.getHttpServer())
      .post('/ingestion/jobs')
      .send({
        supplierId: supplier2Id,
        items: [{ supplierSkuCode: 'SUP2-SKU', name: 'Shared Lotion', brand: 'GLO120 Brand A', barcode: '6228888888888', price: 220, currency: 'EGP' }],
      })
      .expect(201);

    const itemId2 = createJob2.body.items[0].id;
    await new Promise((r) => setTimeout(r, 100));

    // Supplier 2 candidate should EXACT_MATCH the same canonical SKU
    const detail2 = await request(app.getHttpServer()).get(`/ingestion/candidates/${itemId2}`).expect(200);
    expect(detail2.body.matchedSkuId).toBe(canonicalSkuId);
    expect(detail2.body.status).toBe('approved');

    // Supplier 2 publishes
    await request(app.getHttpServer()).post(`/ingestion/candidates/${itemId2}/publish`).expect(200);

    // 3. Assert persisted database records: exactly 1 canonical SKU, but 2 separate SupplierOffers!
    const skuCount = await prisma.sku.count({ where: { barcode: '6228888888888' } });
    expect(skuCount).toBe(1);

    const offers = await prisma.supplierOffer.findMany({ where: { skuId: canonicalSkuId } });
    expect(offers.length).toBe(2);

    const offer1 = offers.find((o) => o.supplierId === supplier1Id);
    const offer2 = offers.find((o) => o.supplierId === supplier2Id);

    expect(offer1).toBeDefined();
    expect(offer1!.costPrice.toNumber()).toBe(200);
    expect(offer2).toBeDefined();
    expect(offer2!.costPrice.toNumber()).toBe(220);
  });

  it('supports approved supplier-specific SKU aliases for automatic future matching', async () => {
    // 1. Create a canonical SKU
    const brand = await prisma.brand.create({ data: { name: 'GLO120 Brand A', slug: 'glo120-brand-a' } });
    const product = await prisma.product.create({
      data: { name: 'Alias Product', slug: 'glo120-brand-a-alias-product', brandId: brand.id, isPublished: true },
    });
    const sku = await prisma.sku.create({
      data: { productId: product.id, code: 'CANONICAL-SKU-ALIAS', variantName: 'Default', barcode: '6227777777777', isActive: true },
    });

    // 2. Register Supplier SKU Alias: Supplier 1 code 'SUP-CODE-99' -> canonical SKU
    await identityService.createSupplierSkuAlias(supplier1Id, 'SUP-CODE-99', sku.id);

    // 3. Candidate imported without barcode but with supplierSkuCode 'SUP-CODE-99'
    const match = await identityService.classifyCandidateMatch({
      supplierId: supplier1Id,
      supplierSkuCode: 'SUP-CODE-99',
      name: 'Unclear Name Upload',
      brand: 'Unclear Brand',
    });

    expect(match.classification).toBe(MatchClassification.EXACT_MATCH);
    expect(match.matchedSkuId).toBe(sku.id);
    expect(match.reason).toBe('matched_supplier_sku_alias');
  });
});
