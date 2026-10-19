CREATE TYPE "ingestion"."IngestionPriceType" AS ENUM ('PURCHASE_COST', 'RETAIL_REFERENCE');

ALTER TABLE "ingestion"."ingestion_items"
ADD COLUMN "price_type" "ingestion"."IngestionPriceType";
