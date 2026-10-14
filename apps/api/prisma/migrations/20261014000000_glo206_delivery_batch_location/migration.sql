-- GLO-206 / GAP-05: record the dispatching hub on each delivery batch so hub operators can be
-- scoped to their own location's runs. Legacy batches keep NULL (admin-only access).

-- AlterTable
ALTER TABLE "fulfillment"."delivery_batches" ADD COLUMN "location_id" UUID;

-- CreateIndex
CREATE INDEX "delivery_batches_location_id_idx" ON "fulfillment"."delivery_batches"("location_id");

-- CreateIndex
CREATE INDEX "delivery_batches_driver_id_idx" ON "fulfillment"."delivery_batches"("driver_id");

-- AddForeignKey
ALTER TABLE "fulfillment"."delivery_batches" ADD CONSTRAINT "delivery_batches_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "fulfillment"."fulfillment_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
