-- CreateEnum
CREATE TYPE "ingestion"."IngestionItemEnrichmentStatus" AS ENUM ('pending', 'succeeded', 'failed');

-- AlterTable
ALTER TABLE "ingestion"."ingestion_items" ADD COLUMN     "enrichment" JSONB,
ADD COLUMN     "enrichment_error" TEXT,
ADD COLUMN     "enrichment_status" "ingestion"."IngestionItemEnrichmentStatus" NOT NULL DEFAULT 'pending';
