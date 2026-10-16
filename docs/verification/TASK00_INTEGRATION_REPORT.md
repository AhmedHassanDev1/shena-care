# Task 00 — Unified Commerce Integration Report (2026-10-16)

**Gate: DONE.** This is the integration candidate. Two owner decisions about package-manager policy stay open (B1, B2). Neither stops a build, test or boot.

## 1. Git state

| Ref | SHA | Relation |
|---|---|---|
| `main` = `origin/main` | `2deda92` | C1 backend (`23b274f`) + 1 commit; ancestor of everything below |
| `feat/c0-commerce-integration` | `ffe3055` | main + W1…W6 + C0 checkpoint (7 commits) |
| `codex/admin-overview` | `6235a1c` | c0 + 2 (Admin Overview console, dev-only demo data) |
| `feat/business-auth` | `b43a343` | admin-overview + 1 (Business email/phone sign-in) |
| **`integration/task-00-commerce`** | `b43a343` + repair commit + this report | **candidate**, worktree `C:/Users/Administrator/Desktop/shena-care-wt/integration-task00` |

- The three unmerged commits are a straight line on top of `ffe3055`, so the candidate is a **fast-forward**: no merges, no conflicts, no rewrites.
- All other local branches (`feat/w1-storefront-checkout`, `feat/web-recovery-design-foundation`, `feat/cloudinary-integration`, `feat/shenacare-backend-mvp-closure`, `feature/glo118-care-final`, `fix/glo-187-and-glo-117`, the detached worktrees `944a3cc` and `ffe3055`) are already ancestors of the candidate. No stashes.
- **Protected, untouched work:** main checkout (`feat/c0-commerce-integration`) has uncommitted `.claude/launch.json` (preview configs) and `apps/api/src/main.ts` (CORS default origins 3000/3001/3002), plus ~120 untracked `apps/api/uploads/**` test artefacts. The `admin-overview` and `business-auth` worktrees each hold untracked `apps/business/{AGENTS,CLAUDE}.md` (Next scaffold agent rules) and `next-env.d.ts`, and `business-auth` also holds uploads. None of this is Commerce work, and none of it was touched.
- Nothing was pushed or merged into `main`.

## 2. Implemented vs missing (evidence from code, API suites and boot smoke)

| Area | Status | Evidence |
|---|---|---|
| Product / SKU retrieval | ✅ | smoke: `/products`, `/products/discovery`, `/products/:slug/detail` 200 |
| Cart persistence | ✅ | guest cart add → `x-cart-token` → `GET /ordering/cart` returns the line |
| Backend-authoritative quote | ✅ | `POST /ordering/checkout/quote` 201, `quoteVersion` echoed on checkout |
| Mandatory confirmed pin + written address | ✅ | checkout without `locationConfirmed` → 400; with pin → 201 |
| COD order submission | ✅ | `ORD-…` placed, status `placed`, COD |
| Order tracking | ✅ | guest tracking 200 with access token, 401 without |
| Business auth + server-enforced roles | ✅ | 4 roles log in; anon 401; supplier→admin, driver→PO, hub→payables, supplier→driver runs all 403; staff OTP routes present (dev/test transport only) |
| Admin operational queues | ✅ | `/operations/queues/attention`, KPIs, `/admin/orders` (sees the smoke order), POs, payables, settlements 200 |
| Supplier PO confirmation | ✅ API | supplier PO list 200; confirm/partial/ready covered by API suites + C0 W3 walkthrough |
| Hub receiving / preparation | ✅ API | hub-scoped receivables, shipments, eligible, runs, cash 200; flows covered by suites |
| Shipment identity / barcode | ✅ API | suites for barcode alias (glo242) and scan idempotency; **printer/scanner hardware not verified** |
| Driver runs / outcomes | ✅ API | driver runs + history 200; outcomes covered by c2c suites |
| COD collection / reconciliation | ✅ API | settlements collections/batches 200; c2c suites |
| Static contract alignment | ✅ | all 47 Business and all storefront API call paths match a backend controller route |
| Dev fixtures isolated | ✅ | Admin demo data only with `NEXT_PUBLIC_ADMIN_OVERVIEW_SOURCE=mock` outside production. The production bundle's executable JS has no fixture strings; they appear only in server source maps. |

## 3. Integration changes

Commit `eff51e0 fix(build): …`. No product code was changed.
- `pnpm-lock.yaml`: was stale since 2026-10-07 (missing `cloudinary`), so `pnpm install --frozen-lockfile` refused to install. Regenerated with `--lockfile-only`.
- `pnpm-workspace.yaml`: added `packageExtensions` so `next@14` gets an optional peer `@types/react`. Under pnpm, apps/web had picked up apps/business's React 19 types and `next build` failed.
- `apps/web/package.json` + `package-lock.json`: declared `jest`, `ts-jest`, `@types/jest`. They were only reachable through npm hoisting from apps/api.

