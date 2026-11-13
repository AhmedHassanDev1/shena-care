import sharp, { OverlayOptions } from 'sharp';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

/** Layout of a template, in fractions of its edge. Stored with each template version, never in code paths. */
export interface TemplateRules {
  output: { size: number; quality: number };
  /** With centerY the pack is centred vertically in the frame (clean studio templates); without it, it stands on baselineY (scene templates). */
  placement: { centerX: number; baselineY: number; centerY?: number; maxHeight: number; maxWidth: number; maxUpscale: number };
  shadow: {
    /** false switches every artificial shadow off, whatever the opacities say. */
    enabled?: boolean;
    contactOpacity: number; contactBlur: number; contactHeight: number;
    /** Soft occlusion pool under the whole pack; 0 disables it. */
    ambientOpacity?: number; ambientBlur?: number;
    castOpacity: number; castBlur: number;
    /** How far the pack's shadow reaches along the surface away from the scene's light (fraction of pack height), and how far it comes toward the viewer. */
    castReach?: number; castDrop?: number;
    color: [number, number, number];
  };
}

export interface CutoutOptions {
  /** Reviewer's statement that the pack is clear: background enclosed by the pack shows through instead of staying opaque. */
  transparentPackaging?: boolean;
  /** Cutout engine: 'auto' | 'neural' | 'deterministic'. In test environment, defaults to 'deterministic' to avoid subprocess timeouts. */
  engine?: 'auto' | 'neural' | 'deterministic';
}

export type QualityWarning = 'TOUCHES_IMAGE_EDGE' | 'LOW_EDGE_CONTRAST' | 'ENCLOSED_BACKGROUND' | 'UPSCALED' | 'SOURCE_SHADOW_REMOVED' | 'SMALL_SOURCE'
  /** Two sizeable separate pieces: a cap, pump or lid came apart from its pack. */
  | 'DETACHED_PART'
  /** A small source had to be enlarged to reach the template's scale: soft labels. */
  | 'UPSCALED_SMALL_SOURCE'
  /** Neural segmentation failed or was unavailable; fallback occurred. */
  | 'NEURAL_CUTOUT_FAILED';

export interface QualityReport {
  backgroundMode: 'SOURCE_ALPHA' | 'PLAIN_BACKGROUND';
  backgroundColor: [number, number, number] | null;
  sourceWidth: number;
  sourceHeight: number;
  productWidth: number;
  productHeight: number;
  coverage: number;
  enclosedBackgroundRatio: number;
  placementScale?: number;
  warnings: QualityWarning[];
}

/** A source this deterministic pipeline cannot cut out honestly. The asset records the failure; nothing is guessed. */
export class MediaProcessingError extends Error {}

const MAX_WORKING_EDGE = 2000;
const MIN_PRODUCT_EDGE = 200;
const ALPHA_PRESENT_FRACTION = 0.005;
const MIN_BACKGROUND_LIGHTNESS = 196;
const MAX_BACKGROUND_SPREAD = 26;
/** Real packshot backdrops differ by 0 to a few levels between sides; a lifestyle scene measured 38 and a soft studio gradient stays under 25. */
const MAX_SIDE_DIFFERENCE = 28;
const MIN_FILL_TOLERANCE = 16;
const EDGE_BAND = 2;
const MIN_COVERAGE = 0.01;
const MAX_COVERAGE = 0.97;
const MIN_COMPONENT_OF_LARGEST = 0.004;
/** Shadow-like = the backdrop darkened: neutral within this many levels of the backdrop's tint, and smooth (no step above SHADOW_MAX_STEP between neighbours). */
const SHADOW_MAX_CHROMA = 9;
const SHADOW_MAX_STEP = 12;
/** Near-black is print or a pump, never a cast shadow on a lit backdrop. */
const SHADOW_MIN_DARK_LUMA = 35;
/** Within this many levels of the backdrop a shadow-like pixel is "pale": only removed under the pack's base band, where contact pools sit. */
const SHADOW_PALE_BAND = 30;
/** Body structures thinner than twice this are edge fringes, not pack. */
const BODY_EROSION_PX = 2;
/** Body pieces smaller than this share of the largest piece do not define the pack's span. */
const BODY_MIN_SHARE = 0.005;
/** A source shadow is a region, not a line: at least this share of the frame, mostly dark, and mostly thick (survives a 3 px erosion). */
const SHADOW_MIN_AREA = 0.003;
const SHADOW_MIN_DARK_SHARE = 0.5;
const SHADOW_MIN_THICK_SHARE = 0.25;
const SHADOW_DARK_BELOW_BACKDROP = 50;
/** After a shadow is removed, its hard outline (neutral, but too stepped to read as smooth) is removed up to this depth. */
const SHADOW_FRINGE_PX = 4;
/** A second piece at least this share of the largest counts as a detached part. */
const DETACHED_PART_SHARE = 0.02;
const ENCLOSED_ALPHA = 0.32;

interface Cutout { rgba: Buffer; width: number; height: number; report: QualityReport }

const lumaOf = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

// One model process at a time: concurrent 973 MB CPU sessions cause host paging.
let neuralQueue: Promise<unknown> = Promise.resolve();
function tryNeuralCutout(source: Buffer): Promise<{ rgba: Buffer; width: number; height: number } | null> {
  const task = neuralQueue.then(() => runNeuralCutout(source));
  neuralQueue = task.catch(() => undefined);
  return task;
}

