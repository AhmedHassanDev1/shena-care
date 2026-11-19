-- Hub shortages and the authorized quantity adjustment of an order line (append-only audit: the original line and money are kept in before/after).
-- CreateEnum
CREATE TYPE "ordering"."OrderAdjustmentStatus" AS ENUM ('proposed', 'applied', 'rejected', 'superseded');

-- CreateTable
CREATE TABLE "ordering"."order_quantity_adjustments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "location_id" UUID,
    "client_request_id" UUID NOT NULL,
    "status" "ordering"."OrderAdjustmentStatus" NOT NULL DEFAULT 'proposed',
    "ordered_quantity" INTEGER NOT NULL,
    "missing_quantity" INTEGER NOT NULL,
    "reason" VARCHAR(300),
    "proposed_by" TEXT NOT NULL,
    "proposed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" VARCHAR(300),
    "before" JSONB,
    "after" JSONB,
    "cod_before" DECIMAL(10,2),
    "cod_after" DECIMAL(10,2),
    "total_before" DECIMAL(10,2),
    "total_after" DECIMAL(10,2),
    "currency" VARCHAR(3),

    CONSTRAINT "order_quantity_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_quantity_adjustments_client_request_id_key" ON "ordering"."order_quantity_adjustments"("client_request_id");

-- CreateIndex
CREATE INDEX "order_quantity_adjustments_order_id_idx" ON "ordering"."order_quantity_adjustments"("order_id");

-- CreateIndex
CREATE INDEX "order_quantity_adjustments_order_item_id_status_idx" ON "ordering"."order_quantity_adjustments"("order_item_id", "status");

-- AddForeignKey
ALTER TABLE "ordering"."order_quantity_adjustments" ADD CONSTRAINT "order_quantity_adjustments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ordering"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordering"."order_quantity_adjustments" ADD CONSTRAINT "order_quantity_adjustments_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "ordering"."order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One open proposal per order line; quantities must make sense.
CREATE UNIQUE INDEX "order_quantity_adjustments_one_open_per_item" ON "ordering"."order_quantity_adjustments"("order_item_id") WHERE "status" = 'proposed';
ALTER TABLE "ordering"."order_quantity_adjustments" ADD CONSTRAINT "order_quantity_adjustments_quantities_check" CHECK ("missing_quantity" >= 1 AND "missing_quantity" < "ordered_quantity");
