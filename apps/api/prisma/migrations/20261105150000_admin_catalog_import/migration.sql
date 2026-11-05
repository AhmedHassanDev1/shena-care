-- Admin catalog bootstrap: plain product-list imports with row-level outcomes. No supplier, offer, price or stock columns.

-- CreateEnum
CREATE TYPE "ingestion"."AdminCatalogImportStatus" AS ENUM ('RECEIVED', 'MATCHING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ingestion"."AdminCatalogImportRowOutcome" AS ENUM ('PENDING', 'LINKED_EXISTING', 'NEW_CANDIDATE', 'HOLD', 'REJECTED');

-- CreateTable
CREATE TABLE "ingestion"."admin_catalog_import_jobs" (
    "id" UUID NOT NULL,
    "source_key" TEXT NOT NULL,
    "source_checksum" TEXT NOT NULL,
    "source_file_name" TEXT NOT NULL,
    "source_mime_type" TEXT NOT NULL,
    "source_size_bytes" INTEGER NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "status" "ingestion"."AdminCatalogImportStatus" NOT NULL DEFAULT 'RECEIVED',
    "column_map" JSONB NOT NULL,
    "totals" JSONB,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "admin_catalog_import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion"."admin_catalog_import_rows" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "size" DECIMAL(10,3),
    "size_unit" TEXT,
    "barcode" TEXT,
    "invalid_barcode" TEXT,
    "category_hint" TEXT,
    "source_url" TEXT,
    "source_cells" JSONB NOT NULL,
    "fingerprint" TEXT,
    "outcome" "ingestion"."AdminCatalogImportRowOutcome" NOT NULL DEFAULT 'PENDING',
    "reason_code" TEXT,
    "reason" TEXT,
    "identity" JSONB,
    "matched_sku_id" UUID,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolution_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_catalog_import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_catalog_import_jobs_source_checksum_key" ON "ingestion"."admin_catalog_import_jobs"("source_checksum");

-- CreateIndex
CREATE INDEX "admin_catalog_import_jobs_status_idx" ON "ingestion"."admin_catalog_import_jobs"("status");

-- CreateIndex
CREATE INDEX "admin_catalog_import_rows_job_id_outcome_idx" ON "ingestion"."admin_catalog_import_rows"("job_id", "outcome");

-- CreateIndex
CREATE INDEX "admin_catalog_import_rows_fingerprint_idx" ON "ingestion"."admin_catalog_import_rows"("fingerprint");

-- CreateIndex
CREATE INDEX "admin_catalog_import_rows_matched_sku_id_idx" ON "ingestion"."admin_catalog_import_rows"("matched_sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_catalog_import_rows_job_id_row_number_key" ON "ingestion"."admin_catalog_import_rows"("job_id", "row_number");

-- AddForeignKey
ALTER TABLE "ingestion"."admin_catalog_import_rows" ADD CONSTRAINT "admin_catalog_import_rows_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "ingestion"."admin_catalog_import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
