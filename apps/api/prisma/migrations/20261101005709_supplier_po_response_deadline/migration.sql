ALTER TYPE "sourcing"."PurchaseOrderStatus" ADD VALUE 'expired';
ALTER TABLE "sourcing"."supplier_purchase_orders"
  ADD COLUMN "expedited" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "response_deadline_at" TIMESTAMP(3);
CREATE INDEX "supplier_purchase_orders_status_response_deadline_at_idx"
  ON "sourcing"."supplier_purchase_orders"("status", "response_deadline_at");
