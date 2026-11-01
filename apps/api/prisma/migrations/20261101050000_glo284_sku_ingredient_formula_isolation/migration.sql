-- GLO-284: SKU-Scoped Ingredients for True Formula Isolation
-- Additive forward migration: allows product ingredients and stated concentrations to be optionally scoped to a specific SKU.

-- 1. Add sku_id column to catalog.product_ingredients
ALTER TABLE "catalog"."product_ingredients"
    ADD COLUMN IF NOT EXISTS "sku_id" UUID;

-- 2. Add Foreign Key to catalog.skus
DO $$ BEGIN
    ALTER TABLE "catalog"."product_ingredients"
        ADD CONSTRAINT "product_ingredients_sku_id_fkey"
        FOREIGN KEY ("sku_id") REFERENCES "catalog"."skus"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 3. Create Index on sku_id
CREATE INDEX IF NOT EXISTS "product_ingredients_sku_id_idx"
    ON "catalog"."product_ingredients"("sku_id");

-- 4. Drop legacy (product_id, ingredient_id) unique constraint to allow SKU-specific formulas/strengths
DO $$ BEGIN
    ALTER TABLE "catalog"."product_ingredients"
        DROP CONSTRAINT IF EXISTS "product_ingredients_product_id_ingredient_id_key";
EXCEPTION WHEN undefined_object THEN null;
END $$;

-- 5. Create new unique index on (product_id, ingredient_id, sku_id)
DO $$ BEGIN
    CREATE UNIQUE INDEX "product_ingredients_product_id_ingredient_id_sku_id_key"
        ON "catalog"."product_ingredients"("product_id", "ingredient_id", "sku_id") NULLS NOT DISTINCT;
EXCEPTION WHEN duplicate_table OR duplicate_object THEN null;
END $$;
