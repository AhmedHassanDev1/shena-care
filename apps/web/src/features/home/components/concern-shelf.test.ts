import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { messages } from '@/lib/i18n/messages';
import { CONCERN_CHIPS, concernHref } from '../lib/concern-chips';

const publicFile = (src: string) => join(process.cwd(), 'public', src);

describe('ConcernShelf assets & translations', () => {
  it('has all six concern WebP assets on disk with valid file sizes', () => {
    for (const chip of CONCERN_CHIPS) {
      const assetPath = publicFile(chip.image.replace(/^\//, ''));
      expect(existsSync(assetPath)).toBe(true);
      expect(statSync(assetPath).size).toBeGreaterThan(15000);
    }
  });

  it('provides complete Arabic and English translations for the section header and assistant panel', () => {
    const requiredKeys = [
      'homeConcernEyebrow',
      'homeConcernHeadlineStart',
      'homeConcernHeadlineAccent',
      'homeConcernSubtitle',
      'homeConcernAssistantBadge',
      'homeConcernAssistantTitle',
      'homeConcernAssistantBody',
      'homeConcernAssistantCta',
      'homeConcernAssistantMobileCta',
    ] as const;

    for (const key of requiredKeys) {
      expect(messages.ar[key]).toBeDefined();
      expect(messages.ar[key].length).toBeGreaterThan(0);

      expect(messages.en[key]).toBeDefined();
      expect(messages.en[key].length).toBeGreaterThan(0);
    }
  });

  it('matches the approved Arabic copy from Google Stitch project 15204893810740198793', () => {
    expect(messages.ar.homeConcernEyebrow).toBe('ابدأ باحتياجك الحقيقي');
    expect(messages.ar.homeConcernHeadlineStart).toBe('إيه اللي حابب ');
    expect(messages.ar.homeConcernHeadlineAccent).toBe('تهتم بيه؟');
    expect(messages.ar.homeConcernAssistantBadge).toBe('مساعدة شينا الذكية');
    expect(messages.ar.homeConcernAssistantTitle).toBe('مش متأكد من احتياجك؟');
    expect(messages.ar.homeConcernAssistantBody).toBe('اسأل شينا وساعدها تفهم احتياجك.');
    expect(messages.ar.homeConcernAssistantCta).toBe('اسأل شينا الآن');
    expect(messages.ar.homeConcernAssistantMobileCta).toBe('اسأل شينا');
  });

  it('ensures all six concerns have authentic titles, descriptions, and valid href resolution', () => {
    for (const chip of CONCERN_CHIPS) {
      const arLabel = messages.ar[chip.label];
      const arDesc = messages.ar[chip.desc];
      expect(arLabel).toBeTruthy();
      expect(arDesc).toBeTruthy();

      const { href } = concernHref(chip, arLabel, []);
      expect(href).toMatch(/^\/products\?q=/);
    }
  });
});
