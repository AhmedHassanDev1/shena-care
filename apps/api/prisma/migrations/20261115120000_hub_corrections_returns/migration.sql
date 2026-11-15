-- GLO-315: auditable Hub corrections, order-level scan attempts and physical return inspections.
-- Additive. Receipts stay append-only: a correction is a compensating (negative) receipt that points at the original.

-- 1. Compensating receipts -------------------------------------------------------------------------
ALTER TABLE "fulfillment"."fulfillment_receipts"
  ADD COLUMN "reverses_receipt_id" UUID,
  ADD COLUMN "correction_reason" VARCHAR(40),
  ADD COLUMN "correction_note" TEXT;

ALTER TABLE "fulfillment"."fulfillment_receipts" DROP CONSTRAINT "fulfillment_receipts_quantity_check";
ALTER TABLE "fulfillment"."fulfillment_receipts" ADD CONSTRAINT "fulfillment_receipts_quantity_check" CHECK (
  ("reverses_receipt_id" IS NULL AND "quantity" > 0)
  OR ("reverses_receipt_id" IS NOT NULL AND "quantity" < 0 AND "correction_reason" IS NOT NULL)
);
-- A receipt can be reversed at most once (DB-level, so concurrent corrections cannot both land).
CREATE UNIQUE INDEX "fulfillment_receipts_reverses_receipt_id_key" ON "fulfillment"."fulfillment_receipts"("reverses_receipt_id");
ALTER TABLE "fulfillment"."fulfillment_receipts"
  ADD CONSTRAINT "fulfillment_receipts_reverses_receipt_id_fkey" FOREIGN KEY ("reverses_receipt_id")
  REFERENCES "fulfillment"."fulfillment_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. Scan attempts that changed nothing (rejected barcodes, before or after a shipment exists) --------
CREATE TABLE "fulfillment"."hub_scan_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "location_id" UUID NOT NULL,
  "context" VARCHAR(20) NOT NULL,
  "order_id" UUID NOT NULL,
  "resolution_id" UUID,
  "client_scan_id" UUID NOT NULL,
  "barcode_scanned" VARCHAR(64),
  "sku_id" UUID,
  "outcome_code" VARCHAR(60) NOT NULL,
  "actor_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hub_scan_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hub_scan_attempts_context_check" CHECK ("context" IN ('desk', 'return')),
  CONSTRAINT "hub_scan_attempts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "fulfillment"."fulfillment_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "hub_scan_attempts_order_id_client_scan_id_key" ON "fulfillment"."hub_scan_attempts"("order_id", "client_scan_id");
CREATE INDEX "hub_scan_attempts_order_id_created_at_idx" ON "fulfillment"."hub_scan_attempts"("order_id", "created_at");

-- 3. Physical return inspections (never a refund decision) -------------------------------------------------
CREATE TABLE "fulfillment"."return_receipts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "location_id" UUID NOT NULL,
  "resolution_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "order_item_id" UUID NOT NULL,
  "sku_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "identity_method" VARCHAR(20) NOT NULL,
  "barcode_scanned" VARCHAR(64),
  "inspection_result" VARCHAR(20) NOT NULL,
  "disposition" VARCHAR(24) NOT NULL,
  "lot_number" VARCHAR(64),
  "expiry_date" DATE,
  "note" TEXT,
  "supersedes_id" UUID,
  "correction_reason" TEXT,
  "idempotency_key" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "return_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "return_receipts_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "return_receipts_result_check" CHECK ("inspection_result" IN ('SEALED_INTACT','OPENED_UNUSED','USED','DAMAGED','EXPIRED')),
  CONSTRAINT "return_receipts_disposition_check" CHECK ("disposition" IN ('RETURN_TO_SUPPLIER','WRITE_OFF','QUARANTINE')),
  -- Owner policy 2026-10-25: only sealed, intact goods go back to the supplier.
  CONSTRAINT "return_receipts_supplier_return_check" CHECK ("disposition" <> 'RETURN_TO_SUPPLIER' OR "inspection_result" = 'SEALED_INTACT'),
  CONSTRAINT "return_receipts_correction_check" CHECK ("supersedes_id" IS NULL OR "correction_reason" IS NOT NULL),
  CONSTRAINT "return_receipts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "fulfillment"."fulfillment_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "return_receipts_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "fulfillment"."return_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "return_receipts_idempotency_key_key" ON "fulfillment"."return_receipts"("idempotency_key");
-- An inspection is superseded at most once, so the current one per line is unambiguous.
CREATE UNIQUE INDEX "return_receipts_supersedes_id_key" ON "fulfillment"."return_receipts"("supersedes_id");
CREATE INDEX "return_receipts_resolution_id_idx" ON "fulfillment"."return_receipts"("resolution_id");
CREATE INDEX "return_receipts_location_id_idx" ON "fulfillment"."return_receipts"("location_id");
