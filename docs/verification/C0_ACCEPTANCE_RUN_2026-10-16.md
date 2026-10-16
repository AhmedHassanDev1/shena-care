# Unified Commerce Acceptance Run — 2026-10-16

**Candidate:** `integration/task-00-commerce` @ `dc621cc` (worktree `shena-care-wt/integration-task00`)
**Result: PASS with 1 High finding.** The full chain Storefront → Admin → Supplier → Hub → Driver → COD → Customer was completed in a browser on production builds. The backend does not enforce driver custody before dispatch (F1).

## Environment

- Disposable PostgreSQL 16 cluster (session scratchpad, `127.0.0.1:55462`), DB `shenacare_acceptance_test`: `migrate deploy` (43) + `npm run seed` + `staff:provision` (ADMIN, SUPPLIER→official-distributor, HUB_OPERATOR→"Maadi Pharmacy Hub", DRIVER). The test password lived only in the scratchpad. Neon and `.env` were never touched.
- API `node dist/main` :3001 (`NODE_ENV=development`). Storefront `next start` :3102. Business `next start` :3103.
- Each role ran in its own origin (`admin.` / `supplier.` / `hub.` / `driver.localhost:3103`) so sessions stayed separate. All four origins were in `FRONTEND_URL`.
- Driver was run at a 375×812 mobile viewport; other workspaces at 1280×900.

## Canonical chain — ORD-3EDE31A1FCAF4601 (clean UI path)

| # | Step | Evidence |
|---|---|---|
| 1 | Storefront: add LoveBond Shampoo, checkout, Cairo/Maadi, map pin 29.9613, 31.2593 confirmed | Review: 290 + 50 delivery = **340 COD** |
| 2 | Double-click "place order" | exactly **1** order in DB |
| 3 | Admin → Sourcing → flush | PO **E30EB03D**, cost 203 |
| 4 | Supplier confirms in full → marks ready | status "ready — not yet at hub" |
| 5 | Hub receives (barcode `TEST-BARCODE-HA-LB-SHMP`) → prepares (scan 1/1) → label `SHP-46AFBD6B-049649E7185A5BF7` → receipt + slip confirmed → packed | events PREPARATION_STARTED…PACKED |
| 6 | Hub creates run **FD95B0C0**; dispatch button disabled until custody | — |
| 7 | Driver scans **order 1's slip** → refused (`Scanned barcode does not match this shipment`); scans correct slip → "parcel in your custody" | `HANDOFF_SCANNED` |
| 8 | Hub dispatches | shipment `out_for_delivery`, order `shipped` |
| 9 | Driver: delivered, declares 340 | — |
| 10 | Hub cash count 340 → settlement **CNT-2026-10-16-E62306-XPGNG** | collection `settled`, variance 0 |
| 11 | Admin cash + payable | collection visible; payable E30EB03D **203 OPEN** |
| 12 | Customer tracking | "Delivered", 6-stage timeline, pin shown |

## Second chain — ORD-092DC2526FD74D6A (exercised negatives and found F1)

- Storefront: 2 SKUs (serum ×2 via quantity +, shampoo ×1), cart survives reload. Continuing without a pin is **blocked** (error with icon and text). Total 640 + 50 = **690 COD**. DB row has `map_pin` and `location_confirmed_at` set.
- Admin: Overview shows **real** KPIs with no demo marker. Order detail shows pin, amounts, lines, and `order.placed → sourcing.supply-plan: delivered`.
- Supplier: sees only its own PO **AE4848FE** and no customer data. Confirmed full, then ready.
- Hub receive: shampoo barcode on the serum line → **`PRODUCT_IDENTITY_MISMATCH`** (server). Quantity above remaining → blocked client-side. Received with lot `LOT-T00-A1`, expiry 2027-12-31.
- Hub scan station: unknown barcode → refused. Second shampoo → "excess" refused. 2/2 + 1/1 → prepare complete.
- Print: 80 mm receipt (690 COD) and Code128 slip `SHP-5625783E-D1CEC4CC3FAF3A3D` render. Pack stays disabled until both prints are confirmed.
- **F1:** the dispatch button was disabled (no custody scan), but `POST /fulfillment/delivery-batches/:id/dispatch` with the hub session returned **201**. The driver app then allowed **Delivered + 690 declared** with no custody. The event trail is `PACKED → DELIVERED`, with no `HANDOFF_SCANNED` and no dispatch event.
- Hub cash count 680 against 690 declared → `short −10`, shown to Admin.
- Payable AE4848FE = 2×136.5 + 175 = **448 OPEN** (correct).

Final DB: both orders `delivered`. Collections `settled` 340/340 and `short` 680/690. Both runs remain `dispatched`.

## Findings

| # | Severity | Finding | Where |
|---|---|---|---|
| F1 | **High** | Driver custody is enforced only in the UI. `dispatchBatch` checks cancellation and pin but not a `HANDOFF_SCANNED` per stop, so a parcel can leave the hub, be delivered and have cash declared with no custody record. This breaks "backend owns business rules". Also, after a no-custody dispatch the driver can no longer scan (`HANDOFF` requires `packed`). | `apps/api/src/modules/fulfillment/services/fulfillment.service.ts` `dispatchBatch` (~L1333) |
| F2 | Low | Dispatch writes no shipment event (no `OUT_FOR_DELIVERY` in the trail), so the audit trail jumps from custody to delivered. | same |
| F3 | Low | Runs stay `dispatched` after all stops are delivered (no completion seen in the UI). | Hub dispatch |
| F4 | Low (UX) | Raw English API text shown to staff: `PRODUCT_IDENTITY_MISMATCH - …`, `Scanned barcode does not match this shipment`, and settlement statuses `settled` / `short`. | Business hub/driver |
| F5 | Low (UX) | The hub run table showed the parcel as "packed" right after dispatch until reload. | Hub dispatch |
| F6 | Info | Hub cash count and the supplier-payable action use native `window.confirm`. The embedded test browser auto-dismisses it, so it was stubbed to `true` in that tab only for this run. Real browsers are unaffected. | `hub/cash/page.tsx:91` |
| F7 | Info | `/_vercel/insights/script.js` 404 off-Vercel (console noise). | Business layout |

## Not verified (physical / external)

Thermal printer output, Code128 scanability on real hardware, physical cash and pickup, SMS delivery (staff/customer OTP fail closed outside dev/test). Failed delivery + retry and customer self-cancel were not re-run here; they are covered by the API suites and the C0 W5/W6 walkthroughs.

## Next executable task

Fix F1 in the backend: `dispatchBatch` should require a current-attempt `HANDOFF_SCANNED` for every stop (409 otherwise), with an integration test. Re-run the c2c and fulfillment suites, and re-run steps 6–8 of the canonical chain.
