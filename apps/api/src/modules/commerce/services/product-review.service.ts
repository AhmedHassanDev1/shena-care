import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isDevTestReviewFlagEnabled } from '../../../platform/auth/dev-test-reviews';
import { PrismaService } from '../../../platform/database/prisma.service';

export type RatingDistribution = Record<1 | 2 | 3 | 4 | 5, number>;

export interface ProductReviewSummary {
  /** Mean of published ratings, one decimal; null when there are none. */
  average: number | null;
  count: number;
  distribution: RatingDistribution;
  /** Share (0–100, whole percent) of published reviews rated 4 or 5; null when there are none. */
  recommendPercent: number | null;
  verifiedCount: number;
}

export interface PublicProductReview {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  authorName: string;
  skinType: string | null;
  isVerifiedPurchase: boolean;
  isTest: boolean;
  helpfulCount: number;
  createdAt: string;
}

export interface CreateCustomerReviewInput {
  productId: string;
  customerId: string;
  skuId?: string | null;
  orderId?: string | null;
  rating: number;
  title?: string | null;
  body?: string | null;
  authorName: string;
  skinType?: string | null;
  isVerifiedPurchase: boolean;
  isTest: boolean;
}

export interface ExistingCustomerReview {
  id: string;
  rating: number;
  isVerifiedPurchase: boolean;
  isTest: boolean;
  createdAt: string;
}

export interface ProductReviewPage {
  summary: ProductReviewSummary;
  items: PublicProductReview[];
  pageInfo: { page: number; limit: number; hasNextPage: boolean };
}

export type ReviewSort = 'recent' | 'helpful' | 'rating_high' | 'rating_low';

const SORTS: Record<ReviewSort, Array<Record<string, 'asc' | 'desc'>>> = {
  recent: [{ createdAt: 'desc' }, { id: 'asc' }],
  helpful: [{ helpfulCount: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
  rating_high: [{ rating: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
  rating_low: [{ rating: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
};

/** Pure summary over published ratings, so the arithmetic is unit-testable without a database. */
export function summarizeRatings(ratings: Array<{ rating: number; count: number; verified: number }>): ProductReviewSummary {
  const distribution: RatingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let count = 0;
  let total = 0;
  let verifiedCount = 0;
  for (const row of ratings) {
    if (!Number.isInteger(row.rating) || row.rating < 1 || row.rating > 5 || row.count <= 0) continue;
    distribution[row.rating as 1 | 2 | 3 | 4 | 5] += row.count;
    count += row.count;
    total += row.rating * row.count;
    verifiedCount += row.verified;
  }
  if (!count) return { average: null, count: 0, distribution, recommendPercent: null, verifiedCount: 0 };
  return {
    average: Math.round((total / count) * 10) / 10,
    count,
    distribution,
    recommendPercent: Math.round(((distribution[4] + distribution[5]) / count) * 100),
    verifiedCount,
  };
}

/**
 * Commerce-owned product reviews. Production reads and rating summaries strictly exclude dev-test rows (`isTest: true`).
 */
@Injectable()
export class ProductReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(productId: string): Promise<ProductReviewSummary> {
    const [all, verified] = await Promise.all([
      this.prisma.productReview.groupBy({
        by: ['rating'],
        where: { productId, status: 'PUBLISHED', isTest: false },
        _count: { _all: true },
      }),
      this.prisma.productReview.groupBy({
        by: ['rating'],
        where: { productId, status: 'PUBLISHED', isTest: false, isVerifiedPurchase: true },
        _count: { _all: true },
      }),
    ]);
    return summarizeRatings(
      all.map((row) => ({
        rating: row.rating,
        count: row._count._all,
        verified: verified.find((v) => v.rating === row.rating)?._count._all ?? 0,
      })),
    );
  }

  async listPublished(
    productId: string,
    options: { page?: number; limit?: number; sort?: ReviewSort; rating?: number; includeTestReviews?: boolean } = {},
  ): Promise<ProductReviewPage> {
    const limit = Math.min(Math.max(options.limit ?? 6, 1), 20);
    const page = Math.max(options.page ?? 1, 1);
    const includeTest = Boolean(options.includeTestReviews) && isDevTestReviewFlagEnabled();
    const where = {
      productId,
      status: 'PUBLISHED' as const,
      ...(includeTest ? {} : { isTest: false }),
      ...(options.rating ? { rating: options.rating } : {}),
    };
    const [summary, rows] = await Promise.all([
      this.getSummary(productId),
      this.prisma.productReview.findMany({
        where,
        orderBy: SORTS[options.sort ?? 'recent'],
        skip: (page - 1) * limit,
        take: limit + 1,
        select: {
          id: true,
          rating: true,
          title: true,
          body: true,
          authorName: true,
          skinType: true,
          isVerifiedPurchase: true,
          isTest: true,
          helpfulCount: true,
          createdAt: true,
        },
      }),
    ]);
    return {
      summary,
      items: rows.slice(0, limit).map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      pageInfo: { page, limit, hasNextPage: rows.length > limit },
    };
  }

  async findByCustomerAndProduct(customerId: string, productId: string): Promise<ExistingCustomerReview | null> {
    const row = await this.prisma.productReview.findFirst({
      where: { productId, customerId },
      select: {
        id: true,
        rating: true,
        isVerifiedPurchase: true,
        isTest: true,
        createdAt: true,
      },
    });
    if (!row) return null;
    return {
      ...row,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async createCustomerReview(input: CreateCustomerReviewInput): Promise<PublicProductReview> {
    const isTest = Boolean(input.isTest);
    if (isTest && !isDevTestReviewFlagEnabled()) {
      throw new ForbiddenException({
        code: 'DEV_TEST_REVIEWS_DISABLED',
        message: 'Development test reviews are disabled outside local development/test mode.',
      });
    }
    if (!isTest && (!input.isVerifiedPurchase || !input.orderId)) {
      throw new ForbiddenException({
        code: 'VERIFIED_PURCHASE_REQUIRED',
        message: 'Verified delivered purchase is required to submit a review.',
      });
    }

    const authorName = input.authorName.trim().slice(0, 60) || 'ShinaCare Customer';
    const normalizedBody = input.body?.trim() ? input.body.trim() : null;
    const normalizedTitle = input.title?.trim() ? input.title.trim().slice(0, 120) : null;

    try {
      const created = await this.prisma.productReview.create({
        data: {
          productId: input.productId,
          customerId: input.customerId,
          skuId: input.skuId ?? null,
          orderId: isTest ? null : (input.orderId ?? null),
          rating: input.rating,
          title: normalizedTitle,
          body: normalizedBody,
          authorName,
          skinType: input.skinType ?? null,
          isVerifiedPurchase: isTest ? false : true,
          isTest,
          status: 'PUBLISHED',
          source: isTest ? 'dev_test' : 'customer',
        },
        select: {
          id: true,
          rating: true,
          title: true,
          body: true,
          authorName: true,
          skinType: true,
          isVerifiedPurchase: true,
          isTest: true,
          helpfulCount: true,
          createdAt: true,
        },
      });
      return {
        ...created,
        createdAt: created.createdAt.toISOString(),
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: 'REVIEW_ALREADY_EXISTS',
          message: 'You have already reviewed this product.',
        });
      }
      throw error;
    }
  }
}
