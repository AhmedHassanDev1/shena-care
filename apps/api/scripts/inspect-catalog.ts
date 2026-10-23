import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const p = await prisma.product.findFirst({
    include: {
      media: true,
      skus: true,
    },
  });

  if (!p) return;
  console.log('Product:', p.name, 'isPublished:', p.isPublished);
  console.log('Media:', JSON.stringify(p.media[0], null, 2));

  const sku = p.skus[0];
  const listing = await prisma.listing.findUnique({ where: { skuId: sku.id } });
  const price = await prisma.sellingPrice.findFirst({ where: { skuId: sku.id, isActive: true } });
  const offer = await prisma.supplierOffer.findFirst({ where: { skuId: sku.id } });

  console.log('Listing:', listing);
  console.log('Price:', price);
  console.log('Offer:', offer);
}

main().catch(console.error).finally(() => prisma.$disconnect());
