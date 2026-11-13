import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { createActor } from '../fixtures/actors';
import { uniqueGtin } from '../fixtures/gtin';

describe('publication identity gate over authenticated HTTP', () => {
  it('denies anonymous/customer callers and blocks an unverified identity despite a valid barcode', async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = module.createNestApplication();
    await app.init();
    try {
      const db = app.get(PrismaService);
      const admin = await createActor(db, 'ADMIN');
      const customer = await createActor(db, 'CUSTOMER');
      const tag = randomUUID();
      const sku = await db.sku.create({ data: { code: `GATE-${tag}`, size: 30, sizeUnit: 'ml', variantName: '30ml', barcode: uniqueGtin(),
        product: { create: { name: 'Identity gate regression', slug: `gate-${tag}`, brand: { create: { name: `Gate ${tag}`, slug: `gate-${tag}` } } } },
      } });
      const endpoint = `/catalog/workbench/skus/${sku.id}/publish`;
      await request(app.getHttpServer()).post(endpoint).send({}).expect(401);
      await request(app.getHttpServer()).post(endpoint).set(customer.auth).send({}).expect(403);
      const response = await request(app.getHttpServer()).post(endpoint).set(admin.auth).send({}).expect(409);
      expect(response.body.blockers).toContain('IDENTITY_NOT_VERIFIED');
      expect((await db.product.findUniqueOrThrow({ where: { id: sku.productId } })).isPublished).toBe(false);
    } finally { await app.close(); }
  }, 60000);
});
