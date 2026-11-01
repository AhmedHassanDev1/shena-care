import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { createActor, Actor } from '../fixtures/actors';

describe('Purchase Order Flow (e2e)', () => {
  let admin: Actor;
  let app: INestApplication;
  let prisma: PrismaService;
  let supplierId: string;
  let skuId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
    prisma = app.get<PrismaService>(PrismaService);
    admin = await createActor(prisma, 'HUB_OPERATOR');

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

  it('blocks standalone creation and preserves legacy history for reconciliation', async () => {
    await request(app.getHttpServer()).post('/purchase-orders').set(admin.auth)
      .send({ supplierId, lines: [{ skuId, requestedQuantity: 50 }] }).expect(409);
    const legacy = await prisma.supplierPurchaseOrder.create({ data: { supplierId, status: 'sent',
      lines: { create: [{ skuId, requestedQuantity: 50 }] } }, include: { lines: true } });
    await request(app.getHttpServer()).get(`/purchase-orders/${legacy.id}`).set(admin.auth).expect(200);
    await request(app.getHttpServer()).post(`/purchase-orders/${legacy.id}/confirm`).set(admin.auth)
      .send({ lines: [{ id: legacy.lines[0].id, status: 'confirmed_partial', confirmedQuantity: 30 }] }).expect(409);
    expect((await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: legacy.lines[0].id } })).confirmedQuantity).toBeNull();
  });
});
