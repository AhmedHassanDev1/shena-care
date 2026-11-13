-- Purchase batches: scheduled, numbered Buy List batches with manual send confirmation, ETA, partial receipts and an audit trail.
-- Additive only (six new tables in the sourcing schema); no existing table is touched.

-- CreateTable
CREATE TABLE "sourcing"."purchase_batch_settings" (
    "id" VARCHAR(20) NOT NULL DEFAULT 'default',
    "interval_minutes" INTEGER NOT NULL DEFAULT 180,
    "start_time" VARCHAR(5) NOT NULL DEFAULT '09:00',
    "time_zone" VARCHAR(64) NOT NULL DEFAULT 'Africa/Cairo',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_batch_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sourcing"."purchase_batches" (
    "id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "slot_key" VARCHAR(80) NOT NULL,
    "kind" VARCHAR(12) NOT NULL DEFAULT 'scheduled',
    "status" VARCHAR(12) NOT NULL DEFAULT 'ready',
    "cutoff_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "sent_by" TEXT,
    "expected_at" TIMESTAMP(3),
    "note" VARCHAR(300),
    "closed_at" TIMESTAMP(3),
    "closed_by" TEXT,
    "close_reason" VARCHAR(12),

    CONSTRAINT "purchase_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sourcing"."purchase_batch_lines" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "product_name" TEXT,
    "sku_code" TEXT,
    "variant_name" TEXT,
    "required_quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_batch_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sourcing"."purchase_batch_links" (
    "id" UUID NOT NULL,
    "line_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "order_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "received_quantity" INTEGER NOT NULL DEFAULT 0,
    "unavailable_quantity" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_batch_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sourcing"."purchase_batch_receipts" (
    "id" UUID NOT NULL,
    "line_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "acquire_key" UUID NOT NULL,
    "received_by" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_batch_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sourcing"."purchase_batch_events" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "type" VARCHAR(24) NOT NULL,
    "actor_id" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_batch_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_batches_number_key" ON "sourcing"."purchase_batches"("number");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_batches_slot_key_key" ON "sourcing"."purchase_batches"("slot_key");

-- CreateIndex
CREATE INDEX "purchase_batches_status_cutoff_at_idx" ON "sourcing"."purchase_batches"("status", "cutoff_at");

-- CreateIndex
CREATE INDEX "purchase_batch_lines_sku_id_idx" ON "sourcing"."purchase_batch_lines"("sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_batch_lines_batch_id_sku_id_key" ON "sourcing"."purchase_batch_lines"("batch_id", "sku_id");

-- CreateIndex
CREATE INDEX "purchase_batch_links_order_item_id_idx" ON "sourcing"."purchase_batch_links"("order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_batch_links_line_id_order_item_id_key" ON "sourcing"."purchase_batch_links"("line_id", "order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_batch_receipts_acquire_key_key" ON "sourcing"."purchase_batch_receipts"("acquire_key");

-- CreateIndex
CREATE INDEX "purchase_batch_receipts_line_id_idx" ON "sourcing"."purchase_batch_receipts"("line_id");

-- CreateIndex
CREATE INDEX "purchase_batch_events_batch_id_created_at_idx" ON "sourcing"."purchase_batch_events"("batch_id", "created_at");

-- AddForeignKey
ALTER TABLE "sourcing"."purchase_batch_lines" ADD CONSTRAINT "purchase_batch_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "sourcing"."purchase_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing"."purchase_batch_links" ADD CONSTRAINT "purchase_batch_links_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "sourcing"."purchase_batch_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing"."purchase_batch_receipts" ADD CONSTRAINT "purchase_batch_receipts_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "sourcing"."purchase_batch_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing"."purchase_batch_events" ADD CONSTRAINT "purchase_batch_events_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "sourcing"."purchase_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- Exact-quantity guards that the ORM cannot express: a link can never receive or resolve more than it was asked for.
ALTER TABLE "sourcing"."purchase_batch_links" ADD CONSTRAINT "purchase_batch_links_quantities_check"
  CHECK ("quantity" > 0 AND "received_quantity" >= 0 AND "unavailable_quantity" >= 0 AND "received_quantity" + "unavailable_quantity" <= "quantity");
ALTER TABLE "sourcing"."purchase_batch_lines" ADD CONSTRAINT "purchase_batch_lines_required_check" CHECK ("required_quantity" > 0);
ALTER TABLE "sourcing"."purchase_batch_receipts" ADD CONSTRAINT "purchase_batch_receipts_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "sourcing"."purchase_batches" ADD CONSTRAINT "purchase_batches_status_check" CHECK ("status" IN ('ready', 'sent', 'closed'));
ALTER TABLE "sourcing"."purchase_batch_settings" ADD CONSTRAINT "purchase_batch_settings_interval_check" CHECK ("interval_minutes" BETWEEN 15 AND 1440);
