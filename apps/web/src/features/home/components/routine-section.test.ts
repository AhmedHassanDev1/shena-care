import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MOCK_ROUTINES } from '@/features/routine/data/routines.mock';
import { mapDtoToRoutineCard, getFeaturedRoutines } from '@/features/routine/services/routines.service';
import type { FeaturedRoutineDto } from '@/features/routine/types/routine.types';
import { routes } from '@/lib/routes';

const publicFile = (src: string) => join(process.cwd(), 'public', src);

describe('RoutineSection Data Architecture & Strict Mock Policy', () => {
  it('contains deterministic mock routines matching the approved Stitch design specifications', () => {
    expect(MOCK_ROUTINES).toHaveLength(2);

    const [skin, hair] = MOCK_ROUTINES;
    expect(skin.category).toBe('skin');
    expect(skin.categoryLabelAr).toBe('البشرة');
    expect(skin.periodLabelAr).toBe('روتين صباحي');
    expect(skin.titleAr).toBe('روتين البشرة الصباحي');
    expect(skin.steps).toHaveLength(3);
    expect(skin.steps.map((s) => s.labelAr)).toEqual(['تنظيف', 'ترطيب', 'حماية']);
    expect(skin.detailHref).toBe(routes.routineDetail('morning-radiance'));

    expect(hair.category).toBe('hair');
    expect(hair.categoryLabelAr).toBe('الشعر');
    expect(hair.periodLabelAr).toBe('روتين أسبوعي');
    expect(hair.titleAr).toBe('روتين العناية بالشعر الجاف');
    expect(hair.steps).toHaveLength(4);
    expect(hair.steps.map((s) => s.labelAr)).toEqual(['زيت دافئ', 'غسيل', 'بلسم', 'سيروم']);
    expect(hair.detailHref).toBe(routes.routineDetail('frizz-curl-definition'));
  });

  it('maps backend FeaturedRoutineDto accurately to RoutineCardModel', () => {
    const mockDto: FeaturedRoutineDto = {
      blueprint: {
        id: 'bp-test-123',
        key: 'morning-barrier-care',
        titleAr: 'روتين ترميم الحاجز الصباحي',
        descriptionAr: 'حماية وترميم سريع للبشرة المتعبة',
        concernSlug: 'barrier-repair',
      },
      preview: true,
      tiers: [
        {
          tier: 'ESSENTIAL',
          totals: { amount: 500, currency: 'EGP' },
          complete: true,
          items: [
            {
              roleKey: 'cleanse',
              titleAr: 'غسول رغوي لطيف',
              isEssential: true,
              startWeek: 1,
              status: 'SELECTED',
              product: { id: 'p1', name: 'Gentle Wash', slug: 'gentle-wash' },
            },
            {
              roleKey: 'moisturize',
              titleAr: 'مرطب سيراميد',
              isEssential: true,
              startWeek: 1,
              status: 'SELECTED',
              product: { id: 'p2', name: 'Ceramide Cream', slug: 'ceramide-cream' },
            },
          ],
        },
      ],
    };

    const card = mapDtoToRoutineCard(mockDto);
    expect(card.id).toBe('bp-test-123');
    expect(card.slug).toBe('morning-barrier-care');
    expect(card.titleAr).toBe('روتين ترميم الحاجز الصباحي');
    expect(card.subtitleAr).toBe('حماية وترميم سريع للبشرة المتعبة');
    expect(card.category).toBe('skin');
    expect(card.periodLabelAr).toBe('روتين صباحي');
    expect(card.steps).toHaveLength(2);
    expect(card.steps[0]).toEqual({ stepNumber: '01', labelAr: 'غسول رغوي لطيف' });
    expect(card.steps[1]).toEqual({ stepNumber: '02', labelAr: 'مرطب سيراميد' });
    expect(card.detailHref).toBe(routes.routineDetail('morning-barrier-care'));
  });

  it('strictly isolates mock routines so they cannot leak into pure production mode', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalPreview = process.env.NEXT_PUBLIC_HOME_PREVIEW;
    try {
      // In pure production mode without preview flag, mock fallback must return empty array
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      delete (process.env as Record<string, string | undefined>).NEXT_PUBLIC_HOME_PREVIEW;
      const routines = await getFeaturedRoutines();
      expect(routines).toEqual([]);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
      (process.env as Record<string, string | undefined>).NEXT_PUBLIC_HOME_PREVIEW = originalPreview;
    }
  });

  it('provides authentic photographic assets in public/images/home', () => {
    const skinImg = publicFile('images/home/routine-skin.jpg');
    const hairImg = publicFile('images/home/routine-hair.jpg');

    expect(existsSync(skinImg)).toBe(true);
    expect(statSync(skinImg).size).toBeGreaterThan(10_000);

    expect(existsSync(hairImg)).toBe(true);
    expect(statSync(hairImg).size).toBeGreaterThan(10_000);
  });
});
