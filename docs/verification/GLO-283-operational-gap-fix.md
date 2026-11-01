# GLO-283 — Final Operational Gap Fix

## Scope and behavior

This follow-up supersedes the missing-pickup hard rejection described in the earlier Supplier PO hardening report. The existing Sourcing module, transactions, allocation policy, outbox and expedited procurement path are reused. No logistics subsystem, inventory workflow, endpoint, dependency or mandatory supplier setup was added.

- A missing `Supplier.pickupLeadMinutes` now uses an internal operational estimate. Defaults: `PROCUREMENT_ESTIMATED_PICKUP_LEAD_MINUTES=240`, `PROCUREMENT_PICKUP_UNCERTAINTY_MINUTES=120`. Both must be whole minutes in 1–10080; invalid configuration fails closed. The planning bound is their sum plus the existing supplier working-time response allowance.
- Within existing opening-time and reliability tiers, verified supplier leads rank before estimated leads. Existing comparable cost, reliability, freshness and stable-ID tie breakers remain. Closed suppliers remain deferred through existing scheduling.
- Recovery still enforces existing stock/availability, freshness, active supplier, price anomaly, currency, margin/cost ceiling, MOQ, order multiple, previously attempted offer and delivery deadline rules. An estimate that exceeds the existing delivery constraint is excluded with `DELIVERY_PROMISE`.
- The existing decision JSON records lead source, minutes, uncertainty, total planning minutes and `deliverySlaVerified: false`; reason codes also identify uncertainty. Even a verified supplier lead does not establish a verified end-to-end delivery SLA. No customer delivery promise or commercial order snapshot is rewritten.
- The Business Workspace supplier help text explains the conservative estimate and explicitly says it is not a guaranteed delivery time.
- Existing confirmed allocations stay committed. Newly confirmed stock is distributed by nearest delivery deadline, otherwise-ready orders, FIFO, then stable ID. The existing event/recovery flow immediately procures the shortage. New PostgreSQL HTTP tests prove this across two successive partial confirmations and a third supplier, including concurrent duplicate confirmations/flushes. No redundant allocation algorithm was introduced.
- If no safe candidate can satisfy the constraints, the existing operational action requirement is retained for Admin intervention.

## Database and data preservation

Verification uses disposable PostgreSQL 17 on `127.0.0.1:5434`, databases `glo283_operational_gap_test` and `glo283_operational_gap_full_test`. Both `DATABASE_URL` and `DIRECT_URL` are explicitly set to the same isolated `_test` database through the existing local test guard, with authentication bypass disabled. All 64 existing migrations applied successfully to fresh local databases.

The Prisma diff changes a comment only; functional schema comparison is identical. No new or pending task migration is necessary. This follow-up performs no Development/production database changes, reset, deletion or rollback. The previously authorized Development migration/backup work is documented in the earlier closure report.

After focused regression, all five SQL integrity checks returned zero: overconfirmed allocations, overcommitted requirements, competing pending requirements, expired-PO pending allocations and broken aggregated-line quantities. The new recovery test also verifies exact preservation of existing allocation lineage, customer promised dates and item commercial snapshots.

## Verification

Evidence is retained locally under `output/glo-283-operational-gap/`; reports do not contain database credentials or customer data.

- Red/green: missing-lead policy and ranking tests failed against the old implementation, then passed after the change.
- GLO-283 PostgreSQL HTTP regression: **15/15**, 1 suite, exit 0 (34.322 s).
- Focused cross-domain regression: **119/119**, 17 suites, exit 0 (122.333 s), including supplier PO batching, lineage, partial allocation, scheduling, engagement, availability, supply plan and architecture.
- API build and typecheck: exit 0. Business Workspace production build and scoped lint: exit 0.
- Scoped API lint: exit 1, **one pre-existing** `no-explicit-any` in `ranking.service.spec.ts:18`; the equivalent HEAD files also produce exactly one error. Changed production files and new tests introduce no lint errors.
- Full API regression: **1094 passed / 12 failed / 1106 total**, 120 passed / 7 failed / 127 suites, exit 1 (464.893 s). Seven failed assertion names exactly match the prior pre-change baseline: four public discovery/detail expectations, stale selected variant readiness, provisional availability pricing expectation and the live Mapbox network smoke test.
- Investigated all five additional failures. Four ingestion scale/concurrency assertions passed on a quiet targeted rerun without code changes; the initial log records expired 5-second ingestion transactions during simultaneous build/graph work. The three affected suites rerun produced **12 passed / 1 failed / 13 total**, exit 1 (82.192 s). The remaining availability-expiry assertion compares a persisted deadline with a later moving clock (22 ms behind in the full run). A separate archived, unchanged `bdc5773` API source checkout on a fresh isolated database reproduces the exact same failing assertion: **3 passed / 1 failed**, exit 1 (9.099 s). No tests/timeouts or unrelated ingestion/ordering implementation were altered. The full repository suite is therefore not green; eight baseline failures remain, and four initial failures passed on rerun.
- Graph update: exit 0. Optional SQL extraction is unavailable because `tree_sitter_sql` is not installed; the source-code graph updated successfully.
- Task diff whitespace check: exit 0. Nine configured secret values checked against task paths with no matches. Schema comparison confirms comment-only change. Existing unrelated staged storefront work is protected by a saved diff hash.

The existing package-manager launcher has a certificate/preparation issue; checks use installed local Jest, Nest, TypeScript, ESLint and Next executables without reinstalling dependencies or changing lockfiles. GitHub API inspection uses the operating system certificate store and verifies no repository webhooks or deployments; the sole checked workflow runs on main/PR-to-main/schedule, not this feature-branch push.

## Security assessment

Security impact: changes automatic supplier recovery eligibility, retaining commercial and delivery safety gates.

Trust boundary: internal operational estimate is auditable planning input, never a customer promise or supplier-provided authorization claim.

Authorization rule: existing Admin/supplier ownership checks and owner-controlled mutations remain unchanged; no endpoint added.

Sensitive data involved: internal supplier costs and order allocations remain in existing internal records; no new public exposure.

Abuse cases considered: repeated/conflicting confirmations, concurrent recovery flushes, duplicate procurement, overcommitment, unsafe delivery estimate and commercial constraint bypass.

Security tests added: HTTP concurrency and duplicate-procurement assertions, immutable prior commitment/customer snapshot assertions, and delivery/commercial/configuration fail-closed tests; existing authorization regressions included in focused tests.

Remaining risk: estimates are operational assumptions rather than verified end-to-end SLA evidence; configured bounds require operational calibration. The eight baseline full-regression failures and the initial resource-sensitive ingestion failures prevent claiming a clean full-suite result. No unresolved new Supplier Fallback failure was found.

## Delivery

Task paths: procurement configuration/policy/ranking, their unit and GLO-283 HTTP tests, the Prisma field comment, Business Workspace supplier help copy, and this report. Unrelated storefront, launch configuration and migration-lock edits remain excluded.

Commit SHA and confirmed remote result are supplied separately in the task handoff. No main merge, force push or production deployment is authorized or performed.
