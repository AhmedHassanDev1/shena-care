# Business design foundation — one dark system for Admin, Hub, Delivery and Supplier

The Business foundation is scoped to `apps/business`. The Storefront is independent and is never imported here. The visual direction follows the [Geist design system](https://vercel.com/geist/introduction) and the Vercel dark dashboard: near-black canvas, surfaces separated by contrast and hairline borders, off-white primary action, restrained state colours, minimal shadow, fast colour-only transitions. It is a design language, not a pixel clone, and it installs no component package.

## Source and scope

- `design/tokens.css` is the only palette. Every role (`admin`, `hub`, `supplier`, `driver`) inherits it from the `.bw` wrapper in `app/(workspace)/layout.tsx`; there is no per-role theme scope and no `.bw-admin` class. A role differs only in navigation and workflows (`components/bw/workspace-frame.tsx`).
- `app/globals.css` still holds legacy console selectors for old pages. Do not build new UI on them. `design/glow.css` and the old `/design/*` screens are separate, development-only contexts.
- New UI imports controls from `@/components/bw/primitives`. `components/ui` is low-level shadcn scaffolding and is not an alternate component API. Do not add page-local colours or another theme provider.
- `/design-system` is a development-only showcase of the primitives and of the shell for all four roles. It is excluded from production routing.

## Tokens and interaction rules

`bw-page` is the canvas (also the sidebar), `bw-surface` raises cards, `bw-sunken` marks hover, selection and inset areas, `bw-ink*` is the text hierarchy, `bw-line` is the hairline for cards, dividers and the shell, and `bw-line-field` keeps form controls at 3:1. `bw-action*` is off-white with dark text; there is no accent colour. `bw-ok|warn|danger|info` are semantic states always shown with an icon and words; success stays neutral. Use `font-bw-display` for headings and `font-bw-text` for content (Alexandria and IBM Plex Sans Arabic). Keep Western digits and codes in `<Code>` or `<bdi>`.

Use `h-bw-control` (44px) and `h-bw-touch` (52px), `gap-bw-section`, `p-bw-page`, `rounded-bw-field` (8px), `rounded-bw-card` (12px), `rounded-bw-pill`, and `shadow-bw-card|overlay`. No glows, gradients or glass blur. Interactive states change colour only (`transition-colors`, 120–200ms), and reduced motion is respected. Use logical spacing and positioning for RTL/LTR. At narrow widths content stacks and the bottom navigation appears; at `lg` the sidebar is persistent.

Controls provide visible keyboard focus, hover, disabled, error, pending, empty and loading states. Dialog and drawer use native `<dialog>` focus and Escape behavior. `Tabs` uses tab roles and arrow/Home/End selection. Search, select, checkbox and switch use native controls and labels. `scripts/check-contrast.mjs` checks every text, field-border and focus pair in `design/tokens.css` and fails if the shared primitives or the workspace frame contain raw palette values.

## Core components

| Need | Canonical export |
| --- | --- |
| Button | `Button` with primary, secondary, danger, ghost, onKohl variants |
| Input and search | `Field`, `Search` |
| Selection | `Select`, `Checkbox`, `Switch`, `Tabs` |
| Badge and feedback | `StatusLabel`, `Notice`, `Toast` |
| Card and layout | `Section` (also exported as `Card`), `PageHeader` |
| Dialog and drawer | `Dialog` with `variant="dialog"` or `variant="drawer"`, `useDialog` |
| Table | `DataTable` |
| Empty, error and loading | `StateBlock`, `Skeleton` |

## Migration boundary

Existing pages keep their workflows. Some supplier and admin pages still use a page-local green for success and active states (`#34d27b`, `emerald-*`) and a few legacy `seven-*` classes; `seven-card` now resolves to the shared tokens. Migrate those to `bw-*` tokens or `StatusLabel` when a page is next touched for product work; do not mass-rewrite them.

Scope: `apps/business` only. The live `/admin`, `/hub`, `/supplier`, and `/driver` routes keep their API calls, authorization, and business rules.

## See and verify

- `npm run dev --workspace=my-project -- --port 3020` → `/design-system` in development. The route returns 404 in production. It shows component states, role shell variants, Arabic RTL, an English LTR sample, and responsive layouts with no operational records or commands.
- The earlier `/design/*` reference screens are also development-only legacy examples; use `/design-system` for decisions.
- `npm run test --workspace=my-project`, `npm run check:contrast --workspace=my-project`, `npm run typecheck --workspace=my-project`, `npm run lint --workspace=my-project`, and `npm run build --workspace=my-project` are the Business package gates. The package scripts invoke its own Next.js and TypeScript versions in this mixed-version workspace.

## Tokens and component usage

`design/tokens.css` is the source of truth for `bw-*` surfaces, text, borders, action and state colours, type, spacing, radii, shadows, and motion. `app/globals.css` maps the existing shadcn semantic aliases onto these values; the older console CSS remains scoped to its legacy selectors. Do not copy storefront tokens into Business.

Use `components/bw/primitives.tsx` for the operational Button, Field, StatusLabel, Notice, Section, DataTable, Dialog, Code/Money, and loading/empty/error states. These APIs are already consumed by live pages. The two `components/ui` shadcn/Base UI files remain low-level scaffolding; avoid adding a second operational button or input API. Prefer native form controls and the existing native dialog unless an interaction needs more.

`components/workspace/role-shell.tsx` owns session and role gating through `lib/session.tsx`. `components/bw/workspace-frame.tsx` owns navigation and desktop, mobile, and task shells. Pass the real role, active nav ID, live count where available, and task exit href from the page. Navigation visibility is presentation; the API remains the authorization boundary. Never put fake counts or sample business entities in live pages.

Use Arabic `dir="rtl"`, logical spacing (`ms`, `me`, `ps`, `pe`, `start`, `end`), and `<Code>` for identifiers, phones, quantities, times, and English numerals. Use `<bdi>` for mixed Latin product names. Preserve the `52px` touch control for supplier, driver, and scanner tasks. Status must include words and an icon, never colour alone. Printing stays black on white.

## Migration pattern

1. Keep the route, hook, API payload, and permission gate as-is.
2. Compose the existing `RoleShell` and `bw` primitives. Replace page-local colours with semantic tokens when that page is touched for product work.
3. Verify loading, empty, error, forbidden, pending, and confirmed states. Do not turn a pending command into a success display before the API confirms it.
4. Check 375px, 768px, and desktop widths in RTL; keep LTR islands isolated; run the Business gates above.

## Remaining work

- Migrate page-local legacy styles gradually as each operational screen is updated. Do not mass-rewrite business pages in v1.
- Decide whether the older `/design/*` synthetic reference screens are still useful, then retire them separately.
- Add automated browser coverage for role navigation and viewport regressions once a Business UI test harness exists. No new dependency was added for v1.
