# GLO-285 — Admin ingestion policy UI restructuring

Verified on 2026-11-02. Branch `feat/c0-commerce-integration`, HEAD `91236b7e60fdb75d8dca7d8a0e0fa06f07956d5a`. No commit, push, deployment, migration or remote seed performed.

## Result

The working `/admin/ingestion-policy` page now uses four Arabic RTL tabs: **البراندات** (default), **التصنيفات**, **أسماء الموردين**, **الاستثناءات**. It reuses the Business Workspace shell, tokens, buttons, fields, native dialogs, status labels and error/loading patterns.

| Before | After |
| --- | --- |
| All canonical records exposed as dropdowns in one long form | Searchable allowlist rows, visible enable/disable switches, and an existing-canonical-brand search dialog |
| Reason field and preview machinery always present | One sticky review/save action appears only when a meaningful draft exists |
| Separate central and mapping saves could leave other edits behind | One review includes the draft's changes; alias-only drafts still use the existing mapping-only API |
| Category hierarchy controls in the primary view | Leaf lists grouped by actual taxonomy ancestry/name under Skincare/Haircare; unfamiliar categories remain in “تصنيفات أخرى” |
| Technical HOLD reasons and long repeated group lists | Arabic reasons, supplier/frequency/sample names, ten groups initially with “show more”, reusable mapping actions |
| History always occupies page space | Secondary accessible history dialog with reasons, timestamps and actor details |

Central selection and reusable name interpretation remain distinct. Name editors never modify ALLOW/DENY. Explicit brand/category DENY and parent DENY controls remain available under advanced disclosure. Category grouping is presentation only; it never changes IDs, taxonomy, inheritance or eligibility.

## Changed files for this UI task

- `apps/business/app/(workspace)/admin/ingestion-policy/page.tsx`: tabs, list controls, draft state, review/preview/activation, grouped rechecks, responsive sticky action and history access.
- `apps/business/app/(workspace)/admin/ingestion-policy/policy-editors.tsx`: canonical search, reusable brand/category alias and supplier category mapping dialogs, HOLD group rows and history dialog.
- `apps/business/lib/ingestion-policy.ts`: typed UI data, independent draft copies, meaningful change summaries and payload construction. No admission or SKU matching logic.
- `apps/business/scripts/ingestion-policy.test.mjs`: seven focused draft/payload/presentation tests using the installed TypeScript compiler and Node test runner.
- `apps/business/package.json`: runs those tests alongside the existing contrast check; adds `test:ingestion-policy`. No dependencies or lockfiles changed.
- This handoff document.

Pre-existing edits to `apps/api/src/main.ts` and `apps/business/lib/api.ts` remain untouched. The existing nullable-current-policy loading correction in the page is retained.

## Existing contracts preserved

- Reads: `/ingestion/eligibility`, `/options`, `/holds`, `/history`.
- Full draft: `POST /ingestion/eligibility/preview` with expected version, reason, rules, aliases and mappings.
- Names only: `POST /ingestion/eligibility/mappings/preview` without ALLOW/DENY fields.
- Activation: `POST /ingestion/eligibility/:id/approve` after server impact preview and explicit confirmation.
- Bulk recheck: `POST /ingestion/eligibility/holds/recheck`, retaining the pinned expected version and sequential bounded-batch continuation.

RBAC, collision validation, audit/versioning, immutable historical snapshots, stock freshness, ingestion hard vetoes and partial/full snapshot protections remain backend-owned and unchanged. Drafts cannot trigger rechecks. Changing a reason invalidates the displayed preview; modifying a draft requires another preview. Server errors remain visible and do not claim success.

## Verification

All database-backed checks used the independently verified local PostgreSQL 17.11 container `glo285-allowlist-test`, database `glo285_allowlist_test`, port bound to `127.0.0.1:55485`. Both `DATABASE_URL` and `DIRECT_URL` were explicitly set to that database. Browser verification used a separate API on 3003 and an isolated application copy on 3004; existing app servers were not stopped or reconfigured. Browser changes affected disposable fixture data only.

