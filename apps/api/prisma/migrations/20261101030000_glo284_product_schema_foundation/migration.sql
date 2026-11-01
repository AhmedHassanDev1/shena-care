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

CREATE TYPE "catalog"."ConcentrationStatus" AS ENUM (
    'STATED',
    'UNDISCLOSED',
    'NOT_APPLICABLE',
    'UNKNOWN'
);

CREATE TYPE "catalog"."SafetyWarningKind" AS ENUM (
    'CONTRAINDICATION',
    'INTERACTION',
    'RESTRICTION',
    'ESCALATION',
    'PRECAUTION'
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
    ADD COLUMN "claims_evidence" JSONB,
    ADD COLUMN "fact_version" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "last_reviewed_at" TIMESTAMP(3),
    ADD COLUMN "last_reviewed_by" TEXT;

-- 3. Alter Table catalog.skus: Add SKU replenishment usage estimation
ALTER TABLE "catalog"."skus"
    ADD COLUMN "estimated_days_of_use" INTEGER;

-- 4. Alter Table catalog.product_ingredients: Add concentrationStatus
ALTER TABLE "catalog"."product_ingredients"
    ADD COLUMN "concentration_status" "catalog"."ConcentrationStatus" NOT NULL DEFAULT 'UNKNOWN';

-- 5. Alter Table catalog.product_usage_rules: Add application quantity and intro phase fields
ALTER TABLE "catalog"."product_usage_rules"
    ADD COLUMN "application_quantity" DECIMAL(7,3),
    ADD COLUMN "application_unit" VARCHAR(30),
    ADD COLUMN "is_introductory" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "phase_order" INTEGER,
    ADD COLUMN "phase_weeks_min" INTEGER,
    ADD COLUMN "phase_weeks_max" INTEGER;

-- 6. Create Table catalog.product_safety_warnings
CREATE TABLE "catalog"."product_safety_warnings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "kind" "catalog"."SafetyWarningKind" NOT NULL,
    "condition" VARCHAR(80),
    "description_en" TEXT NOT NULL,
    "description_ar" TEXT,
    "source_type" VARCHAR(40) NOT NULL,
    "source_url" TEXT,
    "reviewed_by" TEXT NOT NULL,
    "reviewed_at" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_safety_warnings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_safety_warnings_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 7. Create Table care.customer_usage_schedules
CREATE TABLE "care"."customer_usage_schedules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_routine_id" UUID NOT NULL,
    "routine_item_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "weekdays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "timing_slot" "catalog"."UsageRoutinePeriod" NOT NULL DEFAULT 'BOTH',
    "planned_uses_per_occurrence" INTEGER NOT NULL DEFAULT 1,
    "phase" INTEGER NOT NULL DEFAULT 1,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "source_usage_rule_id" UUID,
    "notes" TEXT,
    "is_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "routine_version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_usage_schedules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "customer_usage_schedules_customer_routine_id_fkey" FOREIGN KEY ("customer_routine_id") REFERENCES "care"."customer_routines"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 8. Create Indexes
CREATE INDEX "products_target_area_idx" ON "catalog"."products"("target_area");
CREATE INDEX "products_texture_idx" ON "catalog"."products"("texture");
CREATE INDEX "product_safety_warnings_product_id_idx" ON "catalog"."product_safety_warnings"("product_id");
CREATE INDEX "product_safety_warnings_condition_idx" ON "catalog"."product_safety_warnings"("condition");
CREATE INDEX "customer_usage_schedules_customer_routine_id_idx" ON "care"."customer_usage_schedules"("customer_routine_id");
CREATE INDEX "customer_usage_schedules_product_id_idx" ON "care"."customer_usage_schedules"("product_id");

-- 9. Data Integrity Constraints (Defense in Depth)
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_spf_range"
    CHECK (spf IS NULL OR (spf >= 2 AND spf <= 100));

ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_water_resistance_positive"
    CHECK (water_resistance_minutes IS NULL OR water_resistance_minutes > 0);

ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_fact_version_positive"
    CHECK (fact_version >= 1);

ALTER TABLE "catalog"."skus" ADD CONSTRAINT "skus_estimated_days_positive"
    CHECK (estimated_days_of_use IS NULL OR estimated_days_of_use > 0);

ALTER TABLE "care"."customer_usage_schedules" ADD CONSTRAINT "customer_usage_schedules_unique_entry"
    UNIQUE ("customer_routine_id", "routine_item_id", "timing_slot", "phase");

ALTER TABLE "care"."customer_usage_schedules" ADD CONSTRAINT "customer_usage_schedules_weekdays_valid"
    CHECK (weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]);

ALTER TABLE "care"."customer_usage_schedules" ADD CONSTRAINT "customer_usage_schedules_phase_positive"
    CHECK (phase >= 1);

ALTER TABLE "care"."customer_usage_schedules" ADD CONSTRAINT "customer_usage_schedules_planned_uses_positive"
    CHECK (planned_uses_per_occurrence >= 1);
