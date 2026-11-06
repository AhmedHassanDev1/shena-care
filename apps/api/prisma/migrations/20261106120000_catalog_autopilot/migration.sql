-- Automatic catalog decisions: field-level fact verification, evidence-backed identity, critical-only exceptions and an audit trail. Additive only.
-- Rollback: DROP TABLE ingestion.catalog_exceptions, ingestion.catalog_decisions; DROP FUNCTION ingestion.catalog_decisions_append_only();
--           DROP TYPE ingestion."CatalogExceptionStatus", ingestion."CatalogDecision";
--           ALTER TABLE ingestion.admin_catalog_import_rows DROP COLUMN decision, DROP COLUMN stage, DROP COLUMN attempts, DROP COLUMN next_attempt_at, DROP COLUMN lease_until, DROP COLUMN last_error;
--           ALTER TABLE ingestion.product_fact_proposals DROP COLUMN verification, DROP COLUMN conflict_reason, DROP COLUMN decided_by, DROP COLUMN decision_rule;
--           ALTER TABLE ingestion.product_research_runs DROP COLUMN field_coverage;
--           ALTER TABLE catalog.skus DROP COLUMN identity_status, DROP COLUMN identity_evidence, DROP COLUMN barcode_status;
--           ALTER TABLE catalog.media_assets DROP COLUMN reviewed_automatically;
CREATE TYPE "ingestion"."CatalogDecision" AS ENUM ('AUTO_ACCEPT', 'AUTO_LINK', 'SKIP', 'HOLD_CRITICAL', 'RETRY_AUTOMATIC');
CREATE TYPE "ingestion"."CatalogExceptionStatus" AS ENUM ('OPEN', 'RESOLVED', 'REJECTED', 'RETRYING');

ALTER TABLE "catalog"."skus"
  ADD COLUMN "identity_status" VARCHAR(30) NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN "identity_evidence" JSONB,
  ADD COLUMN "barcode_status" VARCHAR(30) NOT NULL DEFAULT 'UNKNOWN';
-- Barcodes stored before verification was tracked are kept and labelled honestly; nothing is upgraded to VERIFIED here.
UPDATE "catalog"."skus" SET "barcode_status" = 'RECORDED' WHERE "barcode" IS NOT NULL;

ALTER TABLE "catalog"."media_assets" ADD COLUMN "reviewed_automatically" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ingestion"."product_fact_proposals"
  ADD COLUMN "verification" VARCHAR(20),
  ADD COLUMN "conflict_reason" TEXT,
  ADD COLUMN "decided_by" VARCHAR(10),
  ADD COLUMN "decision_rule" VARCHAR(80);
ALTER TABLE "ingestion"."product_research_runs" ADD COLUMN "field_coverage" JSONB;

ALTER TABLE "ingestion"."admin_catalog_import_rows"
  ADD COLUMN "decision" "ingestion"."CatalogDecision",
  ADD COLUMN "stage" VARCHAR(30),
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "next_attempt_at" TIMESTAMP(3),
  ADD COLUMN "lease_until" TIMESTAMP(3),
  ADD COLUMN "last_error" TEXT;
CREATE INDEX "admin_catalog_import_rows_decision_next_attempt_at_idx" ON "ingestion"."admin_catalog_import_rows"("decision", "next_attempt_at");

CREATE TABLE "ingestion"."catalog_decisions" (
  "id" UUID NOT NULL,
  "subject_type" VARCHAR(20) NOT NULL,
  "subject_id" UUID NOT NULL,
  "sku_id" UUID,
  "decision" VARCHAR(40) NOT NULL,
  "reason_code" VARCHAR(80) NOT NULL,
  "rule_version" VARCHAR(40) NOT NULL,
  "evidence" JSONB NOT NULL DEFAULT '{}',
  "actor_type" VARCHAR(10) NOT NULL,
  "actor_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "catalog_decisions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "catalog_decisions_subject_type_subject_id_idx" ON "ingestion"."catalog_decisions"("subject_type", "subject_id");
CREATE INDEX "catalog_decisions_sku_id_idx" ON "ingestion"."catalog_decisions"("sku_id");
CREATE INDEX "catalog_decisions_created_at_idx" ON "ingestion"."catalog_decisions"("created_at");
-- The audit trail is append-only.
CREATE FUNCTION "ingestion"."catalog_decisions_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'catalog decisions are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "catalog_decisions_append_only" BEFORE UPDATE OR DELETE ON "ingestion"."catalog_decisions"
  FOR EACH ROW EXECUTE FUNCTION "ingestion"."catalog_decisions_append_only"();

CREATE TABLE "ingestion"."catalog_exceptions" (
  "id" UUID NOT NULL,
  "dedupe_key" VARCHAR(240) NOT NULL,
  "sku_id" UUID,
  "import_row_id" UUID,
  "subject_type" VARCHAR(20) NOT NULL,
  "subject_id" UUID NOT NULL,
  "field" VARCHAR(60),
  "reason_code" VARCHAR(80) NOT NULL,
  "severity" VARCHAR(10) NOT NULL,
  "summary" TEXT NOT NULL,
  "evidence" JSONB NOT NULL DEFAULT '{}',
  "recommended" JSONB,
  "status" "ingestion"."CatalogExceptionStatus" NOT NULL DEFAULT 'OPEN',
  "resolution" VARCHAR(20),
  "resolution_note" TEXT,
  "resolved_by" UUID,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "catalog_exceptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "catalog_exceptions_dedupe_key_key" ON "ingestion"."catalog_exceptions"("dedupe_key");
CREATE INDEX "catalog_exceptions_status_created_at_idx" ON "ingestion"."catalog_exceptions"("status", "created_at");
CREATE INDEX "catalog_exceptions_sku_id_idx" ON "ingestion"."catalog_exceptions"("sku_id");
CREATE INDEX "catalog_exceptions_import_row_id_idx" ON "ingestion"."catalog_exceptions"("import_row_id");
