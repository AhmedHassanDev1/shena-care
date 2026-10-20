import { PrismaClient } from '@prisma/client';

export interface AuditIssue {
  offerId: string;
  supplierId: string;
  supplierName: string;
  skuId: string;
  skuCode: string;
  costPrice: number;
  currency: string;
  isAvailable: boolean;
  issues: string[];
}

export async function runSupplierOfferAudit(prisma: PrismaClient): Promise<{ total: number; issues: AuditIssue[] }> {
  const total = await prisma.supplierOffer.count();
  const offers = await prisma.supplierOffer.findMany({
    include: {
      supplier: { select: { id: true, name: true, slug: true } },
    },
  });

  const now = new Date();
  const issues: AuditIssue[] = [];

  for (const offer of offers) {
    const sku = await prisma.sku.findUnique({
      where: { id: offer.skuId },
      select: { id: true, code: true, variantName: true, productId: true },
    });

    const activeSellingPrices = await prisma.sellingPrice.findMany({
      where: {
        skuId: offer.skuId,
        isActive: true,
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gte: now } }],
      },
      select: { id: true, amount: true, currency: true },
    });

    const ingestionItems = await prisma.ingestionItem.findMany({
      where: { matchedSkuId: offer.skuId },
      select: { id: true, price: true, priceType: true, currency: true },
    });

    const issueFlags: string[] = [];
    const cost = offer.costPrice.toNumber();

    for (const sp of activeSellingPrices) {
      const sellAmt = sp.amount.toNumber();
      if (cost >= sellAmt) {
        issueFlags.push(`COST_EXCEEDS_OR_EQUALS_SELL_PRICE: cost=${cost} >= sell=${sellAmt} (sellingPriceId=${sp.id})`);
      }
      if (Math.abs(cost - sellAmt) < 0.001) {
        issueFlags.push(`EXACT_PRICE_MATCH_SUSPICION: cost ${cost} exactly equals selling price`);
      }
    }

    if (ingestionItems.some(i => i.priceType === 'RETAIL_REFERENCE' && Math.abs(i.price.toNumber() - cost) < 0.01)) {
      issueFlags.push('RETAIL_REFERENCE_MATCH: cost matches an IngestionItem with priceType=RETAIL_REFERENCE');
    }

    if (ingestionItems.some(i => !i.priceType && Math.abs(i.price.toNumber() - cost) < 0.01)) {
      issueFlags.push('LEGACY_UNCLASSIFIED_MATCH: cost matches an IngestionItem with null priceType');
    }

    if (issueFlags.length > 0) {
      issues.push({
        offerId: offer.id,
        supplierId: offer.supplierId,
        supplierName: offer.supplier?.name || offer.supplierId,
        skuId: offer.skuId,
        skuCode: sku?.code || offer.skuId,
        costPrice: cost,
        currency: offer.currency,
        isAvailable: offer.isAvailable,
        issues: issueFlags,
      });
    }
  }

  return { total, issues };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('Running non-destructive supplier offer price audit...');
    const result = await runSupplierOfferAudit(prisma);
    console.log(`Audited ${result.total} supplier offers.`);
    console.log(`Flagged ${result.issues.length} offers with potential cost/price integrity issues.`);

    if (result.issues.length > 0) {
      console.log('\n--- Flagged Offers Details ---');
      for (const item of result.issues) {
        console.log(`[!] Offer ${item.offerId} (Supplier: ${item.supplierName}, SKU: ${item.skuCode}):`);
        console.log(`    Cost: ${item.costPrice} ${item.currency}`);
        for (const issue of item.issues) {
          console.log(`    - ${issue}`);
        }
      }
      console.log('\nRecommendation: Staff should review flagged offers before approving POs for these SKUs.');
    } else {
      console.log('All supplier offers have verified positive margins and valid cost semantics.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Audit failed with error:', err);
    process.exit(1);
  });
}
