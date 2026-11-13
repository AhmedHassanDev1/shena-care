-- «Why I bought it» (GLO-314): optional customer-stated reason per purchased order line. Additive; the order line itself is untouched.

-- CreateTable
CREATE TABLE "ordering"."order_item_purchase_reasons" (
    "id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "reason_codes" TEXT[],
    "note" VARCHAR(200),
    "source" VARCHAR(20),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_item_purchase_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_item_purchase_reasons_order_item_id_key" ON "ordering"."order_item_purchase_reasons"("order_item_id");

-- AddForeignKey
ALTER TABLE "ordering"."order_item_purchase_reasons" ADD CONSTRAINT "order_item_purchase_reasons_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "ordering"."order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
