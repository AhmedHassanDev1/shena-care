#!/usr/bin/env node
/**
 * SAHEL design-system guardrails (no dependencies). SAHEL V18 is the storefront's only design system.
 *
 * 0. Sync: src/styles/tokens.generated.css and design-scales.generated.ts match design-system/tokens.json + tokens.app.json.
 * 1. Contrast: resolves tokens from the generated CSS and checks WCAG 2.x ratios (src/styles/contrast-pairs.json).
 * 2. Hardcoded colors: fails on hex colors / raw Tailwind palette classes in TS/TSX under src/.
 * 3. Direction: fails on physical left/right utilities anywhere in the storefront.
 * 4. One icon set: fails on lucide-react imports (components/ui/icon is the only icon source).
 * 5. One design system: fails on legacy "Kohl & Malachite" names (malachite, kohl, paper, henna, semantic roles such as
 *    bg-primary / text-muted-foreground, shape-arch…) and on arbitrary design values (text-[13px], bg-[#…], rounded-[…]).
 *
 * Usage: node scripts/check-design-system.mjs [--json]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = join(root, 'src');
const failures = [];
const report = { contrast: [], hex: [], rawPalette: [], direction: [], icons: [], legacy: [] };

// ── 0. Generated tokens are in sync ──────────────────────────────────────
const sync = spawnSync(process.execPath, [join(root, 'scripts', 'build-tokens.mjs'), '--check'], { encoding: 'utf8' });
if (sync.status !== 0) failures.push((sync.stderr || sync.stdout).trim());

// ── 1. Contrast ──────────────────────────────────────────────────────────
const css = readFileSync(join(src, 'styles', 'tokens.generated.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const vars = {};
for (const [, name, value] of css.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) vars[name] = value.trim();

function resolve(name, seen = new Set()) {
  if (seen.has(name)) throw new Error(`Circular token: --${name}`);
  seen.add(name);
  const value = vars[name];
  if (value === undefined) throw new Error(`Unknown token: --${name}`);
  const ref = value.match(/^var\(--([a-z0-9-]+)\)$/);
  if (ref) return resolve(ref[1], seen);
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (!hex) throw new Error(`--${name} is not a hex color: "${value}"`);
  return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));
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
const { pairs } = JSON.parse(readFileSync(join(src, 'styles', 'contrast-pairs.json'), 'utf8'));
for (const { fg, bg, min, note } of pairs) {
  const ratio = contrast(resolve(fg), resolve(bg));
  const pass = min == null ? null : ratio >= min;
  report.contrast.push({ fg, bg, ratio: +ratio.toFixed(2), min, pass, note });
  if (pass === false) failures.push(`contrast ${fg} on ${bg}: ${ratio.toFixed(2)} < ${min}`);
}

// ── Source scans ─────────────────────────────────────────────────────────
const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
const files = walk(src);
const rel = (p) => relative(root, p).replaceAll('\\', '/');
const code = files.filter((f) => ['.ts', '.tsx'].includes(extname(f)) && !f.endsWith('.generated.ts'));
const eachLine = (list, fn) => {
  for (const file of list) readFileSync(file, 'utf8').split('\n').forEach((line, i) => fn(line, `${rel(file)}:${i + 1}`));
};

// 2. Hex colors and raw palette utilities.
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
eachLine(code, (line, at) => {
  for (const match of line.matchAll(HEX)) {
    const before = line.slice(Math.max(0, match.index - 1), match.index);
    if (before === '&' || /href|url|#main-content/i.test(line)) continue;
    report.hex.push(`${at} ${match[0]}`);
  }
});
const RAW_PALETTE =
  /(?<![\w-])(?:[a-z0-9-]+:)*(?:bg|text|border|ring|from|via|to|fill|stroke|divide|outline|placeholder)-(?:(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}|black)(?![\w-])/g;
eachLine(code, (line, at) => {
  for (const match of line.matchAll(RAW_PALETTE)) report.rawPalette.push(`${at} ${match[0]}`);
});

// 3. Physical direction.
const PHYSICAL = /(?<![\w-])(?:[a-z0-9-]+:)*(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br|text-left|text-right)(?:-[\w./[\]%-]+)?(?=[\s"'`])/g;
for (const file of files.filter((f) => extname(f) === '.tsx')) {
  const text = readFileSync(file, 'utf8');
  const hits = [...text.matchAll(/className=(?:"[^"]*"|{`[^`]*`}|{cn\([\s\S]*?\)})|cva\([\s\S]*?\n\)/g)]
    .flatMap((m) => m[0].match(PHYSICAL) ?? [])
    .filter((cls) => !/(^|:)(rtl|ltr):/.test(cls));
  if (hits.length) report.direction.push(`${rel(file)}: ${hits.join(', ')}`);
}

// 4. One icon set.
for (const file of code) {
  if (/from\s+['"]lucide-react['"]/.test(readFileSync(file, 'utf8'))) report.icons.push(rel(file));
}

// 5. One design system: legacy names and arbitrary design values.
const LEGACY_TOKEN =
  /(?<![\w-])(?:[a-z0-9-]+:)*(?:bg|text|border|ring|ring-offset|from|via|to|fill|stroke|outline|shadow|rounded|h|w|size|min-h|z|duration|ease|decoration|placeholder|caret|accent)-(?:malachite[\w-]*|kohl[\w-]*|paper[\w-]*|henna[\w-]*|bone[\w-]*|night[\w-]*|bottle[\w-]*|saffron[\w-]*|coral[\w-]*|err-tint|sand-deep|ink-soft|ink-subtle|ink-disabled|on-[a-z-]+|primary[\w-]*|secondary[\w-]*|muted[\w-]*|foreground|background|card-foreground|popover[\w-]*|destructive[\w-]*|success[\w-]*|warning[\w-]*|info[\w-]*|attention[\w-]*|guide[\w-]*|atm-[\w-]+|rose[\w-]*|peach[\w-]*|lilac[\w-]*|float|control-[sml]-legacy|bottom-nav-h|quick|settle|chrome|display-xl|display-l|display-m|heading|body-l|body-s|caption|price-l|h1|h2|h3|support|body-lg|xs|sm|md|lg|xl|2xl|3xl|input-legacy)(?![\w-])/g;
const LEGACY_CLASS = /(?<![\w-])(?:shape-arch(?:-l)?|stretched-link|on-kohl|t-(?:display|title|heading|body|label|caption|price)[\w-]*)(?![\w-])/g;
const ARBITRARY = /(?<![\w-])(?:[a-z0-9-]+:)*(?:text|bg|border|rounded|shadow|font|leading|tracking|from|via|to|fill|stroke)-\[[^\]]+\]/g;
eachLine(code, (line, at) => {
  for (const re of [LEGACY_TOKEN, LEGACY_CLASS, ARBITRARY]) {
    for (const match of line.matchAll(re)) report.legacy.push(`${at} ${match[0]}`);
  }
});
for (const file of files.filter((f) => extname(f) === '.css' && !f.endsWith('tokens.generated.css'))) {
  for (const m of readFileSync(file, 'utf8').matchAll(/var\(--([a-z0-9-]+)/g)) {
    if (!(m[1] in vars) && !/^(font-|tw-|sheet-from)/.test(m[1])) report.legacy.push(`${rel(file)} var(--${m[1]}) is not a SAHEL token`);
  }
}

report.hex.forEach((h) => failures.push(`hardcoded color ${h}`));
report.rawPalette.forEach((h) => failures.push(`raw palette color ${h}`));
report.direction.forEach((d) => failures.push(`physical direction in ${d}`));
report.icons.forEach((d) => failures.push(`lucide-react import in ${d} (use components/ui/icon)`));
report.legacy.forEach((d) => failures.push(`non-SAHEL design value ${d}`));

// ── Output ───────────────────────────────────────────────────────────────
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ...report, failures }, null, 2));
} else {
  console.log('Contrast (WCAG 2.x)');
  for (const c of report.contrast) {
    const status = c.pass === null ? 'info' : c.pass ? 'pass' : 'FAIL';
    console.log(`  ${status.padEnd(4)}  ${c.ratio.toFixed(2).padStart(5)}:1  ${c.fg} on ${c.bg}${c.min ? ` (min ${c.min})` : ''}${c.note ? ` — ${c.note}` : ''}`);
  }
  const section = (title, list) => {
    console.log(`${title}: ${list.length}`);
    list.slice(0, 60).forEach((h) => console.log(`  ${h}`));
    if (list.length > 60) console.log(`  … ${list.length - 60} more`);
  };
  section('\nHardcoded hex colors in TS/TSX', report.hex);
  section('Raw palette colors', report.rawPalette);
  section('Icon-library imports outside components/ui/icon', report.icons);
  section('Physical-direction classes', report.direction);
  section('Legacy design-system names or arbitrary design values', report.legacy);
  console.log(failures.length ? `\n✗ ${failures.length} failure(s)` : '\n✓ SAHEL design-system checks passed');
}
process.exit(failures.length ? 1 : 0);
