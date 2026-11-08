import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { summarizeRatings } from '../../src/modules/commerce/services/product-review.service';
import { ProductReviewsQueryDto } from '../../src/application/composition/dto/product-reviews.dto';

describe('summarizeRatings', () => {
  it('returns an empty summary when nothing is published', () => {
    expect(summarizeRatings([])).toEqual({
      average: null, count: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, recommendPercent: null, verifiedCount: 0,
    });
  });

  it('computes average, distribution, recommend share and verified count', () => {
    const summary = summarizeRatings([
      { rating: 5, count: 6, verified: 4 },
      { rating: 4, count: 2, verified: 1 },
      { rating: 2, count: 1, verified: 0 },
      { rating: 1, count: 1, verified: 1 },
    ]);
    expect(summary.count).toBe(10);
    expect(summary.average).toBe(4.1); // (30 + 8 + 2 + 1) / 10
    expect(summary.distribution).toEqual({ 1: 1, 2: 1, 3: 0, 4: 2, 5: 6 });
    expect(summary.recommendPercent).toBe(80);
    expect(summary.verifiedCount).toBe(6);
  });

  it('ignores out-of-range ratings instead of skewing the average', () => {
    expect(summarizeRatings([{ rating: 7, count: 3, verified: 0 }, { rating: 3, count: 1, verified: 0 }]).average).toBe(3);
  });
});

describe('ProductReviewsQueryDto', () => {
  const errors = (raw: Record<string, unknown>) => validateSync(plainToInstance(ProductReviewsQueryDto, raw)).map((e) => e.property);

  it('accepts the documented query', () => {
    expect(errors({ page: '2', limit: '6', sort: 'helpful', rating: '5' })).toEqual([]);
  });

  it('rejects out-of-range or unknown values', () => {
    expect(errors({ limit: '50', sort: 'random', rating: '6', page: '0' }).sort()).toEqual(['limit', 'page', 'rating', 'sort']);
  });
});
