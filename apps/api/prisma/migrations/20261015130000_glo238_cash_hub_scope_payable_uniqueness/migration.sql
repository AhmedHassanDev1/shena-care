-- GLO-238: hub-scoped COD counting and one payable per purchase order with an auditable basis.
ALTER TABLE "ordering"."payment_collections" ADD COLUMN "location_id" UUID;
ALTER TABLE "ordering"."courier_settlement_batches" ADD COLUMN "location_id" UUID;

ALTER TABLE "sourcing"."supplier_payables" ADD COLUMN "basis" JSONB;
-- Fails loudly if historical duplicates exist; they must be reviewed, never silently merged.
DROP INDEX IF EXISTS "sourcing"."supplier_payables_purchase_order_id_idx";
CREATE UNIQUE INDEX "supplier_payables_purchase_order_id_key" ON "sourcing"."supplier_payables"("purchase_order_id");
