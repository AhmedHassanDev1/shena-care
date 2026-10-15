# C1 Backend Cart-to-Cash Completion Report — 15 Oct 2026

Scope: GLO-235 backend gate only. No frontend, Business Workspace, design-system or AI work. Physical
cash, printers, scanners, real suppliers, payment providers and role UIs are **not** claimed.
Contracts and runbook: [`docs/architecture/C1_BACKEND_CART_TO_CASH.md`](../architecture/C1_BACKEND_CART_TO_CASH.md).

## Result

**Backend acceptance: PASS** for every automated GLO-235 backend bullet, with the owner policy
decisions in §7 left fail-closed (not invented). Commits are on local `main`, **not pushed or merged**.

## Environment and evidence

- Disposable PostgreSQL 16 cluster created with `initdb` (127.0.0.1:55432, trust auth), database
  `shenacare_test`, recreated from empty; `prisma migrate deploy` → **42 migrations** applied (a 43rd,
  `20261015180000_rt_…`, was added by the red-team slice and applied on top).
  `DATABASE_URL` overridden in-process; the API `.env` (Neon) was never used.
- Baseline at `7e8855e`: 58 suites / 408 tests passed.
- Final run at `b8c2cb5`:
  `DATABASE_URL="postgresql://postgres@127.0.0.1:55432/shenacare_test?connection_limit=5&connect_timeout=30" NODE_ENV=test npx jest --runInBand --forceExit`
  → **69 suites, 470 tests passed, 0 failed, 0 skipped**. `npm run typecheck` clean. ESLint 264
  errors repo-wide (W0 baseline 274; none in files added by C1). The previous full run at
  `4d3adb0` on a freshly recreated database (42 migrations) was 68/68 suites, 467/467.
- Canonical run: `test/integration/c2c-backend-acceptance.e2e-spec.ts` — 12 ordered steps, 12/12,
  repeatable on the same database.
- Known environment flakes (not C1 logic): `product-discovery` can hit `Can't reach database server`
  at full-suite start on this Windows host (pre-existing, recorded in W0; passes in isolation), and
  during antivirus CPU spikes individual suites can exceed the 15 s per-test timeout (a run where
  suites took ~190 s failed this way; the rerun passed 69/69).

## Commits

| SHA | Issue | Slice |
|---|---|---|
| `cdff21e` | GLO-236 | durable `order.placed` outbox + dispatcher/replay; atomic shipment/order/cash transitions; honest outbox/export |
| `50772dd` | GLO-231 (backend) | mandatory confirmed pin, Cairo/Giza serviceability, legacy pin correction, driver navigation |
| `cf2586a` | GLO-237 | consolidated POs with N:1 quantity-aware allocation lineage, distribution, fallback, Ready ≠ received |
| `b469467` | GLO-238 | COD settlement courier/hub/delivered/declared guards, idempotent references, variances; payables |
| `2578b42` | GLO-240 | attempt history + retry, return to sender, staff cancellation, cash-bounded refunds |
| `3f3a6fb` | GLO-239 | role-scoped hub / cashier / admin / support read APIs |
| `eaa4420` | GLO-241 | payment-method-aware orders, fail-closed online payments (METHOD-READY, not live) |
| `34db9b0` | GLO-242 | reviewed barcode aliases, identity evidence at receiving and preparation |
| `6a0fa22` | GLO-237 red team, GLO-243 | typed supplier exceptions (MOQ/pack/price), attributable receiving shortfalls |
| `4d3adb0` | GLO-235 | canonical C2C acceptance suite, contracts/runbook, this report |
| `b8c2cb5` | GLO-235 red team | RT14 idempotent scans, RT08 operator instructions beside the customer pin, RT04 lot/expiry evidence |

## Workflow status (backend)

