import { getMessages } from '@/lib/i18n/messages';
import { PREVIEW_ROUTINES } from '../mocks/routines';
import { getDiscoveryContent } from './discovery';
import { selectSuggestedRoutines, SUGGESTED_MAX } from './routines';

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
  it('fill the suggested row with unique routines that carry a time of day', () => {
    const suggested = selectSuggestedRoutines(PREVIEW_ROUTINES);
    expect(suggested).toHaveLength(SUGGESTED_MAX);
    expect(new Set(suggested.map((r) => r.id)).size).toBe(SUGGESTED_MAX);
    expect(suggested.every((r) => r.timeOfDay !== undefined)).toBe(true);
  });
});