async function runNeuralCutout(source: Buffer): Promise<{ rgba: Buffer; width: number; height: number } | null> {
  const tmpDir = os.tmpdir();
  const id = crypto.randomUUID();
  const inPath = path.join(tmpDir, `in_${id}.png`);
  const outPath = path.join(tmpDir, `out_${id}.png`);
  try {
    fs.writeFileSync(inPath, source);
    const candidates = [
      path.resolve(__dirname, '../../../../scripts/birefnet-cutout.py'),
      path.resolve(process.cwd(), 'apps/api/scripts/birefnet-cutout.py'),
      path.resolve(process.cwd(), 'scripts/birefnet-cutout.py'),
    ];
    const resolvedScript = candidates.find(p => fs.existsSync(p));
    if (!resolvedScript) return null;

    // Measured cold imports/load ~84 s plus ~61 s segmentation/matting on CPU.
    // Bound the complete cold run, without blocking HTTP or changing model resolution.
    await new Promise<void>((resolve, reject) => {
      execFile('python', [resolvedScript, inPath, outPath], { timeout: 180000, maxBuffer: 1024 * 1024 }, error => error ? reject(error) : resolve());
    });
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) return null;

    const { data, info } = await sharp(outPath).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { rgba: Buffer.from(data), width: info.width, height: info.height };
  } catch {
    return null;
  } finally {
    if (fs.existsSync(inPath)) try { fs.unlinkSync(inPath); } catch { /* Best-effort temporary input cleanup. */ }
    if (fs.existsSync(outPath)) try { fs.unlinkSync(outPath); } catch { /* Best-effort temporary output cleanup. */ }
  }
}

/**
 * Separates a pack from its background without touching the pack: pixels are only ever made transparent or, on the antialiased outline, freed of background colour.
 * Every pixel inside the outline keeps its exact source value, so labels, barcodes and claims stay as photographed.
 */
export async function cutOutProduct(source: Buffer, options: CutoutOptions = {}): Promise<Cutout> {
  const { data, info } = await sharp(source, { limitInputPixels: 50_000_000, failOn: 'error' }).rotate()
    .resize({ width: MAX_WORKING_EDGE, height: MAX_WORKING_EDGE, fit: 'inside', withoutEnlargement: true })
    .toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const count = width * height;
  const rgba = Buffer.from(data);

  let transparent = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 16) transparent++;
  const hasAlpha = transparent / count > ALPHA_PRESENT_FRACTION;
  const warnings = new Set<QualityWarning>();
  let background: [number, number, number] | null = null;
  let enclosed = 0;

  if (!hasAlpha) {
    let neuralUsed = false;
    const allowNeural = options.engine === 'neural' || (options.engine !== 'deterministic' && process.env.NODE_ENV !== 'test');
    if (allowNeural) {
      const pngBuffer = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
      const neural = await tryNeuralCutout(pngBuffer);
      if (neural && neural.width === width && neural.height === height) {
        // Matting engines may decontaminate/recolour RGB. Their mask is evidence;
        // the authentic photograph remains the only source of packaging pixels.
        for (let i = 3; i < rgba.length; i += 4) rgba[i] = neural.rgba[i];
        neuralUsed = true;
      } else {
        if (options.engine === 'neural') {
          throw new MediaProcessingError('NEURAL_SEGMENTATION_FAILED');
        }
        warnings.add('NEURAL_CUTOUT_FAILED');
      }
    }
    if (!neuralUsed) {
      background = estimateBackground(rgba, width, height);
      enclosed = removeBackground(rgba, width, height, background, options, warnings);
      keepProductComponents(rgba, width);
      await refineMask(rgba, width, height);
    }
  } else {
    keepProductComponents(rgba, width);
    await refineMask(rgba, width, height);
  }
  inspectCutout(rgba, width, height, warnings);

  const box = alphaBox(rgba, width, height);
  if (!box) throw new MediaProcessingError('NO_PRODUCT_FOUND');

  let opaque = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 8) opaque++;
  const coverage = opaque / count;
  if (coverage < MIN_COVERAGE) throw new MediaProcessingError('NO_PRODUCT_FOUND');
  if (coverage > MAX_COVERAGE) throw new MediaProcessingError('BACKGROUND_NOT_REMOVED');
  const productWidth = box.right - box.left + 1;
  const productHeight = box.bottom - box.top + 1;
  if (Math.max(productWidth, productHeight) < MIN_PRODUCT_EDGE) throw new MediaProcessingError('PRODUCT_RESOLUTION_TOO_LOW');
  if (Math.max(productWidth, productHeight) < MIN_PRODUCT_EDGE * 2) warnings.add('SMALL_SOURCE');
  const touching = [box.left === 0, box.top === 0, box.right === width - 1, box.bottom === height - 1].filter(Boolean).length;
  // A "pack" spanning the whole frame is a surface, a crowd or a lifestyle scene that was not a plain background: refuse rather than composite a slab of it.
  if ((box.left === 0 && box.right === width - 1) || touching >= 3) throw new MediaProcessingError('BACKGROUND_NOT_REMOVED');
  if (touching > 0) warnings.add('TOUCHES_IMAGE_EDGE');
  if (enclosed > 0.02) warnings.add('ENCLOSED_BACKGROUND');

  const cropped = Buffer.alloc(productWidth * productHeight * 4);
  for (let y = 0; y < productHeight; y++) rgba.copy(cropped, y * productWidth * 4, ((y + box.top) * width + box.left) * 4, ((y + box.top) * width + box.right + 1) * 4);
  return {
    rgba: cropped, width: productWidth, height: productHeight,
    report: {
      backgroundMode: hasAlpha ? 'SOURCE_ALPHA' : 'PLAIN_BACKGROUND', backgroundColor: background, sourceWidth: width, sourceHeight: height,
      productWidth, productHeight, coverage: Number(coverage.toFixed(4)), enclosedBackgroundRatio: Number(enclosed.toFixed(4)), warnings: [...warnings],
    },
  };
}

