import { MediaOriginType, MediaType } from '@prisma/client';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { ensureFixtureReviewer, reviewedMediaMetadata } from './sellable-sku';

/**
 * Test-only catalog dataset (CeraVe / La Roche-Posay) that the older integration suites
 * were written against. It was removed from the production seed in GLO-75, so suites that
 * rely on it call this explicitly. Idempotent: every call restores the same known state
 * inside the disposable `_test` database and never touches production seed records.
 */
export const LEGACY = {
  creamSlug: 'cerave-moisturizing-cream',
  creamSkuCode: 'CRV-MC-177',
  creamPrice: 15.99,
  sunscreenSlug: 'lrp-anthelios-sunscreen-spf60',
  sunscreenSkuCode: 'LRP-AH-150',
  currency: 'USD',
} as const;

async function category(prisma: PrismaService, slug: string, name: string, sortOrder: number, parentId: string | null = null) {
  return prisma.category.upsert({
    where: { slug },
    update: { name, parentId, isActive: true },
    create: { slug, name, parentId, sortOrder, isActive: true },
  });
}

export async function ensureLegacyCatalog(prisma: PrismaService) {
  const reviewer = await ensureFixtureReviewer(prisma);

  const cerave = await prisma.brand.upsert({
    where: { slug: 'cerave' }, update: { name: 'CeraVe', isActive: true },
    create: { name: 'CeraVe', slug: 'cerave', description: 'Developed with dermatologists', websiteUrl: 'https://www.cerave.com', countryOfOrigin: 'USA', isActive: true },
  });
  const lrp = await prisma.brand.upsert({
    where: { slug: 'la-roche-posay' }, update: { name: 'La Roche-Posay', isActive: true },
    create: { name: 'La Roche-Posay', slug: 'la-roche-posay', description: 'Dermatological skincare', websiteUrl: 'https://www.laroche-posay.us', countryOfOrigin: 'France', isActive: true },
  });
  const ceraveLine = await prisma.productLine.upsert({
    where: { slug: 'cerave-daily-moisturizers' }, update: { brandId: cerave.id, isActive: true },
    create: { brandId: cerave.id, name: 'Daily Moisturizers', slug: 'cerave-daily-moisturizers', isActive: true },
  });
  const lrpLine = await prisma.productLine.upsert({
    where: { slug: 'lrp-anthelios' }, update: { brandId: lrp.id, isActive: true },
    create: { brandId: lrp.id, name: 'Anthelios Sun Care', slug: 'lrp-anthelios', isActive: true },
  });

  const skinCare = await category(prisma, 'skin-care', 'Skin Care', 1);
  const hairCare = await category(prisma, 'hair-care', 'Hair Care', 2);
  const moisturizers = await category(prisma, 'moisturizers', 'Moisturizers', 2, skinCare.id);
  const sunscreens = await category(prisma, 'sunscreens', 'Sunscreens', 4, skinCare.id);
  await category(prisma, 'shampoos', 'Shampoos', 1, hairCare.id);

  const supplier = await prisma.supplier.upsert({
    where: { slug: 'legacy-fixture-supplier' }, update: { isActive: true },
    create: { name: 'Legacy Fixture Supplier', slug: 'legacy-fixture-supplier', isActive: true },
  });

  const products = [
    { slug: LEGACY.creamSlug, name: 'Moisturizing Cream', brandId: cerave.id, productLineId: ceraveLine.id, categoryId: moisturizers.id,
      description: 'A rich, non-greasy cream that provides 24-hour hydration.', usage: 'Apply liberally to face and body as needed.',
      warnings: 'For external use only.',
      sku: { code: LEGACY.creamSkuCode, variantName: '6 oz Jar', size: 177, sizeUnit: 'ml', barcode: '3606000537736' },
      price: { amount: LEGACY.creamPrice, compareAtAmount: 19.99 } },
    { slug: LEGACY.sunscreenSlug, name: 'Anthelios Melt-In Milk Sunscreen SPF 60', brandId: lrp.id, productLineId: lrpLine.id, categoryId: sunscreens.id,
      description: 'Broad spectrum SPF 60 protection.', usage: 'Apply generously 15 minutes before sun exposure.',
      warnings: 'For external use only.',
      sku: { code: LEGACY.sunscreenSkuCode, variantName: '5 fl oz', size: 150, sizeUnit: 'ml', barcode: '3337875545853' },
      price: { amount: 35.99, compareAtAmount: null } },
  ];

  const result: Record<string, { productId: string; skuId: string }> = {};
  for (const p of products) {
    const { sku: s, price, ...fields } = p;
    const product = await prisma.product.upsert({
      where: { slug: p.slug }, update: { ...fields, isPublished: true }, create: { ...fields, isPublished: true },
    });
    const sku = await prisma.sku.upsert({
      where: { code: s.code }, update: { ...s, productId: product.id, isActive: true }, create: { ...s, productId: product.id, isActive: true },
    });
    const url = `https://cdn.fixtures.test/legacy/${p.slug}-front.jpg`;
    const generationMetadata = reviewedMediaMetadata({ id: sku.id, ...s }, reviewer.id);
    const media = await prisma.productMedia.findFirst({ where: { productId: product.id, url } });
    if (media) {
      await prisma.productMedia.update({ where: { id: media.id }, data: { originType: MediaOriginType.verified, generationMetadata, isPrimary: true, sortOrder: 0 } });
    } else {
      await prisma.productMedia.create({ data: {
        productId: product.id, type: MediaType.image, url, altText: `${p.name} front view`, sortOrder: 0, isPrimary: true,
        originType: MediaOriginType.verified, generationMetadata,
      } });
    }
    await prisma.listing.upsert({
      where: { skuId: sku.id }, update: { isListed: true, unlistedAt: null }, create: { skuId: sku.id, isListed: true, listedAt: new Date() },
    });
    // Restore the canonical effective price if an earlier suite superseded or expired it.
    const now = new Date();
    const effective = await prisma.sellingPrice.findFirst({
      where: { skuId: sku.id, isActive: true, validFrom: { lte: now }, OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
      orderBy: { validFrom: 'desc' },
    });
    if (!effective || effective.amount.toNumber() !== price.amount || effective.currency !== LEGACY.currency) {
      await prisma.sellingPrice.create({ data: {
        skuId: sku.id, amount: price.amount, compareAtAmount: price.compareAtAmount, currency: LEGACY.currency, validFrom: new Date(now.getTime() - 1000),
      } });
    }
    await prisma.supplierOffer.upsert({
      where: { supplierId_skuId: { supplierId: supplier.id, skuId: sku.id } },
      update: { isAvailable: true, lastObservedAt: now, lastConfirmedAt: now },
      create: { supplierId: supplier.id, skuId: sku.id, costPrice: price.amount / 2, currency: LEGACY.currency, lastObservedAt: now, lastConfirmedAt: now },
    });
    result[p.slug] = { productId: product.id, skuId: sku.id };
  }
  return { cerave, lrp, ceraveLine, lrpLine, moisturizers, supplier, reviewer, products: result };
}
