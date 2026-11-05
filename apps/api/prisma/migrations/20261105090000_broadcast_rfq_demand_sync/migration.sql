-- BROADCAST_ON_DEMAND (GLO-283): non-binding RFQs, per-line atomic allocation and a durable demand-event stream.
-- Additive: new tables/enums, two nullable Supplier columns, and relaxed NOT NULLs on source_allocations so a broadcast
-- award needs no SupplierOffer/cost. OFFER_BASED rows and code are untouched.
-- Rollback: DROP the rfq_* tables and procurement_rfqs; DROP the three RFQ enums; drop suppliers.rfq_*; source_allocations
-- NOT NULLs can be restored only after deleting rows with supplier_offer_id IS NULL.
-- CreateEnum
CREATE TYPE "sourcing"."RfqStatus" AS ENUM ('open', 'fulfilled', 'exhausted', 'closed');
-- CreateEnum
CREATE TYPE "sourcing"."RfqRecipientStatus" AS ENUM ('pending', 'responded', 'timed_out');
-- CreateEnum
CREATE TYPE "sourcing"."RfqAnswer" AS ENUM ('FULL', 'PARTIAL', 'UNAVAILABLE');

ALTER TABLE "sourcing"."source_allocations" ADD COLUMN     "rfq_demand_source_id" UUID,
ADD COLUMN     "supplier_id" UUID,
ALTER COLUMN "supplier_offer_id" DROP NOT NULL,
ALTER COLUMN "selected_cost" DROP NOT NULL,
ALTER COLUMN "selected_currency" DROP NOT NULL,
ALTER COLUMN "ranking_decision_id" DROP NOT NULL;

ALTER TABLE "sourcing"."suppliers" ADD COLUMN     "rfq_enrolled_at" TIMESTAMP(3),
ADD COLUMN     "rfq_scope_sku_ids" UUID[] DEFAULT ARRAY[]::UUID[];

