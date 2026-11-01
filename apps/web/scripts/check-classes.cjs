#!/usr/bin/env node
/**
 * Dead utility guardrail. Tailwind silently ignores a class whose token does not exist (text-night after the palette
 * moved to SAHEL V2 renders as inherited colour, bg-bottle as no fill), so a stale token name never fails the build.
 *
 * Extracts class candidates from src/**\/*.ts(x) with Tailwind's own extractor, keeps the ones that start with a
 * design utility prefix (colour, radius, shadow, type size, leading, duration), and fails on every candidate the
 * project's Tailwind config cannot generate.
 *
 * Usage: node scripts/check-classes.cjs
 */
const { readFileSync, readdirSync, statSync } = require('node:fs');
const { join, relative, extname } = require('node:path');

const resolveConfig = require('tailwindcss/resolveConfig');
const { loadConfig } = require('tailwindcss/lib/lib/load-config');
const { createContext } = require('tailwindcss/lib/lib/setupContextUtils');
const { generateRules } = require('tailwindcss/lib/lib/generateRules');
const { defaultExtractor } = require('tailwindcss/lib/lib/defaultExtractor');

const root = join(__dirname, '..');
const context = createContext(resolveConfig(loadConfig(join(root, 'tailwind.config.ts'))));
const extract = defaultExtractor(context);

const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

// Utilities whose value is a design token. Anything else (flex, grid, gap-4…) is out of scope.
const DESIGN = /^(?:[a-z0-9-]+:)*-?(?:bg|text|border(?:-[xyseblrt])?|ring|ring-offset|outline|fill|stroke|decoration|divide|placeholder|caret|accent|from|via|to|shadow|rounded(?:-[a-z]{1,2})?|leading|duration|font)-[a-z0-9]/;

// CSS property names that match the prefix pattern but are never classes, plus the component classes globals.css defines.
const globals = readFileSync(join(root, 'src', 'app', 'globals.css'), 'utf8');
const NOT_CLASSES = new Set([
  'font-size',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-width',
  ...[...globals.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((m) => m[1]),
]);

const dead = new Map();
for (const file of walk(join(root, 'src')).filter((f) => ['.ts', '.tsx'].includes(extname(f)) && !/\.(test|generated)\./.test(f))) {
  const text = readFileSync(file, 'utf8');
  for (const raw of new Set(extract(text))) {
    // The extractor keeps trailing punctuation from template literals and ternaries ("rounded-pill)").
    const candidate = raw.replace(/[),.;'"`]+$/, '');
    if (!DESIGN.test(candidate) || candidate.includes('[') || NOT_CLASSES.has(candidate)) continue;
    // Gradient stop positions (via-45%) lose their % in extraction.
    if (/(?:^|:)(?:from|via|to)-\d+$/.test(candidate) && text.includes(`${candidate}%`)) continue;
    if (generateRules(new Set([candidate]), context).length > 0) continue;
    // Element ids and htmlFor/aria targets are strings, not classes.
    if (new RegExp(`(?:id|htmlFor|aria-[a-z]+)=["'{]${candidate}["'}]`).test(text)) continue;
    const at = relative(root, file).replaceAll('\\', '/');
    dead.set(candidate, [...(dead.get(candidate) ?? []), at]);
  }
}

if (dead.size === 0) {
  console.log('check-classes: every design utility resolves to a token.');
  process.exit(0);
}
for (const [cls, files] of [...dead].sort()) console.error(`${cls}  ←  ${files.join(', ')}`);
console.error(`\ncheck-classes: ${dead.size} utilities resolve to no CSS (unknown token names).`);
process.exit(1);
