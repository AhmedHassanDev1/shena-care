-- CreateEnum
CREATE TYPE "ingestion"."IngestionImportMode" AS ENUM ('FULL_SNAPSHOT', 'PARTIAL_UPDATE');

-- AlterTable
ALTER TABLE "ingestion"."ingestion_jobs"
ADD COLUMN "mode" "ingestion"."IngestionImportMode" NOT NULL DEFAULT 'PARTIAL_UPDATE';

-- AlterTable
ALTER TABLE "ingestion"."ingestion_items"
ADD COLUMN "reported_quantity" INTEGER;

-- AlterTable
ALTER TABLE "sourcing"."supplier_purchase_orders"
ADD COLUMN "opened_at" TIMESTAMP(3);
