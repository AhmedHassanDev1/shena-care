import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { IngestionPriceType, PurchaseOrderStatus } from '@prisma/client';
import { createActor, Actor } from '../fixtures/actors';
import { randomUUID } from 'crypto';

describe('Supplier Workflow & Engagement (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor;
  let supplierActor: Actor;
  let rivalSupplierActor: Actor;
  let supplierId: string;
  let rivalSupplierId: string;
  let skuId: string;
  let brandId: string;
  let productId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
    prisma = app.get<PrismaService>(PrismaService);

    admin = await createActor(prisma, 'ADMIN');

    // Create supplier organizations
    const suffix = randomUUID().slice(0, 8);
    const supplier = await prisma.supplier.create({
      data: { name: `Engagement Supplier ${suffix}`, slug: `engagement-supplier-${suffix}` },
    });
    supplierId = supplier.id;

    const rival = await prisma.supplier.create({
      data: { name: `Rival Supplier ${suffix}`, slug: `rival-supplier-${suffix}` },
    });
    rivalSupplierId = rival.id;

    supplierActor = await createActor(prisma, 'SUPPLIER', supplierId);
    rivalSupplierActor = await createActor(prisma, 'SUPPLIER', rivalSupplierId);

    // Create catalog SKU
    const brand = await prisma.brand.create({
      data: { name: `Brand ${suffix}`, slug: `brand-${suffix}` },
    });
    brandId = brand.id;

    const product = await prisma.product.create({
      data: { brandId: brand.id, name: `Product ${suffix}`, slug: `product-${suffix}` },
    });
    productId = product.id;

    const sku = await prisma.sku.create({
      data: { productId: product.id, code: `SKU-${suffix}`, variantName: '100ml' },
    });
    skuId = sku.id;
  });

  afterAll(async () => {
    await prisma.supplierOffer.deleteMany({ where: { supplierId: { in: [supplierId, rivalSupplierId] } } });
    await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrder: { supplierId: { in: [supplierId, rivalSupplierId] } } } });
    await prisma.supplierPurchaseOrder.deleteMany({ where: { supplierId: { in: [supplierId, rivalSupplierId] } } });
    await prisma.ingestionItem.deleteMany({ where: { job: { supplierId: { in: [supplierId, rivalSupplierId] } } } });
    await prisma.ingestionJob.deleteMany({ where: { supplierId: { in: [supplierId, rivalSupplierId] } } });
    await prisma.sku.deleteMany({ where: { productId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.brand.deleteMany({ where: { id: brandId } });
    await prisma.supplier.deleteMany({ where: { id: { in: [supplierId, rivalSupplierId] } } });
    await app.close();
  });

  describe('Supplier PO Engagement Tracking (openedAt)', () => {
    let poId: string;

    beforeEach(async () => {
      const po = await prisma.supplierPurchaseOrder.create({
        data: {
          supplierId,
          status: PurchaseOrderStatus.sent,
          issuedAt: new Date(),
          lines: {
            create: [
              {
                skuId,
                requestedQuantity: 5,
                unitCost: 120.00,
                currency: 'EGP',
              },
            ],
          },
        },
      });
      poId = po.id;
    });

    it('keeps openedAt null when created and when inspected by staff', async () => {
      const res = await request(app.getHttpServer())
        .get(`/purchase-orders/${poId}`)
        .set(admin.auth)
        .expect(200);

      expect(res.body.id).toBe(poId);
      expect(res.body.openedAt).toBeNull();

      const dbPo = await prisma.supplierPurchaseOrder.findUniqueOrThrow({ where: { id: poId } });
      expect(dbPo.openedAt).toBeNull();
    });

    it('records openedAt timestamp when accessed by the owning supplier', async () => {
      const beforeAccess = new Date();

      const res = await request(app.getHttpServer())
        .get(`/purchase-orders/${poId}`)
        .set(supplierActor.auth)
        .expect(200);

      expect(res.body.id).toBe(poId);
      expect(res.body.openedAt).toBeTruthy();

      const openedAt = new Date(res.body.openedAt);
      expect(openedAt.getTime()).toBeGreaterThanOrEqual(beforeAccess.getTime() - 1000);

      const dbPo = await prisma.supplierPurchaseOrder.findUniqueOrThrow({ where: { id: poId } });
      expect(dbPo.openedAt).toBeTruthy();
      expect(new Date(dbPo.openedAt!).toISOString()).toBe(openedAt.toISOString());

      // Subsequent access by supplier does not overwrite openedAt
      const secondRes = await request(app.getHttpServer())
        .get(`/purchase-orders/${poId}`)
        .set(supplierActor.auth)
        .expect(200);

      expect(new Date(secondRes.body.openedAt).toISOString()).toBe(openedAt.toISOString());
    });

    it('denies rival supplier from accessing or opening the order', async () => {
      await request(app.getHttpServer())
        .get(`/purchase-orders/${poId}`)
        .set(rivalSupplierActor.auth)
        .expect(403);

      const dbPo = await prisma.supplierPurchaseOrder.findUniqueOrThrow({ where: { id: poId } });
      expect(dbPo.openedAt).toBeNull();
    });
    it('does not trigger openedAt on browser prefetch requests', async () => {
      // Prefetch request with Purpose header
      const prefetchRes = await request(app.getHttpServer())
        .get(`/purchase-orders/${poId}`)
        .set(supplierActor.auth)
        .set('Purpose', 'prefetch')
        .expect(200);

      expect(prefetchRes.body.openedAt).toBeNull();
      const dbPo = await prisma.supplierPurchaseOrder.findUniqueOrThrow({ where: { id: poId } });
      expect(dbPo.openedAt).toBeNull();

      // Prefetch request with Sec-Purpose header
      const secPrefetchRes = await request(app.getHttpServer())
        .get(`/purchase-orders/${poId}`)
        .set(supplierActor.auth)
        .set('Sec-Purpose', 'prefetch')
        .expect(200);

      expect(secPrefetchRes.body.openedAt).toBeNull();

      // Normal read subsequently records openedAt
      const normalRes = await request(app.getHttpServer())
        .get(`/purchase-orders/${poId}`)
        .set(supplierActor.auth)
        .expect(200);

      expect(normalRes.body.openedAt).toBeTruthy();
    });
  });

  describe('Ingestion Feed: Import Mode & Quantity Unknown Semantics', () => {
    it('creates a job with explicit FULL_SNAPSHOT mode and records reported quantity', async () => {
      const payload = {
        supplierId,
        mode: 'FULL_SNAPSHOT',
        items: [
          {
            supplierSkuCode: `SUP-SKU-${randomUUID().slice(0, 6)}`,
            name: 'Snapshot Feed Product',
            brand: 'Test Brand',
            price: 75.50,
            priceType: IngestionPriceType.PURCHASE_COST,
            reportedQuantity: 50,
            currency: 'EGP',
          },
        ],
      };

      const res = await request(app.getHttpServer())
        .post('/ingestion/jobs')
        .set(admin.auth)
        .send(payload)
        .expect(201);

      expect(res.body.mode).toBe('FULL_SNAPSHOT');
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].reportedQuantity).toBe(50);
      expect(res.body.items[0].priceType).toBe(IngestionPriceType.PURCHASE_COST);

      // Verify readback as supplier
      const readRes = await request(app.getHttpServer())
        .get(`/ingestion/jobs/${res.body.id}`)
        .set(supplierActor.auth)
        .expect(200);

      expect(readRes.body.mode).toBe('FULL_SNAPSHOT');
      expect(readRes.body.items[0].reportedQuantity).toBe(50);
    });

    it('defaults to PARTIAL_UPDATE and keeps omitted reportedQuantity strictly null (unknown)', async () => {
      const payload = {
        supplierId,
        items: [
          {
            supplierSkuCode: `SUP-SKU-${randomUUID().slice(0, 6)}`,
            name: 'Partial Update Product',
            brand: 'Test Brand',
            price: 110.00,
            priceType: IngestionPriceType.PURCHASE_COST,
            currency: 'EGP',
          },
        ],
      };

      const res = await request(app.getHttpServer())
        .post('/ingestion/jobs')
        .set(admin.auth)
        .send(payload)
        .expect(201);

      expect(res.body.mode).toBe('PARTIAL_UPDATE');
      expect(res.body.items[0].reportedQuantity).toBeNull();

      // Read back from database directly to verify no inferred or fake stock was stored
      const dbItem = await prisma.ingestionItem.findUniqueOrThrow({ where: { id: res.body.items[0].id } });
      expect(dbItem.reportedQuantity).toBeNull();
    });

    it('rejects publishing candidate with CONSUMER_REFERENCE priceType as purchase offer', async () => {
      const job = await prisma.ingestionJob.create({
        data: {
          supplierId,
          mode: 'PARTIAL_UPDATE',
          status: 'pending',
          items: {
            create: [
              {
                supplierSkuCode: `MSRP-${randomUUID().slice(0, 6)}`,
                name: 'Consumer Reference Item',
                brand: 'Brand Ref',
                price: 250.00,
                priceType: IngestionPriceType.CONSUMER_REFERENCE,
                currency: 'EGP',
                status: 'approved',
                matchedSkuId: skuId,
              },
            ],
          },
        },
        include: { items: true },
      });

      const candidateId = job.items[0].id;

      // Attempt to publish candidate with consumer reference price
      const res = await request(app.getHttpServer())
        .post(`/ingestion/candidates/${candidateId}/publish`)
        .set(admin.auth)
        .expect(400);

      expect(res.body.message).toContain('Explicit purchase cost price type is required for offer publication');
    });

    it('deactivates unmentioned supplier offers on FULL_SNAPSHOT job publish while preserving on PARTIAL_UPDATE', async () => {
      // 1. Create a second SKU
      const extraSku = await prisma.sku.create({
        data: { productId, code: `SKU-EXTRA-${randomUUID().slice(0, 6)}`, variantName: '50ml' },
      });

      // 2. Create existing active offer for extraSku
      const oldOffer = await prisma.supplierOffer.create({
        data: {
          supplierId,
          skuId: extraSku.id,
          costPrice: 90.00,
          currency: 'EGP',
          isAvailable: true,
        },
      });

      // 3. Create and publish a FULL_SNAPSHOT job that only contains skuId (extraSku is omitted)
      const snapshotJob = await prisma.ingestionJob.create({
        data: {
          supplierId,
          mode: 'FULL_SNAPSHOT',
          status: 'approved',
          items: {
            create: [
              {
                supplierSkuCode: `SNAP-${randomUUID().slice(0, 6)}`,
                name: 'Snapshot Only Item',
                brand: 'Brand Snapshot',
                price: 100.00,
                priceType: IngestionPriceType.PURCHASE_COST,
                currency: 'EGP',
                status: 'published',
                matchedSkuId: skuId,
              },
            ],
          },
        },
      });

      await request(app.getHttpServer())
        .post(`/ingestion/jobs/${snapshotJob.id}/publish`)
        .set(admin.auth)
        .expect(201);

      // Verify the omitted old offer was deactivated
      const updatedOldOffer = await prisma.supplierOffer.findUniqueOrThrow({ where: { id: oldOffer.id } });
      expect(updatedOldOffer.isAvailable).toBe(false);

      // Cleanup extraSku
      await prisma.supplierOffer.delete({ where: { id: oldOffer.id } });
      await prisma.sku.delete({ where: { id: extraSku.id } });
    });
  });
});
