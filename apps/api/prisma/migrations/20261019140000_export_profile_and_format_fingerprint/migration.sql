-- CreateTable: export_profiles
CREATE TABLE IF NOT EXISTS "ingestion"."export_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "supplier_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "format_fingerprint" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_approved" BOOLEAN NOT NULL DEFAULT false,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "mapping" JSONB NOT NULL,
    "sample_headers" TEXT[] NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_profiles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "export_profiles_supplier_id_format_fingerprint_version_key" UNIQUE ("supplier_id", "format_fingerprint", "version"),
    CONSTRAINT "export_profiles_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "sourcing"."suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Indexes for export_profiles
CREATE INDEX IF NOT EXISTS "export_profiles_supplier_id_idx" ON "ingestion"."export_profiles"("supplier_id");
CREATE INDEX IF NOT EXISTS "export_profiles_format_fingerprint_idx" ON "ingestion"."export_profiles"("format_fingerprint");

-- AlterTable: ingestion_jobs
ALTER TABLE "ingestion"."ingestion_jobs" ADD COLUMN IF NOT EXISTS "format_fingerprint" TEXT;
ALTER TABLE "ingestion"."ingestion_jobs" ADD COLUMN IF NOT EXISTS "profile_id" UUID;

CREATE INDEX IF NOT EXISTS "ingestion_jobs_format_fingerprint_idx" ON "ingestion"."ingestion_jobs"("format_fingerprint");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ingestion_jobs_profile_id_fkey'
    ) THEN
        ALTER TABLE "ingestion"."ingestion_jobs"
            ADD CONSTRAINT "ingestion_jobs_profile_id_fkey"
            FOREIGN KEY ("profile_id") REFERENCES "ingestion"."export_profiles"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
