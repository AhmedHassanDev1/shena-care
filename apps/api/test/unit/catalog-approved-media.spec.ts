import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { DEFAULT_TEMPLATE_KEY } from '../../src/modules/catalog/services/media-template.service';
import { usableIdentityResolution } from '../../src/modules/catalog/research/catalog-decision-engine';

describe('approved catalog media input', () => {
  const assetRoot = path.join(__dirname, '../../assets/media-templates');

  it('keeps the exact approved scene as the default', async () => {
    const scene = fs.readFileSync(path.join(assetRoot, 'catalog-approved-v1.png'));
    const rules = JSON.parse(fs.readFileSync(path.join(assetRoot, 'catalog-approved.rules.json'), 'utf8'));
    expect(DEFAULT_TEMPLATE_KEY).toBe('catalog-approved');
    expect(crypto.createHash('sha256').update(scene).digest('hex')).toBe('88c80cb4a3a8ffcdeb92b42068ae82f8ea77867dbdbac82f3f539e8885a6d136');
    expect(await sharp(scene).metadata()).toMatchObject({ format: 'png', width: 1254, height: 1254 });
    expect(rules).toMatchObject({ output: { size: 1254 }, shadow: { enabled: false } });
  });

  it('accepts clear portrait bottles and rejects undersized identity images', () => {
    expect(usableIdentityResolution(202, 510)).toBe(true);
    expect(usableIdentityResolution(227, 587)).toBe(true);
    expect(usableIdentityResolution(199, 510)).toBe(false);
    expect(usableIdentityResolution(202, 499)).toBe(false);
    expect(usableIdentityResolution(100, 100)).toBe(false);
  });
});
