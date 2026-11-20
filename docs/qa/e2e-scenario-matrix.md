# ShinaCare — E2E scenario matrix

Branch `qa/e2e-lifecycle-audit`. Date of the run: 2026-11-20. Every destructive scenario ran against disposable PostgreSQL `*_test`
databases on a local scratch server (`auto_dispatch_test`, `qa_matrix_test`) with disposable fixtures; nothing ran against Supabase,
a shared database or the clean manual E2E dataset.

**Status key** — `PASS-NEW` written in this audit and passing · `PASS-EXISTING` already in the repository, passed in the full run ·
`FIXED` failed first, defect fixed, now passing (see `bugs-and-fixes.md`) · `GAP` behavior missing or undecided, not silently invented ·
`NOT RUN` not executed in this environment (reason given). Nothing is marked PASS without an executed test.

`PASS-EXISTING` rows rest on the suite's own scenario titles plus its pass result in the full run; I did not re-read every assertion of
those suites. `PASS-NEW` / `FIXED` rows are assertions I wrote and executed.

## The lifecycle as it actually exists

Order: `placed → confirmed → packing → shipped → delivered`, side exits `cancelled` (placed/confirmed/packing only) and `returned`
(delivery given up). Shipment: `pending → ready_to_prepare → preparing → prepared → ready_to_pack → packing → packed → out_for_delivery → delivered`,
plus `failed` (kept in the courier's hands until the hub scans it back) and `cancelled`/`returned`. Delivery run: `planning → dispatched → completed`.
Sourcing in the MVP is `INTERNAL_BUY_LIST` (Buy List → batch → hub receipt); the supplier-PO flow still exists in code and is covered separately.
COD only; guest checkout is closed since 2026-10-18 (owner decision), so "guest checkout" is a legacy read path only.
No statuses or transitions were invented. Return/refund is a resolution workflow (`OrderResolution` → `RefundTransaction`), not an order status.

## A. Order creation

| ID | Scenario | Expected | Result | Test | Status |
|---|---|---|---|---|---|
| A1 | Authenticated checkout, several products/quantities, totals, flat fee | Quote is server-authoritative, order totals match | as expected | `c2c-backend-acceptance` step 1, `checkout` | PASS-EXISTING |
| A2 | Guest checkout | Refused `SIGN_IN_REQUIRED`, nothing created; guest cart adopted after sign-in | as expected | `checkout` (sign-in block) | PASS-EXISTING |
| A3 | Price changed after quote | 409 `CHECKOUT_REVIEW_REQUIRED`, quote not consumed | as expected | `c2c` step 1, `checkout` | PASS-EXISTING |
| A4 | Stale cart revision / duplicate submit / concurrent submit | One order only, replay returns the same order | as expected | `checkout`, `cart` | PASS-EXISTING |
| A5 | Address / pin validation, out-of-area pin | 400 / 422 `OUT_OF_SERVICE_AREA` | as expected | `c2c` step 1, `glo-231-delivery-pin` | PASS-EXISTING |
| A6 | Delivery fee by distance band and invoice size, free threshold | Fee, discount and base fee from policy | as expected | `delivery-fee-policy` | PASS-EXISTING |
| A7 | Unavailable / missing product | Rejected before order, or customer decision flow | as expected | `availability-resolution`, `commerce-sellability` | PASS-EXISTING |
| A8 | Customer tracking and visibility, no operational fields leaked | Owner-only, stages projected from persisted state | as expected | `order-tracking` | PASS-EXISTING |
| A9 | Double click / retry / network error **in the browser** | Button locks, retry works, error shown | not executed | no browser E2E runner in the repo; API idempotency covered by A4 | NOT RUN |

## B. Cancellation at every stage

Admin is the only role that can cancel (`POST /ordering/orders/:id/cancel`, `order.manage`); hub, driver and customer get 403.
Customer self-cancellation is a separate request path (`canCancel`, support cases); it was not re-audited here.

| ID | Stage | Expected | Result | Test | Status |
|---|---|---|---|---|---|
| B1 | Right after creation (`placed`) | Cancelled once, supply released, notification once, admin-only | as expected | `glo-240` staff cancellation | PASS-EXISTING |
| B2 | Before / after confirmation (`placed`/`confirmed`) | Allowed, same effects | as expected | `glo-206-order-transitions` | PASS-EXISTING |
| B3 | In the Buy List, nothing bought yet | Order leaves the list; other order keeps demand and coverage; no exception | as expected | `lifecycle-buylist-cancellation` #1 | PASS-NEW |
| B4 | Buy List, part bought | Bought units raise one actionable exception; other order untouched | **units vanished silently** → fixed | `lifecycle-buylist-cancellation` #2 | FIXED (BUG-08) |
| B5 | Buy List, everything bought | Same exception once; other order stays covered; replay opens nothing | same defect → fixed | `lifecycle-buylist-cancellation` #3 | FIXED (BUG-08) |
| B6 | Open purchase batch (drops out, batch closes) | Batch not corrupted | as expected | `purchase-batch` #2, `buy-list` | PASS-EXISTING |
| B7 | Supplier PO shared by two orders (supplier-PO flow) | Other order, allocation and PO untouched; cancelled order cannot be received | as expected | `lifecycle-cancellation-matrix` (shared purchase order) | PASS-NEW |
| B8 | Goods already received at the hub / supplier commitments in flight | One exception for a human, remaining receipt refused | as expected | `glo-240` #3 | PASS-EXISTING |
| B9 | During Hub preparation (session in progress) | Session failed, parcel and order cancelled | as expected | `lifecycle-cancellation-matrix` | PASS-NEW |
| B10 | After preparation, before assignment (packed, no run) | Cancelled; can never be planned into a run | as expected | `lifecycle-cancellation-matrix` | PASS-NEW |
| B11 | One stop of a shared planning run | Other stops, their custody and the run intact | as expected | `lifecycle-cancellation-matrix` | PASS-NEW |
| B12 | Cancelling the last unscanned stop of a run | Run whose remaining parcels are all scanned still leaves | run stayed in `planning` → fixed | `lifecycle-cancellation-matrix` | FIXED (BUG-07) |
| B13 | While out for delivery | 409 `CANCELLATION_TOO_LATE`, nothing written (no resolution, no status event, cash unchanged) | as expected | `lifecycle-cancellation-matrix`, `glo-240` | PASS-NEW |
| B14 | After successful delivery | Ordinary cancellation refused; goes through returns | as expected | `lifecycle-cancellation-matrix` | PASS-NEW |
| B15 | Cancelled order is terminal (status, packing, run, delivery events) | Every forward move refused, no cash collected | as expected | `lifecycle-cancellation-matrix` | PASS-NEW |
| B16 | Customer-facing result | Tracking `CANCELLED`, no supplier/courier fields, cash expectation voided | as expected | `lifecycle-cancellation-matrix` | PASS-NEW |
| B17 | Three concurrent identical cancellations | One cancellation, one resolution, one notification, all callers get a clean answer | two callers got 409 → fixed | `lifecycle-cancellation-matrix` | FIXED (BUG-06) |
| B18 | Cancel racing the hub dispatch | Exactly one wins; consistent final state | cancel returned **500 (deadlock)** → fixed; 5/5 repeats stable | `lifecycle-cancellation-matrix` | FIXED (BUG-05) |
| B19 | Isolation: cancelling one order never cancels another sharing a batch or run | Verified in B3, B5, B7, B11 | as expected | see rows | PASS-NEW |

## C. Internal purchasing

| ID | Scenario | Result | Test | Status |
|---|---|---|---|---|
| C1 | Aggregation per exact SKU across orders, never merging variants | as expected | `buy-list` | PASS-EXISTING |
| C2 | Oldest orders covered first, retries not double-counted, over-counting refused | as expected | `buy-list` | PASS-EXISTING |
| C3 | Two staff counting the last unit at once | one 200, one 409 | `buy-list` | PASS-EXISTING |
| C4 | Unavailable product → customer decision flow, reopen | as expected | `buy-list` | PASS-EXISTING |
| C5 | Purchase cost entry later / with count, corrected only with a reason | as expected | `profit-share` | PASS-EXISTING |
| C6 | Batch workflow with partial/full receipt, no double counting | as expected | `purchase-batch` | PASS-EXISTING |
| C7 | Cancelled order whose items were already purchased | needed fix | B4/B5 | FIXED |
| C8 | **Reallocating** bought units of a cancelled order to another open order | not supported; the Buy List keeps the other order outstanding and a human decides through the exception | `lifecycle-buylist-cancellation` #2 documents it | GAP — needs owner decision (D5) |
| C9 | Price change after purchase | PO cost is a frozen snapshot | `glo-238` payables, `glo-243` | PASS-EXISTING |
| C10 | Interrupted operation recovery | transactional; failed cancel/dispatch changes nothing | B13, B18 | PASS-NEW |

## D. Hub receiving and preparation

| ID | Scenario | Result | Test | Status |
|---|---|---|---|---|
| D1 | Barcode scan correct / unknown / wrong product (`PRODUCT_IDENTITY_MISMATCH`) | as expected | `c2c` step 4–5, `glo-206-preparation-scan` | PASS-EXISTING |
| D2 | Missing barcode → manual confirmation with reason and checks | as expected | `glo-206-preparation-scan` | PASS-EXISTING |
| D3 | Duplicate / concurrent scans count exactly the quantity (6 racing scans, 2 accepted) | as expected | `glo-206-preparation-scan`, `rt-operational-hardening` | PASS-EXISTING |
| D4 | Excess quantity, missing item blocks completion, double completion refused | as expected | `c2c` step 5, `glo-206-preparation-scan` | PASS-EXISTING |
| D5 | Partial receiving, shortages attributed, paid for what arrived | as expected | `glo-243`, `hub-quantity-shortage` | PASS-EXISTING |
| D6 | Cost recorded at receipt, silent change refused; expiry evidence, expired pack held | as expected | `hub-corrections-returns`, `rt-operational-hardening` | PASS-EXISTING |
| D7 | Committed scan corrected by a compensating event, exactly once | as expected | `hub-corrections-returns` | PASS-EXISTING |
| D8 | Cancellation during preparation | B9 | | PASS-NEW |
| D9 | Reopening an interrupted preparation session in the browser | not executed | no browser runner | NOT RUN |
| D10 | Status consistency Admin / Hub / customer tracking | customer stage projected from the same persisted shipment/order states | `order-tracking`, `order-tracking-custody` | PASS-EXISTING / PASS-NEW |

## E. Delivery and driver

| ID | Scenario | Result | Test | Status |
|---|---|---|---|---|
| E1 | Plan nearby parcels into runs within courier capacity, approve once (idempotent), reassign before custody | as expected | `delivery-mvp` | PASS-EXISTING |
| E2 | Run needs a courier and every parcel scanned; wrong, unknown and duplicate scans audited | as expected | `delivery-mvp` | PASS-EXISTING |
| E3 | Courier's last scan releases the run; hub dispatch is a fallback (second dispatch 400, driver 403) | new behavior | `delivery-mvp`, `c2c`, `glo-240`, `golden-journeys*` (updated) | FIXED (BUG-01) |
| E4 | Customer sees «مع المندوب» once the courier scanned | custody stage projected | `order-tracking-custody` (5 unit tests) | PASS-NEW |
| E5 | Another courier / customer cannot read or act on a foreign run or parcel | as expected | `delivery-mvp`, `lifecycle-delivery-failure` | PASS-EXISTING / PASS-NEW |
| E6 | Failed delivery with **every** reason the courier app offers (11) | 3 reasons were rejected with 400 | `lifecycle-delivery-failure`, `delivery-failure-reasons.spec` | FIXED (BUG-02) |
| E7 | Failed ≠ delivered ≠ collected: order stays `shipped`, COD stays `expected`, parcel stays with the courier | as expected | `lifecycle-delivery-failure` | PASS-NEW |
| E8 | Unknown/missing reason, delivery after failure refused, nothing written | as expected | `lifecycle-delivery-failure` | PASS-NEW |
| E9 | Hub scans back → same order re-planned with another courier → delivered once; attempt history kept (`failed, delivered`) | as expected | `lifecycle-delivery-failure`, `glo-240` | PASS-NEW |
| E10 | Duplicate delivery confirmation | one event, one outcome | `lifecycle-delivery-failure` | PASS-NEW |
| E11 | Customer sees `DELIVERY_ISSUE`, never a delivery date | as expected | `lifecycle-delivery-failure` | PASS-NEW |
| E12 | Delivery given up → `returned`, collection voided, one human exception | as expected | `glo-240` #2 | PASS-EXISTING |
| E13 | COD declaration (exact, replay, conflicting rewrite 409), staff cannot fake a COD delivery | as expected | `c2c` step 7, `glo-214` | PASS-EXISTING |
| E14 | COD settlement counted exactly once, shortage/overage recorded, concurrent counts | as expected | `glo-238`, `glo-206-cod-settlement`, `delivery-mvp` | PASS-EXISTING |
| E15 | Run settlement states and the completion gate (`RUN_NOT_SETTLED`) | as expected | `delivery-mvp` | PASS-EXISTING |
| E16 | Camera scan on a real phone, poor network, one-handed use | not executed | needs a device and HTTPS; the camera needs `BarcodeDetector` (Chrome/Android) | NOT RUN |

## F. Returns, refunds, post-delivery

| ID | Scenario | Result | Test | Status |
|---|---|---|---|---|
| F1 | Never returns more than bought; concurrent claims serialized; completed claims count against what remains | as expected | `glo-206-returns-refunds` | PASS-EXISTING |
| F2 | Resolution statuses move forward only; staff-created resolutions bounded the same | as expected | `glo-206-returns-refunds` | PASS-EXISTING |
| F3 | Refund only for eligible resolutions, in currency, within cash received, once, with proof | as expected | `glo-206-returns-refunds` | PASS-EXISTING |
| F4 | Return windows (7 days change of mind, sealed only; 14 days defective / wrong / expired) | as expected | `return-eligibility`, `return-responsibility` | PASS-EXISTING |
| F5 | Physical return inspection separate from any refund; safety reports quarantined | as expected | `hub-corrections-returns` | PASS-EXISTING |
| F6 | Guest item-problem reports (legacy token) | as expected | `glo-215` | PASS-EXISTING |
| F7 | Succeeded refund lowers revenue and profit once; failed and pending refunds do not | exact numbers | `profit-share` (new case) | PASS-NEW |
| F8 | Partial return, full return **as one customer-facing flow in the UI** | not executed | no browser runner | NOT RUN |

No return/refund workflow was missing at API level, so none was added.

## G. Dashboard and financial consistency

| ID | Scenario | Result | Test | Status |
|---|---|---|---|---|
| G1 | Sales, COD, supplier cost and profit derived from records only; incomplete costs never called a profit | as expected | `admin-finance` | PASS-EXISTING |
| G2 | Profit model: purchase + company-funded delivery + packaging + cancelled-order loss + expenses; COD kept apart; INCOMPLETE until every cost exists; closed month frozen | as expected | `profit-share` | PASS-EXISTING |
| G3 | Delivery cost is recorded automatically when an order is delivered (from the checkout quote), never overwriting a manual value | needed new code | `c2c` step 7, `profit-share` new case | FIXED (BUG-04) |
| G4 | Company share of delivery = base fee − customer fee; larger invoices → customer pays less, company more | exact numbers (50 − 30 = 20) | `profit-share` new case | PASS-NEW |
| G5 | Packaging cost from Settings per bag/box at preparation | as expected | `profit-share`, `pack-ready` fixture | PASS-EXISTING |
| G6 | Cancellation and failed delivery do not create sales, collections or counted cash | as expected | B13–B16, E7 | PASS-NEW |
| G7 | Two finance views (`/operations/finance/summary` vs `/operations/finance/profit`) use different cost bases and can show different "results" | by code reading | n/a | GAP — owner decision (D3) |
| G8 | Dashboard charts after a mutation, stale figures in the browser | not executed | no browser runner | NOT RUN |

## Browser coverage

| ID | Scenario | Result | Status |
|---|---|---|---|
| U1 | Order confirmation page, desktop 1440 and mobile 375, Arabic RTL, three realistic data variants (estimated date + discount + image fallback; confirmed date + free shipping; unknown date + cancel hint) | verified in the browser against a **mock API** (the real API was not running); screenshots in `docs/qa/screenshots/` | PASS (mock data) |
| U2 | Storefront checkout, Admin, Hub, Driver workspaces in the browser | not executed: the Business app dev server on `:3002` belongs to the user's running stack and no API was reachable; audit was code-level only | NOT RUN |
