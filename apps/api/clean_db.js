const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function clean() {
  await prisma.productMedia.deleteMany({});
  await prisma.sku.deleteMany({});
  await prisma.product.deleteMany({});
  console.log('Cleaned db');
}
clean().then(() => prisma.$disconnect());
