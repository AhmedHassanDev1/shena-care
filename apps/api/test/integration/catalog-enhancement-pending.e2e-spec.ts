import { Test } from '@nestjs/testing';
import { randomUUID, createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { ProductMediaService } from '../../src/modules/catalog/services/product-media.service';
import { MediaTemplateService } from '../../src/modules/catalog/services/media-template.service';
import { createActor } from '../fixtures/actors';

describe('deferred enhancement with PostgreSQL and an authentic original photo', () => {
  it('keeps the original bytes and persists one pending, unpublishable derivative', async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = module.createNestApplication();
    await app.init();
    try {
      const db = app.get(PrismaService);
      const admin = await createActor(db, 'ADMIN');
      const buffer = readFileSync(join(__dirname, '../fixtures/media/cerave-moisturising-cream-454g.png'));
      const contentHash = createHash('sha256').update(buffer).digest('hex');
      const prior = await db.mediaAsset.findFirst({ where: { contentHash, parentAssetId: null, sku: { product: { name: 'Authentic photo preservation test' } } } });
      const tag = randomUUID();
      const sku = prior ? await db.sku.findUniqueOrThrow({ where: { id: prior.skuId } }) : await db.sku.create({ data: {
        code: `PHOTO-${tag}`, variantName: '454g', size: 454, sizeUnit: 'g', product: { create: {
          name: 'Authentic photo preservation test', slug: `photo-${tag}`, brand: { create: { name: `Media fixture ${tag}`, slug: `media-${tag}` } },
        } },
      } });
      const media = app.get(ProductMediaService);
      const original = await media.registerOriginal({ skuId: sku.id, role: 'PRIMARY_PACKSHOT', originType: 'verified', sourceUrl: 'https://africa.cerave.com/en/our-products/moisturizers/moisturising-cream', sourcePublisher: 'CeraVe', sourceType: 'OFFICIAL_MANUFACTURER', rightsStatus: 'MANUFACTURER_PUBLISHED' },
        { buffer, originalname: 'original.png', mimetype: 'image/png', size: buffer.length } as Express.Multer.File, admin.id);
      await app.get(MediaTemplateService).ensureDefaultTemplate(admin.id);
      const copy = await media.requestEditorial(original.id, admin.id);
      expect(copy.processingStatus).toBe('PENDING');
      expect(copy.storageUrl).toBeNull();
      expect((await media.requestEditorial(original.id, admin.id)).id).toBe(copy.id);
      expect(await db.mediaAsset.count({ where: { parentAssetId: original.id } })).toBe(1);
      expect((await media.readAssetFile(original.id)).buffer.equals(buffer)).toBe(true);
      expect((await db.mediaAsset.findUniqueOrThrow({ where: { id: original.id } })).contentHash).toBe(createHash('sha256').update(buffer).digest('hex'));
      await expect(media.publish(copy.id, admin.id)).rejects.toThrow();
      expect((await db.product.findUniqueOrThrow({ where: { id: sku.productId } })).isPublished).toBe(false);
    } finally { await app.close(); }
  }, 60000);
});
