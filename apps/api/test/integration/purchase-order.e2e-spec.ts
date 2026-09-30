import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import { PurchaseOrderStatus, PurchaseOrderLineStatus } from '@prisma/client';

describe('Purchase Order Flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let supplierId: string;
  let skuId: string;
  let purchaseOrderId: string;
  let lineId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
    prisma = app.get<PrismaService>(PrismaService);

    // Seed data
    const supplier = await prisma.supplier.create({
      data: { name: 'Test PO Supplier', slug: 'test-po-supplier' },
    });
    supplierId = supplier.id;

    const brand = await prisma.brand.create({
      data: { name: 'PO Brand', slug: 'po-brand' },
    });
    const product = await prisma.product.create({
      data: { brandId: brand.id, name: 'PO Product', slug: 'po-product' },
    });
    const sku = await prisma.sku.create({
      data: { productId: product.id, code: 'PO-SKU-1', variantName: 'Default' },
    });
    skuId = sku.id;
  });

  afterAll(async () => {
    // Cleanup
    await prisma.supplierPurchaseOrder.deleteMany({ where: { supplierId } });
    await prisma.sku.delete({ where: { id: skuId } });
    await prisma.product.deleteMany({ where: { slug: 'po-product' } });
    await prisma.brand.deleteMany({ where: { slug: 'po-brand' } });
    await prisma.supplier.delete({ where: { id: supplierId } });
    await app.close();
  });

  it('should create a grouped purchase order for a supplier', async () => {
    const response = await request(app.getHttpServer())
      .post('/purchase-orders')
      .send({
        supplierId,
        lines: [
          { skuId, requestedQuantity: 50 },
        ],
      })
      .expect(201);

    expect(response.body.status).toBe(PurchaseOrderStatus.created);
    expect(response.body.lines.length).toBe(1);
    expect(response.body.lines[0].status).toBe(PurchaseOrderLineStatus.pending);
    expect(response.body.lines[0].requestedQuantity).toBe(50);

    purchaseOrderId = response.body.id;
    lineId = response.body.lines[0].id;
  });

  it('should confirm the purchase order with partial quantity', async () => {
    const response = await request(app.getHttpServer())
      .post(`/purchase-orders/${purchaseOrderId}/confirm`)
      .send({
        lines: [
          {
            id: lineId,
            status: PurchaseOrderLineStatus.confirmed_partial,
            confirmedQuantity: 30,
          },
        ],
      })
      .expect(201);

    expect(response.body.status).toBe(PurchaseOrderStatus.partial);
    expect(response.body.lines[0].status).toBe(PurchaseOrderLineStatus.confirmed_partial);
    expect(response.body.lines[0].confirmedQuantity).toBe(30);
  });
});
