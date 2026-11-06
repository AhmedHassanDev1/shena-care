import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { messages } from '@/lib/i18n/messages';

const publicFile = (src: string) => join(process.cwd(), 'public', src);

describe('SahelHero assets & translations', () => {
  it('has both desktop and mobile WebP assets on disk with valid file size', () => {
    const desktopAsset = publicFile('assets/home/sahel-hero-desktop.webp');
    const mobileAsset = publicFile('assets/home/sahel-hero-mobile.webp');

    expect(existsSync(desktopAsset)).toBe(true);
    expect(existsSync(mobileAsset)).toBe(true);

    expect(statSync(desktopAsset).size).toBeGreaterThan(10000);
    expect(statSync(mobileAsset).size).toBeGreaterThan(5000);
  });

  it('provides complete Arabic and English translations for Sahel Hero', () => {
    const requiredKeys = [
      'sahelHeroEyebrow',
      'sahelHeroHeadlineStart',
      'sahelHeroHeadlineAccent',
      'sahelHeroDescription',
      'sahelHeroPrimaryCta',
      'sahelHeroSecondaryCta',
      'sahelHeroAltDesktop',
      'sahelHeroAltMobile',
    ] as const;

    for (const key of requiredKeys) {
      expect(messages.ar[key]).toBeDefined();
      expect(messages.ar[key].length).toBeGreaterThan(0);

      expect(messages.en[key]).toBeDefined();
      expect(messages.en[key].length).toBeGreaterThan(0);
    }
  });

  it('has the approved Arabic copy from Google Stitch project 1325875511695454376', () => {
    expect(messages.ar.sahelHeroEyebrow).toBe('SKINCARE & HAIRCARE');
    expect(messages.ar.sahelHeroHeadlineStart).toBe('عنايتك تبدأ من احتياجك،');
    expect(messages.ar.sahelHeroHeadlineAccent).toBe('مش من المنتج.');
    expect(messages.ar.sahelHeroPrimaryCta).toBe('تسوق حسب احتياجك');
    expect(messages.ar.sahelHeroSecondaryCta).toBe('اكتشف الروتينات');
  });
});
