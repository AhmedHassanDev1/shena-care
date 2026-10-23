-- Gate 01: intake audit metadata and a database backstop for duplicate supplier originals.
ALTER TABLE "ingestion"."ingestion_jobs" ADD COLUMN "uploaded_by" TEXT;
ALTER TABLE "ingestion"."ingestion_jobs" ADD COLUMN "source_file_name" TEXT;
ALTER TABLE "ingestion"."ingestion_jobs" ADD COLUMN "source_mime_type" TEXT;
ALTER TABLE "ingestion"."ingestion_jobs" ADD COLUMN "source_size_bytes" INTEGER;
ALTER TABLE "ingestion"."ingestion_jobs" ADD COLUMN "source_metadata" JSONB;

-- Fails loudly if a deployment already holds duplicate originals; resolve those before deploying.
CREATE UNIQUE INDEX "ingestion_jobs_supplier_id_source_checksum_key"
  ON "ingestion"."ingestion_jobs"("supplier_id", "source_checksum");
