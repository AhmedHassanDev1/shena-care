import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest');
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';

describe('Ingestion Lifecycle (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let brandId: string;
  let skuId: string;
  let supplierId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean tables
    await prisma.ingestionItem.deleteMany();
    await prisma.ingestionJob.deleteMany();
    await prisma.supplierOffer.deleteMany();
    await prisma.supplier.deleteMany();
    await prisma.productMedia.deleteMany();
    await prisma.sku.deleteMany();
    await prisma.product.deleteMany();
    await prisma.brand.deleteMany();

    // Setup basic catalog & supplier
    const brand = await prisma.brand.create({
      data: { name: 'IngestBrand', slug: 'ingest-brand' },
    });
    brandId = brand.id;

    const product = await prisma.product.create({
      data: {
        name: 'IngestProduct',
        slug: 'ingest-product',
        brandId,
        isPublished: true,
      },
    });

    const sku = await prisma.sku.create({
      data: {
        productId: product.id,
        code: 'INGEST-SKU',
        variantName: 'Default',
        barcode: '1234567890123',
        isActive: true,
      },
    });
    skuId = sku.id;

    const supplier = await prisma.supplier.create({
      data: { name: 'IngestSupplier', slug: 'ingest-supplier' },
    });
    supplierId = supplier.id;
  });

  it('verifies the ingestion lifecycle with matching and publishing', async () => {
    // 1. Create Ingestion Job
    const createJobRes = await request(app.getHttpServer())
      .post('/ingestion/jobs')
      .send({
        supplierId,
        items: [
          {
            supplierSkuCode: 'SUP-01',
            name: 'Exact Match Product',
            brand: 'IngestBrand',
            barcode: '1234567890123', // should match
            price: 150.5,
            currency: 'EGP',
          },
          {
            supplierSkuCode: 'SUP-02',
            name: 'Unknown Product',
            brand: 'IngestBrand',
            barcode: '0000000000000', // won't match
            price: 200,
            currency: 'EGP',
          },
        ],
      })
      .expect(201);

    const jobId = createJobRes.body.id;
    expect(jobId).toBeDefined();

    // Wait a brief moment for async matching
    await new Promise((r) => setTimeout(r, 100));

    const jobRes = await request(app.getHttpServer())
      .get(`/ingestion/jobs/${jobId}`)
      .expect(200);

    const items = jobRes.body.items;
    expect(items.length).toBe(2);

    // 2. barcode automatically matches existing SKU
    const matchedItem = items.find((i: any) => i.barcode === '1234567890123');
    expect(matchedItem.status).toBe('approved');
    expect(matchedItem.matchedSkuId).toBe(skuId);

    // 3. unknown barcode remains unresolved
    const unresolvedItem = items.find((i: any) => i.barcode === '0000000000000');
    expect(unresolvedItem.status).toBe('review_required');
    expect(unresolvedItem.matchedSkuId).toBeNull();

    // 9. invalid lifecycle transition fails (publish before all approved)
    await request(app.getHttpServer())
      .post(`/ingestion/jobs/${jobId}/publish`)
      .expect(400);

    // 5. invalid SKU approval fails
    await request(app.getHttpServer())
      .patch(`/ingestion/items/${unresolvedItem.id}/approve`)
      .send({ matchedSkuId: '00000000-0000-0000-0000-000000000000' })
      .expect(404);

    // 4. manual approval links correct SKU
    await request(app.getHttpServer())
      .patch(`/ingestion/items/${unresolvedItem.id}/approve`)
      .send({ matchedSkuId: skuId }) // mapping second item to same SKU for test
      .expect(200);

    // Refresh Job
    const jobRes2 = await request(app.getHttpServer())
      .get(`/ingestion/jobs/${jobId}`)
      .expect(200);

    expect(jobRes2.body.status).toBe('approved');

    // 6. publishing creates expected SupplierOffer
    await request(app.getHttpServer())
      .post(`/ingestion/jobs/${jobId}/publish`)
      .expect(201);

    const offers = await prisma.supplierOffer.findMany({ where: { supplierId } });
    expect(offers.length).toBe(1); // both mapped to same SKU, second one updates it
    expect(offers[0].skuId).toBe(skuId);
    expect(offers[0].costPrice.toNumber()).toBe(200); // the latter item was 200

    // 7. duplicate publish is safe (fails with 400 Job is already published)
    await request(app.getHttpServer())
      .post(`/ingestion/jobs/${jobId}/publish`)
      .expect(400);

    // 8. duplicate import does not corrupt offers
    const createJobRes2 = await request(app.getHttpServer())
      .post('/ingestion/jobs')
      .send({
        supplierId,
        items: [
          {
            supplierSkuCode: 'SUP-01',
            name: 'Exact Match Product Again',
            brand: 'IngestBrand',
            barcode: '1234567890123',
            price: 180, // price changed
            currency: 'EGP',
          },
        ],
      })
      .expect(201);

    await new Promise((r) => setTimeout(r, 100));

    // publish the duplicate
    await request(app.getHttpServer())
      .post(`/ingestion/jobs/${createJobRes2.body.id}/publish`)
      .expect(201);

    // offer should be updated, not duplicated
    const offersAfter = await prisma.supplierOffer.findMany({ where: { supplierId } });
    expect(offersAfter.length).toBe(1);
    expect(offersAfter[0].costPrice.toNumber()).toBe(180);
  });
});