function estimateBackground(rgba: Buffer, width: number, height: number): [number, number, number] {
  const ring = Math.max(2, Math.round(Math.min(width, height) * 0.015));
  const channels: number[][] = [[], [], []];
  const take = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) channels[c].push(rgba[i + c]);
  };
  for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
    if (x < ring || y < ring || x >= width - ring || y >= height - ring) take(x, y);
  }
  const median = (list: number[]) => list.sort((a, b) => a - b)[list.length >> 1];
  // A studio backdrop is one colour all round. A wall above and a surface below (a lifestyle photo) are not, whatever the pack looks like.
  const sides = [(x: number, y: number) => y < ring, (x: number, y: number) => y >= height - ring, (x: number) => x < ring, (x: number) => x >= width - ring].map(test => {
    const pts: number[][] = [[], [], []];
    for (let y = 0; y < height; y += 3) for (let x = 0; x < width; x += 3) if (test(x, y)) { const i = (y * width + x) * 4; for (let c = 0; c < 3; c++) pts[c].push(rgba[i + c]); }
    return pts.map(median);
  });
  for (const a of sides) for (const b of sides) if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > MAX_SIDE_DIFFERENCE) throw new MediaProcessingError('BACKGROUND_NOT_PLAIN');
  const bg: [number, number, number] = [median(channels[0]), median(channels[1]), median(channels[2])];
  if (Math.min(...bg) < MIN_BACKGROUND_LIGHTNESS) throw new MediaProcessingError('BACKGROUND_NOT_PLAIN');
  const distances = channels[0].map((_, i) => Math.hypot(channels[0][i] - bg[0], channels[1][i] - bg[1], channels[2][i] - bg[2])).sort((a, b) => a - b);
  // A pack cropped at the frame may occupy part of the ring, so the check allows a minority of it to differ.
  if (distances[Math.floor(distances.length * 0.7)] > MAX_BACKGROUND_SPREAD) throw new MediaProcessingError('BACKGROUND_NOT_PLAIN');
  return bg;
}

