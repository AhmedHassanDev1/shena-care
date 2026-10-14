# Business Workspace design system v0.1 (GLO-230)

Small foundation for the one Business app and its four role experiences (`/admin`, `/supplier`, `/hub`, `/driver`).
It is **not** a second storefront design system and not a component library: it holds only what the four
reference screens use. Status: **v0.1 — waiting for owner review** (gate for GLO-125).

## See it

`npm run dev -- -p 3020` in `apps/business`, then open:

| Route | Role · device | States (`?state=`) |
|---|---|---|
| `/design` | Foundations: colours, type, controls, status, bidi, empty/loading/error/forbidden, LTR sample | — |
| `/design/admin` | Admin · desktop — Attention Center + today's orders, detail drawer | `loading` `empty` `error` `forbidden` |
| `/design/supplier` | Supplier · mobile — PO confirmation: confirm-all, partial/zero qty, cost change, final confirm, receipt | `partial` `confirmed` `empty` `forbidden` |
| `/design/hub` | Hub · scanner station/tablet — one active order, scan, mismatch, pending vs server-confirmed, thermal label | `mismatch` `complete` `error` |
| `/design/driver` | Driver · mobile — assigned stop, package match, delivered + COD, failed attempt, custody ≠ settlement | `delivered` `failed` `empty` |

Every screen uses **synthetic data** (banner on top) and simulates server confirmation with a timer.
Nothing here calls the API; wiring happens in GLO-125 / GLO-108 / GLO-114 / GLO-83 / GLO-220.

## Files

- `design/tokens.css` — `bw-*` tokens (Tailwind v4 `@theme`), `.bw` base, focus ring, `.bw-code`, reduced motion.
- `components/bw/primitives.tsx` — Button, Code, Money, StatusLabel, Notice, PageHeader, Section, Field, Stepper,
  QueueRow, DataTable, Dialog (`dialog` / `drawer` / `sheet`), LabelPreview, StateBlock, Skeleton (+ lab-only helpers).
- `components/bw/workspace-frame.tsx` — the one navigation model: `desktop` (admin sidebar), `mobile`
  (supplier/driver top bar + bottom tabs), `task` (hub kohl bar with explicit exit).
- `lib/fonts.ts` — Alexandria + IBM Plex Sans Arabic (same as `apps/web`).
- `scripts/check-contrast.mjs` — `npm run check:contrast`.

## Rules

1. **One action colour** (malachite `bw-action`). Saffron/danger only for feedback, and feedback is always icon + words.
2. **Shape:** pressable → pill; card/section → 10px; input → 8px. Flat: hairline border, no shadow except sticky bars.
3. **Density by role:** controls 44px (`h-bw-control`) on desktop; 52px (`h-bw-touch`) for supplier, driver and hub.
4. **Logical CSS only** (`ms/me/ps/pe/start/end`); RTL is the default, the `/design` LTR block proves the same primitives flip.
5. **Bidi:** every code, barcode, SKU, phone, quantity, time and amount goes in `<Code>` / `<Money>` (bdi + LTR + tabular
   Western digits). Keep a whole fraction (`2/3`) or size (`100×150`) in **one** `<Code>`. Product names that may
   contain Latin (`SPF 50`) go in `<bdi>`.
6. **Pending ≠ confirmed:** a scan/confirmation shows a pending state until the server answers; completion and printing
   unlock only on server confirmation.
7. **Visibility is presentation, not security:** nav and content are role-scoped, but API role guards and object
   ownership stay the boundary. Supplier sees only its PO lines and its own offer cost (no selling price, margin,
   customer or other suppliers). Driver sees only stops on its assigned run.
8. Native `<dialog>` for dialog/drawer/sheet (focus trap, Esc, inert page). After submit, focus moves to the receipt.

## No-duplication map

| Need | Use | Not |
|---|---|---|
| Buttons, fields, status | `components/bw/primitives` | `components/ui/button`, `components/ui/input` (v0 shadcn, legacy console `app/page.tsx` only) |
| Colours, type | `bw-*` tokens | legacy navy vars in `app/globals.css` (legacy console only) |
| Storefront components | — | `apps/web` components are customer-facing (arch niches, product art); not imported here |

The legacy `/` console stays untouched until GLO-125 replaces it.

## Open questions (owner)

- Priority order between exception types on the Attention Center, and what counts as "urgent" per type.
- Can a supplier edit after confirming? PO response window (GAP-04).
- Driver: attempt limit / return policy (GLO-139), proof of delivery (photo/signature), COD difference tolerance.
- Hub: scanner sound/vibration on error; real thermal printer label size.
