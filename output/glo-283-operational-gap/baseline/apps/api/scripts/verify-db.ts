import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const brands = await prisma.brand.count();
  const productLines = await prisma.productLine.count();
  const categories = await prisma.category.count();
  const products = await prisma.product.count();
  const skus = await prisma.sku.count();
  const listings = await prisma.listing.count();
  const prices = await prisma.sellingPrice.count();
  const suppliers = await prisma.supplier.count();
  const supplierOffers = await prisma.supplierOffer.count();

  console.log('Seeded Database Entity Counts:');
  console.log(JSON.stringify({
    brands,
    productLines,
    categories,
    products,
    skus,
    listings,
    prices,
    suppliers,
    supplierOffers
  }, null, 2));

  // Check sample product and its brand
  const sampleProduct = await prisma.product.findFirst({
    include: {
      brand: true,
      productLine: true,
      skus: true,
    }
  });

  if (sampleProduct) {
    const sku = sampleProduct.skus[0];
    const listing = sku ? await prisma.listing.findUnique({ where: { skuId: sku.id } }) : null;
    const price = sku ? await prisma.sellingPrice.findFirst({ where: { skuId: sku.id, isActive: true } }) : null;
    const offer = sku ? await prisma.supplierOffer.findFirst({ where: { skuId: sku.id } }) : null;
    const supplier = offer ? await prisma.supplier.findUnique({ where: { id: offer.supplierId } }) : null;

    console.log('\nSample Relationship Cross-Schema Verification:');
    console.log({
      productName: sampleProduct.name,
      brand: sampleProduct.brand.name,
      productLine: sampleProduct.productLine?.name,
      skuCode: sku?.code,
      listingStatus: listing ? (listing.isListed ? 'LISTED' : 'UNLISTED') : 'NONE',
      activePrice: price ? `${price.amount} ${price.currency}` : 'NONE',
      supplierOffer: offer ? `${offer.costPrice} ${offer.currency}` : 'NONE',
      supplierName: supplier?.name
    });
  }
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
