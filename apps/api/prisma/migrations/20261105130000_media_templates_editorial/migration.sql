-- Media closure: replaceable category templates and the CATEGORY_EDITORIAL role. Additive only.
-- Rollback: ALTER TABLE catalog.media_assets DROP COLUMN template_id, DROP COLUMN quality_report, DROP COLUMN superseded_at; DROP TABLE catalog.media_templates;
--           (an enum value cannot be dropped; CATEGORY_EDITORIAL stays harmlessly unused).
ALTER TYPE "catalog"."MediaRole" ADD VALUE IF NOT EXISTS 'CATEGORY_EDITORIAL';

CREATE TABLE "catalog"."media_templates" (
  "id" UUID NOT NULL,
  "template_key" VARCHAR(80) NOT NULL,
  "version" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "category_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  "storage_url" TEXT NOT NULL,
  "content_hash" VARCHAR(64) NOT NULL,
  "mime_type" TEXT NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "rules" JSONB NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "media_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "media_templates_template_key_version_key" ON "catalog"."media_templates"("template_key", "version");
-- One live version per template; replacing activates the new version and retires the old one in one transaction.
CREATE UNIQUE INDEX "media_templates_one_active_version" ON "catalog"."media_templates"("template_key") WHERE "is_active";

-- A template version is evidence of what generated a derivative: its file and rules never change.
CREATE FUNCTION "catalog"."media_templates_version_is_immutable"() RETURNS trigger AS $$
BEGIN
  IF NEW."content_hash" IS DISTINCT FROM OLD."content_hash" OR NEW."storage_url" IS DISTINCT FROM OLD."storage_url"
     OR NEW."rules" IS DISTINCT FROM OLD."rules" OR NEW."version" IS DISTINCT FROM OLD."version" OR NEW."template_key" IS DISTINCT FROM OLD."template_key" THEN
    RAISE EXCEPTION 'media template version is immutable; register a new version';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "media_templates_version_is_immutable" BEFORE UPDATE ON "catalog"."media_templates"
  FOR EACH ROW EXECUTE FUNCTION "catalog"."media_templates_version_is_immutable"();

ALTER TABLE "catalog"."media_assets"
  ADD COLUMN "template_id" UUID,
  ADD COLUMN "quality_report" JSONB,
  ADD COLUMN "superseded_at" TIMESTAMP(3),
  ADD CONSTRAINT "media_assets_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "catalog"."media_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- An editorial image is only ever a composition of an authentic original; it can never be uploaded or generated.
  ADD CONSTRAINT "media_assets_editorial_is_derived" CHECK ("role"::text <> 'CATEGORY_EDITORIAL' OR ("origin_type"::text = 'derived' AND "template_id" IS NOT NULL));
CREATE INDEX "media_assets_template_id_idx" ON "catalog"."media_assets"("template_id");
