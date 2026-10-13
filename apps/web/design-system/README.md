# ShinaCare design system — integration in `apps/web`

Direction: **Kohl & Malachite** (limestone `paper`, kohl `ink`, one green for action; pills you press, arches you look at, rectangles you read). Status of the supplied package: *draft for review* — values here are the supplied ones, unmodified.

```
design-system/
  tokens.json           CANONICAL values (verbatim from the supplied package: colors, type, spacing, radius, shadow, layout, size, motion, z-index)
  roles.json            NO values — maps app semantic roles (bg-primary, text-muted-foreground…) and legacy scale names onto tokens
  tailwind-preset.ts    builds Tailwind colors/radii/shadows/type/screens/sizes from the NAMES in the two files above
scripts/build-tokens.mjs        tokens.json + roles.json → src/styles/tokens.generated.css, src/styles/design-scales.generated.ts
src/styles/tokens.generated.css GENERATED, committed. CSS custom properties (--malachite, --malachite-rgb, --space-4…) + t-* type classes
src/styles/design-scales.generated.ts GENERATED. Class-name scales so `cn()` (tailwind-merge) understands token utilities
src/components/ui/              shared components (Button, Input/Field/PhoneField, OtpInput, SearchField, Icon, Wordmark, …)
src/components/navigation/      BottomNav, WordmarkLink
```

## Flow

`tokens.json` → `npm run tokens` → generated CSS (+ scales) → Tailwind utilities → shared components → pages.
`predev` and `prebuild` regenerate automatically; `npm run check:design` fails if the generated files are stale.

## Rules

1. **Values live only in `tokens.json`.** Never edit generated files; never write hex, raw palette classes (`bg-white`, `text-rose-600`) or arbitrary px for design values in TSX.
2. **Use the semantic names.** Color: `bg-background|card|sand`, `text-foreground|ink-soft|ink-subtle|muted-foreground`, `bg-primary text-primary-foreground`, `border-border|input`, danger/success/attention via `-subtle` + text pairs. Type: `text-display-xl|l|m`, `text-title`, `text-heading`, `text-body-l|body|body-s`, `text-label`, `text-caption`, `text-price(-l)` (legacy `text-h1|h2|h3|support|body-lg` still resolve). Radius: `rounded-xs` (badges), `rounded-sm` (inputs, content cards), `rounded-md` (routine cards, notices), `rounded-lg` (sheets, auth panel), `rounded-pill` (anything pressable), `shape-arch` / `shape-arch-l` (product niches). *(`rounded-s`/`rounded-l` are Tailwind's side-corner utilities, which is why the DS radii s/m/l are exposed as sm/md/lg.)* Controls: `h-control-s|m|l` (36/44/52); nothing tappable under `control-m`.
3. **Shape rule:** pressable → pill, product image → arch niche (`ProductNiche`), reading → rectangle. Flat by default: hairline `border-border`, no shadow except `shadow-float` (nav, sticky bars) and `shadow-sheet`.
4. **Logical CSS only** (`ms-*`, `ps-*`, `start-*`, `border-s`, `text-start`). Phone numbers, OTP boxes and Latin codes are isolated LTR (`dir="ltr"`, `PhoneField`, `OtpInput`); wrap numbers/Latin runs in `<bdi>`. Numbers use Western digits (`formatNumber`, `formatEgp`).
5. **One icon set:** `components/ui/icon` (36 DS icons). No `lucide-react`. Forward/back, never left/right (directional icons mirror under `dir="ltr"`).
6. **Brand only through `Wordmark`/`WordmarkLink`.** `ProductArt` is a decorative placeholder, never shown as a customer's product.
7. **Colour never carries meaning alone:** errors have the alert icon + words (`FieldMessage`, `Alert`), selected/active states change weight or shape too. Henna is offers/cart count only; never errors.
8. **Do not restyle a shared component from a page.** Fix it in `src/components/ui` (or add a variant) so every consumer changes together. Page-level classes are for layout (grid, spacing, order), not for re-skinning.
9. **New token / colour:** add to `tokens.json` (with `-soft`/`on-` partners, contrast checked), add a pair to `src/styles/contrast-pairs.json`, run `npm run tokens`.

## Verify

```bash
npm run tokens:check    # generated files match tokens.json
npm run check:design    # contrast pairs (WCAG), no hex / raw palette / lucide / physical left-right in ui, navigation, layout, Home, Auth
npm run typecheck && npm run lint && npm test
npm run check:ui-reset  # route contract (starts its own dev server)
```
