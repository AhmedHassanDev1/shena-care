import { randomUUID } from 'crypto';
import { PrismaService } from '../../src/platform/database/prisma.service';

/** Each test run owns its fixture; no production seed or existing records are changed. */
export async function createSellableSku(prisma: PrismaService) {
  const suffix = randomUUID();
  const brand = await prisma.brand.create({ data: { name: 'Test ' + suffix, slug: 'test-' + suffix } });
  const product = await prisma.product.create({ data: {
    brandId: brand.id, name: 'Test Product', slug: 'test-product-' + suffix,
  } });
  const sku = await prisma.sku.create({ data: {
    productId: product.id, code: 'TEST-' + suffix, variantName: 'Original', barcode: 'TEST-BAR-' + suffix,
  } });
  await prisma.listing.create({ data: { skuId: sku.id, isListed: true } });
  await prisma.sellingPrice.create({ data: {
    skuId: sku.id, amount: 100, currency: 'EGP', validFrom: new Date(Date.now() - 60000),
  } });
  const supplier = await prisma.supplier.create({ data: { name: 'Test Supplier ' + suffix, slug: 'test-supplier-' + suffix } });
  await prisma.supplierOffer.create({ data: {
    supplierId: supplier.id, skuId: sku.id, costPrice: 50, currency: 'EGP', lastObservedAt: new Date(),
  } });
  return { ...sku, productSlug: product.slug };
}
