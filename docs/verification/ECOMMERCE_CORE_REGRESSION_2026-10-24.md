# E-commerce Core — DB-backed regression on local Docker PostgreSQL (2026-10-24)

Branch `feat/c0-commerce-integration`. Target: `docker compose up -d --wait postgres-test` →
`127.0.0.1:5434/shenacare_test` (postgres:17-alpine, tmpfs, disposable). `prisma migrate deploy` applied 57/57 migrations
through `apps/api/scripts/isolated-test-env.cjs` (refuses non-local or non-`_test` targets). The repo `_test` guard
(`test/test-database-guard.ts`) is unchanged. The shared Supabase dev DB (`postgres`) was never written by this run.

Command (from `apps/api`): `node scripts/isolated-test-env.cjs npx jest --runInBand --forceExit`

| Run | Suites | Tests | Time |
|---|---|---|---|
| 1 (before fixes) | 97 pass / 15 fail | 963 pass / 37 fail / 1 skip | 754 s |
| 2 | 111 pass / 1 fail (hook timeout) | 1000 pass / 0 fail / 1 skip | 518 s |
| 3 (final, jest testTimeout 15 s → 30 s) | **112 pass / 0 fail** | **1000 pass / 0 fail / 1 skip** | 600 s |

Skipped: `route-optimization` live Mapbox smoke (needs `MAPBOX_ACCESS_TOKEN`; not run).

## Root causes of the 15 failing suites — all obsolete fixtures; no application defect found
- Availability policy (76c9a63): only supplier-CONFIRMED offers are orderable → `availability-resolution` offers need `lastConfirmedAt`.
- Ranking policy (87f6eba): a quote below 0.5× the other quote is a price anomaly → `supply-plan` used 20 vs 50.
- Payable adjust is ADMIN-only (6e128a5) → `glo-238` expected a Hub operator to adjust.
- Publication gates: reviewed catalog brand + stated net content + verified packshot + identity match (`glo-77/120/121/123`, `ingestion-lifecycle`, `product-readiness`, `sg11` ×2).
- Gate 02: suppliers only propose mappings; admin approves with confirmed semantics + currency (`sg11-full`, `sg12`).
- Gate 05: publish never deactivates absent offers; price-only rows never assert availability (`supplier-workflow-engagement`, `sg11-portal`).
- `sg09`: enrichment key is `ingredientProfile.actives`; `sg12`: `Product.name` (was `title`).
- Remote-DB latency (not a defect): the earlier Supabase-hosted run failed timing-dependent specs (`glo-236` waits 150 ms); they pass locally.
- Hook timeouts (`checkout`, `order-tracking` boot) → jest default timeout 30 s.

## Not verified here (see Linear)
Real printer/barcode hardware; real supplier export pilot; browser role walkthroughs on the current SAHEL V18 UI.
