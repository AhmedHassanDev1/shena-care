# Delivery MVP — dispatch, verified handoff, courier delivery, COD settlement

Owners: `modules/fulfillment` (runs, custody, shipments), `modules/ordering` (order states, expected/declared/counted cash). Workspaces:
Hub `/hub/dispatch`, Courier `/driver`, Admin, customer tracking (reads the same order/shipment states). No new tables.

## Flow

1. **Ready → planned.** `POST /fulfillment/locations/:id/dispatch/plan-preview` clusters packed parcels by distance (local heuristic, no paid
   routing by default), respects each courier's `maxStops`/trips, returns unassigned parcels with a reason; `plan-approve` (fingerprint-checked,
   idempotent) creates one `planning` run per trip. Preview and approve are scoped to the hubs the operator is assigned to (Admin: any).
   Manual adjustment: add/remove/reorder stops (existing) and `PATCH /fulfillment/delivery-batches/:id/driver` to change the courier — only
   while the run is `planning` and no parcel is in custody yet.
2. **Verified handoff.** `POST …/delivery-batches/:id/handoff-scan { barcode }` (hub or the run's courier) answers with a typed outcome:
   `SCANNED` (custody recorded once; the event notes who handed over / that the courier received), `DUPLICATE` (counted and audited as
   `HANDOFF_DUPLICATE`, nothing changes), `NOT_IN_RUN` (a genuine label of another parcel, audited on that parcel as `HANDOFF_REJECTED`),
   `UNKNOWN_PARCEL`, `INVALID_STATE`. Progress and `missingShipmentIds` come back with every scan; `GET …/delivery-batches/:id` shows per stop
   `handoff { at, scannedById, receivedById }` and `duplicateScans`.
3. **Dispatch gate and automatic release.** The courier's own scan of the run's last parcel releases the run by itself (owner decision 2026-11-20): the same checks
   as a manual dispatch run, the order becomes `shipped` and the expected COD is fixed. If any check refuses (cancelled order, delivery pin, payment) the run stays
   `planning` for the Hub, which can still press «خروج المشوار» (`POST …/dispatch`, hub-only) as a fallback; a second dispatch of a released run answers 400. A scan
   by the hub or an admin never releases a run. Cancelling an order that leaves a planning run whose remaining parcels are all already scanned releases it too.
   Until release, a parcel the courier scanned already shows the customer «مع المندوب». `POST …/dispatch` is refused (`COURIER_REQUIRED`, `HANDOFF_INCOMPLETE` + the missing parcels) until a courier is assigned
   and every active parcel was scanned into custody; then parcels → `out_for_delivery`, orders → `shipped`, expected COD per order is fixed.
4. **Courier.** Only the run's courier sees it (`GET /fulfillment/driver/runs`); other couriers get 404/403. Delivered needs the cash declaration
   (idempotent replay, a conflicting rewrite is a 409); failed needs a typed reason and the parcel stays in the courier's custody until the hub
   takes it back (`RECEIVED_BACK` with the label scan), after which it can join another run (attempt history kept: `failed > delivered`).
5. **COD settlement.** `GET /ordering/settlements/rounds/open` (expected vs declared per courier, hub-scoped) → `POST …/rounds` counts a courier's
   cash once (reference = idempotency key; a different count under the same reference or nothing left to count is a 409). A shortage/overage is
   recorded as a variance (`short`/`over`) for admin review, never silently settled. `runId`/`orderIds` scope a count to one run.

6. **Run settlement states (server-owned).** `GET /fulfillment/delivery-batches/:id/settlement` (and `settlement` on every row of the hub run list)
   returns one answer derived from the run's stops and the cash of the orders it *delivered*: `state` = `pending` (parcels on the road, declared
   cash not yet counted, or nothing happened yet) · `reconciliation_required` (a failed parcel still in the courier's hands, delivered COD whose
   cash was never declared, or a disputed collection) · `settled` (every delivery accounted for and every returned parcel back at the hub) ·
   `completed`; plus `blockers`, `canSettleCash`, `canComplete`. A valid zero-COD run (prepaid parcels delivered) and a run whose only outcome
   is a parcel taken back are `settled` with no cash to count. **`POST …/complete` is gated by the same rule** (409 `RUN_NOT_SETTLED` with the
   blockers): an empty run, a run with uncounted cash, or one with an open return can never be closed. A count scoped by `runId` only sweeps
   cash this run delivered (an unknown run is a 404, an empty scope a 409 `NO_OPEN_ROUND`, never "everything of the courier").

7. **Hub desk = three tabs (`/hub/dispatch`).** *توزيع الطلبات* (ready parcels → suggested geographic groups or manual pick → a `planning` trip, reviewed here, sent out
   with *خروج المشوار* only after the courier scanned every parcel in the Delivery workspace; the Hub has no scan button), *جاري التوصيل* (trips on the road: delivered /
   failed / remaining and the expected COD, read-only) and *التسوية* (trips back at the hub: one centered modal / bottom sheet with one input — the cash actually received —
   the backend's expected COD, a live matched / shortage / surplus line, label-scan confirmation of returned parcels and one *تأكيد التسوية* that counts the cash and then
   closes the trip if the server says it may). Closed trips are read-only summaries behind *سجل المشاوير*. A trip is its own accounting batch: its reference is
   `TRP-` + the first 8 hex of its id (no new column); every id, reference and order number on the page is a copy button that copies the complete value.
   The run list rows carry `cod: { orders, expectedTotal }` = cash the whole trip should bring back (COD parcels not failed / returned / cancelled), computed by
   `runCodExposure` from the expected collections fixed at dispatch.

## Safety rules enforced here

- A confirmed order's **quantity, unit price, total and COD amount cannot be edited from the Hub or Delivery** (the desk line editor was removed);
  commercial amendments go only through the customer-agreed availability decision workflow.
- Price writes (`/commerce/prices`) are Admin only; the Hub may read.
- Hub run list: `toAttempt` = stops still waiting for an outcome (a failed parcel in the courier's hands no longer keeps the run "on the road").

## Verification

`test/integration/delivery-mvp.e2e-spec.ts` (smart dispatch + capacity + approval + reassignment, handoff gate and scan outcomes, courier
scope, delivery/failed/retry/COD, one counted settlement, and every settlement state: empty trip, outstanding cash, pending returns, counted COD,
valid zero-COD, returned-only) and `test/unit/run-settlement.spec.ts`, plus the existing fulfillment, COD, finance, driver and golden-journey suites.
Browser E2E on an isolated database covered: plan → approve → reassign → scan (wrong parcel refused) → dispatch → courier delivery with COD →
failed delivery → receive back → cash count with a recorded shortage → close run, and another courier opening a foreign stop.
