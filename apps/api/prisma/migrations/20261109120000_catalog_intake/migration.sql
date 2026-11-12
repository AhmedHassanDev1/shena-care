-- CreateEnum
CREATE TYPE "ingestion"."IntakeSource" AS ENUM ('ADMIN', 'SUPPLIER');

-- CreateEnum
CREATE TYPE "ingestion"."IntakeJobStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ingestion"."IntakeRowOutcome" AS ENUM ('PENDING', 'SKIPPED', 'MATCHED', 'UPDATED', 'UNMATCHED', 'INVALID', 'CRITICAL', 'DRAFT_CREATED', 'LINKED_EXISTING', 'UNRESOLVED');

-- CreateEnum
CREATE TYPE "ingestion"."MarketPriceCheckStatus" AS ENUM ('REFERENCE_READY', 'UNAVAILABLE', 'FAILED');

-- AlterTable
ALTER TABLE "sourcing"."supplier_offers" ADD COLUMN     "consumer_price" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "sourcing"."supplier_offer_price_events" (
    "id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "purchase_price" DECIMAL(10,2) NOT NULL,
    "consumer_price" DECIMAL(10,2),
    "currency" VARCHAR(3) NOT NULL,
    "source_type" VARCHAR(20) NOT NULL,
    "source_ref" TEXT,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_offer_price_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion"."intake_jobs" (
    "id" UUID NOT NULL,
    "source" "ingestion"."IntakeSource" NOT NULL,
    "supplier_id" UUID,
    "submitted_by" UUID NOT NULL,
    "input_kind" VARCHAR(10) NOT NULL,
    "source_file_name" TEXT,
    "source_mime_type" TEXT,
    "source_size_bytes" INTEGER,
    "source_checksum" VARCHAR(64) NOT NULL,
    "column_map" JSONB,
    "snapshot" JSONB,
    "status" "ingestion"."IntakeJobStatus" NOT NULL DEFAULT 'RECEIVED',
    "totals" JSONB,
    "metrics" JSONB,
    "last_error" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intake_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion"."intake_rows" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "raw_name" TEXT NOT NULL,
    "source_cells" JSONB NOT NULL,
    "normalized_name" TEXT,
    "fingerprint" VARCHAR(64),
    "supplier_code" TEXT,
    "barcode" TEXT,
    "purchase_price" DECIMAL(10,2),
    "consumer_price" DECIMAL(10,2),
    "currency" VARCHAR(3),
    "quantity" INTEGER,
    "parsed" JSONB,
    "outcome" "ingestion"."IntakeRowOutcome" NOT NULL DEFAULT 'PENDING',
    "reason_code" VARCHAR(80),
    "reason" TEXT,
    "matched_sku_id" UUID,
    "candidates" JSONB,
    "evidence" JSONB,
    "readiness" JSONB,
    "stage" VARCHAR(30),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "lease_until" TIMESTAMP(3),
    "last_error" TEXT,
    "processing_ms" INTEGER,
    "cost" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intake_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion"."intake_identity_aliases" (
    "id" UUID NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "scope_key" VARCHAR(40) NOT NULL,
    "sku_id" UUID NOT NULL,
    "basis" VARCHAR(20) NOT NULL,
    "sample_text" TEXT NOT NULL,
    "confirmations" INTEGER NOT NULL DEFAULT 1,
    "retired_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intake_identity_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion"."market_price_checks" (
    "id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "status" "ingestion"."MarketPriceCheckStatus" NOT NULL,
    "reason_code" VARCHAR(80),
    "reference" JSONB,
    "coverage" JSONB NOT NULL,
    "cost" JSONB,
    "requested_by" UUID NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "market_price_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_offer_price_events_source_ref_key" ON "sourcing"."supplier_offer_price_events"("source_ref");

-- CreateIndex
CREATE INDEX "supplier_offer_price_events_offer_id_observed_at_idx" ON "sourcing"."supplier_offer_price_events"("offer_id", "observed_at");

-- CreateIndex
CREATE INDEX "supplier_offer_price_events_sku_id_idx" ON "sourcing"."supplier_offer_price_events"("sku_id");

-- CreateIndex
CREATE INDEX "intake_jobs_source_status_idx" ON "ingestion"."intake_jobs"("source", "status");

-- CreateIndex
CREATE INDEX "intake_jobs_supplier_id_created_at_idx" ON "ingestion"."intake_jobs"("supplier_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "intake_jobs_source_source_checksum_submitted_by_key" ON "ingestion"."intake_jobs"("source", "source_checksum", "submitted_by");

-- CreateIndex
CREATE INDEX "intake_rows_job_id_outcome_idx" ON "ingestion"."intake_rows"("job_id", "outcome");

-- CreateIndex
CREATE INDEX "intake_rows_fingerprint_idx" ON "ingestion"."intake_rows"("fingerprint");

-- CreateIndex
CREATE INDEX "intake_rows_matched_sku_id_idx" ON "ingestion"."intake_rows"("matched_sku_id");

-- CreateIndex
CREATE INDEX "intake_rows_outcome_next_attempt_at_idx" ON "ingestion"."intake_rows"("outcome", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "intake_rows_job_id_row_number_key" ON "ingestion"."intake_rows"("job_id", "row_number");

-- CreateIndex
CREATE INDEX "intake_identity_aliases_sku_id_idx" ON "ingestion"."intake_identity_aliases"("sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "intake_identity_aliases_fingerprint_scope_key_key" ON "ingestion"."intake_identity_aliases"("fingerprint", "scope_key");

-- CreateIndex
CREATE INDEX "market_price_checks_sku_id_started_at_idx" ON "ingestion"."market_price_checks"("sku_id", "started_at");

-- AddForeignKey
ALTER TABLE "ingestion"."intake_rows" ADD CONSTRAINT "intake_rows_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "ingestion"."intake_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
