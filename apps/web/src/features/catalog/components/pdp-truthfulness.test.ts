import fs from 'node:fs';
import path from 'node:path';

describe('PDP Truthfulness & Fake Data Prevention', () => {
  const componentsDir = path.resolve(__dirname);

  it('ensures no production component imports mock data from mock-product-detail', () => {
    const files = [
      'ProductDetailView.tsx',
      'ProductDetailSections.tsx',
      'ProductReviews.tsx',
      'ProductCard.tsx',
    ];

    for (const file of files) {
      const content = fs.readFileSync(path.join(componentsDir, file), 'utf-8');
      expect(content).not.toContain("from '../lib/mock-product-detail'");
      expect(content).not.toContain('from "@/features/catalog/lib/mock-product-detail"');
      expect(content).not.toContain('MOCK_STARVILLE');
      expect(content).not.toContain('MOCK_REVIEWS_ITEMS');
    }
  });

  it('ensures no hardcoded broken Google CDN images exist in PDP sections', () => {
    const content = fs.readFileSync(path.join(componentsDir, 'ProductDetailSections.tsx'), 'utf-8');
    expect(content).not.toContain('lh3.googleusercontent.com');
  });

  it('ensures reviews component uses authentic API query instead of hardcoded numbers', () => {
    const content = fs.readFileSync(path.join(componentsDir, 'ProductReviews.tsx'), 'utf-8');
    expect(content).toContain('useProductReviews');
    // Ensure no hardcoded clinical percentages
    expect(content).not.toContain('98% تحكم بالدهون');
    expect(content).not.toContain('94% تقليص المسام');
    expect(content).not.toContain('91% صفاء البشرة');
    expect(content).not.toContain('WriteReviewDialog');
    expect(content).not.toContain('432');
    expect(content).not.toContain('سارة م.');
  });

  it('ensures Stitch PDP components contain no fabricated CeraVe design placeholders', () => {
    const files = ['ProductDetailView.tsx', 'ProductDetailSections.tsx', 'ProductReviews.tsx'];
    for (const file of files) {
      const content = fs.readFileSync(path.join(componentsDir, file), 'utf-8');
      expect(content).not.toContain('749');
      expect(content).not.toContain('340 جم');
      expect(content).not.toContain('CeraVe');
      expect(content).not.toContain('خطوط شيش متحركة');
    }
  });

  it('ensures add-to-cart respects variant.canOrder and surface errors honestly', () => {
    const content = fs.readFileSync(path.join(componentsDir, 'ProductDetailView.tsx'), 'utf-8');
    expect(content).toContain('variant.canOrder');
    expect(content).toContain('setAddError');
  });
});
