import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CatalogService } from '../../catalog/public';

export type SellabilityReason =
  | 'SELLABLE'
  | 'INVALID_SKU_ID'
  | 'SKU_NOT_FOUND'
  | 'SKU_INACTIVE'
  | 'LISTING_NOT_FOUND'
  | 'NOT_LISTED'
  | 'PRICE_NOT_FOUND'
  | 'PRICE_EXPIRED'
  | 'PRICE_INACTIVE';

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

export interface SellabilityEvaluation {
  skuId: string;
  isSellable: boolean;
  reason: SellabilityReason;
  message: string;
  terms: SellingTerms | null;
}

@Injectable()
export class CommerceService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly catalogService?: CatalogService,
  ) {}

  private isUuid(val: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
  }

  /**
   * Deterministic sellability evaluation for a SKU.
   * A SKU is commercially sellable if and only if:
   * 1. SKU exists and is active in Catalog, and its parent product is published.
   * 2. A listing exists in Commerce and isListed is true.
   * 3. An active SellingPrice exists where validFrom <= now <= validUntil (or validUntil is null).
   */
  async evaluateSellability(skuId: string): Promise<SellabilityEvaluation> {
    if (!this.isUuid(skuId)) {
      return {
        skuId,
        isSellable: false,
        reason: 'INVALID_SKU_ID',
        message: 'The provided SKU ID is not a valid UUID format.',
        terms: null,
      };
    }

    // 1. Catalog SKU Validation
    if (this.catalogService) {
      const skuStatus = await this.catalogService.getSkuValidationStatus(skuId);
      if (!skuStatus) {
        return {
          skuId,
          isSellable: false,
          reason: 'SKU_NOT_FOUND',
          message: `SKU '${skuId}' does not exist in Catalog.`,
          terms: null,
        };
      }

      if (!skuStatus.isActive) {
        return {
          skuId,
          isSellable: false,
          reason: 'SKU_INACTIVE',
          message: `SKU '${skuId}' is inactive in Catalog.`,
          terms: null,
        };
      }

      if (!skuStatus.isProductPublished) {
        return {
          skuId,
          isSellable: false,
          reason: 'SKU_INACTIVE',
          message: `The product for SKU '${skuId}' is not published in Catalog.`,
          terms: null,
        };
      }
    }

    // 2. Listing Verification
    const listing = await this.prisma.listing.findUnique({
      where: { skuId },
    });

    if (!listing) {
      return {
        skuId,
        isSellable: false,
        reason: 'LISTING_NOT_FOUND',
        message: `No listing record found for SKU '${skuId}'.`,
        terms: null,
      };
    }

    // 3. Selling Price Verification
    const now = new Date();
    const prices = await this.prisma.sellingPrice.findMany({
      where: { skuId },
      orderBy: { validFrom: 'desc' },
    });

    const activeValidPrice = prices.find(
      (p) =>
        p.isActive &&
        p.validFrom <= now &&
        (p.validUntil === null || p.validUntil >= now),
    );

    const priceTerm = activeValidPrice
      ? {
          amount: activeValidPrice.amount.toNumber(),
          currency: activeValidPrice.currency,
          compareAtAmount: activeValidPrice.compareAtAmount
            ? activeValidPrice.compareAtAmount.toNumber()
            : null,
        }
      : null;

    if (!listing.isListed) {
      return {
        skuId,
        isSellable: false,
        reason: 'NOT_LISTED',
        message: `SKU '${skuId}' is unlisted in Commerce.`,
        terms: {
          skuId,
          isListed: false,
          price: priceTerm,
          canOrder: false,
        },
      };
    }

    if (prices.length === 0) {
      return {
        skuId,
        isSellable: false,
        reason: 'PRICE_NOT_FOUND',
        message: `No selling price found for SKU '${skuId}'.`,
        terms: {
          skuId,
          isListed: true,
          price: null,
          canOrder: false,
        },
      };
    }

    if (!activeValidPrice) {
      const hasExpiredOrFuturePrice = prices.some(
        (p) =>
          p.isActive &&
          ((p.validUntil !== null && p.validUntil < now) || p.validFrom > now),
      );

      if (hasExpiredOrFuturePrice) {
        return {
          skuId,
          isSellable: false,
          reason: 'PRICE_EXPIRED',
          message: `Active selling price for SKU '${skuId}' has expired or is not yet effective.`,
          terms: {
            skuId,
            isListed: true,
            price: null,
            canOrder: false,
          },
        };
      }

      return {
        skuId,
        isSellable: false,
        reason: 'PRICE_INACTIVE',
        message: `Selling price for SKU '${skuId}' is marked inactive.`,
        terms: {
          skuId,
          isListed: true,
          price: null,
          canOrder: false,
        },
      };
    }

    return {
      skuId,
      isSellable: true,
      reason: 'SELLABLE',
      message: `SKU '${skuId}' is commercially sellable.`,
      terms: {
        skuId,
        isListed: true,
        price: priceTerm,
        canOrder: true,
      },
    };
  }

  /**
   * Convenience boolean helper for sellability.
   */
  async isSellable(skuId: string): Promise<boolean> {
    const evaluation = await this.evaluateSellability(skuId);
    return evaluation.isSellable;
  }

  /**
   * Returns selling terms for a SKU, used by composition and consumer layers.
   */
  async getSellingTerms(skuId: string): Promise<SellingTerms | null> {
    if (!this.isUuid(skuId)) {
      return null;
    }

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

    let isCatalogValid = true;
    if (this.catalogService) {
      const status = await this.catalogService.getSkuValidationStatus(skuId);
      isCatalogValid = !!status && status.isActive && status.isProductPublished;
    }

    const canOrder = listing.isListed && price !== null && isCatalogValid;

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
