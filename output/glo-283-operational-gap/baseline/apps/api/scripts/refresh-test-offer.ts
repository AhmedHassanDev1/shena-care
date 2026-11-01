import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const offerId = '6f6aa5ce-80ca-46c4-a4ee-1233ab25738a';
  const updated = await prisma.supplierOffer.update({
    where: { id: offerId },
    data: {
      lastConfirmedAt: new Date(),
      lastObservedAt: new Date(),
      isAvailable: true,
    },
  });
  console.log('Updated offer confirmation:', updated);
}

main().catch(console.error).finally(() => prisma.$disconnect());
