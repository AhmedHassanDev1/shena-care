#!/usr/bin/env node
/**
 * Asset and illustration guardrails for the storefront (no dependencies). Run by `npm run check:design`.
 *
 * 1. Every `/images/...` path written in src exists under public/.
 * 2. Declared pixel sizes in features/home/lib (HOME_IMAGES, BRAND_LOGOS) equal the real file sizes, so next/image never
 *    reserves the wrong box.
 * 3. Every file under public/images is listed in docs/frontend/homepage-image-manifest.md (provenance and rights are
 *    written down for each asset).
 * 4. No inline <svg> in features/home: SVG is for icons (components/ui/icon) and the UI chrome, never for drawn product
 *    or lifestyle imagery.
 * 5. Every <Image …> element states an `alt` (an empty alt is a decision; a missing one is a defect).
 *
 * Usage: node scripts/check-assets.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = join(root, 'src');
const publicDir = join(root, 'public');
const manifestPath = join(root, '..', '..', 'docs', 'frontend', 'homepage-image-manifest.md');
const failures = [];
const rel = (p) => relative(root, p).replaceAll('\\', '/');

const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

/** Pixel size from the file header (PNG IHDR, JPEG SOFn). Returns null for anything else. */
function imageSize(file) {
  const buf = readFileSync(file);
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  return null;
}

const code = walk(src).filter((f) => ['.ts', '.tsx'].includes(extname(f)) && !/\.(test|generated)\./.test(f));

// 1. Referenced public images exist.
for (const file of code) {
  const text = readFileSync(file, 'utf8');
  for (const [, path] of text.matchAll(/['"`](\/images\/[A-Za-z0-9_./-]+\.(?:jpg|jpeg|png|webp|avif|svg))['"`]/g)) {
    if (!existsSync(join(publicDir, path))) failures.push(`${rel(file)}: references ${path}, which is not in public/`);
  }
}

// 2. Declared sizes match the files.
const libDir = join(src, 'features', 'home', 'lib');
for (const file of walk(libDir).filter((f) => f.endsWith('.ts') && !f.includes('.test.'))) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/src:\s*'(\/images\/[^']+)'\s*,\s*width:\s*(\d+)\s*,\s*height:\s*(\d+)/g)) {
    const path = join(publicDir, m[1]);
    if (!existsSync(path)) continue; // reported by check 1
    const size = imageSize(path);
    if (!size) failures.push(`${rel(file)}: cannot read the size of ${m[1]}`);
    else if (size.width !== Number(m[2]) || size.height !== Number(m[3])) {
      failures.push(`${rel(file)}: ${m[1]} is declared ${m[2]}×${m[3]} but the file is ${size.width}×${size.height}`);
    }
  }
}

// 3. Every public image is in the manifest.
const imagesDir = join(publicDir, 'images');
if (existsSync(imagesDir)) {
  const manifest = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : '';
  if (!manifest) failures.push('docs/frontend/homepage-image-manifest.md is missing');
  for (const file of walk(imagesDir)) {
    if (!manifest.includes(basename(file))) failures.push(`${rel(file)} is not listed in docs/frontend/homepage-image-manifest.md`);
  }
}

// 4. No inline SVG in the homepage feature.
for (const file of walk(join(src, 'features', 'home')).filter((f) => f.endsWith('.tsx'))) {
  if (/<svg[\s>]/.test(readFileSync(file, 'utf8'))) failures.push(`${rel(file)}: inline <svg> (use components/ui/icon for icons; photography for imagery)`);
}

// 5. <Image> always has alt.
for (const file of code.filter((f) => f.endsWith('.tsx'))) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/<Image\b[^>]*?(?:\/>|>)/gs)) {
    if (!/\balt=/.test(m[0])) failures.push(`${rel(file)}: <Image> without alt near "${m[0].slice(0, 60).replace(/\s+/g, ' ')}…"`);
  }
}

if (failures.length > 0) {
  console.error('Asset checks failed:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
console.log('✓ Asset checks passed (references, declared sizes, manifest coverage, no inline SVG imagery, image alt text)');
