-- CreateSchemas
CREATE SCHEMA IF NOT EXISTS "operations";
CREATE SCHEMA IF NOT EXISTS "accounts";
CREATE SCHEMA IF NOT EXISTS "ordering";
CREATE SCHEMA IF NOT EXISTS "sourcing";

-- CreateEnum
CREATE TYPE "sourcing"."PayableStatus" AS ENUM ('open', 'ready_to_pay', 'paid', 'disputed', 'adjusted');

-- CreateEnum
CREATE TYPE "ordering"."OrderResolutionType" AS ENUM ('cancellation', 'return', 'refund', 'replacement', 'compensation');

-- CreateEnum
CREATE TYPE "ordering"."OrderResolutionStatus" AS ENUM ('requested', 'approved', 'rejected', 'in_transit', 'received', 'resolved');

-- CreateEnum
CREATE TYPE "ordering"."RefundStatus" AS ENUM ('pending', 'processing', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "ordering"."SettlementStatus" AS ENUM ('expected', 'collected', 'settled', 'short', 'over', 'disputed');

-- CreateEnum
CREATE TYPE "accounts"."Role" AS ENUM ('CUSTOMER', 'ADMIN', 'HUB_OPERATOR', 'SUPPLIER', 'DRIVER');

-- CreateEnum
CREATE TYPE "operations"."OutboxEventStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "operations"."SupportCaseStatus" AS ENUM ('open', 'in_progress', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "operations"."SupportCasePriority" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "operations"."SupportCaseCategory" AS ENUM ('payment', 'sourcing', 'delivery', 'damaged_item', 'wrong_item', 'cancellation', 'return', 'supplier_dispute', 'other');

-- CreateEnum
CREATE TYPE "operations"."AccountingExportStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- AlterTable
ALTER TABLE "accounts"."customers" ADD COLUMN     "roles" "accounts"."Role"[] DEFAULT ARRAY['CUSTOMER']::"accounts"."Role"[];

-- CreateTable
CREATE TABLE "sourcing"."supplier_payables" (
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" "sourcing"."PayableStatus" NOT NULL DEFAULT 'open',
    "due_date" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "payment_ref" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_payables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sourcing"."payable_adjustments" (
    "id" UUID NOT NULL,
    "payable_id" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payable_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordering"."order_resolutions" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "type" "ordering"."OrderResolutionType" NOT NULL,
    "status" "ordering"."OrderResolutionStatus" NOT NULL DEFAULT 'requested',
    "reason_code" TEXT,
    "notes" TEXT,
    "resolution_details" JSONB,
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordering"."order_resolution_items" (
    "id" UUID NOT NULL,
    "resolution_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "order_resolution_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordering"."order_resolution_events" (
    "id" UUID NOT NULL,
    "resolution_id" UUID NOT NULL,
    "status" "ordering"."OrderResolutionStatus" NOT NULL,
    "actor_id" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_resolution_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordering"."refund_transactions" (
    "id" UUID NOT NULL,
    "resolution_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" "ordering"."RefundStatus" NOT NULL DEFAULT 'pending',
    "payment_provider" TEXT,
    "provider_ref" TEXT,
    "error_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refund_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordering"."payment_collections" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "expected_amount" DECIMAL(10,2) NOT NULL,
    "collected_amount" DECIMAL(10,2),
    "currency" VARCHAR(3) NOT NULL,
    "status" "ordering"."SettlementStatus" NOT NULL DEFAULT 'expected',
    "courier_id" TEXT,
    "settlement_batch_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordering"."courier_settlement_batches" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "courier_id" TEXT NOT NULL,
    "total_expected" DECIMAL(10,2) NOT NULL,
    "total_collected" DECIMAL(10,2) NOT NULL,
    "fees" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "net_settled" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "settled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_id" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "courier_settlement_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment"."inventory_balances" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "owned_on_hand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "available_to_sell" INTEGER NOT NULL DEFAULT 0,
    "order_allocated_external_goods" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment"."inventory_transactions" (
    "id" UUID NOT NULL,
    "balance_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT,
    "actor_id" TEXT,
    "reference_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations"."outbox_events" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "operations"."OutboxEventStatus" NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations"."support_cases" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "operations"."SupportCaseCategory" NOT NULL DEFAULT 'other',
    "priority" "operations"."SupportCasePriority" NOT NULL DEFAULT 'medium',
    "status" "operations"."SupportCaseStatus" NOT NULL DEFAULT 'open',
    "customer_id" TEXT,
    "order_id" UUID,
    "supplier_id" UUID,
    "assignee_id" TEXT,
    "internal_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations"."accounting_export_jobs" (
    "id" UUID NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "status" "operations"."AccountingExportStatus" NOT NULL DEFAULT 'pending',
    "file_url" TEXT,
    "error" TEXT,
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_payables_supplier_id_idx" ON "sourcing"."supplier_payables"("supplier_id");

-- CreateIndex
CREATE INDEX "supplier_payables_purchase_order_id_idx" ON "sourcing"."supplier_payables"("purchase_order_id");

-- CreateIndex
CREATE INDEX "payable_adjustments_payable_id_idx" ON "sourcing"."payable_adjustments"("payable_id");

-- CreateIndex
CREATE INDEX "order_resolutions_order_id_idx" ON "ordering"."order_resolutions"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_resolution_items_resolution_id_order_item_id_key" ON "ordering"."order_resolution_items"("resolution_id", "order_item_id");

-- CreateIndex
CREATE INDEX "order_resolution_events_resolution_id_idx" ON "ordering"."order_resolution_events"("resolution_id");

-- CreateIndex
CREATE UNIQUE INDEX "refund_transactions_resolution_id_key" ON "ordering"."refund_transactions"("resolution_id");

-- CreateIndex
CREATE INDEX "refund_transactions_order_id_idx" ON "ordering"."refund_transactions"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_collections_order_id_key" ON "ordering"."payment_collections"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "courier_settlement_batches_reference_key" ON "ordering"."courier_settlement_batches"("reference");

-- CreateIndex
CREATE INDEX "inventory_balances_location_id_idx" ON "fulfillment"."inventory_balances"("location_id");

-- CreateIndex
CREATE INDEX "inventory_balances_sku_id_idx" ON "fulfillment"."inventory_balances"("sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_balances_location_id_sku_id_key" ON "fulfillment"."inventory_balances"("location_id", "sku_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_balance_id_idx" ON "fulfillment"."inventory_transactions"("balance_id");

-- CreateIndex
CREATE INDEX "outbox_events_status_idx" ON "operations"."outbox_events"("status");

-- CreateIndex
CREATE INDEX "support_cases_status_idx" ON "operations"."support_cases"("status");

-- CreateIndex
CREATE INDEX "support_cases_assignee_id_idx" ON "operations"."support_cases"("assignee_id");

-- AddForeignKey
ALTER TABLE "sourcing"."supplier_payables" ADD CONSTRAINT "supplier_payables_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "sourcing"."suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing"."supplier_payables" ADD CONSTRAINT "supplier_payables_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "sourcing"."supplier_purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing"."payable_adjustments" ADD CONSTRAINT "payable_adjustments_payable_id_fkey" FOREIGN KEY ("payable_id") REFERENCES "sourcing"."supplier_payables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordering"."order_resolutions" ADD CONSTRAINT "order_resolutions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ordering"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordering"."order_resolution_items" ADD CONSTRAINT "order_resolution_items_resolution_id_fkey" FOREIGN KEY ("resolution_id") REFERENCES "ordering"."order_resolutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordering"."order_resolution_items" ADD CONSTRAINT "order_resolution_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "ordering"."order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordering"."order_resolution_events" ADD CONSTRAINT "order_resolution_events_resolution_id_fkey" FOREIGN KEY ("resolution_id") REFERENCES "ordering"."order_resolutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordering"."refund_transactions" ADD CONSTRAINT "refund_transactions_resolution_id_fkey" FOREIGN KEY ("resolution_id") REFERENCES "ordering"."order_resolutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordering"."refund_transactions" ADD CONSTRAINT "refund_transactions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ordering"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordering"."payment_collections" ADD CONSTRAINT "payment_collections_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ordering"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordering"."payment_collections" ADD CONSTRAINT "payment_collections_settlement_batch_id_fkey" FOREIGN KEY ("settlement_batch_id") REFERENCES "ordering"."courier_settlement_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment"."inventory_balances" ADD CONSTRAINT "inventory_balances_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "fulfillment"."fulfillment_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment"."inventory_transactions" ADD CONSTRAINT "inventory_transactions_balance_id_fkey" FOREIGN KEY ("balance_id") REFERENCES "fulfillment"."inventory_balances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

