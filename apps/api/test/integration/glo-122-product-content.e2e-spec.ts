import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
const request = require('supertest');
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { AiClient } from '../../src/platform/ai';

const mockAiClient = {
  enrichProduct: jest.fn(),
  recommendRoutine: jest.fn(),
  generateContent: jest.fn().mockResolvedValue({
    schemaVersion: '1',
    content: {
      titleEn: 'Mock Title',
      titleAr: 'عنوان وهمي',
      descriptionEn: 'Mock Description',
      descriptionAr: 'وصف وهمي',
      shortDescriptionEn: 'Short',
      shortDescriptionAr: 'قصير',
      benefitsEn: ['Hydration'],
      benefitsAr: ['ترطيب'],
      usageInstructionsEn: [],
      usageInstructionsAr: [],
      keywords: ['mock'],
    },
    providerMetadata: { provider: 'mock' },
  }),
};


describe('GLO-122 Product Content Generation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let supplierId: string;
  let jobId: string;
  let candidateId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AiClient)
      .useValue(mockAiClient)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);

    // Create a supplier
    const supplier = await prisma.supplier.upsert({
      where: { name: 'GLO-122 Supplier' },
      update: {},
      create: { name: 'GLO-122 Supplier', slug: 'glo-122-supplier' },
    });
    supplierId = supplier.id;

    // Create a customer with ADMIN role to act as the operator
    const admin = await prisma.customer.upsert({
      where: { email: 'admin.glo122@shenacare.test' },
      update: {},
      create: {
        name: 'Admin Tester GLO-122',
        email: 'admin.glo122@shenacare.test',
        roles: ['ADMIN'],
      },
    });

    const session = await prisma.session.upsert({
      where: { token: '00000000-0000-0000-0000-000000000122' },
      update: {},
      create: {
        customerId: admin.id,
        token: '00000000-0000-0000-0000-000000000122',
        expiresAt: new Date(Date.now() + 100000),
      },
    });
    adminToken = session.token;
  });

  afterAll(async () => {
    await prisma.productContentDraft.deleteMany({
      where: { candidate: { job: { supplierId } } },
    });
    await prisma.ingestionJob.deleteMany({ where: { supplierId } });
    await prisma.supplier.deleteMany({ where: { id: supplierId } });
    await prisma.customer.deleteMany({ where: { email: 'admin.glo122@shenacare.test' } });
    await app.close();
  });

  it('should create an ingestion job and item', async () => {
    const res = await request(app.getHttpServer())
      .post('/ingestion/jobs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        supplierId,
        items: [
          {
            supplierSkuCode: 'GLO-122-SKU',
            name: 'Hydrating Face Cream',
            brand: 'TestBrand',
            barcode: '1221221221221',
            price: 50.0,
            currency: 'SAR',
          },
        ],
      })
      .expect(HttpStatus.CREATED);

    jobId = res.body.id;
    candidateId = res.body.items[0].id;
  });

  it('should generate content draft from AI provider', async () => {
    const res = await request(app.getHttpServer())
      .post(`/ingestion/candidates/${candidateId}/content`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);

    expect(res.body.draft).toBeDefined();
    expect(res.body.draft.titleEn).toBeDefined();
    expect(res.body.draft.titleAr).toBeDefined();
    expect(res.body.metadata.provider).toBe('mock');

    // Verify it is saved in the DB
    const draft = await prisma.productContentDraft.findUnique({
      where: { candidateId },
    });
    expect(draft).toBeDefined();
    expect(draft?.language).toBe('mixed');
    expect(draft?.titleEn).toBeDefined();
    expect(draft?.titleAr).toBeDefined();
  });

  it('should update the draft if called again idempotently', async () => {
    const res = await request(app.getHttpServer())
      .post(`/ingestion/candidates/${candidateId}/content`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);

    expect(res.body.draft.titleEn).toBeDefined();

    // Verify only 1 draft exists for this candidate
    const drafts = await prisma.productContentDraft.findMany({
      where: { candidateId },
    });
    expect(drafts.length).toBe(1);
  });
});