/** Flood-fills from the frame, so a white label inside the outline is never reached. Returns the ratio of pack area that looks like background but is enclosed. */
function removeBackground(rgba: Buffer, width: number, height: number, bg: [number, number, number], options: CutoutOptions, warnings: Set<QualityWarning>): number {
  const count = width * height;
  const distance = new Float32Array(count);
  for (let p = 0; p < count; p++) distance[p] = Math.hypot(rgba[p * 4] - bg[0], rgba[p * 4 + 1] - bg[1], rgba[p * 4 + 2] - bg[2]);

  const samples: number[] = [];
  const ring = Math.max(2, Math.round(Math.min(width, height) * 0.01));
  for (let y = 0; y < height; y += 3) for (let x = 0; x < width; x += 3) if (x < ring || y < ring || x >= width - ring || y >= height - ring) samples.push(distance[y * width + x]);
  samples.sort((a, b) => a - b);
  const tolerance = Math.max(MIN_FILL_TOLERANCE, Math.min(MAX_BACKGROUND_SPREAD * 1.4, samples[Math.floor(samples.length * 0.6)] * 1.8));

  const isBackground = new Uint8Array(count);
  const stack = new Int32Array(count);
  let top = 0;
  const seed = (p: number) => { if (!isBackground[p] && distance[p] < tolerance) { isBackground[p] = 1; stack[top++] = p; } };
  for (let x = 0; x < width; x++) { seed(x); seed((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { seed(y * width); seed(y * width + width - 1); }
  while (top > 0) {
    const p = stack[--top];
    const x = p % width;
    if (x > 0) seed(p - 1);
    if (x < width - 1) seed(p + 1);
    if (p >= width) seed(p - width);
    if (p < count - width) seed(p + width);
  }

  const shadowRemoved = removeSourceShadows(rgba, width, height, bg, isBackground);
  if (shadowRemoved > 0) warnings.add('SOURCE_SHADOW_REMOVED');

  // Antialiased outline: a pixel is a mix of the background and the pack just inside it. Its alpha is how far along that line it sits, and the background's share is taken
  // back out of its colour, so no halo survives on the new scene.
  const nearBackground = new Uint8Array(count);
  for (let pass = 0; pass < EDGE_BAND; pass++) {
    const source = pass === 0 ? isBackground : nearBackground.slice();
    for (let p = 0; p < count; p++) {
      if (isBackground[p] || nearBackground[p]) continue;
      const x = p % width;
      if ((x > 0 && source[p - 1]) || (x < width - 1 && source[p + 1]) || (p >= width && source[p - width]) || (p < count - width && source[p + width])) nearBackground[p] = 1;
    }
  }
  const edgeRange = tolerance * 2.2;
  const innerDistance = (p: number) => {
    const x = p % width;
    const y = Math.floor(p / width);
    let best = -1;
    let nearest = Infinity;
    for (let dy = -3; dy <= 3; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -3; dx <= 3; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= width) continue;
        const q = ny * width + nx;
        if (isBackground[q] || nearBackground[q]) continue;
        const reach = dx * dx + dy * dy;
        if (reach < nearest) { nearest = reach; best = distance[q]; }
      }
    }
    return best;
  };
  let soft = 0;
  let edge = 0;
  for (let p = 0; p < count; p++) {
    const i = p * 4;
    if (isBackground[p]) { rgba[i + 3] = 0; continue; }
    if (!nearBackground[p]) continue;
    edge++;
    const inner = innerDistance(p);
    const alpha = Math.min(1, distance[p] / (inner > tolerance ? inner : edgeRange));
    if (alpha >= 1) continue;
    soft++;
    if (alpha < 0.12) { rgba[i + 3] = 0; continue; }
    for (let c = 0; c < 3; c++) rgba[i + c] = Math.max(0, Math.min(255, Math.round((rgba[i + c] - (1 - alpha) * bg[c]) / alpha)));
    rgba[i + 3] = Math.round(alpha * 255);
  }
  if (edge > 0 && soft / edge > 0.75) warnings.add('LOW_EDGE_CONTRAST');

  let packArea = 0;
  let enclosed = 0;
  for (let p = 0; p < count; p++) {
    if (isBackground[p]) continue;
    packArea++;
    if (distance[p] >= tolerance || nearBackground[p]) continue;
    enclosed++;
    if (options.transparentPackaging) {
      // Clear packaging lets the scene through; only this explicit reviewer choice changes an interior pixel.
      const alpha = Math.max(ENCLOSED_ALPHA, Math.min(1, distance[p] / tolerance));
      const i = p * 4;
      for (let c = 0; c < 3; c++) rgba[i + c] = Math.max(0, Math.min(255, Math.round((rgba[i + c] - (1 - alpha) * bg[c]) / alpha)));
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }
  return packArea ? enclosed / packArea : 0;
}

/**
 * Removes the old scene's shadows, cast or contact, and nothing of the pack.
 *
 * A source shadow is the backdrop darkened: neutral, smooth, and attached to the backdrop. A pack can be neutral and smooth too (a white tube, a pale cap, a silver
 * collar), so colour alone never decides. What decides is position: the pack's solid body (everything that is not shadow-like) defines, row by row, the span the pack
 * occupies, and the lowest row it reaches. Shadow-like pixels outside that span, or below the pack's base, belong to the floor; shadow-like pixels inside it belong to
 * the pack and stay. A dark hard cast shadow beside a bottle and a pale contact pool under a jar are both removed this way, while a pale cap or a grey label stays.
 * Returns the number of pixels removed.
 */
function removeSourceShadows(rgba: Buffer, width: number, height: number, bg: [number, number, number], isBackground: Uint8Array): number {
  const count = width * height;
  const bgLuma = lumaOf(bg[0], bg[1], bg[2]);
  const luma = new Float32Array(count);
  for (let p = 0; p < count; p++) luma[p] = lumaOf(rgba[p * 4], rgba[p * 4 + 1], rgba[p * 4 + 2]);
  const neutral = (p: number) => {
    const r = rgba[p * 4]; const g = rgba[p * 4 + 1]; const b = rgba[p * 4 + 2];
    // Relative to the backdrop's own tint: a warm backdrop's shadow is warm too.
    const scale = luma[p] / Math.max(1, bgLuma);
    return Math.max(Math.abs(r - bg[0] * scale), Math.abs(g - bg[1] * scale), Math.abs(b - bg[2] * scale)) <= SHADOW_MAX_CHROMA + 4;
  };
  const touchesBackground = (p: number) => {
    const x = p % width;
    return (x > 0 && isBackground[p - 1] === 1) || (x < width - 1 && isBackground[p + 1] === 1) || (p >= width && isBackground[p - width] === 1) || (p < count - width && isBackground[p + width] === 1);
  };
  const smooth = (p: number) => {
    const x = p % width;
    let step = 0;
    for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p >= width ? p - width : -1, p < count - width ? p + width : -1]) {
      if (q < 0 || isBackground[q] === 1) continue;
      step = Math.max(step, Math.abs(luma[p] - luma[q]));
    }
    return step <= SHADOW_MAX_STEP;
  };
  // 1 = dark shadow-like, 2 = pale shadow-like. Darkest blacks are print, never shadow.
  const kind = new Uint8Array(count);
  for (let p = 0; p < count; p++) {
    if (isBackground[p] || luma[p] < SHADOW_MIN_DARK_LUMA || luma[p] >= bgLuma || !neutral(p)) continue;
    if (!smooth(p) && !touchesBackground(p)) continue;
    kind[p] = luma[p] <= bgLuma - SHADOW_PALE_BAND ? 1 : 2;
  }

  // The pack's solid body: what is in the outline and not shadow-like. Per row, its span; overall, its base.
  // Thin lines (an edge fringe along a shadow, a hairline of compression noise) are not body: only what survives a small erosion counts.
  const body = new Uint8Array(count);
  for (let p = 0; p < count; p++) body[p] = !isBackground[p] && !kind[p] ? 1 : 0;
  const eroded = erode(erode(body, width, height, BODY_EROSION_PX, true), width, height, BODY_EROSION_PX, false);
  // Only sizeable pieces of body define the pack: a fragment of a soft shadow edge is not a part of the pack.
  dropSmallComponents(eroded, width, height, BODY_MIN_SHARE);
  const spanLeft = new Int32Array(height).fill(width);
  const spanRight = new Int32Array(height).fill(-1);
  let base = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x;
    if (!eroded[p]) continue;
    if (x < spanLeft[y]) spanLeft[y] = x;
    if (x > spanRight[y]) spanRight[y] = x;
    if (y > base) base = y;
  }
  if (base < 0) return 0;
  // A row the body only grazes (a thin outline) borrows the span of its neighbours, so a plain band of a pale pack is never read as floor.
  const reach = Math.max(2, Math.round(height * 0.004));
  const left = new Int32Array(height);
  const right = new Int32Array(height);
  for (let y = 0; y < height; y++) {
    let l = width; let r = -1;
    for (let k = Math.max(0, y - reach); k <= Math.min(height - 1, y + reach); k++) { if (spanLeft[k] < l) l = spanLeft[k]; if (spanRight[k] > r) r = spanRight[k]; }
    left[y] = l; right[y] = r;
  }
  // The same per column: a part with pack above and below it (a collar between pump and shoulder) is pack, whatever its colour.
  const colTop = new Int32Array(width).fill(height);
  const colBottom = new Int32Array(width).fill(-1);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!eroded[y * width + x]) continue;
    if (y < colTop[x]) colTop[x] = y;
    if (y > colBottom[x]) colBottom[x] = y;
  }
  const top0 = new Int32Array(width);
  const bottom0 = new Int32Array(width);
  const reachX = Math.max(2, Math.round(width * 0.004));
  for (let x = 0; x < width; x++) {
    let t = height; let b = -1;
    for (let k = Math.max(0, x - reachX); k <= Math.min(width - 1, x + reachX); k++) { if (colTop[k] < t) t = colTop[k]; if (colBottom[k] > b) b = colBottom[k]; }
    top0[x] = t; bottom0[x] = b;
  }
  const floor = (p: number) => {
    const x = p % width;
    const y = (p - x) / width;
    if (y > base) return true;
    const outsideRow = right[y] < 0 || x < left[y] || x > right[y];
    const outsideColumn = bottom0[x] < 0 || y < top0[x] || y > bottom0[x];
    return outsideRow && outsideColumn;
  };

  // Shadow-like regions attached to the backdrop. Only a region that is a real cast or contact shadow qualifies: large, mostly dark and thick. The grey
  // outline and pale shading of a white pack are thin or pale, so a white tube on a white backdrop keeps every pixel.
  const thick = erode(erode(kind.map(k => (k ? 1 : 0)) as Uint8Array, width, height, 3, true), width, height, 3, false);
  const region = new Int32Array(count);
  const stack = new Int32Array(count);
  const accepted = new Set<number>();
  let next = 1;
  for (let start = 0; start < count; start++) {
    if (!kind[start] || region[start] || !touchesBackground(start)) continue;
    const label = next++;
    let top = 0; let area = 0; let dark = 0; let thickCount = 0;
    stack[top++] = start; region[start] = label;
    while (top > 0) {
      const p = stack[--top];
      area++;
      if (kind[p] === 1 && luma[p] <= bgLuma - SHADOW_DARK_BELOW_BACKDROP) dark++;
      if (thick[p]) thickCount++;
      const x = p % width;
      for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p >= width ? p - width : -1, p < count - width ? p + width : -1,
        x > 0 && p >= width ? p - width - 1 : -1, x < width - 1 && p >= width ? p - width + 1 : -1, x > 0 && p < count - width ? p + width - 1 : -1, x < width - 1 && p < count - width ? p + width + 1 : -1]) {
        if (q >= 0 && kind[q] && !region[q]) { region[q] = label; stack[top++] = q; }
      }
    }
    if (area >= count * SHADOW_MIN_AREA && dark >= area * SHADOW_MIN_DARK_SHARE && thickCount >= area * SHADOW_MIN_THICK_SHARE) accepted.add(label);
  }
  if (!accepted.size) return 0;

  // Within an accepted shadow, remove what lies on the floor, growing from the backdrop so nothing enclosed by the pack is touched. The shadow's pale falloff and
  // antialiased rim belong to it and go with it.
  let top = 0;
  let removed = 0;
  const push = (p: number) => {
    if (!kind[p] || isBackground[p] || !accepted.has(region[p]) || !floor(p)) return;
    isBackground[p] = 2; stack[top++] = p; removed++;
  };
  for (let p = 0; p < count; p++) if (kind[p] && touchesBackground(p)) push(p);
  while (top > 0) {
    const p = stack[--top];
    const x = p % width;
    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (p >= width) push(p - width);
    if (p < count - width) push(p + width);
    if (x > 0 && p >= width) push(p - width - 1);
    if (x < width - 1 && p >= width) push(p - width + 1);
    if (x > 0 && p < count - width) push(p + width - 1);
    if (x < width - 1 && p < count - width) push(p + width + 1);
  }
  // The shadow's own outline: neutral pixels on the floor directly against the removed shadow, a few pixels deep.
  let frontier: number[] = [];
  for (let p = 0; p < count; p++) if (isBackground[p] === 2) frontier.push(p);
  const fringe = (p: number) => !isBackground[p] && !kind[p] && luma[p] >= SHADOW_MIN_DARK_LUMA && neutral(p) && floor(p);
  for (let depth = 0; depth < SHADOW_FRINGE_PX && frontier.length; depth++) {
    const next: number[] = [];
    for (const p of frontier) {
      const x = p % width;
      for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p >= width ? p - width : -1, p < count - width ? p + width : -1]) {
        if (q >= 0 && fringe(q)) { isBackground[q] = 2; removed++; next.push(q); }
      }
    }
    frontier = next;
  }
  return removed;
}

