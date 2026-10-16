# Business Design System v1 — Antigravity handoff

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
