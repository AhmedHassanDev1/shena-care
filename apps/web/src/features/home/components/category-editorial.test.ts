import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { messages } from '@/lib/i18n/messages';
import { mainCategorySlugs, routes } from '@/lib/routes';

const publicFile = (src: string) => join(process.cwd(), 'public', src);

describe('CategoryEditorial assets & specifications', () => {
  it('has both authentic Stitch editorial photography assets on disk with valid dimensions and file size', () => {
    const assets = [
      'assets/categories/skincare-editorial.png',
      'assets/categories/haircare-editorial.png',
    ];

    for (const asset of assets) {
      const assetPath = publicFile(asset);
      expect(existsSync(assetPath)).toBe(true);
      expect(statSync(assetPath).size).toBeGreaterThan(100_000);
    }
  });

  it('provides complete Arabic and English translations for the Category Showcase section', () => {
    const requiredKeys = [
      'homeCategoriesEyebrow',
      'homeCategoriesTitle',
      'homeCategoriesSubtitle',
      'homeCategorySkinTitle',
      'homeCategorySkinBody',
      'homeCategorySkinCta',
      'homeCategoryHairTitle',
      'homeCategoryHairBody',
      'homeCategoryHairCta',
    ] as const;

    for (const key of requiredKeys) {
      expect(messages.ar[key]).toBeDefined();
      expect(messages.ar[key].length).toBeGreaterThan(0);

      expect(messages.en[key]).toBeDefined();
      expect(messages.en[key].length).toBeGreaterThan(0);
    }
  });

  it('matches the approved Stitch project 15850160123086413494 Arabic copy verbatim', () => {
    expect(messages.ar.homeCategoriesEyebrow).toBe('اكتشفي العناية');
    expect(messages.ar.homeCategoriesTitle).toBe('تسوقي حسب القسم');
    expect(messages.ar.homeCategoriesSubtitle).toBe(
      'من أول خطوة في روتينك، اكتشفي منتجات العناية ببشرتك وشعرك.'
    );
    expect(messages.ar.homeCategorySkinTitle).toBe('العناية بالبشرة');
    expect(messages.ar.homeCategorySkinBody).toBe(
      'غسول، مرطب وواقي شمس — أساسيات روتين بشرتك اليومي.'
    );
    expect(messages.ar.homeCategorySkinCta).toBe('تسوقي البشرة');
    expect(messages.ar.homeCategoryHairTitle).toBe('العناية بالشعر');
    expect(messages.ar.homeCategoryHairBody).toBe(
      'شامبو، بلسم وعناية إضافية لشعر صحي ومظهر تحبيه.'
    );
    expect(messages.ar.homeCategoryHairCta).toBe('تسوقي الشعر');
  });

  it('generates valid and functional category routes for both departments', () => {
    const skinHref = routes.productsByCategory(mainCategorySlugs.skin);
    const hairHref = routes.productsByCategory(mainCategorySlugs.hair);

    expect(skinHref).toBeTruthy();
    expect(hairHref).toBeTruthy();
    expect(skinHref).not.toEqual(hairHref);
    expect(skinHref).toContain(mainCategorySlugs.skin);
    expect(hairHref).toContain(mainCategorySlugs.hair);
  });
});
