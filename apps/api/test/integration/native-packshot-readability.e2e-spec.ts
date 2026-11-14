import { Test } from '@nestjs/testing';
import { randomUUID, createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../../src/app.module';
import { ProductMediaService } from '../../src/modules/catalog/public';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { createActor } from '../fixtures/actors';

describe('native small manufacturer packshot readability review', () => {
  it('quarantines a real 200x400 original; rejects automatic approval, wrong labels and customers; preserves bytes on explicit verified-label review', async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile(), app = mod.createNestApplication(); await app.init();
    const db = app.get(PrismaService), media = app.get(ProductMediaService), tag = randomUUID();
    let skuId: string | undefined, productId: string | undefined;
    try {
      const admin = await createActor(db, 'ADMIN'), customer = await createActor(db, 'CUSTOMER');
      const sku = await db.sku.create({ data: {
        code: `NATIVE-${tag}`, variantName: '236 ml', size: 236, sizeUnit: 'ml', identityStatus: 'EVIDENCE_VERIFIED',
        product: { create: { name: 'SA Smoothing Cleanser', slug: `native-${tag}`,
          brand: { connectOrCreate: { where: { name: 'CeraVe' }, create: { name: 'CeraVe', slug: `native-brand-${tag}` } } },
        } },
      } }); skuId = sku.id; productId = sku.productId;
      const bytes = readFileSync(join(__dirname, '../fixtures/media/cerave-sa-smoothing-cleanser-236ml.webp'));
      const file = { buffer: bytes, originalname: 'native.webp', mimetype: 'image/webp', size: bytes.length } as Express.Multer.File;
      const input = { skuId, role: 'PRIMARY_PACKSHOT' as const, originType: 'verified' as const, sourceUrl: 'https://africa.cerave.com/en/our-products/cleansers/sa-smoothing-cleanser',
        sourcePublisher: 'CeraVe', sourceType: 'OFFICIAL_MANUFACTURER' as const, rightsStatus: 'MANUFACTURER_PUBLISHED' as const };
      await expect(media.registerOriginal(input, file, customer.id)).rejects.toThrow();
      await expect(media.registerOriginal({ ...input, sourceUrl: 'https://cerave.com.evil.example/image' }, file, admin.id)).rejects.toThrow();
      const asset = await media.registerOriginal(input, file, admin.id);
      expect(asset).toMatchObject({ width: 200, height: 400, reviewStatus: 'PENDING_REVIEW', contentHash: createHash('sha256').update(bytes).digest('hex') });
      const automatic = await media.autoReview(asset.id, { approve: true, reason: 'Source is official' }, admin.id);
      expect(automatic).toMatchObject({ reviewStatus: 'REJECTED', reviewNote: 'Automatic: RESOLUTION_TOO_LOW' });
      await db.mediaAsset.update({ where: { id: asset.id }, data: { reviewStatus: 'APPROVED' } });
      await expect(media.publish(asset.id, admin.id)).rejects.toThrow('Native label review is missing');
      await expect(media.review(asset.id, { decision: 'APPROVED', reason: 'Image examined in native resolution' }, admin.id)).rejects.toThrow();
      await expect(media.review(asset.id, { decision: 'APPROVED', reason: 'Image examined in native resolution', evidence: { labelText: 'CeraVe SA Smoothing Cleanser 500 ml' } } as never, admin.id)).rejects.toThrow();
      await expect(media.review(asset.id, { decision: 'APPROVED', reason: 'Image examined in native resolution', evidence: { labelText: 'CeraVe SA Smoothing Cleanser 1236 ml' } } as never, admin.id)).rejects.toThrow();
      await expect(media.review(asset.id, { decision: 'APPROVED', reason: 'Image examined in native resolution', evidence: { labelText: 'CeraVe SA Smoothing Cleanser 8 FL OZ / 236 ml' } } as never, customer.id)).rejects.toThrow();
      const reviewed = await media.review(asset.id, { decision: 'APPROVED', reason: 'Native label is readable: brand, SA Smoothing Cleanser, 8 FL OZ / 236 ml; original pump and bottle intact',
        evidence: { labelText: 'CeraVe SA Smoothing Cleanser 8 FL OZ / 236 ml' } } as never, admin.id);
      expect(reviewed.reviewStatus).toBe('APPROVED');
      expect(reviewed.reviewedAutomatically).toBe(false);
      expect(reviewed.verifiedFacts).toMatchObject({ nativeLabelReadability: { contentHash: asset.contentHash, reviewedBy: admin.id } });
      const published = await media.publish(asset.id, admin.id);
      expect(published.publishedMediaId).toBeTruthy();
      expect(published.contentHash).toBe(asset.contentHash);
      expect(published).toMatchObject({ width: 200, height: 400 });
    } finally {
      if (productId) await db.productMedia.deleteMany({ where: { productId } });
      if (skuId) { await db.mediaAsset.deleteMany({ where: { skuId } }); await db.sku.delete({ where: { id: skuId } }); }
      if (productId) await db.product.delete({ where: { id: productId } });
      await app.close();
    }
  }, 60000);
});
