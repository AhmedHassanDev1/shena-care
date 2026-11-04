-- GLO-285 independent product media: additive. Existing ProductMedia rows and storefront behaviour are unchanged.
-- Rollback: DROP TABLE catalog.media_assets; ALTER TABLE catalog.product_media DROP COLUMN role, DROP COLUMN asset_id; DROP the four enums.
CREATE TYPE "catalog"."MediaRole" AS ENUM ('PRIMARY_PACKSHOT', 'TEXTURE_SENSORY', 'INGREDIENT_STORY', 'PACKAGING_PROOF');
CREATE TYPE "catalog"."MediaReviewStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');
CREATE TYPE "catalog"."MediaRightsStatus" AS ENUM ('UNKNOWN', 'MANUFACTURER_PUBLISHED', 'AUTHORIZED_DISTRIBUTOR', 'LICENSED', 'OWN_CAPTURE');
CREATE TYPE "catalog"."MediaProcessingStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

ALTER TABLE "catalog"."product_media" ADD COLUMN "role" "catalog"."MediaRole", ADD COLUMN "asset_id" UUID;

CREATE TABLE "catalog"."media_assets" (
  "id" UUID NOT NULL,
  "sku_id" UUID NOT NULL,
  "role" "catalog"."MediaRole" NOT NULL,
  "origin_type" "catalog"."MediaOriginType" NOT NULL,
  "parent_asset_id" UUID,
  "transform_version" TEXT,
  "storage_url" TEXT,
  "mime_type" TEXT,
  "width" INTEGER,
  "height" INTEGER,
  "byte_size" INTEGER,
  "content_hash" VARCHAR(64),
  "source_url" TEXT NOT NULL,
  "source_publisher" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "rights_status" "catalog"."MediaRightsStatus" NOT NULL DEFAULT 'UNKNOWN',
  "captured_at" TIMESTAMP(3),
  "processing_status" "catalog"."MediaProcessingStatus" NOT NULL DEFAULT 'PENDING',
  "processing_error" TEXT,
  "processing_attempts" INTEGER NOT NULL DEFAULT 0,
  "review_status" "catalog"."MediaReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "reviewed_by" UUID,
  "reviewed_at" TIMESTAMP(3),
  "review_note" TEXT,
  "verified_facts" JSONB,
  "published_media_id" UUID,
  "published_at" TIMESTAMP(3),
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "media_assets_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "catalog"."skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "media_assets_parent_asset_id_fkey" FOREIGN KEY ("parent_asset_id") REFERENCES "catalog"."media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- A generated image can never state what a physical product is, whichever code path writes it.
  CONSTRAINT "media_assets_generated_not_identity" CHECK ("origin_type" <> 'generated' OR "role" IN ('TEXTURE_SENSORY', 'INGREDIENT_STORY')),
  CONSTRAINT "media_assets_derived_has_parent" CHECK (("origin_type" = 'derived') = ("parent_asset_id" IS NOT NULL))
);
CREATE UNIQUE INDEX "media_assets_parent_asset_id_transform_version_key" ON "catalog"."media_assets"("parent_asset_id", "transform_version");
CREATE UNIQUE INDEX "media_assets_one_original_per_image" ON "catalog"."media_assets"("sku_id", "role", "content_hash") WHERE "parent_asset_id" IS NULL;
CREATE INDEX "media_assets_sku_id_role_idx" ON "catalog"."media_assets"("sku_id", "role");
CREATE INDEX "media_assets_content_hash_idx" ON "catalog"."media_assets"("content_hash");

-- A stored image's file and hash never change once set; a retry of a failed copy may still fill them in.
CREATE FUNCTION "catalog"."media_assets_file_is_immutable"() RETURNS trigger AS $$
BEGIN
  IF OLD."content_hash" IS NOT NULL AND (NEW."content_hash" IS DISTINCT FROM OLD."content_hash" OR NEW."storage_url" IS DISTINCT FROM OLD."storage_url") THEN
    RAISE EXCEPTION 'media asset file is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "media_assets_file_is_immutable" BEFORE UPDATE ON "catalog"."media_assets"
  FOR EACH ROW EXECUTE FUNCTION "catalog"."media_assets_file_is_immutable"();
