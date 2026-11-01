-- GLO-284: Product Schema Foundation for Accurate, Evidence-Based Skincare/Haircare Guidance & Routines
-- Additive only: preserves all existing data, migrations, and API contracts.

-- 1. Create Enums in catalog schema
CREATE TYPE "catalog"."ProductTexture" AS ENUM (
    'GEL',
    'CREAM',
    'GEL_CREAM',
    'LOTION',
    'EMULSION',
    'SERUM',
    'OIL',
    'BALM',
    'FOAM',
    'LIQUID',
    'SPRAY',
    'PASTE',
    'STICK',
    'POWDER'
);

CREATE TYPE "catalog"."UvFilterType" AS ENUM (
    'MINERAL',
    'CHEMICAL',
    'HYBRID'
);

-- 2. Alter Table catalog.products: Add physical, dermatological, safety, and versioning attributes
ALTER TABLE "catalog"."products"
    ADD COLUMN "target_area" "catalog"."UsageTargetArea",
    ADD COLUMN "texture" "catalog"."ProductTexture",
    ADD COLUMN "suitable_skin_types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "suitable_hair_types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "spf" INTEGER,
    ADD COLUMN "broad_spectrum" BOOLEAN,
    ADD COLUMN "uv_filter_type" "catalog"."UvFilterType",
    ADD COLUMN "water_resistance_minutes" INTEGER,
    ADD COLUMN "is_fragrance_free" BOOLEAN,
    ADD COLUMN "is_non_comedogenic" BOOLEAN,
    ADD COLUMN "fact_version" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "last_reviewed_at" TIMESTAMP(3),
    ADD COLUMN "last_reviewed_by" TEXT;

-- 3. Alter Table catalog.skus: Add SKU replenishment usage estimation
ALTER TABLE "catalog"."skus"
    ADD COLUMN "estimated_days_of_use" INTEGER;

-- 4. Create Indexes
CREATE INDEX "products_target_area_idx" ON "catalog"."products"("target_area");
CREATE INDEX "products_texture_idx" ON "catalog"."products"("texture");

-- 5. Data Integrity Constraints (Defense in Depth)
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_spf_range"
    CHECK (spf IS NULL OR (spf >= 2 AND spf <= 100));

ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_water_resistance_positive"
    CHECK (water_resistance_minutes IS NULL OR water_resistance_minutes > 0);

ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_fact_version_positive"
    CHECK (fact_version >= 1);

ALTER TABLE "catalog"."skus" ADD CONSTRAINT "skus_estimated_days_positive"
    CHECK (estimated_days_of_use IS NULL OR estimated_days_of_use > 0);
