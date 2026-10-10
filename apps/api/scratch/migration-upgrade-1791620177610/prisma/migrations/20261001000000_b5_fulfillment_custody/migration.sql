-- CreateEnum
CREATE TYPE "fulfillment"."PreparationSessionStatus" AS ENUM ('in_progress', 'completed');

-- AlterEnum
-- Note: 'packing' already defined in init_tables. Only new values added here.
ALTER TYPE "fulfillment"."ShipmentStatus" ADD VALUE 'ready_to_prepare';
ALTER TYPE "fulfillment"."ShipmentStatus" ADD VALUE 'preparing';
ALTER TYPE "fulfillment"."ShipmentStatus" ADD VALUE 'prepared';
ALTER TYPE "fulfillment"."ShipmentStatus" ADD VALUE 'ready_to_pack';
ALTER TYPE "fulfillment"."ShipmentStatus" ADD VALUE 'packed';
ALTER TYPE "fulfillment"."ShipmentStatus" ADD VALUE 'out_for_delivery';
ALTER TYPE "fulfillment"."ShipmentStatus" ADD VALUE 'returned';

-- AlterTable
ALTER TABLE "fulfillment"."shipments" ADD COLUMN "delivery_batch_id" UUID;

-- CreateTable
CREATE TABLE "fulfillment"."delivery_batches" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "hub_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planning',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "delivery_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment"."shipment_events" (
    "id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "actor_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shipment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment"."shipment_preparation_sessions" (
    "id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "operator_id" TEXT NOT NULL,
    "status" "fulfillment"."PreparationSessionStatus" NOT NULL DEFAULT 'in_progress',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "shipment_preparation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment"."preparation_scan_events" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "sku_id" UUID,
    "barcode_scanned" TEXT,
    "is_successful" BOOLEAN NOT NULL DEFAULT true,
    "error_reason" TEXT,
    "scanned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "preparation_scan_events_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "fulfillment"."shipments" ADD CONSTRAINT "shipments_delivery_batch_id_fkey" FOREIGN KEY ("delivery_batch_id") REFERENCES "fulfillment"."delivery_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment"."shipment_events" ADD CONSTRAINT "shipment_events_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "fulfillment"."shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment"."shipment_preparation_sessions" ADD CONSTRAINT "shipment_preparation_sessions_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "fulfillment"."shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment"."preparation_scan_events" ADD CONSTRAINT "preparation_scan_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "fulfillment"."shipment_preparation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