/** Clears 4-connected pieces smaller than share of the largest one. */
function dropSmallComponents(mask: Uint8Array, width: number, height: number, share: number) {
  const count = width * height;
  const labels = new Int32Array(count);
  const sizes: number[] = [0];
  const stack = new Int32Array(count);
  for (let start = 0; start < count; start++) {
    if (!mask[start] || labels[start]) continue;
    const label = sizes.length;
    let size = 0;
    let top = 0;
    stack[top++] = start;
    labels[start] = label;
    while (top > 0) {
      const p = stack[--top];
      size++;
      const x = p % width;
      const visit = (q: number) => { if (mask[q] && !labels[q]) { labels[q] = label; stack[top++] = q; } };
      if (x > 0) visit(p - 1);
      if (x < width - 1) visit(p + 1);
      if (p >= width) visit(p - width);
      if (p < count - width) visit(p + width);
    }
    sizes.push(size);
  }
  const keep = Math.max(64, Math.max(0, ...sizes) * share);
  for (let p = 0; p < count; p++) if (labels[p] && sizes[labels[p]] < keep) mask[p] = 0;
}

/** Separable binary erosion: a pixel stays only if every pixel within radius along the axis is set. */
function erode(mask: Uint8Array, width: number, height: number, radius: number, horizontal: boolean): Uint8Array {
  const out = new Uint8Array(mask.length);
  const [outer, inner] = horizontal ? [height, width] : [width, height];
  for (let o = 0; o < outer; o++) {
    let run = 0;
    const at = (i: number) => (horizontal ? o * width + i : i * width + o);
    // Distance to the last unset pixel behind, then a backward pass for the one ahead.
    const behind = new Int32Array(inner);
    for (let i = 0; i < inner; i++) { run = mask[at(i)] ? run + 1 : 0; behind[i] = run; }
    run = 0;
    for (let i = inner - 1; i >= 0; i--) {
      run = mask[at(i)] ? run + 1 : 0;
      if (behind[i] > radius && run > radius) out[at(i)] = 1;
    }
  }
  return out;
}

