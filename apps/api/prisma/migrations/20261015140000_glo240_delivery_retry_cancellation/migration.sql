-- GLO-240: retryable delivery attempts with history, cancellation before custody, returned-to-sender orders.
-- AlterEnum
ALTER TYPE "fulfillment"."ShipmentStatus" ADD VALUE 'cancelled';

-- AlterEnum
ALTER TYPE "ordering"."OrderStatus" ADD VALUE 'returned';

-- AlterEnum
ALTER TYPE "ordering"."SettlementStatus" ADD VALUE 'voided';

-- DropIndex
DROP INDEX "fulfillment"."delivery_stops_shipment_id_key";

-- AlterTable
ALTER TABLE "fulfillment"."delivery_stops" ADD COLUMN     "closed_at" TIMESTAMP(3),
ADD COLUMN     "status" VARCHAR(20) NOT NULL DEFAULT 'active';

-- AlterTable
ALTER TABLE "fulfillment"."shipment_events" ADD COLUMN     "reason_code" VARCHAR(40);

-- CreateIndex
CREATE INDEX "delivery_stops_shipment_id_idx" ON "fulfillment"."delivery_stops"("shipment_id");


-- Existing attempts that already ended are history, not active.
UPDATE "fulfillment"."delivery_stops" ds
SET "status" = s."status"::text, "closed_at" = COALESCE(s."delivered_at", s."updated_at")
FROM "fulfillment"."shipments" s
WHERE ds."shipment_id" = s."id" AND s."status" IN ('delivered', 'returned');

-- At most one active (in-progress) delivery attempt per shipment; closed attempts are history.
CREATE UNIQUE INDEX "delivery_stops_one_active_per_shipment" ON "fulfillment"."delivery_stops"("shipment_id") WHERE "status" = 'active';
