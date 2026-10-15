-- Red-team RT04/RT08/RT14: receipt lot/expiry evidence, append-only delivery instructions, idempotent scans.
-- AlterTable
ALTER TABLE "fulfillment"."fulfillment_receipts" ADD COLUMN     "expiry_date" DATE,
ADD COLUMN     "lot_number" VARCHAR(64);

-- AlterTable
ALTER TABLE "fulfillment"."preparation_scan_events" ADD COLUMN     "client_scan_id" VARCHAR(64);

-- CreateTable
CREATE TABLE "ordering"."delivery_instructions" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "note" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "reason" VARCHAR(40) NOT NULL,
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_instructions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_instructions_order_id_created_at_idx" ON "ordering"."delivery_instructions"("order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "preparation_scan_events_session_id_client_scan_id_key" ON "fulfillment"."preparation_scan_events"("session_id", "client_scan_id");

-- AddForeignKey
ALTER TABLE "ordering"."delivery_instructions" ADD CONSTRAINT "delivery_instructions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ordering"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;


