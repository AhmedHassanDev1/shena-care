ALTER TABLE "sourcing"."rfq_responses"
  ADD COLUMN "confirmation_source" VARCHAR(10),
  ADD COLUMN "confirmed_at" TIMESTAMP(3);

ALTER TABLE "sourcing"."supplier_purchase_orders"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "supplier_purchase_orders_supplier_id_batch_ref_version_idx"
  ON "sourcing"."supplier_purchase_orders"("supplier_id", "batch_ref", "version");
