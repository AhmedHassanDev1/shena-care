# ShinaCare — bugs and fixes

Branch `qa/e2e-lifecycle-audit`, 2026-11-20. Severity: P1 breaks a business flow or money, P2 wrong behavior with a workaround, P3 hygiene.
"Evidence" is a test that failed before the fix (or, where stated, an observed failure) and passes now.

## Product defects fixed

### BUG-01 — Delivery run stuck in `planning`: no delivery buttons, no «مع المندوب», empty «جاري التوصيل» (P1)
- **Reproduce:** hub plans a run, courier scans every parcel in the Delivery workspace, opens the stop page.
- **Observed:** the stop page showed only "waiting for the run to leave"; the customer still saw "preparing"; the hub tab «جاري التوصيل» was empty.
- **Root cause:** a run was released only by the hub pressing dispatch (`dispatchBatch`). Courier events other than the custody scan need `batch.status === 'dispatched'`,
  the order only becomes `shipped` at dispatch, and the customer projection ignored custody entirely. Nothing connected the courier's scan to the release.
- **Fix (owner approved "تلقائي"):** the courier's scan of the run's last parcel releases the run through the same checks as a manual dispatch
  (`releaseRunWhenCustodyComplete` → `releaseBatch`); a refusal leaves the run in `planning` and logs a warning; hub/admin scans never release; hub dispatch stays as a fallback.
  Tracking projects a scanned, packed parcel as `OUT_FOR_DELIVERY` (`inCourierCustody`). The stop page polls every 8 s and the map button is honest about why it cannot start.
- **Regression evidence:** `delivery-mvp`, `c2c-backend-acceptance`, `glo-240`, `golden-journeys`, `golden-journeys-routines`, `glo-241` (these assumed a manual dispatch after the courier's scan: they now assert
  the run is `dispatched`); `order-tracking-custody.spec` (5 unit tests). Before the change `c2c` step 6 failed with `expected 201, got 400` once the courier scanned (run already released).
- **Docs:** `docs/project/DELIVERY_MVP.md` §3 updated.

