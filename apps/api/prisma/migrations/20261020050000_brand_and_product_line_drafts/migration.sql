-- CreateTable: brand_drafts
CREATE TABLE IF NOT EXISTS "ingestion"."brand_drafts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "canonical_name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "aliases" TEXT[] NOT NULL DEFAULT '{}',
    "description_en" TEXT,
    "description_ar" TEXT,
    "website_url" TEXT,
    "country_of_origin" TEXT,
    "logo_url" TEXT,
    "logo_metadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "rejection_reason" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "evidence" JSONB,
    "canonical_brand_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_drafts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "brand_drafts_slug_key" UNIQUE ("slug")
);

-- Indexes for brand_drafts
CREATE INDEX IF NOT EXISTS "brand_drafts_canonical_name_idx" ON "ingestion"."brand_drafts"("canonical_name");
CREATE INDEX IF NOT EXISTS "brand_drafts_status_idx" ON "ingestion"."brand_drafts"("status");

-- CreateTable: product_line_drafts
CREATE TABLE IF NOT EXISTS "ingestion"."product_line_drafts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "brand_draft_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description_en" TEXT,
    "description_ar" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "rejection_reason" TEXT,
    "canonical_line_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_line_drafts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_line_drafts_brand_draft_id_slug_key" UNIQUE ("brand_draft_id", "slug"),
    CONSTRAINT "product_line_drafts_brand_draft_id_fkey" FOREIGN KEY ("brand_draft_id") REFERENCES "ingestion"."brand_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Indexes for product_line_drafts
CREATE INDEX IF NOT EXISTS "product_line_drafts_brand_draft_id_idx" ON "ingestion"."product_line_drafts"("brand_draft_id");
CREATE INDEX IF NOT EXISTS "product_line_drafts_status_idx" ON "ingestion"."product_line_drafts"("status");
