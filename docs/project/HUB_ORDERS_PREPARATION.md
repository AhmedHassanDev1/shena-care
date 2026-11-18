# Hub — Orders & Preparation (verification, barcodes, packaging, printing, handoff)

Screen: `apps/business` → `/hub/orders`. Backend owner: `modules/fulfillment` (desk, shipments, print events) with two cross-context
checks supplied by `application/composition` (packaging record, loss review). No schema change: everything below reuses existing tables.

## Flow

1. **Receive + verify (one scan per unit).** `POST /fulfillment/locations/:id/desk/orders/:orderId/scan` — a unit bought on the Buy List is
   received against its exact order line and, through that same scan, counts as the preparation verification. Wrong item, unknown or
   ambiguous code, excess/duplicate unit, not-yet-bought unit and a closed order are all refused, change no quantity, and are recorded in
   `fulfillment.hub_scan_attempts`. A retry with the same `clientScanId` returns the original outcome.
   Input sources are equal: hardware scanner (keyboard), typing, or the mobile/webcam camera (`BarcodeDetector`, needs https or localhost).
   The camera reports a code once until it leaves the frame, and goes through exactly the same endpoint and checks.
2. **Missing barcode.** `POST …/desk/orders/:orderId/register-barcode` registers a code for a product that has **none yet** (no primary
   barcode, no approved alias), after the operator ticks all four checks (brand, variant, size, pack) and writes a note (≥ 5 chars).
   Refusals (all recorded as `REGISTER_*` attempts on the order, nothing saved): `INVALID_BARCODE` (not GTIN-8/12/13/14 with a correct
   check digit), `WRONG_ITEM` (SKU not in the order), `BARCODE_ALREADY_USED` (code belongs to another product), `SKU_ALREADY_HAS_BARCODE`.
   Success = an approved `catalog.sku_barcode_aliases` row (`source = hub_registration`, `approved_by` = the actor, `evidence_ref =
   hub-desk:<orderId>`, reason with the checks) + a `BARCODE_REGISTERED` attempt. The SKU's own catalog identity is never rewritten; a
   different code for a product that already has one goes through catalog review (`/catalog/barcode-aliases`, Admin).
   Manual fallback with no readable barcode stays: "تحقق يدوي" (reason + all four checks, audited on the receipt and the preparation scan).
3. **Print.** Two papers: customer receipt and shipping label (`GET /fulfillment/shipments/:id/documents`, `POST …/label`). The server never
   infers printing: the operator confirms each paper (`RECEIPT_PRINTED` / `LABEL_PRINTED`) or reports `PRINT_FAILED` with `document`
   (`RECEIPT` | `LABEL`) and a required reason. **The latest event of each paper wins** (`print-state.ts`): a failure after a confirmation
   reopens that paper. The UI only offers "طلعت سليمة / فشلت" after the paper was sent to the printer from the screen.
4. **Packaging.** `PUT /order-costs/:orderId { packagingType: BAG | BOX }` records the type and snapshots the configured cost at that moment
   (Admin settings `commerce.packaging.bag_cost` / `box_cost`). A recorded packaging can only be replaced by an Admin with a reason.
   Packaging *size* does not exist in the settings (only the two types), so it is not recorded.
5. **Handoff.** `POST /fulfillment/shipments/:id/events { type: PACKED }` is refused (409, typed) unless: preparation was verified by scan
   (status machine), the label was generated (`LABEL_NOT_GENERATED`), both papers are currently printed (`PRINT_NOT_CONFIRMED`) and the
   packaging is recorded (`PACKAGING_NOT_RECORDED`). A replay of an already packed parcel is a no-op.

## Costs and pricing

- Actual purchase cost is captured in the purchasing/receiving workflow only: Buy List count or the first receipt scan
  (`PurchaseCostService`, list price − discount). A recorded cost can only be corrected with a reason (history kept).
- The customer's confirmed price (`order_items.price`, `line_total`, `orders.total_amount`) is never touched by any of this.
- Per-order margin (`OrderProfitabilityService`, same terms as the monthly profit model): goods net − purchase cost − packaging −
  company-funded delivery (courier beyond the customer's fee). `GET /order-costs/:orderId/profitability` is **Admin only**.
- A loss (recorded costs already exceed the goods sold) opens one deduplicated operational exception (`order-loss:<orderId>`, category
  `sourcing`, priority high) when packaging is recorded and again, idempotently, when the parcel is packed. It never blocks the parcel; an
  authorized reviewer decides in the Admin exceptions queue. Future catalog pricing is a separate decision.

## Wiring

`FulfillmentService.registerPackingGate()` is called at start-up by `PackingReadinessService` (composition), so Fulfillment never reads
`operations.order_cost_records`. Tests that pack parcels use `test/fixtures/pack-ready.ts`.

## Verification

`test/unit/order-handoff.spec.ts`, `test/integration/hub-orders-preparation.e2e-spec.ts`, plus the existing hub-desk, golden-journeys,
fulfillment-lifecycle, glo-210 and profit suites (run with the right `SOURCING_MODE`).

## Screen (apps/business `/hub/orders`)

One screen, no steps: a compact queue (desktop: beside the workspace; phone: its own list screen) and, per order, a light bar with three
controls — **packaging** (a select showing the real configured cost), **print** (sends both papers, then an inline "سليم / فشل" with
preset reasons; the label and receipt are tracked separately), **handoff** (enabled only when verified + printed + packaging recorded).
Scanning is the main action: hardware scanner (keyboard), typing, or the phone camera (`BarcodeDetector`, https/localhost only).
Problems go through one guided "مش بيتمسح؟" flow (unreadable barcode → confirm the pack; product without a barcode → register it).
Screens: `docs/project/hub-orders-screens/` (`before-*` = previous screen, `v2-*` = this one, real data in a scratch database).
Code: `components/workspace/prep/*`, `camera-scanner.tsx`; the legacy `/hub/pack` page still uses `pack-card.tsx`.