## 4. Verification

The disposable cluster was `initdb` in the session scratchpad on `127.0.0.1:55462`. DBs `shenacare_test` and `shenacare_boot_test`. It was stopped afterwards. Neon and `.env` were never used.

| Command | Result |
|---|---|
| `pnpm install --lockfile-only` → `pnpm install --frozen-lockfile` | installs; **exit 1** `ERR_PNPM_IGNORED_BUILDS` (B1) |
| `prisma validate` / `generate` / `migrate deploy` (43 migrations) | pass |
| `prisma migrate diff` DB→schema | only the known `care.routine_proposals` drift (`currency`, `updated_at`) |
| api `typecheck` / `build` | pass / pass |
| api `lint` | fail: 266 errors = 265 baseline + 1 new (`no-var-requires` in new `staff-auth.e2e-spec.ts`, same pattern as baseline specs) |
| api `jest --runInBand --forceExit` | **74/74 suites, 519/519 tests, 0 skipped** |
| web `typecheck` / `lint` / `test` / `build` | before repair: 200 TS errors, jest missing, build fail → after: pass / pass / 52/52 / pass |
| web `tokens:check` / `check:design` | fail on a fresh Windows checkout (CRLF), pass after `npm run tokens` (B4) |
| business `typecheck` / `test` / `build` | pass / 22/22 / pass (23 routes) |
| boot smoke (`node dist/main`, `next start` ×2, NODE_ENV=development) | **51/51** |

## 5. System startup

- **API** (`apps/api`, `node dist/main`, :3001). Needs `DATABASE_URL`, `SHIPMENT_LABEL_SECRET`, `DELIVERY_FEE_EGP`, and `FRONTEND_URL` (comma list; CORS was verified for both frontends). `/api/health` 200.
- **Storefront** (`apps/web`, Next 14, :3102). `NEXT_PUBLIC_API_URL` is baked in at build time. `/`, `/products`, `/cart`, `/checkout`, `/orders`, `/auth` return 200.
- **Business** (`apps/business`, Next 16, :3103). `NEXT_PUBLIC_API_URL` is baked in at build time. `/login`, `/admin`, `/supplier`, `/hub`, `/driver` return 200. Session comes from `/workspace/me`.
- The AI service (FastAPI) is out of scope and was not started.

## 6. Blockers and owner decisions

| # | Severity | Issue | Decision needed |
|---|---|---|---|
| B1 | Medium | pnpm 12 exits 1 on install because build scripts are unapproved (`@prisma/*`, `prisma`, `bcrypt`, `@nestjs/core`, `unrs-resolver`). The install itself completes; bcrypt loads and `prisma generate` is run explicitly. | Approve or deny with `pnpm approve-builds` (supply-chain policy) |
| B2 | Medium | Two package managers: `package-lock.json` (npm, maintained, used by CLAUDE.md and C0/C1 evidence) and `pnpm-lock.yaml` (was stale). `apps/business/pnpm-workspace.yaml` settings are ignored inside the root workspace. | Choose one package manager of record and remove the other lock |
| B3 | Medium (deploy only) | Unique indexes on existing tables from C1 migrations, already on `main`: `sourcing.supplier_payables(purchase_order_id)` and partial `fulfillment.delivery_stops(shipment_id) WHERE status='active'`. | Run a duplicate preflight before `migrate deploy` on any DB holding data |
| B4 | Low | `core.autocrlf=true` makes the generated token files CRLF, so `tokens:check` fails until regenerated. | Optional `.gitattributes eol=lf` for `*.generated.*` |
| B5 | Low | `apps/business/next.config` sets `typescript.ignoreBuildErrors: true`, so the build does not typecheck. Separate `typecheck` passes. | Keep or remove |
| — | External | Thermal printer and Code128 scanning, SMS provider (staff and customer OTP fail closed outside dev/test), delivery-fee and variance policies (from the C0 state doc). | Owner |

## 7. Next executable task

Run the browser-driven Storefront → Admin → Supplier → Hub → Driver → COD acceptance on **this candidate** (`integration/task-00-commerce` at the report commit). Use a fresh disposable DB: `migrate deploy` + `npm run seed` + `npm run staff:provision` for the 4 roles. Build the frontends with `NEXT_PUBLIC_API_URL` pointing at the API, and set `FRONTEND_URL` to both frontend origins. Start from a storefront COD order with a confirmed pin and carry it through PO flush → supplier confirm → hub receive/prepare/pack/dispatch → driver deliver → cashier settlement.
