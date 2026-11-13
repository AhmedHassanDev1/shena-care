-- Profit model (Finance): actual Buy List purchase cost batches, per-order courier/packaging cost records and frozen closed periods.
-- Additive only: three new tables, no existing table is altered.

-- CreateTable
CREATE TABLE "sourcing"."purchase_cost_batches" (
    "id" UUID NOT NULL,
    "acquire_key" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "list_unit_price" DECIMAL(10,2) NOT NULL,
    "discount_per_unit" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "final_unit_cost" DECIMAL(10,2) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "history" JSONB NOT NULL DEFAULT '[]',
    "recorded_by" TEXT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_cost_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations"."order_cost_records" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "courier_cost" DECIMAL(10,2),
    "courier_recorded_by" TEXT,
    "courier_recorded_at" TIMESTAMP(3),
    "packaging_type" VARCHAR(3),
    "packaging_cost" DECIMAL(10,2),
    "packaging_recorded_by" TEXT,
    "packaging_recorded_at" TIMESTAMP(3),
    "corrections" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_cost_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations"."finance_period_closes" (
    "id" UUID NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "profit_share_percent" DECIMAL(5,2) NOT NULL,
    "net_profit" DECIMAL(12,2) NOT NULL,
    "profit_share_amount" DECIMAL(12,2) NOT NULL,
    "figures" JSONB NOT NULL,
    "closed_by" TEXT NOT NULL,
    "closed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_period_closes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_cost_batches_acquire_key_key" ON "sourcing"."purchase_cost_batches"("acquire_key");

-- CreateIndex
CREATE INDEX "purchase_cost_batches_sku_id_idx" ON "sourcing"."purchase_cost_batches"("sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_cost_records_order_id_key" ON "operations"."order_cost_records"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "finance_period_closes_period_key" ON "operations"."finance_period_closes"("period");

