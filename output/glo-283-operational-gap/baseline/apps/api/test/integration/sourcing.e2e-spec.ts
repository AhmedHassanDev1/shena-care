import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { CatalogService } from '../../src/modules/catalog/public';
import { ensureLegacyCatalog } from '../fixtures/legacy-catalog';
import { createActor, Actor } from '../fixtures/actors';

// Exercises the guarded /sourcing API (SourcingController) as an authenticated operator.
describe('Sourcing Management (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let catalogService: CatalogService;
  let admin: Actor;

  let testSkuId: string;
  let supplierId: string;
  let offerId: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
    await ensureLegacyCatalog(app.get(PrismaService));

    prisma = app.get<PrismaService>(PrismaService);
    catalogService = app.get<CatalogService>(CatalogService);
    admin = await createActor(prisma, 'ADMIN');

    // Use seed data
    const product = await catalogService.getPublishedProduct('cerave-moisturizing-cream');
    testSkuId = product?.skus[0]?.id as string;

    // Clean only sourcing tables
    const previousSupplier = await prisma.supplier.findUnique({ where: { slug: 'global-meds' } });
    if (previousSupplier) {
      await prisma.supplierOffer.deleteMany({ where: { supplierId: previousSupplier.id } });
      await prisma.supplier.delete({ where: { id: previousSupplier.id } });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Supplier Management', () => {
    it('should create a new supplier', async () => {
      const response = (await http().post('/sourcing/suppliers').set(admin.auth)
        .send({ name: 'Global Meds', slug: 'global-meds' }).expect(201)).body;

      expect(response).toMatchObject({
        name: 'Global Meds',
        slug: 'global-meds',
        isActive: true,
      });
      supplierId = response.id;
    });

    it('should fail to create supplier with duplicate name', async () => {
      await http().post('/sourcing/suppliers').set(admin.auth)
        .send({ name: 'Global Meds', slug: 'global-meds-2' }).expect(409);
    });

    it('should get suppliers list', async () => {
      const response = (await http().get('/sourcing/suppliers').set(admin.auth).expect(200)).body;

      expect(Array.isArray(response)).toBe(true);
      expect(response.length).toBeGreaterThanOrEqual(1);
    });

    it('should get supplier by ID', async () => {
      const response = (await http().get(`/sourcing/suppliers/${supplierId}`).set(admin.auth).expect(200)).body;

      expect(response.id).toBe(supplierId);
      expect(response.name).toBe('Global Meds');
    });

    it('should update supplier', async () => {
      const response = (await http().patch(`/sourcing/suppliers/${supplierId}`).set(admin.auth)
        .send({ isActive: false }).expect(200)).body;

      expect(response.isActive).toBe(false);
    });
  });

  describe('Supplier Offer Management', () => {
    it('should create a supplier offer', async () => {
      const response = (await http().post('/sourcing/offers').set(admin.auth).send({
        supplierId,
        skuId: testSkuId,
        costPrice: 50.0,
        currency: 'EGP',
      }).expect(201)).body;

      expect(response).toMatchObject({
        supplierId,
        skuId: testSkuId,
        costPrice: 50,
        currency: 'EGP',
        isAvailable: true,
      });
      offerId = response.id;
    });

    it('should fail to create offer for non-existent SKU', async () => {
      await http().post('/sourcing/offers').set(admin.auth).send({
        supplierId,
        skuId: '00000000-0000-0000-0000-000000000000',
        costPrice: 50.0,
        currency: 'EGP',
      }).expect(404);
    });

    it('should get supplier offers by skuId', async () => {
      const response = (await http().get(`/sourcing/offers?skuId=${testSkuId}`).set(admin.auth).expect(200)).body;

      expect(Array.isArray(response)).toBe(true);
      expect(response.length).toBeGreaterThanOrEqual(1);
      const found = response.find((o: any) => o.id === offerId);
      expect(found).toBeDefined();
    });

    it('should update supplier offer cost', async () => {
      const response = (await http().patch(`/sourcing/offers/${offerId}`).set(admin.auth)
        .send({ costPrice: 55.5 }).expect(200)).body;

      expect(response.costPrice).toBe(55.5);
    });

    it('should confirm offer availability', async () => {
      const response = (await http().post(`/sourcing/offers/${offerId}/confirm-availability`).set(admin.auth)
        .send({ isAvailable: false }).expect(201)).body;

      expect(response.isAvailable).toBe(false);
      expect(response.lastConfirmedAt).toBeNull();
    });

    it('should update confirmedAt on true availability', async () => {
      const response = (await http().post(`/sourcing/offers/${offerId}/confirm-availability`).set(admin.auth)
        .send({ isAvailable: true }).expect(201)).body;

      expect(response.isAvailable).toBe(true);
      expect(response.lastConfirmedAt).not.toBeNull();
    });
  });
});
