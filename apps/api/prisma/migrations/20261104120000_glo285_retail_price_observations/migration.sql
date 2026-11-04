-- GLO-285 read-only retail evidence: additive, one new table, no foreign key into another bounded context.
-- Rollback: DROP TABLE ingestion.retail_price_observations; DROP TYPE ingestion."RetailObservationStatus";
CREATE TYPE "ingestion"."RetailObservationStatus" AS ENUM ('ACCEPTED', 'REJECTED');

CREATE TABLE "ingestion"."retail_price_observations" (
  "id" UUID NOT NULL,
  "sku_id" UUID NOT NULL,
  "source_url" TEXT NOT NULL,
  "seller_name" TEXT NOT NULL,
  "seller_domain" TEXT NOT NULL,
  "observed_at" TIMESTAMP(3) NOT NULL,
  "retrieved_at" TIMESTAMP(3) NOT NULL,
  "price_egp" DECIMAL(10,2) NOT NULL,
  "regular_price_egp" DECIMAL(10,2),
  "in_stock" BOOLEAN,
  "pack_text" TEXT NOT NULL,
  "confidence" DECIMAL(3,2) NOT NULL,
  "evidence_excerpt" TEXT,
  "status" "ingestion"."RetailObservationStatus" NOT NULL,
  "reject_reason" TEXT,
  "collected_by" TEXT NOT NULL,
  "dedupe_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "retail_price_observations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "retail_price_observations_rejected_has_reason" CHECK (("status" = 'REJECTED') = ("reject_reason" IS NOT NULL))
);
CREATE UNIQUE INDEX "retail_price_observations_dedupe_key_key" ON "ingestion"."retail_price_observations"("dedupe_key");
CREATE INDEX "retail_price_observations_sku_id_status_observed_at_idx" ON "ingestion"."retail_price_observations"("sku_id", "status", "observed_at");
