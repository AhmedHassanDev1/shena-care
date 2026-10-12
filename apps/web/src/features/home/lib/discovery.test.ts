import { getMessages } from '@/lib/i18n/messages';
import { getDiscoveryContent, ROUTINE_BUILDER_AVAILABLE } from './discovery';

const ar = getMessages('ar');

describe('getDiscoveryContent', () => {
  it('does not promise a questionnaire while the builder is not available', () => {
    expect(ROUTINE_BUILDER_AVAILABLE).toBe(false);
    const content = getDiscoveryContent(ar);
    expect(content.guided).toBe(false);
    expect(content.questions).toEqual([]);
    expect(content.cta.href).toContain('/products');
    expect(content.steps).toHaveLength(3);
  });

  it('uses the approved copy and the builder route once it is available', () => {
    const content = getDiscoveryContent(ar, true);
    expect(content.guided).toBe(true);
    expect(content.title).toBe('ابني روتينك بسهولة');
    expect(content.cta).toEqual({ label: 'ابدأ الآن', href: '/routine/builder' });
    expect(content.stepsTitle).toBe('روتينك في 3 خطوات بسيطة');
    expect(content.steps.map((s) => s.title)).toEqual(['حدّد احتياجك', 'جاوب على الأسئلة', 'اكتشف روتينك']);
    expect(content.benefits).toHaveLength(3);
    expect(content.questions).toHaveLength(3);
  });
});
