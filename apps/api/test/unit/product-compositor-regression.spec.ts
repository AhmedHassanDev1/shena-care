import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { composeOnTemplate, cutOutProduct, TemplateRules } from '../../src/platform/storage/product-compositor';
import { parseTemplateRules } from '../../src/modules/catalog/services/media-template.service';

/**
 * Regressions from the real 10-product run (2026-11-06): the SAHEL derivatives of Clary Conditioner (ghost silhouette from the source's cast shadow) and Capixy
 * Conditioner (pale cap cut away, then shown detached with a duplicate shadow) were rejected. These run the real source images.
 */
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, '../fixtures/media', name));
const CLEAN = fs.readFileSync(path.join(__dirname, '../../assets/media-templates/sahel-clean-v1.webp'));
const CLEAN_RULES = parseTemplateRules(JSON.parse(fs.readFileSync(path.join(__dirname, '../../assets/media-templates/sahel-clean.rules.json'), 'utf8')));
const OFF_WHITE = [0xf7, 0xf5, 0xf2];

async function opaqueBox(buffer: Buffer) {
  const { data, info } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width; let right = -1; let top = info.height; let bottom = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * 3;
    if (Math.abs(data[i] - OFF_WHITE[0]) + Math.abs(data[i + 1] - OFF_WHITE[1]) + Math.abs(data[i + 2] - OFF_WHITE[2]) <= 6) continue;
    if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y;
  }
  return { left, right, top, bottom, width: info.width, height: info.height, data };
}

describe('Product compositor regressions on real sources', () => {
  it('Clary Conditioner: the hard source cast shadow is removed, the bottle and its silver collar are kept', async () => {
    const cut = await cutOutProduct(fixture('clary-conditioner-300ml.png'));
    expect(cut.report.warnings).toContain('SOURCE_SHADOW_REMOVED');
    expect(cut.report.warnings).not.toContain('DETACHED_PART');
    // Bottle with pump nozzle is ~300 px wide in the 1080 px source; with the shadow kept the "product" was ~440 px wide.
    expect(cut.report.productWidth).toBeGreaterThan(280);
    expect(cut.report.productWidth).toBeLessThan(330);
    // Pump top to bottle base, nothing cropped.
    expect(cut.report.productHeight).toBeGreaterThan(900);
    // The collar row: opaque across the collar, not eaten as "shadow".
    const collarRow = Math.round(cut.height * 0.17);
    let opaque = 0;
    for (let x = 0; x < cut.width; x++) if (cut.rgba[(collarRow * cut.width + x) * 4 + 3] > 200) opaque++;
    expect(opaque).toBeGreaterThan(100);
  }, 60000);

  it('Capixy Conditioner: a white tube on white keeps its pale cap and crimp; nothing is cut away as shadow', async () => {
    const cut = await cutOutProduct(fixture('capixy-hydrating-conditioner-250ml.png'));
    expect(cut.report.warnings).not.toContain('SOURCE_SHADOW_REMOVED');
    expect(cut.report.warnings).not.toContain('DETACHED_PART');
    expect(cut.report.productHeight).toBeGreaterThanOrEqual(715);
    // The cap is the bottom ~25 px and about two thirds of the tube's width (rounded at its very bottom): solid across that width.
    for (const fromBottom of [12, 20]) {
      const y = cut.height - fromBottom;
      let solid = 0;
      for (let x = 0; x < cut.width; x++) if (cut.rgba[(y * cut.width + x) * 4 + 3] > 200) solid++;
      expect(solid / cut.width).toBeGreaterThan(0.55);
    }
  }, 60000);

  it('clean template: solid #F7F5F2 square, product centred at a consistent scale, no artificial shadow, deterministic', async () => {
    const results = [];
    for (const name of ['clary-conditioner-300ml.png', 'capixy-hydrating-conditioner-250ml.png']) {
      const out = await composeOnTemplate(fixture(name), CLEAN, CLEAN_RULES);
      expect([out.width, out.height]).toEqual([1254, 1254]);
      const box = await opaqueBox(out.buffer);
      // Every corner and the band under the product is the plain backdrop: no podium, prop or shadow.
      for (const [x, y] of [[2, 2], [1251, 2], [2, 1251], [1251, 1251]]) {
        const i = (y * 1254 + x) * 3;
        expect(Math.abs(box.data[i] - OFF_WHITE[0]) + Math.abs(box.data[i + 1] - OFF_WHITE[1]) + Math.abs(box.data[i + 2] - OFF_WHITE[2])).toBeLessThanOrEqual(4);
      }
      const centreX = (box.left + box.right) / 2;
      const centreY = (box.top + box.bottom) / 2;
      expect(Math.abs(centreX - 627)).toBeLessThan(1254 * 0.02);
      expect(Math.abs(centreY - 627)).toBeLessThan(1254 * 0.02);
      results.push((box.bottom - box.top) / 1254);
      const again = await composeOnTemplate(fixture(name), CLEAN, CLEAN_RULES);
      expect(again.buffer.equals(out.buffer)).toBe(true);
    }
    // Same visual height for two different packs (both height-bound).
    for (const share of results) expect(share).toBeGreaterThan(0.72);
    for (const share of results) expect(share).toBeLessThan(0.76);
  }, 120000);

  it('a small official source is composed honestly but flagged so it is never approved automatically', async () => {
    const out = await composeOnTemplate(fixture('cerave-moisturising-cream-454g.png'), CLEAN, CLEAN_RULES);
    expect(out.report.warnings).toEqual(expect.arrayContaining(['SMALL_SOURCE', 'UPSCALED_SMALL_SOURCE']));
    expect(out.report.placementScale).toBeLessThanOrEqual(CLEAN_RULES.placement.maxUpscale);
  }, 60000);

  it('the shadow switch turns every artificial shadow off, even with non-zero opacities', async () => {
    const rules: TemplateRules = { ...CLEAN_RULES, shadow: { ...CLEAN_RULES.shadow, enabled: false, contactOpacity: 0.9, castOpacity: 0.9, ambientOpacity: 0.9, contactHeight: 0.02, contactBlur: 0.004, castBlur: 0.01 } };
    const off = await composeOnTemplate(fixture('capixy-hydrating-conditioner-250ml.png'), CLEAN, rules);
    const plain = await composeOnTemplate(fixture('capixy-hydrating-conditioner-250ml.png'), CLEAN, CLEAN_RULES);
    expect(off.buffer.equals(plain.buffer)).toBe(true);
  }, 60000);

  it('rejects template rules that are out of range, accepts the clean rule set', () => {
    expect(() => parseTemplateRules({ ...CLEAN_RULES, placement: { ...CLEAN_RULES.placement, centerY: 0.95 } })).toThrow();
    expect(() => parseTemplateRules({ ...CLEAN_RULES, shadow: { ...CLEAN_RULES.shadow, enabled: 'no' } })).toThrow();
    expect(parseTemplateRules(CLEAN_RULES).shadow.enabled).toBe(false);
  });
});