/** Quality signals measured on the finished cutout, independent of how it was made. */
function inspectCutout(rgba: Buffer, width: number, height: number, warnings: Set<QualityWarning>) {
  const count = width * height;
  // More than one sizeable piece: a cap, pump or lid has come apart from its pack.
  const labels = new Int32Array(count);
  const sizes: number[] = [0];
  const stack = new Int32Array(count);
  for (let start = 0; start < count; start++) {
    if (labels[start] || rgba[start * 4 + 3] <= 64) continue;
    const label = sizes.length;
    let size = 0;
    let top = 0;
    stack[top++] = start;
    labels[start] = label;
    while (top > 0) {
      const p = stack[--top];
      size++;
      const x = p % width;
      const visit = (q: number) => { if (!labels[q] && rgba[q * 4 + 3] > 64) { labels[q] = label; stack[top++] = q; } };
      if (x > 0) visit(p - 1);
      if (x < width - 1) visit(p + 1);
      if (p >= width) visit(p - width);
      if (p < count - width) visit(p + width);
    }
    sizes.push(size);
  }
  const largest = Math.max(0, ...sizes);
  if (sizes.filter(size => size >= largest * DETACHED_PART_SHARE).length > 1) warnings.add('DETACHED_PART');
}

/** Drops dust and stray marks: only regions comparable to the pack survive. */
function keepProductComponents(rgba: Buffer, width: number) {
  const count = rgba.length / 4;
  const labels = new Int32Array(count);
  const sizes: number[] = [0];
  const stack = new Int32Array(count);
  for (let start = 0; start < count; start++) {
    if (labels[start] || rgba[start * 4 + 3] <= 8) continue;
    const label = sizes.length;
    let size = 0;
    let top = 0;
    stack[top++] = start;
    labels[start] = label;
    while (top > 0) {
      const p = stack[--top];
      size++;
      const x = p % width;
      const visit = (q: number) => { if (!labels[q] && rgba[q * 4 + 3] > 8) { labels[q] = label; stack[top++] = q; } };
      if (x > 0) visit(p - 1);
      if (x < width - 1) visit(p + 1);
      if (p >= width) visit(p - width);
      if (p < count - width) visit(p + width);
    }
    sizes.push(size);
  }
  const largest = Math.max(...sizes);
  // A real part of a pack has a solid core. A hairline left where an old shadow's edge was has none, whatever its length.
  const solid = new Uint8Array(count);
  for (let p = 0; p < count; p++) solid[p] = rgba[p * 4 + 3] > 8 ? 1 : 0;
  const core = erode(erode(solid, width, count / width, 2, true), width, count / width, 2, false);
  const cored = new Set<number>();
  for (let p = 0; p < count; p++) if (core[p]) cored.add(labels[p]);
  for (let p = 0; p < count; p++) if (labels[p] && (sizes[labels[p]] < largest * MIN_COMPONENT_OF_LARGEST || !cored.has(labels[p]))) rgba[p * 4 + 3] = 0;
}

function alphaBox(rgba: Buffer, width: number, height: number) {
  let left = width; let right = -1; let top = height; let bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (rgba[(y * width + x) * 4 + 3] <= 8) continue;
    if (x < left) left = x;
    if (x > right) right = x;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  return right < 0 ? null : { left, right, top, bottom };
}

const CORE_ALPHA = 250;
const KEEP_PX = 2;
const COLOR_RADIUS = 3;
const ALPHA_SMOOTHING = 0.8;

/**
 * Edge quality for every source, whether it came with an alpha channel or had its background removed here.
 *  1. Anything semi-transparent that is OUTSIDE the pack and more than a couple of pixels from its solid body is a baked drop shadow or glow, and is removed.
 *  2. The thin outline that remains takes its colour from the solid pack pixels beside it, so no white background (or old shadow) bleeds onto a different scene.
 *  3. Only that outline gets a light alpha smoothing, which removes stair-stepping. Solid pack pixels are never changed, so labels, logos and barcodes stay as photographed.
 */
