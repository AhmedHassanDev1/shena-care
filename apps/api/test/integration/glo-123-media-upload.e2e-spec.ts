import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
const request = require('supertest');
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import * as path from 'path';
import * as fs from 'fs';

describe('GLO-123 Product Media Core & Shared Storage (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let supplierId: string;
  let jobId: string;
  let candidateId: string;
  const testImagePath = path.join(__dirname, 'test-image.png');

  beforeAll(async () => {
    // Create dummy image file for upload testing
    fs.writeFileSync(testImagePath, Buffer.from('89504E470D0A1A0A', 'hex'));

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);

    // Setup admin user and supplier
    const supplier = await prisma.supplier.upsert({
      where: { name: 'GLO-123 Media Supplier' },
      update: {},
      create: { name: 'GLO-123 Media Supplier', slug: 'glo-123-media' },
    });
    supplierId = supplier.id;

    const admin = await prisma.customer.upsert({
      where: { email: 'admin.media@shenacare.test' },
      update: {},
      create: {
        name: 'Admin Media',
        email: 'admin.media@shenacare.test',
        roles: ['ADMIN'],
      },
    });

    const session = await prisma.session.upsert({
      where: { token: '00000000-0000-0000-0000-000000000123' },
      update: {},
      create: {
        customerId: admin.id,
        token: '00000000-0000-0000-0000-000000000123',
        expiresAt: new Date(Date.now() + 100000),
      },
    });
    adminToken = session.token;
  });

  afterAll(async () => {
    if (fs.existsSync(testImagePath)) {
      fs.unlinkSync(testImagePath);
    }
    
    // Cleanup
    const job = await prisma.ingestionJob.findFirst({ where: { supplierId } });
    if (job) {
      const items = await prisma.ingestionItem.findMany({ where: { jobId: job.id } });
      for (const item of items) {
        if (item.matchedSkuId) {
          const sku = await prisma.sku.findUnique({ where: { id: item.matchedSkuId } });
          if (sku) {
            await prisma.supplierOffer.deleteMany({ where: { skuId: sku.id } });
            await prisma.supplierSkuAlias.deleteMany({ where: { skuId: sku.id } });
            await prisma.productMedia.deleteMany({ where: { productId: sku.productId } });
            await prisma.sku.delete({ where: { id: sku.id } });
            await prisma.product.delete({ where: { id: sku.productId } });
          }
        }
      }
      await prisma.ingestionItem.deleteMany({ where: { jobId: job.id } });
      await prisma.ingestionJob.delete({ where: { id: job.id } });
    }

    await prisma.supplier.delete({ where: { id: supplierId } });
    await prisma.customer.delete({ where: { email: 'admin.media@shenacare.test' } });

    await app.close();
  });

  it('should create an ingestion job', async () => {
    const uniqueSuffix = Date.now().toString();
    const res = await request(app.getHttpServer())
      .post('/ingestion/jobs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        supplierId,
        items: [
          {
            supplierSkuCode: `MEDIA-SKU-${uniqueSuffix}`,
            name: `Media Test Cream ${uniqueSuffix}`,
            brand: 'MediaTest',
            barcode: `123${uniqueSuffix}`.substring(0, 12),
            price: 50.0,
            currency: 'SAR',
          },
        ],
      })
      .expect(HttpStatus.CREATED);

    jobId = res.body.id;
    candidateId = res.body.items[0].id;
  });

  it('should upload media for the candidate', async () => {
    const res = await request(app.getHttpServer())
      .post(`/ingestion/candidates/${candidateId}/media`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', testImagePath)
      .expect(HttpStatus.CREATED);

    expect(res.body.url).toContain('/storage/private/');
    expect(res.body.originType).toBe('unverified');
    
    const candidate = await prisma.ingestionItem.findUnique({ where: { id: candidateId } });
    const enrichment = candidate.enrichment as Record<string, any>;
    expect(enrichment.media).toBeDefined();
    expect(enrichment.media[0].url).toBe(res.body.url);
  });

  it('should approve the candidate', async () => {
    const candidate = await prisma.ingestionItem.findUnique({ where: { id: candidateId } });
    const enrichment = candidate.enrichment as Record<string, any>;
    const mediaUrl = enrichment.media[0].url;

    await request(app.getHttpServer())
      .patch(`/ingestion/candidates/${candidateId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ verifiedMediaUrls: [mediaUrl] })
      .expect(HttpStatus.OK);
  });

  it('should publish the candidate and map media to ProductMedia', async () => {
    const res = await request(app.getHttpServer())
      .post(`/ingestion/candidates/${candidateId}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);

    const matchedSkuId = res.body.matchedSkuId;
    expect(matchedSkuId).toBeDefined();

    const sku = await prisma.sku.findUnique({ where: { id: matchedSkuId }});
    expect(sku).toBeDefined();

    // Verify ProductMedia was created
    const productMedia = await prisma.productMedia.findMany({
      where: { productId: sku.productId }
    });

    expect(productMedia.length).toBe(1);
    expect(productMedia[0].url).toContain('/storage/public/media/');
    expect(productMedia[0].originType).toBe('verified');
  });
});
