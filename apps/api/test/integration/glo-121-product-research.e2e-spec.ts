import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';

describe('GLO-121 Product Research Pipeline (e2e)', () => {
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
    const supplier = await prisma.supplier.findUnique({ where: { slug: 'glo121-supplier' } });
    if (supplier) {
      await prisma.ingestionItem.deleteMany({ where: { job: { supplierId: supplier.id } } });
      await prisma.ingestionJob.deleteMany({ where: { supplierId: supplier.id } });
      await prisma.supplier.delete({ where: { id: supplier.id } });
    }
  }

  beforeEach(async () => {
    await cleanFixture();

    const supplier = await prisma.supplier.create({
      data: { name: 'GLO121 Research Supplier', slug: 'glo121-supplier' },
    });
    supplierId = supplier.id;
  });

  afterEach(cleanFixture);

  it('runs research pipeline on a product candidate, extracts field-level evidence, and caches results to protect credits', async () => {
    // 1. Create a candidate job for a real skincare product (CeraVe Moisturizing Cream)
    const jobRes = await request(app.getHttpServer())
      .post('/ingestion/jobs')
      .send({
        supplierId,
        items: [
          {
            supplierSkuCode: 'CERAVE-CREAM-340',
            name: 'Moisturizing Cream',
            brand: 'CeraVe',
            price: 340.0,
            currency: 'EGP',
          },
        ],
      })
      .expect(201);

    const itemId = jobRes.body.items[0].id;

    // 2. Trigger Product Research via POST /ingestion/candidates/:id/research
    const researchRes = await request(app.getHttpServer())
      .post(`/ingestion/candidates/${itemId}/research`)
      .expect(200);

    expect(researchRes.body.candidateId).toBe(itemId);
    expect(researchRes.body.brand).toBe('CeraVe');
    expect(researchRes.body.discoveredSources).toBeDefined();
    expect(Array.isArray(researchRes.body.fieldEvidences)).toBe(true);
    expect(researchRes.body.providerStatuses).toBeDefined();

    // Verify provider status tracking (Exa and Firecrawl live vs Grok status)
    expect(['LIVE', 'UNAVAILABLE']).toContain(researchRes.body.providerStatuses.exa);
    expect(['LIVE', 'UNAVAILABLE']).toContain(researchRes.body.providerStatuses.firecrawl);
    expect(['LIVE', 'UNAVAILABLE', 'INVALID_KEY']).toContain(researchRes.body.providerStatuses.grok);

    // 3. Verify persistence: refetch candidate to ensure research evidence is stored in database
    const detailRes = await request(app.getHttpServer())
      .get(`/ingestion/candidates/${itemId}`)
      .expect(200);

    expect(detailRes.body.id).toBe(itemId);
    expect(detailRes.body.evidence).toBeDefined();

    // 4. Verify Credit Caching: Repeating research returns cached evidence without re-querying external APIs
    const cachedResearchRes = await request(app.getHttpServer())
      .post(`/ingestion/candidates/${itemId}/research`)
      .expect(200);

    expect(cachedResearchRes.body.researchedAt).toBe(researchRes.body.researchedAt);
  });

  it('handles incomplete product information and safely keeps candidates reviewable', async () => {
    // Candidate with missing size and minimal facts
    const jobRes = await request(app.getHttpServer())
      .post('/ingestion/jobs')
      .send({
        supplierId,
        items: [
          {
            supplierSkuCode: 'UNKNOWN-LOTION',
            name: 'Generic Hydrating Essence',
            brand: 'UnknownBrand',
            price: 120.0,
            currency: 'EGP',
          },
        ],
      })
      .expect(201);

    const itemId = jobRes.body.items[0].id;

    const researchRes = await request(app.getHttpServer())
      .post(`/ingestion/candidates/${itemId}/research`)
      .expect(200);

    expect(researchRes.body.candidateId).toBe(itemId);
    expect(researchRes.body.fieldEvidences).toBeDefined();

    // Candidate must remain in reviewable state
    const detailRes = await request(app.getHttpServer())
      .get(`/ingestion/candidates/${itemId}`)
      .expect(200);

    expect(detailRes.body.status).toBe('review_required');
  });
});