| Check | Measured result |
| --- | --- |
| `npm --prefix apps/business test` | Exit 0: **44/44** contrast checks and **7/7** draft/payload tests |
| Targeted ESLint: page, editors, helper, test | Exit 0, no findings |
| Isolated source TypeScript check | Exit 0 |
| Production Next build of current application source in isolated copy | Exit 0: compile, TypeScript and **35/35** static pages completed; no ignored build errors |
| API: `glo285-stock-freshness.spec.ts`, `ingestion-eligibility.e2e-spec.ts`, `ingestion-eligibility-operational.e2e-spec.ts` | Exit 0: **3 suites, 36/36 tests** |
| `git diff --check` | Exit 0 |

Exact API command: `npm --prefix apps/api test -- test/unit/glo285-stock-freshness.spec.ts test/integration/ingestion-eligibility.e2e-spec.ts test/integration/ingestion-eligibility-operational.e2e-spec.ts --no-cache` with the isolated database URLs, `TEST_BYPASS_AUTH=false`, and Mapbox tokens unset. This is a focused regression run, not the full API suite.

Browser flow verified against actual local backend responses:

1. Four tabs, Brands default, no save action on a clean page; one sticky action on draft changes.
2. Canonical-brand search/add to draft; disable/revert; cancel/discard without activation.
3. Category list switches and reusable category aliases, preserving pending brand alias changes between tabs.
4. Reason required before preview; impact values displayed; explicit activation only after preview. Reason edits invalidate confirmation.
5. Cross-brand alias collision returned HTTP 400 and remained unsaved. Corrected alias-only draft preview/activation returned 201; success refreshed the active version and removed the sticky action.
6. Reusable category mapping preserved the central allowlist. Group recheck after mapping an ambiguous label to an excluded category returned **0 ALLOW / 1 SKIP / 2 HOLD** for one affected file. No per-product or per-file approval queue was introduced.
7. Recheck disabled while unsaved edits exist. History displayed the actual activation reasons, versions, times and actor details.
8. RTL arrow-key tab movement updates selection and focus. Native dialogs support Escape and focus containment.
9. Layout inspected at **390×844, 768×1024, 1280×900**. No horizontal overflow. On mobile, sticky save sits above the Workspace bottom navigation (button bottom 731px in an 844px viewport), and the review dialog fits within the viewport.
10. Production-built page loaded authenticated, displayed all four tabs and no clean-state save action, with no browser console errors. Mobile overflow and sticky placement were checked again on the built page.

Local evidence: `.codex/qa-logs/glo285-ui-build.log`, `glo285-ui-business-tests.log`, `glo285-ui-api-regression.log`, `glo285-ui-lint-final.log`, `glo285-policy-desktop.png`, `glo285-policy-mobile.png`.

## Limits and deployment

- The original checkout's direct typecheck encountered malformed pre-existing generated `.next/dev/types/validator.ts`. A webpack dev-generated validator also rejected the unchanged named `AdminOverview` export. Neither generated cache nor unrelated route was edited. Source checking and the clean production build passed in the isolated copy.
- HOLD listing still uses the existing backend cap of 200 latest groups. The UI states that search covers loaded groups and exposes older loaded groups progressively. No backend pagination contract was added.
- An unrecognized taxonomy family stays in “other categories”; no categories or IDs were invented. The isolated fixture taxonomy had no Haircare leaves, so no fake Haircare records were displayed.
- No new browser automation dependency was installed. Interaction checks were performed through the real browser; unit/payload checks are repeatable via the Business test script. The whole API test suite and production data were not exercised.
- To deploy, build and release the Business application through the existing owner-controlled process. This UI task requires no schema change, migration, seed or backend deployment. No deployment has been performed.

**PASS for the scoped UI restructuring and focused verification.**
