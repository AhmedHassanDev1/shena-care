import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND_LOGOS } from './brand-logos';
import { HOME_IMAGES } from './home-images';

const publicFile = (src: string) => join(process.cwd(), 'public', src);

describe('homepage image registry', () => {
  it('points every photograph at a real, non-empty file with positive dimensions', () => {
    for (const [name, image] of Object.entries(HOME_IMAGES)) {
      expect(existsSync(publicFile(image.src))).toBe(true);
      expect(statSync(publicFile(image.src)).size).toBeGreaterThan(1000);
      expect(image.width).toBeGreaterThan(0);
      expect(image.height).toBeGreaterThan(0);
      expect(image.position).toMatch(/^\d+% \d+%$/);
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it('points every brand logo at a real file keyed by the catalog slug', () => {
    for (const [slug, logo] of Object.entries(BRAND_LOGOS)) {
      expect(slug).toMatch(/^[a-z0-9-]+$/);
      expect(logo.src.startsWith('/images/brands/')).toBe(true);
      expect(existsSync(publicFile(logo.src))).toBe(true);
    }
  });
});
