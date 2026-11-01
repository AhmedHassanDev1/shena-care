import { randomUUID } from 'crypto';
import { MediaOriginType, MediaType } from '@prisma/client';
import { PrismaService } from '../../src/platform/database/prisma.service';

/** Trusted manufacturer page accepted by the media-review policy (platform/security/media-review.ts). */
export const FIXTURE_SOURCE_URL = 'https://www.cerave.com/skincare/moisturizers/moisturizing-cream';

type ReviewableSku = { id: string; barcode: string; size: number; sizeUnit: string; variantName: string };

/**
 * A human reviewer (ADMIN) whose identity review makes media publicly eligible.
 * Fixtures model the outcome of the approval flow; the flow itself is covered by
 * product-readiness and glo-123-media-upload.
 */
export async function ensureFixtureReviewer(prisma: PrismaService) {
  return prisma.customer.upsert({
    where: { email: 'fixture-media-reviewer@fixtures.test' },
    update: { roles: ['ADMIN'] },
    create: { name: 'Fixture Media Reviewer', email: 'fixture-media-reviewer@fixtures.test', roles: ['ADMIN'] },
  });
}

export function reviewedMediaMetadata(sku: ReviewableSku, reviewerId: string) {
  return {
    isTest: false,
    reviewedBy: reviewerId,
    reviewedAt: new Date().toISOString(),
    skuId: sku.id,
    barcode: sku.barcode,
    size: sku.size,
    sizeUnit: sku.sizeUnit,
    variantName: sku.variantName,
    sourceType: 'OFFICIAL_MANUFACTURER',
    sourceUrl: FIXTURE_SOURCE_URL,
  };
}

/** Gives an existing SKU a reviewed identity (barcode/size) and verified media, making it catalog-eligible. */
export async function attachReviewedMedia(prisma: PrismaService, skuId: string) {
  const reviewer = await ensureFixtureReviewer(prisma);
  const current = await prisma.sku.findUniqueOrThrow({ where: { id: skuId } });
  const sku = await prisma.sku.update({ where: { id: skuId }, data: {
    barcode: current.barcode ?? 'REVIEWED-' + randomUUID(), size: current.size ?? 50, sizeUnit: current.sizeUnit ?? 'ml',
  } });
  return prisma.productMedia.create({ data: {
    productId: sku.productId, type: MediaType.image, url: `https://cdn.fixtures.test/${randomUUID()}.png`, isPrimary: true,
    originType: MediaOriginType.verified,
    generationMetadata: reviewedMediaMetadata({ id: sku.id, barcode: sku.barcode!, size: sku.size!.toNumber(),
      sizeUnit: sku.sizeUnit!, variantName: sku.variantName }, reviewer.id),
  } });
}

/**
 * Each test run owns its fixture; no production seed or existing records are changed.
 * The SKU is publicly eligible and orderable: published product, reviewed media,
 * listing, active price and fresh confirmed supplier availability.
 */
export async function createSellableSku(prisma: PrismaService) {
  const suffix = randomUUID();
  const reviewer = await ensureFixtureReviewer(prisma);
  const brand = await prisma.brand.create({ data: { name: 'Test ' + suffix, slug: 'test-' + suffix } });
  const product = await prisma.product.create({ data: {
    brandId: brand.id, name: 'Test Product', slug: 'test-product-' + suffix, isPublished: true,
  } });
  const sku = await prisma.sku.create({ data: {
    productId: product.id, code: 'TEST-' + suffix, variantName: '50 ml', size: 50, sizeUnit: 'ml', barcode: 'TEST-BAR-' + suffix,
  } });
  await prisma.productMedia.create({ data: {
    productId: product.id, type: MediaType.image, url: `https://cdn.fixtures.test/${suffix}.png`, isPrimary: true,
    originType: MediaOriginType.verified,
    generationMetadata: reviewedMediaMetadata({ id: sku.id, barcode: sku.barcode!, size: 50, sizeUnit: 'ml', variantName: '50 ml' }, reviewer.id),
  } });
  await prisma.listing.create({ data: { skuId: sku.id, isListed: true } });
  await prisma.sellingPrice.create({ data: {
    skuId: sku.id, amount: 100, currency: 'EGP', validFrom: new Date(Date.now() - 60000),
  } });
  const supplier = await prisma.supplier.create({ data: { name: 'Test Supplier ' + suffix, slug: 'test-supplier-' + suffix } });
  await prisma.supplierOffer.create({ data: {
    supplierId: supplier.id, skuId: sku.id, costPrice: 50, currency: 'EGP', lastObservedAt: new Date(), lastConfirmedAt: new Date(),
  } });
  return { ...sku, productSlug: product.slug, productId: product.id, supplierId: supplier.id };
}
