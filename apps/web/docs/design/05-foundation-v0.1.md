# Shena Care — Design System Foundation v0.1 (implementation log)

**Status:** Implemented on branch `feat/web-recovery-design-foundation`. Everything visual below is **PROPOSED** unless marked otherwise — see `03-design-foundations.md` and `04-design-review-rules.md` for the governing rules.

Review it live: run `npm run dev` in `apps/web` and open `/design-lab` (development only; returns 404 in production unless `DESIGN_LAB=enabled`).

## Where things live

| Concern | File |
|---|---|
| Primitive + semantic color tokens, radius, shadow, motion, leading | `src/styles/tokens.css` |
| Tailwind mapping of the tokens (colors, type scale, radius, shadow, z-index, motion) | `tailwind.config.ts` |
| Provisional app font | `src/lib/fonts.ts` |
| tailwind-merge awareness of the custom scales | `src/lib/utils.ts` |
| Shared primitives | `src/components/ui/*` |
| Contrast pairs (single source for CLI + lab) | `src/styles/contrast-pairs.json` |
| Guardrails: contrast, hex colors, physical direction | `scripts/check-design-system.mjs` → `npm run check:design` |
| Specimen lab | `src/app/design-lab/` |

## Rules for feature code

1. Use semantic classes only (`bg-primary`, `text-muted-foreground`, `border-input`…). No hex, no primitives (`--olive-700`) in features. `npm run check:design` fails on hex in TS/TSX.
2. `border` is for decorative dividers (below 3:1 by design); `input` is for interactive control boundaries (≥ 3:1).
3. Use the type tokens (`text-display`, `text-h1`–`text-h3`, `text-body-lg`, `text-body`, `text-support`, `text-caption`). Nothing below 13px. Line height comes from the token and is taller for Arabic automatically.
4. Radii: `rounded-sm` (4px) controls/badges, `rounded-md` (8px) buttons/cards/media, `rounded-lg` (12px) overlays. `rounded-full` only for step markers and avatars. Legacy `rounded-xl/2xl` resolve to 12px.
5. Direction: logical utilities only (`ms-/me-/ps-/pe-/start-/end-/text-start/border-s`). Mirror directional icons with the `rtl-mirror` class, **not** `rtl:` — the `rtl:` variant also fires inside a nested `dir="ltr"` region of an Arabic page. Keep phone numbers LTR and wrap Latin product names in `<bdi>`.
6. Overlays use `z-overlay` (100); sticky page chrome uses `z-chrome` (40) or lower.
7. Flat by default: separate with borders; `shadow-raised` / `shadow-overlay` only for things that float.
8. Error state on inputs = `aria-invalid` + `aria-describedby` to a visible message with an icon. Disabled = token colors, not opacity. `Button loading` keeps focus and blocks activation.

## Decisions taken in this implementation (all reversible)

| Decision | Status | Note |
|---|---|---|
| Olive Blush as development theme | PROPOSED / temporary | Neutrals are low-chroma warm grey (not beige); olive = primary, blush = sparing accent; success leans teal so it never reads as primary. All 31 required pairs pass WCAG AA. |
| IBM Plex Sans Arabic as provisional app font | PROPOSED | Chosen as the neutral default while Readex Pro and Alexandria are compared in the lab. One family covers Arabic + Latin; no Inter added. |
| `norya.*` Tailwind palette | Deprecated alias | Maps onto semantic roles so legacy screens follow the theme; migrate screen by screen, then delete. |
| Step sequence (`Steps`) | Built | Only for real backend sequences (e.g. `CUSTOMER_STAGES` order tracking). |

## Deferred (needs backend contracts or owner decisions)

- Reason note ("why this suits you"), routine role on products, product-fit indicators — no backend contract (GLO-183). Must not be inferred in the UI.
- Final palette, final fonts, logo/motif, digit system for Arabic (Arabic-Indic vs Latin — both shown in the lab), default locale (currently `en`), dark mode.

## Known legacy debt (reported by `npm run check:design`, not failed)

- `src/app/globals.css` still holds ~40 decorative hex literals (home hero gradients, per-concern pastel chips) and some 8–11px text — scheduled for the home/screen redesign.
- 17 physical-direction classes across 7 feature files; legacy screens still contain hardcoded English copy and mock data (home routines, `ProductCard` category→step mapping).
