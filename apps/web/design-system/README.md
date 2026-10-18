# SAHEL V2 — the storefront design system (`apps/web`)

SAHEL V18 is the storefront's **only** design system (approved package: `docs/design/sahel-v18/`). The previous
"Kohl & Malachite" system, its tokens, semantic-role layer, campaign palette, fonts, assets and components were removed;
there are no parallel themes, aliases or compatibility layers. Scope: `apps/web` only — never `apps/business`.

```
design-system/
  tokens.json       CANONICAL. Byte-identical copy of docs/design/sahel-v18/03-tokens/tokens.json (SAHEL V2).
  tokens.app.json   App values the canonical file lacks, each copied from the V18 package (handoff, addendum,
                    motion.json, non-token-colours.json, board inline styles): board-only colours pending design
                    confirmation, mobile display sizes, board type/leading/radius/spacing ramps, control sizes,
                    board shadows (nav, action, inset outlines), motion, breakpoints, z-index. Never redefines a
                    tokens.json name (the generator fails if it tries).
  tailwind-preset.ts Tailwind built from both files. Colours, radii, shadows, font sizes and line heights REPLACE
                    Tailwind's defaults, so raw palette classes (bg-white, text-red-600) do not exist here.
scripts/build-tokens.mjs  → src/styles/tokens.generated.css (custom properties) + design-scales.generated.ts (cn scales)
scripts/check-design-system.mjs  guardrails (below)
```

`npm run tokens` regenerates (also `predev` / `prebuild`); never edit the generated files.

## Vocabulary

- **Colour by SAHEL name:** `bg-bone` (page), `bg-linen` (cards, sheets, inputs), `bg-sand` (product tiles, muted),
  `bg-dune`, `text-night` / `text-ink-2` / `text-ink-3`, `border-line` (hairline) / `line-2` (controls), `bg-blue`
  (the only commerce action) / `blue-deep` / `blue-tint`, `coral` (campaign fields only), `saffron*` (Shina and "now"
  only), `ok` / `err` / `err-tint`. Board-only colours (`warn`, `ok-tint`, `white`, `blue-hover`, `blue-light`,
  `blue-dark`, `saffron-light`) are flagged in `tokens.app.json` as pending design confirmation.
- **Type:** `text-display-hero|display-1|display-2|display-3` (Beiruti; sizes step down below `lg`), `text-title`,
  `text-body`, `text-product-name`, `text-brand` (Latin caps, tracked), `text-price`, `text-label`, `text-campaign`
  (Instrument Serif italic, one Latin line per campaign). Other board sizes use the ramp: `text-13`, `leading-22`…
- **Radius:** `rounded-image` 12, `rounded-input` 14, `rounded-card` 20, `rounded-sheet` 28, `rounded-pill`; board ramp
  `rounded-4|6|8|10|16|18|22|24|32`.
- **Shadow:** `shadow-elevation-1|2|3` (one sun, umber, falls toward the reading end), `shadow-nav`, `shadow-action`,
  inset outlines `shadow-outline-night|control|hairline|ok|blue|err|verified|dune|warn|commerce`, `shadow-focus-field`.
- **Sizes:** `h-control-s|m|search|l` (44 / 48 / 50 / 56), `h-header-m` 56, `h-nav-h` 68, `max-w-container` 1200.
- **Motion:** `duration-fast|base|slow` (180/300/600), `ease-standard`. Reduced motion: fades only.
- **Breakpoint:** the boards draw 390 and 1440 only; the desktop layout starts at `lg` = 1024 (engineering decision,
  recorded in `tokens.app.json`).

## Rules

1. Values live only in `tokens.json` / `tokens.app.json`; no hex, raw palette classes, `lucide-react`, physical
   left/right, legacy names, or arbitrary `text-[…]` / `bg-[…]` / `rounded-[…]` / `shadow-[…]` / `font-[…]` /
   `leading-[…]` / `tracking-[…]` in TSX (enforced by `npm run check:design`).
2. Shape: pressable → pill; product image → the sand `ProductTile`; reading surface → card/sheet radius. Hairline
   outlines are inset shadows so states never change a box's size.
3. **Shutter Loading is the pending state of async buttons only** (`Button loading` / `AsyncButton`, `.sl` +
   `aria-busy`): never on cards, images, pages or infinite scroll, which keep skeletons and written status.
4. Shared components (`src/components/ui`, `src/features/shell`) are fixed centrally; pages only lay out.
5. RTL first: logical properties only, Latin runs isolated (`dir="ltr"` / `<bdi>`, `text-match-parent`), phone and OTP
   inputs LTR. Letter-spacing only on Latin caps.
6. **Digits:** the Arabic storefront shows prices, totals, quantities, counts and dates in Arabic-Indic digits via
   `src/lib/i18n/format.ts` (Intl `ar-EG`: «٣٬٣٢٠ ج.م», «١٨ أكتوبر ٢٠٢٦»); English uses Western digits ("EGP 3,320").
   Phone numbers, OTP codes, SKU codes, order and transaction references stay Western/LTR. Never replace digit
   characters by hand; API payloads and calculations never use display formatting.
7. Errors and success always carry words (and a dot or icon); colour never carries meaning alone.
8. Data integrity: never show a price, stock level, discount, rating, delivery date or claim the backend has not
   returned; «[..]» placeholders stay visible until real data exists.

## Fonts

Beiruti (display), IBM Plex Sans Arabic (text) and Instrument Serif (campaign) are self-hosted from `@fontsource`
(OFL-1.1), imported in `src/app/layout.tsx` under their own family names — no runtime or build-time Google Fonts request.

## Verify

```bash
npm run tokens:check    # generated files match tokens.json + tokens.app.json
npm run check:design    # WCAG pairs (src/styles/contrast-pairs.json) + hex / palette / icon / direction / legacy guardrails
npm run typecheck && npm run lint && npm test
```