### BUG-02 — «تعذر التسليم» failed with an error after choosing a reason (P1)
- **Root cause:** the courier app offers `CUSTOMER_NOT_FOUND`, `ITEM_MISMATCH`, `WRONG_ITEM`; the API whitelist (`DELIVERY_FAILURE_REASONS`) did not contain them, so validation answered 400.
- **Fix:** the three codes added to the whitelist (`fulfillment.dto.ts`).
- **Regression evidence:** `delivery-failure-reasons.spec` (every code in the courier app's `FAILURE_REASONS` must be accepted; `TELEPORTED` must not) and
  `lifecycle-delivery-failure` #1 (all 11 reasons recorded through HTTP; order stays `shipped`, COD stays `expected`). The failing state before the fix is the 400 the courier reported.

### BUG-03 — Test-barcode buttons in production screens (P2)
- Removed «باركود اختبار» / «مسح تجريبي» from the courier home, the stop page, the hub return scan and the continuous handoff modal; deleted `lib/dev-barcode.ts`.
  The camera now fills the code from the printed waybill and submits at once; scan errors show under the camera.
- **Evidence:** business `tsc` clean. Not exercised on a real phone (camera needs HTTPS and `BarcodeDetector`).

### BUG-04 — Profit page: "1 order without actual delivery cost" although Settings had a delivery cost (P1, money)
- **Root cause:** the profit report needs a per-order `OrderCostRecord.courierCost`; the Settings value (`commerce.delivery.internal_cost`) is only a suggestion in the hub queue. Nothing recorded the cost automatically.
- **Fix:** when an order is delivered, `OrderCostDeliveryListener` freezes the courier cost from the system's own price: the distance-based `deliveryFeeBase` stored in the order's checkout quote
  (older orders fall back to the Settings value; nothing is invented when neither exists; a manually recorded cost is never overwritten). The company share (base − customer fee) is derived by the existing profit model.
  `backfillDeliveredCourierCosts` exists for earlier delivered orders and was **not run** against any shared data.
- **Evidence:** `c2c` step 7 (cost equals the quoted base fee, recorded by `system:QUOTE_BASE_FEE`); `profit-share` new case (50 base − 30 customer = 20 company-funded, exact month result 91).

### BUG-05 — Cancel racing dispatch ended in HTTP 500 (deadlock `40P01`) (P1)
- **Reproduce:** cancel an order and dispatch its run at the same instant.
- **Root cause:** inverted lock order. Dispatch locks the shipment then the order; cancellation locked the order (`FOR UPDATE`) then the shipment.
- **Fix:** cancellation takes the shipment row lock first (`lockShipmentForOrder`), the same order dispatch uses. The loser now gets a clean 409/400, never a 500.
- **Evidence:** `lifecycle-cancellation-matrix` "cancel racing the hub dispatch": failed with `Expected 409, got 500` before; passes, and passed 5/5 repeated runs.

### BUG-06 — Concurrent identical cancellations: some callers got an error instead of an idempotent answer (P2)
- **Root cause:** the "already cancelled" check ran before the row lock; a caller that waited on the lock then saw `cancelled` and failed the status check (`CANCELLATION_TOO_LATE`). The failing run showed "not every caller got 201"; the exact status codes were not captured.
- **Fix:** `cancelInTx` re-checks after taking the lock and returns `alreadyCancelled`; the cancellation service stops there (no second resolution, notification or exception).
- **Evidence:** `lifecycle-cancellation-matrix` "three concurrent cancellations" (one cancellation, one resolution, one notification, three 201s).

### BUG-07 — Run never left the hub after its last unscanned stop was cancelled (P2)
- **Root cause:** release was triggered only by a courier scan; cancelling the one missing parcel produced a run whose remaining stops were all scanned but nobody scanned again.
- **Fix:** `cancelShipmentForOrder` reports the planning runs it left; after commit the cancellation service calls `releaseRunIfCustodyComplete`.
- **Evidence:** `lifecycle-cancellation-matrix` "cancelling the last unscanned stop" (stayed `planning` before).

### BUG-08 — Cancelling an order whose items were already bought on the Buy List silently dropped the purchase (P1, money)
- **Reproduce:** two orders for one SKU, buy 3 units, cancel the 2-unit order through the Admin endpoint.
- **Observed:** response `goodsReceived: false`, no commitments, no exception; the Buy List showed only 1 acquired unit — two bought units were simply gone from every screen.
- **Root cause:** the cancellation exception was raised only for goods received at the hub or supplier-PO commitments, never for Buy List purchases.
- **Fix:** `releaseForCancelledOrder` counts the Buy List units bought for the order (`boughtUnits`) and the cancellation opens one high-priority `cancellation` exception naming the units.
  No automatic re-allocation to another order (a policy decision, see D5).
- **Evidence:** `lifecycle-buylist-cancellation` #2 and #3 (probe before the fix showed `exceptionCaseId: null`).

## Test and fixture defects (not product bugs)

| ID | Defect | Fix |
|---|---|---|
| T-01 | `glo-241-payment-methods` dispatched a run without any custody scan, failing since the Delivery MVP handoff gate (`409 HANDOFF_INCOMPLETE`) | The test now takes custody first (hub-side scan, which never auto-releases) |
| T-02 | `glo-212-driver-manifest` cleanup failed with an FK violation on `payment_collections` because a released run creates the expected COD collection | Cleanup deletes collections and status events first |
| T-03 | `zero-COD` case in `delivery-mvp` marked the order prepaid *after* the courier's scan; with auto-release the run had already created a COD collection | Payment is settled before the scan, as in real life |

## Pre-existing failures, not caused by this work

Full API run before and after: the failures below exist independently of the changed files.
Verified on a clean extract of `HEAD` (no working-tree changes) against the same scratch database: `cart-reorder.spec` (stale mock: no `getSellingTermsBatch`, from the cart performance commit),
`glo-205-security-regressions` (candidate route answers 404), `sourcing` (supplier CRUD suite), `catalog-enhancement-pending`.
The other failing suites are catalog, media, brand-research, care-consultation, rc-smoke, product-search/read-performance, ai-client-privacy and candidate-publish suites. They do not touch any file
changed here but **were not individually re-run on clean `HEAD`**.
`accounts` (OTP) failed in the full runs and passes in isolation (22/22, twice) on both my tree and clean HEAD: order/state dependent, and the working tree carries someone else's uncommitted edits in `accounts.service.ts` and `accounts.e2e-spec.ts`.
Web lint errors (`card-model.test.ts`, `spotlight-products.test.ts`, `ConcernView.tsx`) are in files not touched here; `apps/api` lint errors in `ordering.service.ts` lines 48–239 pre-date these changes.

## Needs owner approval (decisions, not defects)

| ID | Decision | Why it needs you |
|---|---|---|
| D1 | Courier's last scan releases the run automatically (hub dispatch becomes a fallback) | Changes the hub's gate; you approved it for delivery, but the Hub's «خروج المشوار» step is now mostly redundant |
| D2 | Delivery cost = quoted base fee (company pays base − customer fee), not a flat Settings number | Defines "what delivery costs us"; the backfill for old delivered orders is not run |
| D3 | Two finance views disagree by design: `/operations/finance/summary` (supplier invoice lots + courier settlement fees) vs `/operations/finance/profit` (Buy List + per-order cost records) | Admin may see two different "results"; one should be declared the MVP truth |
| D4 | Dates in the Arabic storefront use Latin digits (`ar-EG-u-nu-latn` in `format.ts`) while `CLAUDE.md` rule 7 asks for Arabic-Indic digits for dates | Code and rule contradict each other |
| D5 | What happens to units bought for a cancelled order (reallocate to another open order, keep as stock, return) | Currently a human decides through the exception; no inventory model exists |
| D6 | Customer-facing order reference shown as `ORD-1A2B-3C4D-5E6F-7A8B` (display only; the stored and copied number is unchanged) | Cosmetic, but it is the customer-visible reference |
