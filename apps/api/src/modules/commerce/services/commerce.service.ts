import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';

export interface SellingTerms {
  skuId: string;
  isListed: boolean;
  price: {
    amount: number;
    currency: string;
    compareAtAmount: number | null;
  } | null;
  canOrder: boolean;
}

@Injectable()
export class CommerceService {
  constructor(private readonly prisma: PrismaService) {}

  async getSellingTerms(skuId: string): Promise<SellingTerms | null> {
    const listing = await this.prisma.listing.findUnique({
      where: { skuId },
    });

    if (!listing) {
      return null;
    }

    const now = new Date();
    const price = await this.prisma.sellingPrice.findFirst({
      where: {
        skuId,
        isActive: true,
        validFrom: { lte: now },
        OR: [{ validUntil: { gte: now } }, { validUntil: null }],
      },
      orderBy: { validFrom: 'desc' },
    });

    const canOrder = listing.isListed && price !== null;

    return {
      skuId,
      isListed: listing.isListed,
      price: price
        ? {
            amount: price.amount.toNumber(),
            currency: price.currency,
            compareAtAmount: price.compareAtAmount ? price.compareAtAmount.toNumber() : null,
          }
        : null,
      canOrder,
    };
  }

  async evaluateSellability(skuId: string): Promise<boolean> {
    const terms = await this.getSellingTerms(skuId);
    return terms?.canOrder ?? false;
  }

  async createListing(skuId: string): Promise<void> {
    const existing = await this.prisma.listing.findUnique({ where: { skuId } });

    if (existing) {
      await this.prisma.listing.update({
        where: { skuId },
        data: { isListed: true, listedAt: new Date(), unlistedAt: null },
      });
    } else {
      await this.prisma.listing.create({
        data: { skuId, isListed: true, listedAt: new Date() },
      });
    }
  }

  async createSellingPrice(
    skuId: string,
    amount: number,
    currency: string,
    compareAtAmount?: number,
  ): Promise<void> {
    await this.prisma.sellingPrice.create({
      data: {
        skuId,
        amount,
        currency,
        compareAtAmount: compareAtAmount ?? null,
        validFrom: new Date(),
        isActive: true,
      },
    });
  }
}
