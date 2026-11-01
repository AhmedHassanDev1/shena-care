ALTER TABLE "sourcing"."suppliers" ADD COLUMN "pickup_lead_minutes" INTEGER;
ALTER TABLE "sourcing"."suppliers" ADD CONSTRAINT "supplier_pickup_lead_nonnegative"
  CHECK ("pickup_lead_minutes" IS NULL OR "pickup_lead_minutes" BETWEEN 0 AND 10080);
ALTER TABLE "sourcing"."supplier_offers"
  ADD COLUMN "minimum_order_units" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "order_multiple_units" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "sourcing"."supplier_offers" ADD CONSTRAINT "supplier_offer_positive_order_terms"
  CHECK ("minimum_order_units" > 0 AND "order_multiple_units" > 0);
CREATE TABLE "sourcing"."sourcing_decisions" (
  "id" UUID NOT NULL,
  "sku_id" UUID NOT NULL,
  "required_quantity" INTEGER NOT NULL,
  "requirement_id" UUID,
  "ranked_offers" JSONB NOT NULL,
  "excluded_offers" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sourcing_decisions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sourcing_decisions_requirement_id_created_at_idx" ON "sourcing"."sourcing_decisions"("requirement_id", "created_at");
CREATE INDEX "sourcing_decisions_sku_id_created_at_idx" ON "sourcing"."sourcing_decisions"("sku_id", "created_at");
CREATE INDEX "purchase_order_lines_distribution_required_created_at_idx" ON "sourcing"."purchase_order_lines"("distribution_required", "created_at");
CREATE INDEX "source_allocations_result_selected_at_idx" ON "sourcing"."source_allocations"("result", "selected_at");