async function refineMask(rgba: Buffer, width: number, height: number) {
  const count = width * height;
  const core = new Uint8Array(count);
  for (let p = 0; p < count; p++) core[p] = rgba[p * 4 + 3] >= CORE_ALPHA ? 1 : 0;

  // Outside = reachable from the frame through non-solid pixels. Enclosed partial alpha (clear packaging) is not outside.
  const outside = new Uint8Array(count);
  const stack = new Int32Array(count);
  let top = 0;
  const seed = (p: number) => { if (!core[p] && !outside[p]) { outside[p] = 1; stack[top++] = p; } };
  for (let x = 0; x < width; x++) { seed(x); seed((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { seed(y * width); seed(y * width + width - 1); }
  while (top > 0) {
    const p = stack[--top];
    const x = p % width;
    if (x > 0) seed(p - 1);
    if (x < width - 1) seed(p + 1);
    if (p >= width) seed(p - width);
    if (p < count - width) seed(p + width);
  }

  // Distance (in pixels, up to KEEP_PX + 1) from the solid body, growing outwards.
  const dist = new Uint8Array(count).fill(255);
  let frontier: number[] = [];
  for (let p = 0; p < count; p++) if (core[p]) { dist[p] = 0; frontier.push(p); }
  for (let depth = 1; depth <= KEEP_PX + 1; depth++) {
    const next: number[] = [];
    for (const p of frontier) {
      const x = p % width;
      const visit = (q: number) => { if (dist[q] === 255) { dist[q] = depth; next.push(q); } };
      if (x > 0) visit(p - 1);
      if (x < width - 1) visit(p + 1);
      if (p >= width) visit(p - width);
      if (p < count - width) visit(p + width);
    }
    frontier = next;
  }

  const original = Buffer.alloc(count);
  for (let p = 0; p < count; p++) original[p] = rgba[p * 4 + 3];
  for (let p = 0; p < count; p++) {
    if (core[p] || !outside[p]) continue;
    if (dist[p] > KEEP_PX) rgba[p * 4 + 3] = 0;
  }

  // Colour of the outline pixels: the average of the solid body within reach.
  const band: number[] = [];
  for (let p = 0; p < count; p++) if (!core[p] && outside[p] && dist[p] <= KEEP_PX) band.push(p);
  const recolor = new Map<number, [number, number, number]>();
  for (const p of band) {
    const x = p % width;
    const y = (p - x) / width;
    let r = 0; let g = 0; let b = 0; let n = 0;
    for (let dy = -COLOR_RADIUS; dy <= COLOR_RADIUS; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -COLOR_RADIUS; dx <= COLOR_RADIUS; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= width) continue;
        const q = ny * width + nx;
        if (!core[q]) continue;
        const weight = 1 / (1 + dx * dx + dy * dy);
        r += rgba[q * 4] * weight; g += rgba[q * 4 + 1] * weight; b += rgba[q * 4 + 2] * weight; n += weight;
      }
    }
    if (n > 0) recolor.set(p, [Math.round(r / n), Math.round(g / n), Math.round(b / n)]);
  }
  for (const [p, [r, g, b]] of recolor) { rgba[p * 4] = r; rgba[p * 4 + 1] = g; rgba[p * 4 + 2] = b; }

  await featherOutline(rgba, width, height);
}

/**
 * Turns any remaining alpha step (solid pack pixel next to a fully transparent one) into a one-pixel ramp. Only pixels on such a step change; solid pixels keep their colour and
 * stay at least 80% opaque, and a newly visible pixel takes the colour of the strongest pack pixel beside it.
 */
async function featherOutline(rgba: Buffer, width: number, height: number) {
  const count = width * height;
  const plane = Buffer.alloc(count);
  for (let p = 0; p < count; p++) plane[p] = rgba[p * 4 + 3];
  const blurred = await sharp(plane, { raw: { width, height, channels: 1 } }).blur(ALPHA_SMOOTHING).extractChannel(0).raw().toBuffer();
  const updates: Array<[number, number, number, number, number]> = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x;
      let min = 255; let max = 0; let strongest = -1; let strongestAlpha = -1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const q = p + dy * width + dx;
        const value = plane[q];
        if (value < min) min = value;
        if (value > max) max = value;
        if (value > strongestAlpha) { strongestAlpha = value; strongest = q; }
      }
      if (max - min < 96) continue;
      const own = plane[p];
      const next = own >= 250 ? Math.max(blurred[p], 205) : blurred[p];
      if (own === 0 && next === 0) continue;
      if (own < 16) updates.push([p, rgba[strongest * 4], rgba[strongest * 4 + 1], rgba[strongest * 4 + 2], Math.min(next, 120)]);
      else updates.push([p, rgba[p * 4], rgba[p * 4 + 1], rgba[p * 4 + 2], next]);
    }
  }
  for (const [p, r, g, b, alpha] of updates) { rgba[p * 4] = r; rgba[p * 4 + 1] = g; rgba[p * 4 + 2] = b; rgba[p * 4 + 3] = alpha; }
}

/** Outcome of composing one authentic pack on a template. Deterministic: same original, template and rules give the same bytes. */
export async function composeOnTemplate(source: Buffer, template: Buffer, rules: TemplateRules, options: CutoutOptions = {}): Promise<{ buffer: Buffer; width: number; height: number; report: QualityReport }> {
  const cut = await cutOutProduct(source, options);
  const size = rules.output.size;
  const { centerX, baselineY, maxHeight, maxWidth, maxUpscale } = rules.placement;
  const scale = Math.min((maxHeight * size) / cut.height, (maxWidth * size) / cut.width, maxUpscale);
  const productWidth = Math.max(1, Math.round(cut.width * scale));
  const productHeight = Math.max(1, Math.round(cut.height * scale));
  const report: QualityReport = { ...cut.report, placementScale: Number(scale.toFixed(4)), warnings: [...cut.report.warnings] };
  if (scale > 1 && !report.warnings.includes('UPSCALED')) report.warnings.push('UPSCALED');
  // Enlarging a small source more than a little softens its label: reported so the image is not approved automatically.
  if (scale > 1.15 && report.warnings.includes('SMALL_SOURCE')) report.warnings.push('UPSCALED_SMALL_SOURCE');

  const product = await sharp(cut.rgba, { raw: { width: cut.width, height: cut.height, channels: 4 } })
    .resize({ width: productWidth, height: productHeight, kernel: 'lanczos3' }).png().toBuffer();
  const left = Math.round(centerX * size - productWidth / 2);
  const top = rules.placement.centerY !== undefined ? Math.round(rules.placement.centerY * size - productHeight / 2) : Math.round(baselineY * size - productHeight);
  const shadows = rules.shadow.enabled !== false;
  const footprint = shadows ? await footprintSpan(product, productWidth, productHeight) : { left: 0, width: productWidth };

  const layers: OverlayOptions[] = [
    ...(shadows ? await ambientShadow(footprint, left, top + productHeight, size, rules) : []),
    ...(shadows ? await castShadow(product, productWidth, productHeight, left, top, size, rules) : []),
    ...(shadows ? await contactShadow(footprint, left, top + productHeight, size, rules) : []),
    { input: product, left, top },
  ];
  const { data, info } = await sharp(template, { failOn: 'error' }).rotate().resize({ width: size, height: size, fit: 'cover' }).removeAlpha()
    .composite(layers).webp({ quality: rules.output.quality, effort: 5, smartSubsample: true }).toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height, report };
}