CREATE TABLE "sourcing"."procurement_rfqs" (
    "id" UUID NOT NULL,
    "batch_ref" VARCHAR(64) NOT NULL,
    "status" "sourcing"."RfqStatus" NOT NULL DEFAULT 'open',
    "mode" VARCHAR(30) NOT NULL DEFAULT 'BROADCAST_ON_DEMAND',
    "expedited" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT NOT NULL,
    "reason" TEXT,
    "closed_at" TIMESTAMP(3),
    "close_reason" VARCHAR(40),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_rfqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sourcing"."rfq_recipients" (
    "id" UUID NOT NULL,
    "rfq_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "status" "sourcing"."RfqRecipientStatus" NOT NULL DEFAULT 'pending',
    "added_reason" VARCHAR(20) NOT NULL DEFAULT 'INITIAL',
    "deadline_at" TIMESTAMP(3) NOT NULL,
    "opened_at" TIMESTAMP(3),
    "responded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfq_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sourcing"."rfq_demand_lines" (
    "id" UUID NOT NULL,
    "rfq_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "required_quantity" INTEGER NOT NULL,
    "awarded_quantity" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rfq_demand_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sourcing"."rfq_demand_sources" (
    "id" UUID NOT NULL,
    "demand_line_id" UUID NOT NULL,
    "requirement_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "awarded_quantity" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfq_demand_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sourcing"."rfq_responses" (
    "id" UUID NOT NULL,
    "rfq_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(80) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "purchase_order_id" UUID,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfq_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sourcing"."rfq_response_lines" (
    "id" UUID NOT NULL,
    "response_id" UUID NOT NULL,
    "demand_line_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "answer" "sourcing"."RfqAnswer" NOT NULL,
    "offered_quantity" INTEGER NOT NULL,
    "awarded_quantity" INTEGER NOT NULL,
    "based_on_version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfq_response_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sourcing"."rfq_events" (
    "seq" BIGSERIAL NOT NULL,
    "rfq_id" UUID NOT NULL,
    "supplier_id" UUID,
    "type" VARCHAR(40) NOT NULL,
    "actor_id" TEXT NOT NULL,
    "reason" TEXT,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfq_events_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE UNIQUE INDEX "procurement_rfqs_batch_ref_key" ON "sourcing"."procurement_rfqs"("batch_ref");

-- CreateIndex
CREATE INDEX "procurement_rfqs_status_created_at_idx" ON "sourcing"."procurement_rfqs"("status", "created_at");

-- CreateIndex
CREATE INDEX "rfq_recipients_supplier_id_status_idx" ON "sourcing"."rfq_recipients"("supplier_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rfq_recipients_rfq_id_supplier_id_key" ON "sourcing"."rfq_recipients"("rfq_id", "supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "rfq_demand_lines_rfq_id_sku_id_key" ON "sourcing"."rfq_demand_lines"("rfq_id", "sku_id");

-- CreateIndex
CREATE INDEX "rfq_demand_sources_requirement_id_idx" ON "sourcing"."rfq_demand_sources"("requirement_id");

-- CreateIndex
CREATE UNIQUE INDEX "rfq_demand_sources_demand_line_id_requirement_id_key" ON "sourcing"."rfq_demand_sources"("demand_line_id", "requirement_id");

-- CreateIndex
CREATE UNIQUE INDEX "rfq_responses_rfq_id_supplier_id_idempotency_key_key" ON "sourcing"."rfq_responses"("rfq_id", "supplier_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "rfq_response_lines_response_id_idx" ON "sourcing"."rfq_response_lines"("response_id");

-- CreateIndex
CREATE UNIQUE INDEX "rfq_response_lines_demand_line_id_supplier_id_key" ON "sourcing"."rfq_response_lines"("demand_line_id", "supplier_id");

-- CreateIndex
CREATE INDEX "rfq_events_rfq_id_seq_idx" ON "sourcing"."rfq_events"("rfq_id", "seq");

-- CreateIndex
CREATE INDEX "rfq_events_supplier_id_seq_idx" ON "sourcing"."rfq_events"("supplier_id", "seq");

-- AddForeignKey
ALTER TABLE "sourcing"."rfq_recipients" ADD CONSTRAINT "rfq_recipients_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "sourcing"."procurement_rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing"."rfq_recipients" ADD CONSTRAINT "rfq_recipients_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "sourcing"."suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing"."rfq_demand_lines" ADD CONSTRAINT "rfq_demand_lines_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "sourcing"."procurement_rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing"."rfq_demand_sources" ADD CONSTRAINT "rfq_demand_sources_demand_line_id_fkey" FOREIGN KEY ("demand_line_id") REFERENCES "sourcing"."rfq_demand_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing"."rfq_responses" ADD CONSTRAINT "rfq_responses_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "sourcing"."procurement_rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing"."rfq_response_lines" ADD CONSTRAINT "rfq_response_lines_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "sourcing"."rfq_responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing"."rfq_response_lines" ADD CONSTRAINT "rfq_response_lines_demand_line_id_fkey" FOREIGN KEY ("demand_line_id") REFERENCES "sourcing"."rfq_demand_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing"."rfq_events" ADD CONSTRAINT "rfq_events_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "sourcing"."procurement_rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "care"."customer_usage_schedules_unique_entry" RENAME TO "customer_usage_schedules_customer_routine_id_routine_item_i_key";


-- Invariants enforced by the database itself: demand can never go negative or be over-awarded.
ALTER TABLE "sourcing"."rfq_demand_lines" ADD CONSTRAINT "rfq_demand_lines_quantities_check"
  CHECK ("required_quantity" > 0 AND "awarded_quantity" >= 0 AND "awarded_quantity" <= "required_quantity");
ALTER TABLE "sourcing"."rfq_demand_sources" ADD CONSTRAINT "rfq_demand_sources_quantities_check"
  CHECK ("quantity" > 0 AND "awarded_quantity" >= 0 AND "awarded_quantity" <= "quantity");
ALTER TABLE "sourcing"."rfq_response_lines" ADD CONSTRAINT "rfq_response_lines_quantities_check"
  CHECK ("offered_quantity" >= 0 AND "awarded_quantity" >= 0 AND "awarded_quantity" <= "offered_quantity");
