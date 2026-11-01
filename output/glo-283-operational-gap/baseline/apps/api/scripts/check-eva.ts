import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const p = await prisma.product.findFirst({
    where: { name: { contains: 'Eva' } },
    include: {
      media: true,
      skus: {
        include: {
          media: true,
        }
      }
    }
  });

  if (!p) {
    console.log('No Eva product found');
    return;
  }

  console.log('Eva Product:', {
    id: p.id,
    name: p.name,
    isPublished: p.isPublished,
    media: p.media,
    skus: p.skus.map(s => ({
      id: s.id,
      code: s.code,
      isActive: s.isActive,
      media: s.media,
    }))
  });

  const sku = p.skus[0];
  if (sku) {
    const listing = await prisma.listing.findUnique({ where: { skuId: sku.id } });
    const price = await prisma.sellingPrice.findFirst({ where: { skuId: sku.id, isActive: true } });
    const offers = await prisma.supplierOffer.findMany({ where: { skuId: sku.id } });
    console.log('Commerce & Sourcing:', {
      listing,
      price,
      offers,
    });
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
