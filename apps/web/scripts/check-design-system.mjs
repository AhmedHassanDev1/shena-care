#!/usr/bin/env node
/**
 * Design-system guardrails (no dependencies).
 *
 * 1. Contrast: resolves semantic tokens from src/styles/tokens.css and checks WCAG 2.x ratios.
 * 2. Hardcoded colors: fails on hex colors in TS/TSX under src/ (CSS files are reported, not failed).
 * 3. Direction: fails on physical left/right utilities in shared UI and the design lab.
 *
 * Usage: node scripts/check-design-system.mjs [--json]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = join(root, 'src');
const failures = [];
const report = { contrast: [], hex: [], direction: [], legacy: {} };

// ── 1. Contrast ──────────────────────────────────────────────────────────
const css = readFileSync(join(src, 'styles', 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const vars = {};
for (const [, name, value] of css.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
  // Last declaration wins, matching the cascade for the default theme. The :lang(ar) block only
  // redefines typography tokens, which are never resolved as colors.
  vars[name] = value.trim();
}

function resolve(name, seen = new Set()) {
  if (seen.has(name)) throw new Error(`Circular token: --${name}`);
  seen.add(name);
  const value = vars[name];
  if (value === undefined) throw new Error(`Unknown token: --${name}`);
  const ref = value.match(/^var\(--([a-z0-9-]+)\)$/);
  if (ref) return resolve(ref[1], seen);
  const channels = value.split(/\s+/).map(Number);
  if (channels.length !== 3 || channels.some((c) => Number.isNaN(c) || c < 0 || c > 255)) {
    throw new Error(`--${name} is not an RGB channel triple: "${value}"`);
  }
  return channels;
}

const luminance = (rgb) => {
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Same pair list the /design-lab contrast table renders. min: 4.5 text, 3 UI, null informational.
const { pairs } = JSON.parse(readFileSync(join(src, 'styles', 'contrast-pairs.json'), 'utf8'));
for (const { fg, bg, min, note } of pairs) {
  const ratio = contrast(resolve(fg), resolve(bg));
  const pass = min == null ? null : ratio >= min;
  report.contrast.push({ fg, bg, ratio: +ratio.toFixed(2), min, pass, note });
  if (pass === false) failures.push(`contrast ${fg} on ${bg}: ${ratio.toFixed(2)} < ${min}`);
}

// ── 2 & 3. Source scans ──────────────────────────────────────────────────
const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
const files = walk(src);
const rel = (p) => relative(root, p).replaceAll('\\', '/');

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
for (const file of files.filter((f) => ['.ts', '.tsx'].includes(extname(f)))) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    // Ignore URL fragments and HTML entities.
    for (const match of line.matchAll(HEX)) {
      const before = line.slice(Math.max(0, match.index - 1), match.index);
      if (before === '&' || /href|url/i.test(line)) continue;
      report.hex.push(`${rel(file)}:${i + 1} ${match[0]}`);
    }
  });
}
report.hex.forEach((h) => failures.push(`hardcoded color ${h}`));

// Raw Tailwind palette utilities (red-50, amber-700, bg-white…) bypass the semantic roles just like hex.
const RAW_PALETTE =
  /(?<![\w-])(?:[a-z0-9-]+:)*(?:bg|text|border|ring|from|via|to|fill|stroke|divide|outline|placeholder)-(?:(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}|white)(?![\w-])/g;
report.rawPalette = [];
for (const file of files.filter((f) => extname(f) === '.tsx' && !/design-lab/.test(f))) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    for (const match of line.matchAll(RAW_PALETTE)) report.rawPalette.push(`${rel(file)}:${i + 1} ${match[0]}`);
  });
}
report.rawPalette.forEach((h) => failures.push(`raw palette color ${h}`));

const PHYSICAL = /(?<![\w-])(?:[a-z0-9-]+:)*(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|text-left|text-right)(?:-[\w./[\]%-]+)?(?=[\s"'`])/g;
const strict = (f) => /src[\\/](components[\\/]ui|app[\\/]design-lab)[\\/]/.test(f);
for (const file of files.filter((f) => extname(f) === '.tsx')) {
  const text = readFileSync(file, 'utf8');
  const hits = [...text.matchAll(/className=(?:"[^"]*"|{`[^`]*`}|{cn\([\s\S]*?\)})|cva\([\s\S]*?\n\)/g)]
    .flatMap((m) => m[0].match(PHYSICAL) ?? [])
    // `rtl:` / `ltr:` scoped overrides are explicit direction handling, not a defect.
    .filter((cls) => !/(^|:)(rtl|ltr):/.test(cls));
  if (!hits.length) continue;
  if (strict(file)) {
    report.direction.push(`${rel(file)}: ${hits.join(', ')}`);
    failures.push(`physical direction in ${rel(file)}: ${hits.join(', ')}`);
  } else {
    report.legacy[rel(file)] = hits.length;
  }
}
const legacyCssHex = (readFileSync(join(src, 'app', 'globals.css'), 'utf8').match(HEX) ?? []).length;

// ── Output ───────────────────────────────────────────────────────────────
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ...report, legacyCssHex, failures }, null, 2));
} else {
  console.log('Contrast (WCAG 2.x)');
  for (const c of report.contrast) {
    const status = c.pass === null ? 'info' : c.pass ? 'pass' : 'FAIL';
    console.log(`  ${status.padEnd(4)}  ${c.ratio.toFixed(2).padStart(5)}:1  ${c.fg} on ${c.bg}${c.min ? ` (min ${c.min})` : ''}${c.note ? ` — ${c.note}` : ''}`);
  }
  console.log(`\nHardcoded hex colors in TS/TSX: ${report.hex.length}`);
  report.hex.forEach((h) => console.log(`  ${h}`));
  console.log(`Raw palette colors in TSX: ${report.rawPalette.length}`);
  report.rawPalette.forEach((h) => console.log(`  ${h}`));
  console.log(`Physical-direction classes in shared UI / design lab: ${report.direction.length}`);
  report.direction.forEach((d) => console.log(`  ${d}`));
  const legacyTotal = Object.values(report.legacy).reduce((a, b) => a + b, 0);
  console.log(`Legacy (reported, not failed): ${legacyTotal} physical-direction classes in ${Object.keys(report.legacy).length} feature files; ${legacyCssHex} hex literals in app/globals.css`);
  console.log(failures.length ? `\n✗ ${failures.length} failure(s)` : '\n✓ Design-system checks passed');
}
process.exit(failures.length ? 1 : 0);
