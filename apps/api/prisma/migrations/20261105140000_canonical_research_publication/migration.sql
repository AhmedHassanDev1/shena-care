-- Canonical-SKU research evidence and the carton decision used by publication. Additive only.
-- Rollback: DROP TABLE ingestion.product_fact_proposals, ingestion.product_research_runs; DROP TYPE ingestion."ProductFactStatus", ingestion."ResearchRunStatus";
--           ALTER TABLE catalog.skus DROP COLUMN has_outer_carton;
ALTER TABLE "catalog"."skus" ADD COLUMN "has_outer_carton" BOOLEAN;

CREATE TYPE "ingestion"."ResearchRunStatus" AS ENUM ('RUNNING', 'COMPLETE', 'NO_EVIDENCE', 'PROVIDER_UNAVAILABLE', 'FAILED');
CREATE TYPE "ingestion"."ProductFactStatus" AS ENUM ('PROPOSED', 'CONFLICT', 'REJECTED', 'APPLIED');

CREATE TABLE "ingestion"."product_research_runs" (
  "id" UUID NOT NULL,
  "sku_id" UUID NOT NULL,
  "status" "ingestion"."ResearchRunStatus" NOT NULL DEFAULT 'RUNNING',
  "schema_version" INTEGER NOT NULL,
  "sources" JSONB NOT NULL DEFAULT '[]',
  "rejected" JSONB NOT NULL DEFAULT '[]',
  "provider_statuses" JSONB,
  "error_reason" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "requested_by" UUID NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "product_research_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "product_research_runs_sku_id_started_at_idx" ON "ingestion"."product_research_runs"("sku_id", "started_at");

CREATE TABLE "ingestion"."product_fact_proposals" (
  "id" UUID NOT NULL,
  "sku_id" UUID NOT NULL,
  "run_id" UUID NOT NULL,
  "field" VARCHAR(60) NOT NULL,
  "value" JSONB NOT NULL,
  "value_hash" VARCHAR(64) NOT NULL,
  "status" "ingestion"."ProductFactStatus" NOT NULL DEFAULT 'PROPOSED',
  "evidence" JSONB NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "schema_version" INTEGER NOT NULL,
  "reviewed_by" UUID,
  "reviewed_at" TIMESTAMP(3),
  "review_note" TEXT,
  "applied_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_fact_proposals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_fact_proposals_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ingestion"."product_research_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- The same fact found twice is one proposal with more evidence, never a duplicate.
CREATE UNIQUE INDEX "product_fact_proposals_sku_id_field_value_hash_key" ON "ingestion"."product_fact_proposals"("sku_id", "field", "value_hash");
CREATE INDEX "product_fact_proposals_sku_id_status_idx" ON "ingestion"."product_fact_proposals"("sku_id", "status");
