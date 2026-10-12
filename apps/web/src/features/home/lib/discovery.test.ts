import { getMessages } from '@/lib/i18n/messages';
import { PREVIEW_ROUTINES } from '../mocks/routines';
import { getDiscoveryContent } from './discovery';
import { HERO_MAX_SLIDES, RECOMMENDED_MAX, splitRoutines } from './routines';

const ar = getMessages('ar');

describe('getDiscoveryContent', () => {
  it('always carries the approved routine-builder copy, whatever the backend state', () => {
    const content = getDiscoveryContent(ar);
    expect(content.title).toBe('ابني روتينك بسهولة');
    expect(content.description).toBe('جاوب على شوية أسئلة بسيطة تساعدك تكتشف روتين مناسب لاحتياجاتك.');
    expect(content.cta).toEqual({ label: 'ابدأ الآن', href: '/routine/builder' });
    expect(content.stepsTitle).toBe('روتينك في 3 خطوات بسيطة');
    expect(content.steps.map((s) => s.title)).toEqual(['حدّد احتياجك', 'جاوب على الأسئلة', 'اكتشف روتينك']);
    expect(content.benefits.map((b) => b.label)).toEqual([
      'منتجات مناسبة لاحتياجاتك',
      'روتين واضح وسهل التطبيق',
      'اختيارات أسهل من المنتجات المتاحة',
    ]);
    expect(content.questions).toHaveLength(3);
  });
});

describe('preview routine fixtures', () => {
  it('fill the hero swiper and the suggested row without repeating a routine', () => {
    const { hero, recommended } = splitRoutines(PREVIEW_ROUTINES);
    expect(hero).toHaveLength(HERO_MAX_SLIDES);
    expect(recommended).toHaveLength(RECOMMENDED_MAX);
    expect(new Set([...hero, ...recommended].map((r) => r.id)).size).toBe(HERO_MAX_SLIDES + RECOMMENDED_MAX);
  });
});
