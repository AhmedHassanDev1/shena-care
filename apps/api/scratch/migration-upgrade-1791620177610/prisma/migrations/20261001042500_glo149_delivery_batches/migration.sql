-- AlterTable
ALTER TABLE "fulfillment"."delivery_batches" ALTER COLUMN "status" SET DEFAULT 'planning';
ALTER TABLE "fulfillment"."shipments" DROP CONSTRAINT IF EXISTS "shipments_delivery_batch_id_fkey";
ALTER TABLE "fulfillment"."shipments" DROP COLUMN IF EXISTS "delivery_batch_id";

-- CreateTable
CREATE TABLE "fulfillment"."delivery_stops" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_stops_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "delivery_stops_shipment_id_key" ON "fulfillment"."delivery_stops"("shipment_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_stops_batch_id_sequence_key" ON "fulfillment"."delivery_stops"("batch_id", "sequence");

-- AddForeignKey
ALTER TABLE "fulfillment"."delivery_stops" ADD CONSTRAINT "delivery_stops_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "fulfillment"."delivery_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment"."delivery_stops" ADD CONSTRAINT "delivery_stops_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "fulfillment"."shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
