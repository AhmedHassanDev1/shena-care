import { PrismaClient } from '@prisma/client';
import { resolvePurchaseAvailability } from '../src/modules/sourcing/services/availability-policy';

const prisma = new PrismaClient();

async function main() {
  const p = await prisma.product.findFirst({
    where: { name: { contains: 'Eva' } },
    include: { skus: true },
  });

  if (!p || !p.skus.length) return;
  const sku = p.skus[0];

  const offers = await prisma.supplierOffer.findMany({
    where: { skuId: sku.id, isAvailable: true, supplier: { isActive: true } },
    select: { lastConfirmedAt: true, lastObservedAt: true },
  });

  console.log('Offers in DB:', offers);

  const at = new Date();
  const res24 = resolvePurchaseAvailability(offers, at, 24 * 3600 * 1000, false);
  console.log('With 24h window:', res24);

  const res72 = resolvePurchaseAvailability(offers, at, 72 * 3600 * 1000, false);
  console.log('With 72h window:', res72);
}

main().catch(console.error).finally(() => prisma.$disconnect());
