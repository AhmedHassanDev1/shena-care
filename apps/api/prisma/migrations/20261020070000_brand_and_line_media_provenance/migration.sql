-- AlterTable
ALTER TABLE "catalog"."brands" ADD COLUMN IF NOT EXISTS "logo_metadata" JSONB;

-- AlterTable
ALTER TABLE "catalog"."product_lines" ADD COLUMN IF NOT EXISTS "image_url" TEXT;
ALTER TABLE "catalog"."product_lines" ADD COLUMN IF NOT EXISTS "image_metadata" JSONB;

-- AlterTable
ALTER TABLE "ingestion"."product_line_drafts" ADD COLUMN IF NOT EXISTS "image_url" TEXT;
ALTER TABLE "ingestion"."product_line_drafts" ADD COLUMN IF NOT EXISTS "image_metadata" JSONB;
