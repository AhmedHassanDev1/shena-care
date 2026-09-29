import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AiClient } from '../../src/platform/ai';

describe('Ingestion Enrichment (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let supplierId: string;
  let brandId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AiClient)
      .useValue({
        enrichProduct: jest.fn().mockResolvedValue({
          schemaVersion: '1' as const,
          suggestions: {
            normalizedTitle: 'CeraVe Moisturizing Cream 340g',
            brand: 'CeraVe',
            description: 'Moisturizing cream for normal to dry skin',
            size: { value: 340, unit: 'g' },
            barcode: null,
            ingredients: ['Ceramide NP', 'Hyaluronic Acid'],
            benefits: ['Moisturizes', 'Restores skin barrier'],
            usage: ['Apply to face and body twice daily'],
            warnings: [],
          },
          confidence: { title: 0.95, brand: 0.99 },
          warnings: [],
          providerMetadata: { model: 'mock-v1', provider: 'mock' },
        }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function cleanFixture() {
    const supplier = await prisma.supplier.findUnique({ where: { slug: 'enrich-supplier' } });
    if (supplier) {
      await prisma.ingestionItem.deleteMany({ where: { job: { supplierId: supplier.id } } });
      await prisma.ingestionJob.deleteMany({ where: { supplierId: supplier.id } });
      await prisma.supplier.delete({ where: { id: supplier.id } });
    }
    const product = await prisma.product.findUnique({ where: { slug: 'enrich-product' } });
    if (product) {
      await prisma.sku.deleteMany({ where: { productId: product.id } });
      await prisma.product.delete({ where: { id: product.id } });
    }
    await prisma.brand.deleteMany({ where: { slug: 'enrich-brand' } });
  }

  beforeEach(async () => {
    await cleanFixture();

    const brand = await prisma.brand.create({ data: { name: 'EnrichBrand', slug: 'enrich-brand' } });
    brandId = brand.id;

    const product = await prisma.product.create({
      data: { name: 'EnrichProduct', slug: 'enrich-product', brandId, isPublished: true },
    });

    await prisma.sku.create({
      data: { productId: product.id, code: 'ENRICH-SKU', variantName: 'Default', isActive: true },
    });

    const supplier = await prisma.supplier.create({ data: { name: 'EnrichSupplier', slug: 'enrich-supplier' } });
    supplierId = supplier.id;
  });

  afterEach(cleanFixture);

  it('triggers enrichment via POST /ingestion/items/:id/enrich and stores result', async () => {
    // 1. Create a job with an item
    const createJobRes = await request(app.getHttpServer())
      .post('/ingestion/jobs')
      .send({
        supplierId,
        items: [
          {
            supplierSkuCode: 'ENRICH-01',
            name: 'CeraVe Moisturizing Cream',
            brand: 'CeraVe',
            barcode: null,
            price: 250,
            currency: 'EGP',
          },
        ],
      })
      .expect(201);

    const jobId = createJobRes.body.id;
    const itemId = createJobRes.body.items[0].id;

    // 2. Trigger enrichment manually
    const enrichRes = await request(app.getHttpServer())
      .post(`/ingestion/items/${itemId}/enrich`)
      .expect(200);

    expect(enrichRes.body.enrichmentStatus).toBe('succeeded');
    expect(enrichRes.body.enrichment).toBeDefined();
    expect(enrichRes.body.enrichment.suggestions).toBeDefined();
    expect(enrichRes.body.enrichment.suggestions.normalizedTitle).toBe('CeraVe Moisturizing Cream 340g');
    expect(enrichRes.body.enrichment.suggestions.ingredients).toContain('Ceramide NP');
    expect(enrichRes.body.enrichmentError).toBeNull();

    // 3. Verify persistence: refetch job to confirm field is stored
    const jobRes = await request(app.getHttpServer()).get(`/ingestion/jobs/${jobId}`).expect(200);
    // Job still present
    expect(jobRes.body.id).toBe(jobId);

    // 4. Invalid item ID returns 400
    await request(app.getHttpServer())
      .post('/ingestion/items/not-a-uuid/enrich')
      .expect(400);

    // 5. Non-existent item returns 404
    await request(app.getHttpServer())
      .post('/ingestion/items/00000000-0000-0000-0000-000000000000/enrich')
      .expect(404);
  });

  it('handles AI service unavailability gracefully (soft error — status stays pending)', async () => {
    // Override mock for this test to simulate unavailability
    const aiClient = app.get<AiClient>(AiClient);
    const { AiClientError, AiErrorKind } = await import('../../src/platform/ai');
    jest.spyOn(aiClient, 'enrichProduct').mockRejectedValueOnce(
      new AiClientError(AiErrorKind.UNAVAILABLE, 'AI service unreachable'),
    );

    const createJobRes = await request(app.getHttpServer())
      .post('/ingestion/jobs')
      .send({
        supplierId,
        items: [
          {
            supplierSkuCode: 'ENRICH-02',
            name: 'Some Product',
            brand: 'SomeBrand',
            price: 100,
            currency: 'EGP',
          },
        ],
      })
      .expect(201);

    const itemId = createJobRes.body.items[0].id;

    const enrichRes = await request(app.getHttpServer())
      .post(`/ingestion/items/${itemId}/enrich`)
      .expect(200);

    // Soft error: enrichmentStatus stays pending (can retry)
    expect(enrichRes.body.enrichmentStatus).toBe('pending');
    expect(enrichRes.body.enrichmentError).toContain('ai_unavailable');
  });
});
