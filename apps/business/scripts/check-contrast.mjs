// WCAG contrast guard for design/tokens.css (GLO-230). Text pairs need 4.5:1, field borders and focus 3:1.
// One palette serves Admin, Hub, Delivery and Supplier. Run: npm run check:contrast
import fs from 'node:fs'

const css = fs.readFileSync(new URL('../design/tokens.css', import.meta.url), 'utf8')
const tokens = Object.fromEntries([...css.matchAll(/--color-(bw-[\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]))

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

const text = (fg, ...bgs) => bgs.map((bg) => [fg, bg, 4.5])
const pairs = [
  ...text('bw-ink', 'bw-page', 'bw-sidebar', 'bw-surface', 'bw-sunken', 'bw-ok-soft', 'bw-warn-soft', 'bw-danger-soft', 'bw-info-soft', 'bw-action-soft'),
  ...text('bw-ink-soft', 'bw-page', 'bw-sidebar', 'bw-surface', 'bw-sunken'),
  ...text('bw-ink-subtle', 'bw-page', 'bw-sidebar', 'bw-surface', 'bw-sunken'),
  ...text('bw-on-action', 'bw-action', 'bw-action-hover', 'bw-danger'),
  ...text('bw-action', 'bw-surface', 'bw-page'),
  ...text('bw-action-ink', 'bw-action-soft', 'bw-surface'),
  ...text('bw-ok', 'bw-ok-soft', 'bw-surface'),
  ...text('bw-warn', 'bw-warn-soft', 'bw-surface'),
  ...text('bw-danger', 'bw-danger-soft', 'bw-surface'),
  ...text('bw-info', 'bw-info-soft', 'bw-surface'),
  ...text('bw-on-kohl', 'bw-kohl', 'bw-kohl-raised'),
  ...text('bw-on-kohl-soft', 'bw-kohl', 'bw-kohl-raised'),
  ...text('bw-on-kohl-action', 'bw-kohl', 'bw-kohl-raised'),
  ...text('bw-on-kohl-warn', 'bw-kohl', 'bw-kohl-raised'),
  ...text('bw-on-kohl-danger', 'bw-kohl', 'bw-kohl-raised'),
  ...text('bw-kohl', 'bw-on-kohl-action'),
  ['bw-line-field', 'bw-surface', 3],
  ['bw-line-field', 'bw-page', 3],
  ['bw-line-field', 'bw-sunken', 3],
  ['bw-focus', 'bw-surface', 3],
  ['bw-focus', 'bw-page', 3],
  ['bw-on-kohl-action', 'bw-kohl', 3],
]

let failed = 0
if (!tokens['bw-page'] || luminance(tokens['bw-page']) > 0.03) {
  console.error('FAIL bw-page must be a dark canvas')
  failed++
}
for (const [fg, bg, min] of pairs) {
  if (!tokens[fg] || !tokens[bg]) {
    console.error(`missing token: ${tokens[fg] ? bg : fg}`)
    failed++
    continue
  }
  const r = ratio(tokens[fg], tokens[bg])
  if (r < min) {
    console.error(`FAIL ${fg} on ${bg}: ${r.toFixed(2)} < ${min}`)
    failed++
  }
}
const total = pairs.length + 2
const primitives = fs.readFileSync(new URL('../components/bw/primitives.tsx', import.meta.url), 'utf8').split('export function LabelPreview')[0]
if (/#(?:[0-9a-f]{3,8})\b|\b(?:bg|text|border)-(?:black|white|slate|zinc|emerald|amber|red|blue)-|\bseven-card\b|border-white\//i.test(primitives)) {
  console.error('FAIL shared Business primitives contain raw palette or legacy surface styles')
  failed++
}
const frame = fs.readFileSync(new URL('../components/bw/workspace-frame.tsx', import.meta.url), 'utf8')
if (/#(?:[0-9a-f]{3,8})\b|\b(?:bg|text|border|from|to|ring)-(?:black|white|emerald)|white\/\[|shadow-\[0_/i.test(frame)) {
  console.error('FAIL the shared workspace frame contains raw palette values; use bw-* tokens')
  failed++
}
console.log(`${total + 2 - failed}/${total + 2} design foundation checks pass`)
process.exit(failed ? 1 : 0)
