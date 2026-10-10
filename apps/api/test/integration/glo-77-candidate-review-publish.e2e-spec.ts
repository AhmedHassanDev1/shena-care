import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';

describe('GLO-77 Candidate Review & Publish (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
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

  async function cleanFixture() {
    const supplier = await prisma.supplier.findUnique({ where: { slug: 'glo77-supplier' } });
    if (supplier) {
      await prisma.ingestionItem.deleteMany({ where: { job: { supplierId: supplier.id } } });
      await prisma.ingestionJob.deleteMany({ where: { supplierId: supplier.id } });
      await prisma.supplierOffer.deleteMany({ where: { supplierId: supplier.id } });
      await prisma.supplier.delete({ where: { id: supplier.id } });
    }
    const product = await prisma.product.findUnique({ where: { slug: 'glo77-brand-glo77-new-serum' } });
    if (product) {
      await prisma.sku.deleteMany({ where: { productId: product.id } });
      await prisma.product.delete({ where: { id: product.id } });
    }
    await prisma.brand.deleteMany({ where: { slug: 'glo77-brand' } });
  }

  beforeEach(async () => {
    await cleanFixture();

    const supplier = await prisma.supplier.create({
      data: { name: 'GLO77 Supplier', slug: 'glo77-supplier' },
    });
    supplierId = supplier.id;
  });

  afterEach(cleanFixture);

  it('completes the full GLO-77 candidate lifecycle: list, view evidence/conflicts, correct, approve, publish to canonical catalog, and verify retry idempotency', async () => {
    // 1. Create Ingestion Job with an unknown product candidate (missing barcode)
    const createRes = await request(app.getHttpServer())
      .post('/ingestion/jobs')
      .send({
        supplierId,
        items: [
          {
            supplierSkuCode: 'GLO77-SKU-01',
            name: 'GLO77 New Serum',
            brand: 'GLO77 Brand',
            price: 350.0,
            currency: 'EGP',
          },
        ],
      })
      .expect(201);

    const jobId = createRes.body.id;
    const itemId = createRes.body.items[0].id;

    // Wait for initial processing
    await new Promise((r) => setTimeout(r, 100));

    // 2. List candidates for review
    const listRes = await request(app.getHttpServer())
      .get('/ingestion/candidates?status=review_required')
      .expect(200);

    expect(Array.isArray(listRes.body)).toBe(true);
    const candidateInList = listRes.body.find((c: any) => c.id === itemId);
    expect(candidateInList).toBeDefined();
    expect(candidateInList.status).toBe('review_required');

    // 3. Read candidate facts, evidence, and conflict analysis
    const detailRes = await request(app.getHttpServer())
      .get(`/ingestion/candidates/${itemId}`)
      .expect(200);

    expect(detailRes.body.id).toBe(itemId);
    expect(detailRes.body.name).toBe('GLO77 New Serum');
    expect(detailRes.body.conflicts).toContain('missing_barcode');
    expect(detailRes.body.conflicts).toContain('brand_not_found_in_catalog');

    // 4. Correct candidate data (adding barcode)
    const updateRes = await request(app.getHttpServer())
      .patch(`/ingestion/candidates/${itemId}`)
      .send({ barcode: '6220001112223' })
      .expect(200);

    expect(updateRes.body.barcode).toBe('6220001112223');

    // 5. Approve candidate for publication
    await request(app.getHttpServer())
      .patch(`/ingestion/candidates/${itemId}/approve`)
      .send({})
      .expect(200);

    const approvedDetail = await request(app.getHttpServer())
      .get(`/ingestion/candidates/${itemId}`)
      .expect(200);
    expect(approvedDetail.body.status).toBe('approved');

    // 6. Publish candidate into canonical Catalog domain
    const publishRes = await request(app.getHttpServer())
      .post(`/ingestion/candidates/${itemId}/publish`)
      .expect(200);

    expect(publishRes.body.status).toBe('published');
    expect(publishRes.body.matchedSkuId).toBeDefined();

    const canonicalSkuId = publishRes.body.matchedSkuId;

    // 7. Verify persisted canonical Product & SKU exist in Catalog
    const createdSku = await prisma.sku.findUnique({
      where: { id: canonicalSkuId },
      include: { product: { include: { brand: true } } },
    });

    expect(createdSku).toBeDefined();
    expect(createdSku!.barcode).toBe('6220001112223');
    expect(createdSku!.product.name).toBe('GLO77 New Serum');
    expect(createdSku!.product.brand.name).toBe('GLO77 Brand');
    expect(createdSku!.product.isPublished).toBe(true);

    // 8. Verify Sourcing SupplierOffer was created
    const offer = await prisma.supplierOffer.findFirst({
      where: { supplierId, skuId: canonicalSkuId },
    });
    expect(offer).toBeDefined();
    expect(offer!.costPrice.toNumber()).toBe(350.0);

    // 9. Idempotency test: Retry publishing candidate should be safe and return existing canonical SKU without duplicates
    const retryPublishRes = await request(app.getHttpServer())
      .post(`/ingestion/candidates/${itemId}/publish`)
      .expect(400); // Already published

    expect(retryPublishRes.body.message).toContain('already published');

    // Verify product count in Catalog is exactly 1 (no duplicate creation)
    const productCount = await prisma.product.count({
      where: { name: 'GLO77 New Serum' },
    });
    expect(productCount).toBe(1);
  });
});
