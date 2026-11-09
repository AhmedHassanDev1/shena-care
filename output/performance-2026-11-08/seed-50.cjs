const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

const target = new URL(process.env.DATABASE_URL || '');
if (target.hostname !== '127.0.0.1' || target.port !== '5434' || !target.pathname.endsWith('_test') ||
    process.env.DIRECT_URL !== process.env.DATABASE_URL) {
  throw new Error('Both datasource URLs must point to the isolated localhost _test database');
}

async function main() {
  const db = new PrismaClient();
  const brands = Array.from({ length: 5 }, (_, i) => ({ id: randomUUID(), name: `Performance Fixture Brand ${i + 1}`, slug: `perf-brand-${i + 1}` }));
  const categories = Array.from({ length: 5 }, (_, i) => ({ id: randomUUID(), name: `Performance Fixture Category ${i + 1}`, slug: `perf-category-${i + 1}` }));
  const products = Array.from({ length: 50 }, (_, i) => ({
    id: randomUUID(), brandId: brands[i % brands.length].id, categoryId: categories[i % categories.length].id,
    name: `Performance Fixture Facial Care ${String(i + 1).padStart(2, '0')}`,
    slug: `perf-facial-care-${String(i + 1).padStart(2, '0')}`, isPublished: true,
  }));
  const skus = products.map((p, i) => ({
    id: randomUUID(), productId: p.id, code: `PERF-20261108-${String(i + 1).padStart(3, '0')}`,
    variantName: '50 ml', size: 50, sizeUnit: 'ml', identityStatus: 'ADMIN_VERIFIED', isActive: true,
  }));
  const media = skus.map((s, i) => ({
    id: randomUUID(), productId: s.productId, type: 'image', originType: 'verified',
    url: `https://example.invalid/perf/product-${i + 1}.png`, isPrimary: true,
    generationMetadata: { sourceUrl: 'https://www.cerave.com/', sourceType: 'OFFICIAL_MANUFACTURER',
      reviewedBy: '00000000-0000-4000-8000-000000000001', reviewedAt: '2026-11-08T00:00:00.000Z',
      skuId: s.id, barcode: null, identityVerification: 'ADMIN_VERIFIED',
      size: 50, sizeUnit: 'ml', variantName: '50 ml', isTest: false },
  }));
  try {
    await db.brand.createMany({ data: brands });
    await db.category.createMany({ data: categories });
    await db.product.createMany({ data: products });
    await db.sku.createMany({ data: skus });
    await db.productMedia.createMany({ data: media });
    await db.listing.createMany({ data: skus.map(s => ({ skuId: s.id, isListed: true })) });
    await db.sellingPrice.createMany({ data: skus.map((s, i) => ({ skuId: s.id, amount: 100 + i * 3,
      currency: 'EGP', validFrom: new Date('2026-01-01T00:00:00Z'), isActive: true })) });
    console.log(JSON.stringify({ products: await db.product.count(), skus: await db.sku.count(),
      media: await db.productMedia.count(), listings: await db.listing.count(), prices: await db.sellingPrice.count() }));
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
