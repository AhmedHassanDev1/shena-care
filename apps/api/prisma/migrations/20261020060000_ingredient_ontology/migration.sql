-- CreateTable: catalog.ingredients
CREATE TABLE IF NOT EXISTS "catalog"."ingredients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "name_ar" VARCHAR(255),
    "slug" VARCHAR(255) NOT NULL,
    "inci_name" VARCHAR(255) NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "family" VARCHAR(100),
    "family_slug" VARCHAR(100),
    "chemical_form" VARCHAR(150),
    "primary_function" VARCHAR(100) NOT NULL,
    "functions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active_ingredient" BOOLEAN NOT NULL DEFAULT false,
    "rating" VARCHAR(50),
    "description_en" TEXT,
    "description_ar" TEXT,
    "benefits" JSONB,
    "cautions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contraindications" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "visual_status" VARCHAR(50) NOT NULL DEFAULT 'NOT_GENERATED',
    "visual_url" VARCHAR(500),
    "visual_metadata" JSONB,
    "status" VARCHAR(50) NOT NULL DEFAULT 'APPROVED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable: catalog.product_ingredients
CREATE TABLE IF NOT EXISTS "catalog"."product_ingredients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "is_key_active" BOOLEAN NOT NULL DEFAULT false,
    "concentration" VARCHAR(50),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_ingredients_pkey" PRIMARY KEY ("id")
);

-- Unique & Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "ingredients_name_key" ON "catalog"."ingredients"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "ingredients_slug_key" ON "catalog"."ingredients"("slug");
CREATE INDEX IF NOT EXISTS "ingredients_family_slug_idx" ON "catalog"."ingredients"("family_slug");
CREATE INDEX IF NOT EXISTS "ingredients_inci_name_idx" ON "catalog"."ingredients"("inci_name");
CREATE INDEX IF NOT EXISTS "ingredients_is_active_ingredient_idx" ON "catalog"."ingredients"("is_active_ingredient");

CREATE UNIQUE INDEX IF NOT EXISTS "product_ingredients_product_id_ingredient_id_key" ON "catalog"."product_ingredients"("product_id", "ingredient_id");
CREATE INDEX IF NOT EXISTS "product_ingredients_product_id_idx" ON "catalog"."product_ingredients"("product_id");
CREATE INDEX IF NOT EXISTS "product_ingredients_ingredient_id_idx" ON "catalog"."product_ingredients"("ingredient_id");

-- Foreign Keys
DO $$ BEGIN
    ALTER TABLE "catalog"."product_ingredients"
    ADD CONSTRAINT "product_ingredients_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "catalog"."product_ingredients"
    ADD CONSTRAINT "product_ingredients_ingredient_id_fkey"
    FOREIGN KEY ("ingredient_id") REFERENCES "catalog"."ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
