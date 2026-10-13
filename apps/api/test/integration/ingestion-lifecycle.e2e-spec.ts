import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { createActor, Actor } from '../fixtures/actors';
import { reviewCandidateMedia } from '../fixtures/candidate-review';

describe('Ingestion Lifecycle (e2e)', () => {
  let admin: Actor;
  let app: INestApplication;
  let prisma: PrismaService;

  let brandId: string;
  let skuId: string;
  let supplierId: string;

  type JobBody = {
    status: string;
    items: Array<{ id: string; barcode: string | null; status: string; matchedSkuId: string | null }>;
  };

  async function waitForJob(jobId: string, ready: (job: JobBody) => boolean): Promise<JobBody> {
    const deadline = Date.now() + 5000;
    do {
      const response = await request(app.getHttpServer()).get(`/ingestion/jobs/${jobId}`).set(admin.auth).expect(200);
      const job = response.body as JobBody;
      if (ready(job)) return job;
      await new Promise((resolve) => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    throw new Error(`Ingestion job ${jobId} did not reach the expected state`);
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
    admin = await createActor(app.get(PrismaService), 'ADMIN');

    prisma = app.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function cleanFixture() {
    const supplier = await prisma.supplier.findUnique({ where: { slug: 'ingest-supplier' } });
    if (supplier) {
      await prisma.ingestionItem.deleteMany({ where: { job: { supplierId: supplier.id } } });
      await prisma.ingestionJob.deleteMany({ where: { supplierId: supplier.id } });
      await prisma.supplierOffer.deleteMany({ where: { supplierId: supplier.id } });
      await prisma.supplier.delete({ where: { id: supplier.id } });
    }
    const product = await prisma.product.findUnique({ where: { slug: 'ingest-product' } });
    if (product) {
      await prisma.productMedia.deleteMany({ where: { productId: product.id } });
      await prisma.sku.deleteMany({ where: { productId: product.id } });
      await prisma.product.delete({ where: { id: product.id } });
    }
    await prisma.brand.deleteMany({ where: { slug: 'ingest-brand' } });
  }

  beforeEach(async () => {
    await cleanFixture();

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
        variantName: '50 ml',
        size: 50,
        sizeUnit: 'ml',
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

  afterEach(cleanFixture);

  it('verifies the ingestion lifecycle with matching and publishing', async () => {
    // 1. Create Ingestion Job
    const createJobRes = await request(app.getHttpServer())
      .post('/ingestion/jobs').set(admin.auth)
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

    const job = await waitForJob(jobId, (current) =>
      current.items.every((item) => item.status !== 'pending'),
    );

    const items = job.items;
    expect(items.length).toBe(2);

    // 2. barcode automatically pre-links the existing SKU but still needs human review
    const matchedItem = items.find((i) => i.barcode === '1234567890123');
    expect(matchedItem.status).toBe('review_required');
    expect(matchedItem.matchedSkuId).toBe(skuId);

    // 3. unknown barcode remains unresolved
    const unresolvedItem = items.find((i) => i.barcode === '0000000000000');
    expect(unresolvedItem.status).toBe('review_required');
    expect(unresolvedItem.matchedSkuId).toBeNull();

    // 9. invalid lifecycle transition fails (publish before all approved)
    await request(app.getHttpServer())
      .post(`/ingestion/jobs/${jobId}/publish`).set(admin.auth)
      .expect(400);

    // 5. invalid SKU approval fails
    await request(app.getHttpServer())
      .patch(`/ingestion/items/${unresolvedItem.id}/approve`).set(admin.auth)
      .send({ matchedSkuId: '00000000-0000-0000-0000-000000000000' })
      .expect(404);

    // 4. an item whose barcode differs from the SKU cannot be reviewed onto it
    const mismatched = await reviewCandidateMedia(app, admin.auth, unresolvedItem.id, '0000000000000');
    await request(app.getHttpServer())
      .patch(`/ingestion/items/${unresolvedItem.id}/approve`).set(admin.auth)
      .send({ matchedSkuId: skuId, mediaReviews: mismatched })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/ingestion/items/${unresolvedItem.id}/reject`).set(admin.auth)
      .expect(200);

    // manual approval of the pre-linked item after media review
    const reviews = await reviewCandidateMedia(app, admin.auth, matchedItem.id, '1234567890123');
    await request(app.getHttpServer())
      .patch(`/ingestion/items/${matchedItem.id}/approve`).set(admin.auth)
      .send({ matchedSkuId: skuId, mediaReviews: reviews })
      .expect(200);

    // Refresh Job
    const jobRes2 = await request(app.getHttpServer())
      .get(`/ingestion/jobs/${jobId}`).set(admin.auth)
      .expect(200);

    expect(jobRes2.body.status).toBe('approved');

    // 6. publishing creates expected SupplierOffer
    await request(app.getHttpServer())
      .post(`/ingestion/jobs/${jobId}/publish`).set(admin.auth)
      .expect(201);

    const offers = await prisma.supplierOffer.findMany({ where: { supplierId } });
    expect(offers.length).toBe(1); // the rejected item is not published
    expect(offers[0].skuId).toBe(skuId);
    expect(offers[0].costPrice.toNumber()).toBe(150.5);

    // 7. duplicate publish is safe (fails with 400 Job is already published)
    await request(app.getHttpServer())
      .post(`/ingestion/jobs/${jobId}/publish`).set(admin.auth)
      .expect(400);

    // 8. duplicate import does not corrupt offers
    const createJobRes2 = await request(app.getHttpServer())
      .post('/ingestion/jobs').set(admin.auth)
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

    const job2 = await waitForJob(createJobRes2.body.id, (current) => current.items.every((item) => item.status !== 'pending'));
    const reviews2 = await reviewCandidateMedia(app, admin.auth, job2.items[0].id, '1234567890123');
    await request(app.getHttpServer())
      .patch(`/ingestion/items/${job2.items[0].id}/approve`).set(admin.auth)
      .send({ mediaReviews: reviews2 })
      .expect(200);

    // publish the duplicate
    await request(app.getHttpServer())
      .post(`/ingestion/jobs/${createJobRes2.body.id}/publish`).set(admin.auth)
      .expect(201);

    // offer is not duplicated, and a re-import never overwrites the Sourcing-owned offer
    // (cost or availability); changes go through Sourcing.
    const offersAfter = await prisma.supplierOffer.findMany({ where: { supplierId } });
    expect(offersAfter.length).toBe(1);
    expect(offersAfter[0].costPrice.toNumber()).toBe(150.5);
    expect(offersAfter[0].isAvailable).toBe(false);
    expect(offersAfter[0].lastConfirmedAt).toBeNull();
  });
});
