import {
  Injectable,
  Optional,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
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

export interface ListingDetail {
  id: string;
  skuId: string;
  isListed: boolean;
  listedAt: Date | null;
  unlistedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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

  // ---------------------------------------------------------------------------
  // Sellability Evaluation (GLO-101)
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Listing Management (GLO-102)
  // ---------------------------------------------------------------------------

  async getListing(skuId: string): Promise<ListingDetail | null> {
    if (!this.isUuid(skuId)) {
      return null;
    }

    const listing = await this.prisma.listing.findUnique({
      where: { skuId },
    });

    if (!listing) {
      return null;
    }

    return {
      id: listing.id,
      skuId: listing.skuId,
      isListed: listing.isListed,
      listedAt: listing.listedAt,
      unlistedAt: listing.unlistedAt,
      createdAt: listing.createdAt,
      updatedAt: listing.updatedAt,
    };
  }

  async getListings(filters?: {
    isListed?: boolean;
    page?: number;
    limit?: number;
  }): Promise<{ items: ListingDetail[]; total: number; page: number; limit: number }> {
    const where = {
      ...(filters?.isListed !== undefined && { isListed: filters.isListed }),
    };

    const page = filters?.page && filters.page > 0 ? filters.page : 1;
    const limit = filters?.limit && filters.limit > 0 ? Math.min(filters.limit, 100) : 20;
    const skip = (page - 1) * limit;

    const [total, listings] = await Promise.all([
      this.prisma.listing.count({ where }),
      this.prisma.listing.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      items: listings.map((l) => ({
        id: l.id,
        skuId: l.skuId,
        isListed: l.isListed,
        listedAt: l.listedAt,
        unlistedAt: l.unlistedAt,
        createdAt: l.createdAt,
        updatedAt: l.updatedAt,
      })),
      total,
      page,
      limit,
    };
  }

  async createListing(skuId: string, isListed = true): Promise<ListingDetail> {
    if (!this.isUuid(skuId)) {
      throw new BadRequestException(`Invalid SKU ID format: ${skuId}`);
    }

    if (this.catalogService) {
      const isValid = await this.catalogService.validateSku(skuId);
      if (!isValid) {
        throw new NotFoundException(`SKU not found or inactive in Catalog: ${skuId}`);
      }
    }

    const existing = await this.prisma.listing.findUnique({ where: { skuId } });
    if (existing) {
      if (existing.isListed !== isListed) {
        const updated = await this.prisma.listing.update({
          where: { skuId },
          data: {
            isListed,
            listedAt: isListed ? new Date() : existing.listedAt,
            unlistedAt: isListed ? null : new Date(),
          },
        });
        return {
          id: updated.id,
          skuId: updated.skuId,
          isListed: updated.isListed,
          listedAt: updated.listedAt,
          unlistedAt: updated.unlistedAt,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        };
      }
      return {
        id: existing.id,
        skuId: existing.skuId,
        isListed: existing.isListed,
        listedAt: existing.listedAt,
        unlistedAt: existing.unlistedAt,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
      };
    }

    const now = new Date();
    const created = await this.prisma.listing.create({
      data: {
        skuId,
        isListed,
        listedAt: isListed ? now : null,
        unlistedAt: isListed ? null : now,
      },
    });

    return {
      id: created.id,
      skuId: created.skuId,
      isListed: created.isListed,
      listedAt: created.listedAt,
      unlistedAt: created.unlistedAt,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  }

  async listSku(skuId: string): Promise<ListingDetail> {
    if (!this.isUuid(skuId)) {
      throw new BadRequestException(`Invalid SKU ID format: ${skuId}`);
    }

    if (this.catalogService) {
      const isValid = await this.catalogService.validateSku(skuId);
      if (!isValid) {
        throw new NotFoundException(`SKU not found or inactive in Catalog: ${skuId}`);
      }
    }

    const existing = await this.prisma.listing.findUnique({ where: { skuId } });
    const now = new Date();

    if (!existing) {
      const created = await this.prisma.listing.create({
        data: {
          skuId,
          isListed: true,
          listedAt: now,
          unlistedAt: null,
        },
      });
      return {
        id: created.id,
        skuId: created.skuId,
        isListed: created.isListed,
        listedAt: created.listedAt,
        unlistedAt: created.unlistedAt,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      };
    }

    if (existing.isListed) {
      return {
        id: existing.id,
        skuId: existing.skuId,
        isListed: existing.isListed,
        listedAt: existing.listedAt,
        unlistedAt: existing.unlistedAt,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
      };
    }

    const updated = await this.prisma.listing.update({
      where: { skuId },
      data: {
        isListed: true,
        listedAt: now,
        unlistedAt: null,
      },
    });

    return {
      id: updated.id,
      skuId: updated.skuId,
      isListed: updated.isListed,
      listedAt: updated.listedAt,
      unlistedAt: updated.unlistedAt,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  async unlistSku(skuId: string): Promise<ListingDetail> {
    if (!this.isUuid(skuId)) {
      throw new BadRequestException(`Invalid SKU ID format: ${skuId}`);
    }

    const existing = await this.prisma.listing.findUnique({ where: { skuId } });
    if (!existing) {
      throw new NotFoundException(`Listing not found for SKU: ${skuId}`);
    }

    if (!existing.isListed) {
      return {
        id: existing.id,
        skuId: existing.skuId,
        isListed: existing.isListed,
        listedAt: existing.listedAt,
        unlistedAt: existing.unlistedAt,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
      };
    }

    const now = new Date();
    const updated = await this.prisma.listing.update({
      where: { skuId },
      data: {
        isListed: false,
        unlistedAt: now,
      },
    });

    return {
      id: updated.id,
      skuId: updated.skuId,
      isListed: updated.isListed,
      listedAt: updated.listedAt,
      unlistedAt: updated.unlistedAt,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  // ---------------------------------------------------------------------------
  // SellingPrice Management (Baseline)
  // ---------------------------------------------------------------------------

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
