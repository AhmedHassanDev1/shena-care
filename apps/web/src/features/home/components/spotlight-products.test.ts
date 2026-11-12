import { messages } from '@/lib/i18n/messages';
import { toCardModel, resolveArabicProductName } from '@/features/catalog/lib/card-model';
import type { ProductView } from '@/features/catalog/api/products';

const makeProduct = (over: Partial<ProductView> = {}): ProductView => ({
  id: 'prod-1',
  name: 'Antioxidant Facial Cleanser',
  slug: 'shaan-antioxidant-facial-cleanser',
  description: 'Cleanser for daily use',
  usage: 'Apply on damp face',
  warnings: null,
  brand: { id: 'brand-1', name: 'shaan', slug: 'shaan' },
  category: { id: 'cat-1', name: 'Cleansers', slug: 'cleansers', parentId: 'root' },
  skus: [
    {
      id: 'sku-1',
      code: 'SC-1',
      variantName: '250 ml',
      size: 250,
      sizeUnit: 'ml',
      price: { amount: 110, currency: 'EGP', compareAtAmount: 130 },
      canOrder: true,
    },
  ],
  media: [
    {
      id: 'm-proof',
      type: 'image',
      url: 'https://res.cloudinary.com/proof.jpg',
      altText: 'Back label proof',
      isPrimary: false,
      role: 'PACKAGING_PROOF',
    } as any,
    {
      id: 'm-pack',
      type: 'image',
      url: 'https://res.cloudinary.com/packshot.jpg',
      altText: 'Front packshot',
      isPrimary: true,
      role: 'PRIMARY_PACKSHOT',
    } as any,
  ],
  ...over,
});

describe('SpotlightProducts & Product Card Specification', () => {
  describe('Product Card Editorial Improvements', () => {
    it('translates product titles to Arabic primary titles and preserves original English as secondary', () => {
      const cardAr = toCardModel(makeProduct(), 'ar');
      expect(cardAr.arabicName).toBe('غسول الوجه المضاد للأكسدة');
      expect(cardAr.englishName).toBe('Antioxidant Facial Cleanser');

      const cardEn = toCardModel(makeProduct(), 'en');
      expect(cardEn.arabicName).toBe('Antioxidant Facial Cleanser');
      expect(cardEn.englishName).toBeNull();
    });

    it('resolves known Arabic names accurately across all catalog product categories', () => {
      expect(resolveArabicProductName('Hyaluronic Acid Facial Serum')).toBe('سيروم حمض الهيالورونيك للوجه');
      expect(resolveArabicProductName('Rejuvenation Cream')).toBe('كريم تجديد البشرة');
      expect(resolveArabicProductName('Sun Screen oil Defense Fluid spf 50')).toBe('سائل واقي شمس للتحكم في الزيوت SPF 50');
      expect(resolveArabicProductName('Hyaluron Moisture Shampoo')).toBe('شامبو هيالورون لترطيب الشعر');
      expect(resolveArabicProductName('Hyaluron Moisture Conditioner')).toBe('بلسم ترطيب الشعر بحمض الهيالورون');
    });

    it('derives two compact chips: chip1 (category/type) and chip2 (skin-type/SPF/size)', () => {
      const card = toCardModel(
        makeProduct({
          suitableSkinTypes: ['sensitive'],
        } as any),
        'ar'
      );
      expect(card.chip1).toBe('غسول');
      expect(card.chip2).toBe('للبشرة الحساسة');
    });

    it('derives SPF chip2 and benefit badge when product has SPF protection and no discount', () => {
      const card = toCardModel(
        makeProduct({
          name: 'Sun Screen oil Defense Fluid spf 50',
          category: { id: 'cat-sun', name: 'Sunscreens', slug: 'sunscreens', parentId: 'root' },
          spf: 50,
          skus: [
            {
              id: 'sku-sun',
              code: 'SC-SUN-1',
              variantName: '50 ml',
              size: 50,
              sizeUnit: 'ml',
              price: { amount: 140, currency: 'EGP', compareAtAmount: null },
              canOrder: true,
            },
          ],
        } as any),
        'ar'
      );
      expect(card.chip1).toBe('واقي شمس');
      expect(card.chip2).toBe('حماية SPF 50');
      expect(card.benefitBadge).toBe('SPF 50+');
    });

    it('derives discount percent and discount badge when on promotion', () => {
      const card = toCardModel(makeProduct(), 'ar');
      expect(card.discountPercent).toBe(15);
      expect(card.benefitBadge).toBe('خصم ١٥٪');
      expect(card.compareAtPrice).toEqual({ amount: 130, currency: 'EGP' });
    });

    it('handles rating and review count truthfully without fabrication', () => {
      const cardWithRating = toCardModel(
        makeProduct({
          rating: { average: 4.8, count: 124 },
        } as any),
        'ar'
      );
      expect(cardWithRating.rating).toEqual({ average: 4.8, count: 124 });

      const cardWithoutRating = toCardModel(makeProduct(), 'ar');
      expect(cardWithoutRating.rating).toBeNull();
    });

    it('prefers genuine front-facing PRIMARY_PACKSHOT and avoids back-label PACKAGING_PROOF', () => {
      const card = toCardModel(makeProduct(), 'ar');
      expect(card.imageUrl).toBe('https://res.cloudinary.com/packshot.jpg');
    });
  });

  describe('SpotlightProducts Section Translations & Reassurance', () => {
    it('has complete translation parity in Arabic and English for all section elements and filter tabs', () => {
      const requiredKeys = [
        'homeProductsEyebrow',
        'homeProductsTitle',
        'homeProductsBody',
        'homeProductsMore',
        'homeProductsFilterAll',
        'homeProductsFilterCleansers',
        'homeProductsFilterSerums',
        'homeProductsFilterMoisturizers',
        'homeProductsFilterSun',
        'homeProductsFilterHair',
        'homeProductsTrustTitle',
        'homeProductsTrustBody',
        'homeProductsTrustCod',
        'homeProductsTrustAuthentic',
      ] as const;

      for (const key of requiredKeys) {
        expect(messages.ar[key]).toBeDefined();
        expect(messages.ar[key].length).toBeGreaterThan(0);

        expect(messages.en[key]).toBeDefined();
        expect(messages.en[key].length).toBeGreaterThan(0);
      }
    });
  });
});