| # | Workflow | Status | Evidence |
|---|---|---|---|
| 1 | Cart, pricing, quote, price-change 409, idempotent COD order, confirmed pin | PASS | c2c step 1; checkout, cart, glo-231 |
| 2 | Durable Order → Sourcing | PASS | c2c step 2; glo-236 |
| 3 | Supplier batch, PO confirmation, N:1 lineage, shortage/fallback | PASS (priority policy = explicit admin decision) | c2c 2–3; glo-237, glo-243 |
| 4 | Hub receiving, quantity, identity, inventory integrity | PASS | c2c 4; fulfillment-receiving, glo-242, glo-243 |
| 5 | Barcode preparation, packing, shipment identity, thermal document data | PASS (printer hardware deferred) | c2c 5; glo-210, glo-242 |
| 6 | Runs, assigned manifest, custody handoff, transitions | PASS | c2c 6; glo-212, glo-231, glo-236 |
| 7 | Failed delivery, retry, cancellation, returns | PASS (retry limit = owner policy) | c2c 6, 11; glo-240 |
| 8 | Expected / declared / counted cash, reconciliation | PASS (tolerance = owner policy) | c2c 7–8; glo-214, glo-238 |
| 9 | Supplier payables, refunds, financial audit | PASS | c2c 9–10; glo-238, glo-206-returns-refunds |
| 10 | Support/exceptions, reliable events, truthful outbox | PASS | c2c 11–12; glo-236, glo-240 |
| 11 | Role-scoped operational read APIs | PASS | glo-239 |
| 12 | Cross-domain automated E2E | PASS | c2c-backend-acceptance |
| — | Payment methods (cards, Vodafone Cash) | METHOD-READY only — no provider | glo-241 |

## Red-team register coverage (owner document, 20 hypotheses)

| RT | Coverage |
|---|---|
| RT01, RT02, RT06, RT07, RT11, RT15, RT19, RT20 | implemented and tested (GLO-236/237/238/240/241, git hygiene, c2c suite) |
| RT03, RT04 | reviewed aliases, typed review/ambiguity, audited manual check, condition/expired hold, lot/expiry evidence; physical QC remains a human gate |
| RT05 | shortfall attribution (`NOT_HANDED_OVER`, `LOST_IN_TRANSIT`, …); pickup manifest = owner decision |
| RT08 | immutable customer pin, typed failure reasons (`PIN_MISMATCH`, `ADDRESS_NOT_FOUND`, `NOT_SERVICEABLE`), append-only operator instructions |
| RT09, RT10 | fail-closed online payments; MOQ/pack/price exceptions recorded, never applied; approval/negative-margin policy = owner |
| RT12 | cancellation fences batching/receiving/dispatch; refunds bounded and proof-backed |
| RT14 | receipt idempotency keys, scan session lock, client scan ids, handoff/delivery replays |
| RT13, RT16, RT17, RT18 | owner policy / operational tests (returns law table, ERP correlation, proof of delivery, promise windows) — not invented |

## Security and financial integrity results

- RBAC/IDOR negatives: supplier B on supplier A's PO/confirm/ready (403), hub B on hub A queues,
  settlement and batches (403/404), driver B on driver A's parcel (404) and manifest, customers and
  drivers on staff endpoints (403), supplier/hub on alias approval and distribution (403), forged or
  unsigned payment callbacks (401).
- PII minimisation: supplier PO views, hub queues, cash queues and the admin attention queue
  carry ids, order numbers and statuses only; only the assigned driver gets the pin and phone.
- Concurrency/replay: duplicate checkout, concurrent PO flushes, concurrent deliveries, concurrent
  settlements and same-reference twins, concurrent payable creation, racing runs for one parcel,
  concurrent scans for the last unit, concurrent provider callbacks — each exactly once.
- Transaction failure: forced failures roll back order + event together; a delivery whose order
  cannot move changes nothing; dispatch is all-or-nothing.
- Money: Decimal(10,2), DTO ≤ 2 decimals, explicit short/over variance, payables from snapshot
  cost × accepted quantity, refunds bounded by cash actually received and paid only with proof.

## Remaining risks

- Commits are unreviewed by a second engineer and not pushed; migrations add unique indexes
  (`supplier_payables.purchase_order_id`, partial `delivery_stops`, `payment_attempts`) that fail
  loudly if production data already violates them — check before deploying.
- Prisma cannot model the two partial unique indexes; `prisma migrate diff` shows them as drift and
  future generated migrations must not drop them.
- The web checkout is incompatible until it sends the pin; settlement clients must send `locationId`.
- Pre-existing schema drift on `care.routine_proposals` (W0) remains untouched.
- Notifications are held (no provider); accounting export fails honestly (no destination).

## Requirements before Frontend integration

1. Storefront checkout: map pin UI sending `latitude/longitude/locationSource/locationConfirmed`.
2. Business Workspace screens on the GLO-239 read APIs and the new commands (distribution,
   shortfalls, cancellation, received-back/returned, cash count with `locationId`, alias review).
3. Driver UI on the manifest (`location.navigationUrl`, `attemptStatus`) and typed failure reasons.
4. Owner decisions in §7 of the contract page; payment provider selection for cards/Vodafone Cash.
5. Separate operational gates: physical printing, scanner hardware, real supplier pickup, real cash
   handover and GLO-232 cross-workspace acceptance.
