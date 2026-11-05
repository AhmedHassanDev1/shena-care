# Business design foundation — Admin dark context

The active Admin foundation is scoped to `apps/business`. The Storefront is independent and is never imported here. The visual direction uses the [Geist design system](https://vercel.com/geist/introduction) for operational clarity, contrast, and restraint. The user-provided dark dashboard reference sets the palette: charcoal layers, quiet gray borders, white primary actions, and Arabic type. It does not install a Geist component package.

## Source and scope

- `design/tokens.css` defines the existing `bw-*` semantic scale and the refined dark `.bw-admin` context. `design/admin.css` styles the Admin shell. `RoleShell` applies `.bw-admin` only for the Admin role.
- `app/globals.css` still holds legacy console selectors. Their dark styles are not the foundation for new Admin surfaces. `design/glow.css`, the supplier, hub, driver, login, print, and old `/design/*` experiences are separate contexts.
- All new Admin UI imports controls from `@/components/bw/primitives`. `components/ui` is low-level shadcn scaffolding and is not an alternate Admin component API. Do not add page-local colors or another theme provider.
- `/design-system` is a development-only Admin component showcase, excluded from production routing and navigation.

## Tokens and interaction rules

The Admin context maps `bw-page` to a deep charcoal canvas, `bw-surface` to a raised graphite surface, `bw-sunken` to a quiet inset surface, `bw-ink*` to text hierarchy, and `bw-line*` to boundaries. `bw-action*` is off-white, with dark text on the filled action. There is no green Admin accent. `bw-ok|warn|danger|info` are semantic states with text and icons; success stays neutral, while warning and danger retain restrained alert color. Use `font-bw-display` for headings and `font-bw-text` for content; Alexandria and IBM Plex Sans Arabic support Arabic and Latin. Keep Western digits and codes in `<Code>` or `<bdi>`.

Use `h-bw-control` (44px) and `h-bw-touch` (52px), `gap-bw-section`, `p-bw-page`, `rounded-bw-field`, `rounded-bw-card`, `rounded-bw-pill`, and `shadow-bw-card|overlay`. Admin cards use a border and restrained shadow. At narrow widths, stack content and retain the mobile navigation; at `lg` the sidebar becomes persistent. Use logical spacing and positioning for RTL/LTR. Limit transitions to the fast/normal scale and respect reduced motion.

Controls provide visible keyboard focus, hover feedback, disabled styling, error text, pending state, empty state, and loading skeletons. Dialog and drawer use native `<dialog>` focus and Escape behavior. `Tabs` uses tab roles and arrow/Home/End keyboard selection. Search, select, checkbox, and switch use native controls and labels. The source of truth for colors and contrast checks is `design/tokens.css`; `scripts/check-contrast.mjs` checks both the established role palette and the Admin palette.

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

Existing Admin pages retain their current workflows and some page-local styling. The legacy `seven-*` styles, obsolete selectors in `globals.css`, and hardcoded colors in the shared `workspace-frame.tsx` and page implementations need targeted migration as each page is rebuilt. This foundation applies semantic charcoal tokens to shared components and isolates the Admin shell; it does not certify every legacy page as migrated. New pages should use only the canonical exports and semantic classes above.

Scope: `apps/business` only. The live `/admin`, `/hub`, `/supplier`, and `/driver` routes keep their API calls, authorization, and business rules. The storefront design system is independent.

## See and verify

- `npm run dev --workspace=my-project -- --port 3020` → `/design-system` in development. The route returns 404 in production. It shows component states, role shell variants, Arabic RTL, an English LTR sample, and responsive layouts with no operational records or commands.
- The earlier `/design/*` reference screens are also development-only. They are legacy design examples with synthetic workflows; use `/design-system` for v1 decisions.
- `npm run test --workspace=my-project`, `npm run check:contrast --workspace=my-project`, `npm run typecheck --workspace=my-project`, `npm run lint --workspace=my-project`, and `npm run build --workspace=my-project` are the Business package gates. The package scripts invoke its own Next.js and TypeScript versions in this mixed-version workspace.

## Tokens and component usage

`design/tokens.css` is the source of truth for `bw-*` surfaces, text, borders, action and state colours, type, spacing, radii, shadows, and motion. Existing Tailwind classes such as `bg-bw-surface`, `text-bw-ink`, and `h-bw-touch` now resolve to v1 values. `app/globals.css` maps the existing shadcn semantic aliases onto these values; the older console CSS remains scoped to its legacy selectors. Do not copy storefront tokens into Business.

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
