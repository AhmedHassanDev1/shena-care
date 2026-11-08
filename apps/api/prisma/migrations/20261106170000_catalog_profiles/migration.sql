-- Additive only: brand profile, product classification and SKU routine profiles. No existing column is changed or dropped.
ALTER TABLE "catalog"."brands" ADD COLUMN "profile" JSONB, ADD COLUMN "profile_updated_at" TIMESTAMP(3);
ALTER TABLE "catalog"."products" ADD COLUMN "product_type" VARCHAR(40), ADD COLUMN "product_subtype" VARCHAR(60), ADD COLUMN "classification" JSONB;

CREATE TABLE "catalog"."sku_routine_profiles" (
    "id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "rule_version" VARCHAR(40) NOT NULL,
    "product_type" VARCHAR(40),
    "primary_role" VARCHAR(40),
    "primary_role_status" VARCHAR(20) NOT NULL,
    "secondary_roles" JSONB NOT NULL DEFAULT '[]',
    "routine_domain" VARCHAR(10),
    "step_order" INTEGER,
    "routine_period" VARCHAR(10) NOT NULL DEFAULT 'UNKNOWN',
    "routine_period_status" VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
    "period_eligibility" VARCHAR(10),
    "cadence_unit" VARCHAR(15) NOT NULL DEFAULT 'UNKNOWN',
    "cadence_min" INTEGER,
    "cadence_max" INTEGER,
    "cadence_status" VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
    "rinse_mode" VARCHAR(15) NOT NULL DEFAULT 'UNKNOWN',
    "rinse_mode_status" VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
    "expected_rinse_mode" VARCHAR(15),
    "contact_minutes" INTEGER,
    "target_area" VARCHAR(20),
    "target_area_status" VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
    "active_ingredients" JSONB NOT NULL DEFAULT '[]',
    "featured_ingredients" JSONB NOT NULL DEFAULT '[]',
    "prerequisites" JSONB NOT NULL DEFAULT '[]',
    "sequencing_rules" JSONB NOT NULL DEFAULT '[]',
    "cautions" JSONB NOT NULL DEFAULT '[]',
    "suitability" JSONB NOT NULL DEFAULT '{}',
    "conflicts" JSONB NOT NULL DEFAULT '[]',
    "field_status" JSONB NOT NULL DEFAULT '{}',
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sku_routine_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sku_routine_profiles_sku_id_key" ON "catalog"."sku_routine_profiles"("sku_id");
CREATE INDEX "sku_routine_profiles_product_id_idx" ON "catalog"."sku_routine_profiles"("product_id");
CREATE INDEX "sku_routine_profiles_primary_role_idx" ON "catalog"."sku_routine_profiles"("primary_role");
ALTER TABLE "catalog"."sku_routine_profiles" ADD CONSTRAINT "sku_routine_profiles_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "catalog"."skus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
