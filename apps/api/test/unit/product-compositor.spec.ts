import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import sharp from 'sharp';
import { composeOnTemplate, cutOutProduct, MediaProcessingError, TemplateRules } from '../../src/platform/storage/product-compositor';

const TEMPLATE = fs.readFileSync(path.join(__dirname, '../../assets/media-templates/sahel-soft-plinth-v1.webp'));
const RULES = JSON.parse(fs.readFileSync(path.join(__dirname, '../../assets/media-templates/sahel-soft-plinth.rules.json'), 'utf8')) as TemplateRules;

/** A synthetic pack with a pure white label inside its outline and hairline barcode stripes: exactly what a careless cut-out would damage. */
function packSvg(options: { background?: string; body?: string; size?: number } = {}) {
  const { background = '#ffffff', body = '#1f4e79', size = 800 } = options;
  const bars = Array.from({ length: 20 }, (_, i) => `<rect x="${340 + i * 6}" y="470" width="${i % 3 === 0 ? 4 : 2}" height="50" fill="#000"/>`).join('');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 800 800">
    <rect width="800" height="800" fill="${background}"/>
    <rect x="360" y="110" width="80" height="60" rx="6" fill="#222"/>
    <rect x="280" y="170" width="240" height="520" rx="30" fill="${body}"/>
    <rect x="310" y="300" width="180" height="240" fill="#ffffff"/>
    <rect x="330" y="330" width="140" height="30" fill="#c0392b"/>
    ${bars}
  </svg>`);
}
const png = (svg: Buffer) => sharp(svg).png().toBuffer();

describe('product compositor', () => {
  it('removes a white background without touching any pixel inside the pack outline', async () => {
    const source = await png(packSvg());
    const cut = await cutOutProduct(source);
    expect(cut.report).toMatchObject({ backgroundMode: 'PLAIN_BACKGROUND', backgroundColor: [255, 255, 255] });
    // The outline may grow by one pixel per side from antialiasing, never more.
    expect(cut.width).toBeGreaterThanOrEqual(240);
    expect(cut.width).toBeLessThanOrEqual(242);
    expect(cut.height).toBeGreaterThanOrEqual(580);
    expect(cut.height).toBeLessThanOrEqual(582);

    const original = await sharp(source).ensureAlpha().raw().toBuffer();
    const originAt = (x: number, y: number) => [...original.subarray((y * 800 + x) * 4, (y * 800 + x) * 4 + 4)];
    const originX = 280 - Math.floor((cut.width - 240) / 2);
    const originY = 110 - Math.floor((cut.height - 580) / 2);
    const cutAt = (x: number, y: number) => [...cut.rgba.subarray(((y - originY) * cut.width + (x - originX)) * 4, ((y - originY) * cut.width + (x - originX)) * 4 + 4)];
    // Interior sweep: label white, barcode bars, red block, body colour are byte-identical and fully opaque.
    for (let y = 180; y < 680; y += 3) {
      for (let x = 290; x < 510; x += 3) expect(cutAt(x, y)).toEqual(originAt(x, y));
    }
    expect(cutAt(400, 320)).toEqual([255, 255, 255, 255]); // the enclosed white label is the pack, not background
    // The corner of the crop, outside the cap, is gone.
    expect(cutAt(281, 111)[3]).toBe(0);
  });

  it('handles off-white, JPEG, WebP and already-transparent sources', async () => {
    const offWhite = await cutOutProduct(await png(packSvg({ background: '#f4f1ea' })));
    expect(offWhite.report.backgroundColor).toEqual([244, 241, 234]);
    expect(offWhite.width).toBeLessThanOrEqual(244);

    const jpeg = await cutOutProduct(await sharp(packSvg()).jpeg({ quality: 88 }).toBuffer());
    expect(jpeg.height).toBeGreaterThan(570);
    expect(jpeg.height).toBeLessThan(590);

    const webp = await cutOutProduct(await sharp(packSvg({ background: '#fafafa' })).webp({ quality: 90 }).toBuffer());
    expect(webp.height).toBeGreaterThan(570);

    const clear = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect x="280" y="170" width="240" height="520" rx="30" fill="#1f4e79"/></svg>`);
    const transparent = await cutOutProduct(await sharp(clear).png().toBuffer());
    expect(transparent.report).toMatchObject({ backgroundMode: 'SOURCE_ALPHA', backgroundColor: null });
    expect(transparent.width).toBeLessThanOrEqual(242);
  });

  it('leaves no light halo: every outline pixel takes the pack\'s own colour, never the old background\'s', async () => {
    const cut = await cutOutProduct(await png(packSvg()));
    let partial = 0;
    for (let i = 0; i < cut.rgba.length; i += 4) {
      const alpha = cut.rgba[i + 3];
      if (alpha === 0 || alpha === 255) continue;
      partial++;
      // The pack body is (31,78,121) and its cap (34,34,34); a white or grey fringe would be far from both.
      const nearBody = Math.abs(cut.rgba[i] - 31) + Math.abs(cut.rgba[i + 1] - 78) + Math.abs(cut.rgba[i + 2] - 121);
      const nearCap = Math.abs(cut.rgba[i] - 34) + Math.abs(cut.rgba[i + 1] - 34) + Math.abs(cut.rgba[i + 2] - 34);
      expect(Math.min(nearBody, nearCap)).toBeLessThan(80);
    }
    expect(partial).toBeGreaterThan(100);
  });

  it('smooths the outline: no solid pixel touches a fully transparent one, on straight and rotated edges', async () => {
    const rotated = await png(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#fff"/><g transform="rotate(21 400 400)"><rect x="300" y="150" width="200" height="500" rx="20" fill="#1f4e79"/></g></svg>'));
    for (const source of [await png(packSvg()), rotated]) {
      const cut = await cutOutProduct(source);
      let hard = 0;
      const levels = new Set<number>();
      for (let y = 1; y < cut.height - 1; y++) for (let x = 1; x < cut.width - 1; x++) {
        const alpha = cut.rgba[(y * cut.width + x) * 4 + 3];
        if (alpha > 0 && alpha < 255) levels.add(Math.round(alpha / 16));
        if (alpha !== 255) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (cut.rgba[((y + dy) * cut.width + x + dx) * 4 + 3] === 0) hard++;
      }
      expect(hard).toBe(0);
      expect(levels.size).toBeGreaterThanOrEqual(6);
    }
  });

  it('removes a baked drop shadow that came with a transparent source, keeps the pack untouched', async () => {
    const pack = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect x="300" y="100" width="200" height="560" rx="24" fill="#1f4e79"/><rect x="330" y="300" width="140" height="160" fill="#fff"/></svg>')).png().toBuffer();
    const shadow = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><ellipse cx="560" cy="690" rx="190" ry="26" fill="#000" fill-opacity="0.35"/><ellipse cx="400" cy="700" rx="150" ry="14" fill="#000" fill-opacity="0.2"/></svg>')).png().toBuffer();
    const withShadow = await sharp(shadow).composite([{ input: pack }]).png().toBuffer();
    const clean = await cutOutProduct(pack);
    const dirty = await cutOutProduct(withShadow);
    expect(dirty.report.backgroundMode).toBe('SOURCE_ALPHA');
    expect(Math.abs(dirty.width - clean.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(dirty.height - clean.height)).toBeLessThanOrEqual(1);
    // Interior pixels are byte-identical to the shadow-free pack.
    let different = 0;
    for (let y = 8; y < clean.height - 8; y++) for (let x = 8; x < clean.width - 8; x++) {
      const i = (y * clean.width + x) * 4;
      if (clean.rgba[i] !== dirty.rgba[i] || clean.rgba[i + 1] !== dirty.rgba[i + 1] || clean.rgba[i + 2] !== dirty.rgba[i + 2] || clean.rgba[i + 3] !== dirty.rgba[i + 3]) different++;
    }
    expect(different).toBe(0);
  });

  it('refuses a source whose "pack" spans the frame (a surface or scene), instead of compositing a slab', async () => {
    const scene = await png(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#fff"/><rect x="0" y="560" width="800" height="240" fill="#d6cfc4"/><rect x="330" y="150" width="140" height="410" rx="16" fill="#c28a1a"/></svg>'));
    await expect(cutOutProduct(scene)).rejects.toThrow(/BACKGROUND_NOT_(PLAIN|REMOVED)/);
  });

  it('refuses a lifestyle photo whose wall and surface differ, even when the product itself is cleanly lit', async () => {
    const photo = await png(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3f0ea"/><stop offset="1" stop-color="#ece3da"/></linearGradient></defs><rect width="800" height="800" fill="url(#g)"/><rect x="330" y="150" width="140" height="450" rx="16" fill="#c28a1a"/></svg>'));
    await expect(cutOutProduct(photo)).resolves.toBeTruthy(); // a gentle studio gradient is fine
    const lifestyle = await png(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="500" fill="#f3f0ea"/><rect y="500" width="800" height="300" fill="#e0d2c1"/><rect x="330" y="150" width="140" height="450" rx="16" fill="#c28a1a"/></svg>'));
    await expect(cutOutProduct(lifestyle)).rejects.toThrow('BACKGROUND_NOT_PLAIN');
  });

  it('grounds the pack: a tight contact shadow at the base, soft shadow on the surface, nothing mirrored below it', async () => {
    const composed = await composeOnTemplate(await png(packSvg()), TEMPLATE, RULES);
    const output = await sharp(composed.buffer).removeAlpha().raw().toBuffer();
    const scene = await sharp(TEMPLATE).removeAlpha().raw().toBuffer();
    const luma = (buffer: Buffer, x: number, y: number) => { const i = (y * 1254 + x) * 3; return 0.299 * buffer[i] + 0.587 * buffer[i + 1] + 0.114 * buffer[i + 2]; };
    const baseline = Math.round(RULES.placement.baselineY * 1254);
    const centreX = Math.round(RULES.placement.centerX * 1254);
    // Directly under the base the surface is darker than the bare template.
    expect(luma(scene, centreX, baseline + 3) - luma(output, centreX, baseline + 3)).toBeGreaterThan(12);
    // The pack's shadow falls on the surface to the right (away from the light) and fades out.
    const reach = centreX + 160;
    expect(luma(scene, reach, baseline + 6) - luma(output, reach, baseline + 6)).toBeGreaterThan(3);
    // Left of the pack, toward the light, there is no shadow.
    expect(Math.abs(luma(scene, centreX - 330, baseline + 6) - luma(output, centreX - 330, baseline + 6))).toBeLessThan(5);
    // Nothing of the pack's colour appears below the base: no reflection.
    for (let y = baseline + 4; y < baseline + 90; y += 4) for (let x = centreX - 100; x < centreX + 100; x += 4) {
      const i = (y * 1254 + x) * 3;
      expect(Math.abs(output[i] - 31) + Math.abs(output[i + 1] - 78) + Math.abs(output[i + 2] - 121)).toBeGreaterThan(90);
    }
  });

  it('refuses a busy background and a blank image instead of guessing', async () => {
    const busy = await sharp({ create: { width: 800, height: 800, channels: 3, background: '#3b7a57' } }).composite([{ input: packSvg(), blend: 'difference' }]).png().toBuffer();
    await expect(cutOutProduct(busy)).rejects.toThrow(new MediaProcessingError('BACKGROUND_NOT_PLAIN'));
    const blank = await sharp({ create: { width: 800, height: 800, channels: 3, background: '#ffffff' } }).png().toBuffer();
    await expect(cutOutProduct(blank)).rejects.toThrow(new MediaProcessingError('NO_PRODUCT_FOUND'));
  });

  it('keeps enclosed light areas opaque by default and lets clear packaging show the scene only when a reviewer says so', async () => {
    const clearPack = await png(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#ffffff"/>
      <rect x="290" y="150" width="220" height="540" rx="24" fill="#ffffff" stroke="#6b7c8a" stroke-width="10"/></svg>`));
    const opaque = await cutOutProduct(clearPack);
    expect(opaque.report.warnings).toContain('ENCLOSED_BACKGROUND');
    const centre = (cut: { width: number; height: number; rgba: Buffer }) => cut.rgba[((cut.height >> 1) * cut.width + (cut.width >> 1)) * 4 + 3];
    expect(centre(opaque)).toBe(255);
    const clear = await cutOutProduct(clearPack, { transparentPackaging: true });
    expect(centre(clear)).toBeLessThan(120);
  });

  it('composes on the supplied template: output keeps its size, scene and palette, the pack sits on the plinth, and the result is deterministic', async () => {
    const source = await png(packSvg());
    const first = await composeOnTemplate(source, TEMPLATE, RULES);
    const second = await composeOnTemplate(source, TEMPLATE, RULES);
    expect(crypto.createHash('sha256').update(first.buffer).digest('hex')).toBe(crypto.createHash('sha256').update(second.buffer).digest('hex'));
    expect(await sharp(first.buffer).metadata()).toMatchObject({ format: 'webp', width: 1254, height: 1254 });

    const output = await sharp(first.buffer).removeAlpha().raw().toBuffer();
    const scene = await sharp(TEMPLATE).removeAlpha().raw().toBuffer();
    const pixel = (buffer: Buffer, x: number, y: number) => [...buffer.subarray((y * 1254 + x) * 3, (y * 1254 + x) * 3 + 3)];
    const near = (a: number[], b: number[], tolerance = 12) => a.every((value, i) => Math.abs(value - b[i]) <= tolerance);
    // Far from the pack the template is intact: wall shadows, lime disc, stone, towel.
    for (const [x, y] of [[30, 30], [120, 300], [1100, 500], [1000, 300], [60, 950], [1100, 950], [1200, 1200]]) expect(near(pixel(output, x, y), pixel(scene, x, y))).toBe(true);

    // The pack stands on the plinth: its base meets the configured baseline, centred.
    const baseline = Math.round(RULES.placement.baselineY * 1254);
    const centreX = Math.round(RULES.placement.centerX * 1254);
    expect(near(pixel(output, centreX, baseline - 30), [31, 78, 121], 16)).toBe(true);
    expect(near(pixel(output, centreX, baseline + 40), pixel(scene, centreX, baseline + 40), 90)).toBe(true);
    expect(first.report.placementScale).toBeGreaterThan(0);
  });

  it('never upscales past the template limit and reports it when it does upscale', async () => {
    const small = await png(packSvg({ size: 300 }));
    const composed = await composeOnTemplate(small, TEMPLATE, RULES);
    expect(composed.report.warnings).toContain('UPSCALED');
    expect(composed.report.placementScale!).toBeLessThanOrEqual(RULES.placement.maxUpscale);
  });
});
