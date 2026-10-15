-- GLO-237: consolidated supplier POs with quantity-aware PO-line -> order allocation lineage.
-- AlterEnum
ALTER TYPE "sourcing"."PurchaseOrderLineStatus" ADD VALUE 'price_changed';

-- AlterTable
ALTER TABLE "sourcing"."purchase_order_lines" ADD COLUMN     "currency" VARCHAR(3),
ADD COLUMN     "distributed_at" TIMESTAMP(3),
ADD COLUMN     "distributed_by" TEXT,
ADD COLUMN     "distribution_reason" TEXT,
ADD COLUMN     "distribution_required" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "supplier_offer_id" UUID,
ADD COLUMN     "unit_cost" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "sourcing"."supplier_purchase_orders" ADD COLUMN     "batch_ref" VARCHAR(64),
ADD COLUMN     "confirmed_at" TIMESTAMP(3),
ADD COLUMN     "issued_at" TIMESTAMP(3),
ADD COLUMN     "ready_at" TIMESTAMP(3),
ADD COLUMN     "received_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "sourcing"."purchase_order_line_allocations" (
    "id" UUID NOT NULL,
    "purchase_order_line_id" UUID NOT NULL,
    "source_allocation_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "confirmed_quantity" INTEGER,
    "received_quantity" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_order_line_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_line_allocations_source_allocation_id_key" ON "sourcing"."purchase_order_line_allocations"("source_allocation_id");

-- CreateIndex
CREATE INDEX "purchase_order_line_allocations_purchase_order_line_id_idx" ON "sourcing"."purchase_order_line_allocations"("purchase_order_line_id");

-- CreateIndex
CREATE INDEX "purchase_order_line_allocations_order_id_idx" ON "sourcing"."purchase_order_line_allocations"("order_id");

-- CreateIndex
CREATE INDEX "supplier_purchase_orders_batch_ref_idx" ON "sourcing"."supplier_purchase_orders"("batch_ref");

-- AddForeignKey
ALTER TABLE "sourcing"."purchase_order_line_allocations" ADD CONSTRAINT "purchase_order_line_allocations_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "sourcing"."purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing"."purchase_order_line_allocations" ADD CONSTRAINT "purchase_order_line_allocations_source_allocation_id_fkey" FOREIGN KEY ("source_allocation_id") REFERENCES "sourcing"."source_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