/** The span the pack actually rests on: its lowest rows, not its widest point. */
async function footprintSpan(product: Buffer, width: number, height: number) {
  const { data } = await sharp(product).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  const rows = Math.max(2, Math.round(height * 0.03));
  let left = width; let right = -1;
  for (let y = height - rows; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[y * width + x] <= 90) continue;
    if (x < left) left = x;
    if (x > right) right = x;
  }
  return right < 0 ? { left: 0, width } : { left, width: right - left + 1 };
}

const canvasOverlay = async (svg: string, blur: number): Promise<OverlayOptions> =>
  ({ input: await sharp(Buffer.from(svg)).blur(Math.max(0.5, blur)).png().toBuffer(), left: 0, top: 0, blend: 'multiply' });

/** A wide, very soft pool of occlusion around the base: the surface is slightly darker everywhere the pack hides it from the sky. */
async function ambientShadow(footprint: { left: number; width: number }, left: number, baseline: number, size: number, rules: TemplateRules): Promise<OverlayOptions[]> {
  const { ambientOpacity = 0.22, ambientBlur = 0.02, color } = rules.shadow;
  if (ambientOpacity <= 0) return [];
  const rx = footprint.width * 0.78;
  const ry = Math.max(6, footprint.width * 0.16);
  const cx = left + footprint.left + footprint.width / 2;
  return [await canvasOverlay(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><ellipse cx="${cx.toFixed(1)}" cy="${(baseline - ry * 0.1).toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="rgb(${color.join(',')})" fill-opacity="${ambientOpacity}"/></svg>`, ambientBlur * size)];
}

/** The tight, dark line where the pack meets the surface. Its front half shows below the base; the back half is hidden behind the pack, so the pack looks seated, not floating. */
async function contactShadow(footprint: { left: number; width: number }, left: number, baseline: number, size: number, rules: TemplateRules): Promise<OverlayOptions[]> {
  const { contactBlur, contactHeight, contactOpacity, color } = rules.shadow;
  if (contactOpacity <= 0) return [];
  const rx = footprint.width * 0.5;
  const ry = Math.max(2, (contactHeight * size) / 2);
  const cx = left + footprint.left + footprint.width / 2;
  const dark = color.map(channel => Math.round(channel * 0.55));
  return [await canvasOverlay(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><ellipse cx="${cx.toFixed(1)}" cy="${(baseline - ry * 0.35).toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="rgb(${dark.join(',')})" fill-opacity="${contactOpacity}"/></svg>`, contactBlur * size)];
}

/**
 * The pack's silhouette projected onto the surface, away from the scene's light: heights become distance along the surface, so the shadow starts at the base and fades out.
 * It is a projection, never a flipped copy, so it cannot read as a reflection.
 */
async function castShadow(product: Buffer, width: number, height: number, left: number, top: number, size: number, rules: TemplateRules): Promise<OverlayOptions[]> {
  const { castOpacity, castBlur, castReach = 0.28, castDrop = 0.07, color } = rules.shadow;
  if (castOpacity <= 0 || castReach === 0) return [];
  const alpha = await sharp(product).ensureAlpha().extractChannel(3).raw().toBuffer();
  const reachPx = Math.round(height * Math.abs(castReach));
  const dropPx = Math.max(2, Math.round(height * castDrop));
  const direction = castReach >= 0 ? 1 : -1;
  const outWidth = width + reachPx;
  const outHeight = dropPx + 2;
  const plane = new Float32Array(outWidth * outHeight);
  for (let y = 0; y < height; y++) {
    const lift = (height - 1 - y) / height;
    const dy = Math.min(outHeight - 1, Math.round(lift * dropPx));
    const dx = Math.round(lift * reachPx);
    const fade = 1 - 0.75 * lift;
    for (let x = 0; x < width; x++) {
      const a = alpha[y * width + x] / 255;
      if (a <= 0) continue;
      const tx = direction > 0 ? x + dx : x + reachPx - dx;
      const index = dy * outWidth + tx;
      const value = a * fade;
      if (value > plane[index]) plane[index] = value;
    }
  }
  // Thin rows of a projection leave gaps; close them vertically before softening.
  for (let y = 1; y < outHeight; y++) for (let x = 0; x < outWidth; x++) {
    if (plane[y * outWidth + x] === 0 && plane[(y - 1) * outWidth + x] > 0) plane[y * outWidth + x] = plane[(y - 1) * outWidth + x] * 0.9;
  }
  const rgba = Buffer.alloc(outWidth * outHeight * 4);
  for (let i = 0; i < plane.length; i++) {
    rgba[i * 4] = color[0]; rgba[i * 4 + 1] = color[1]; rgba[i * 4 + 2] = color[2];
    rgba[i * 4 + 3] = Math.round(Math.min(1, plane[i]) * castOpacity * 255);
  }
  const pad = Math.ceil(castBlur * size * 3) + 2;
  const soft = await sharp(rgba, { raw: { width: outWidth, height: outHeight, channels: 4 } })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: color[0], g: color[1], b: color[2], alpha: 0 } })
    .blur(Math.max(0.5, castBlur * size)).png().toBuffer();
  const meta = await sharp(soft).metadata();
  const px = left - pad - (direction < 0 ? reachPx : 0) + (direction < 0 ? reachPx : 0);
  const py = top + height - pad - Math.round(dropPx * 0.15);
  const cropLeft = Math.max(0, -px);
  const cropTop = Math.max(0, -py);
  const cropWidth = Math.min((meta.width ?? 0) - cropLeft, size - Math.max(0, px));
  const cropHeight = Math.min((meta.height ?? 0) - cropTop, size - Math.max(0, py));
  if (cropWidth <= 0 || cropHeight <= 0) return [];
  const input = await sharp(soft).extract({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight }).png().toBuffer();
  return [{ input, left: Math.max(0, px), top: Math.max(0, py), blend: 'multiply' }];
}
