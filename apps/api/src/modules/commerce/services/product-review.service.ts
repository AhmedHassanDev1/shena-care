import { Injectable } from '@nestjs/common';
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
  body: string;
  authorName: string;
  skinType: string | null;
  isVerifiedPurchase: boolean;
  helpfulCount: number;
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
 * Commerce-owned product reviews. Public reads return PUBLISHED reviews only; moderation and submission are not part
 * of this slice (no public write endpoint yet).
 */
@Injectable()
export class ProductReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(productId: string): Promise<ProductReviewSummary> {
    const [all, verified] = await Promise.all([
      this.prisma.productReview.groupBy({ by: ['rating'], where: { productId, status: 'PUBLISHED' }, _count: { _all: true } }),
      this.prisma.productReview.groupBy({ by: ['rating'], where: { productId, status: 'PUBLISHED', isVerifiedPurchase: true }, _count: { _all: true } }),
    ]);
    return summarizeRatings(
      all.map((row) => ({ rating: row.rating, count: row._count._all, verified: verified.find((v) => v.rating === row.rating)?._count._all ?? 0 })),
    );
  }

  async listPublished(productId: string, options: { page?: number; limit?: number; sort?: ReviewSort; rating?: number } = {}): Promise<ProductReviewPage> {
    const limit = Math.min(Math.max(options.limit ?? 6, 1), 20);
    const page = Math.max(options.page ?? 1, 1);
    const where = { productId, status: 'PUBLISHED' as const, ...(options.rating ? { rating: options.rating } : {}) };
    const [summary, rows] = await Promise.all([
      this.getSummary(productId),
      this.prisma.productReview.findMany({
        where,
        orderBy: SORTS[options.sort ?? 'recent'],
        skip: (page - 1) * limit,
        take: limit + 1,
        select: { id: true, rating: true, title: true, body: true, authorName: true, skinType: true, isVerifiedPurchase: true, helpfulCount: true, createdAt: true },
      }),
    ]);
    return {
      summary,
      items: rows.slice(0, limit).map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      pageInfo: { page, limit, hasNextPage: rows.length > limit },
    };
  }
}
