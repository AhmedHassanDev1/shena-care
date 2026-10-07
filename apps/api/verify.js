const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function verify() {
  console.log('Products:', await prisma.product.count());
  console.log('Brands:', await prisma.brand.count());
  console.log('Lines:', await prisma.productLine.count());
  
  const p = await prisma.product.findMany({ include: { brand: true, category: true, media: true } });
  let noBrand = 0, noCat = 0, noImg = 0;
  for(const x of p) {
    if(!x.brand) noBrand++;
    if(!x.category) noCat++;
    if(!x.media.length) noImg++;
  }
  
  console.log({ noBrand, noCat, noImg });
  await prisma.$disconnect();
}

verify().catch(console.error);
