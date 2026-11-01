-- GLO-284: Schedule & Formula Integrity, Claims Evidence, and Safety Warning Scoping
-- Additive forward migration: resolves formula identity, schedule integrity, and recommendation feature readiness.

-- 1. Create Enums in catalog schema
DO $$ BEGIN
    CREATE TYPE "catalog"."ConcentrationStatus" AS ENUM (
        'STATED',
        'UNDISCLOSED',
        'NOT_APPLICABLE',
        'UNKNOWN'
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "catalog"."SafetyWarningKind" AS ENUM (
        'CONTRAINDICATION',
        'INTERACTION',
        'RESTRICTION',
        'ESCALATION',
        'PRECAUTION'
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 2. Alter Table catalog.products: Add claims_evidence JSONB
ALTER TABLE "catalog"."products"
    ADD COLUMN IF NOT EXISTS "claims_evidence" JSONB;

-- 3. Alter Table catalog.product_ingredients: Add concentration_status
ALTER TABLE "catalog"."product_ingredients"
    ADD COLUMN IF NOT EXISTS "concentration_status" "catalog"."ConcentrationStatus" NOT NULL DEFAULT 'UNKNOWN';

-- 4. Alter Table catalog.product_usage_rules: Add application quantity and intro phase fields
ALTER TABLE "catalog"."product_usage_rules"
    ADD COLUMN IF NOT EXISTS "application_quantity" DECIMAL(7,3),
    ADD COLUMN IF NOT EXISTS "application_unit" VARCHAR(30),
    ADD COLUMN IF NOT EXISTS "is_introductory" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "phase_order" INTEGER,
    ADD COLUMN IF NOT EXISTS "phase_weeks_min" INTEGER,
    ADD COLUMN IF NOT EXISTS "phase_weeks_max" INTEGER;

-- 5. Create Table catalog.product_safety_warnings (supports optional sku_id for formula/variant scoping)
CREATE TABLE IF NOT EXISTS "catalog"."product_safety_warnings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "sku_id" UUID,
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
    CONSTRAINT "product_safety_warnings_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "product_safety_warnings_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "catalog"."skus"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Ensure sku_id column exists if table was previously created without it
ALTER TABLE "catalog"."product_safety_warnings"
    ADD COLUMN IF NOT EXISTS "sku_id" UUID;

DO $$ BEGIN
    ALTER TABLE "catalog"."product_safety_warnings"
        ADD CONSTRAINT "product_safety_warnings_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "catalog"."skus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "product_safety_warnings_product_id_idx" ON "catalog"."product_safety_warnings"("product_id");
CREATE INDEX IF NOT EXISTS "product_safety_warnings_sku_id_idx" ON "catalog"."product_safety_warnings"("sku_id");
CREATE INDEX IF NOT EXISTS "product_safety_warnings_condition_idx" ON "catalog"."product_safety_warnings"("condition");

-- 6. Create Table care.customer_usage_schedules
CREATE TABLE IF NOT EXISTS "care"."customer_usage_schedules" (
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
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_usage_schedules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "customer_usage_schedules_customer_routine_id_fkey" FOREIGN KEY ("customer_routine_id") REFERENCES "care"."customer_routines"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

DO $$ BEGIN
    ALTER TABLE "care"."customer_usage_schedules"
        ADD CONSTRAINT "customer_usage_schedules_unique_entry" UNIQUE ("customer_routine_id", "routine_item_id", "timing_slot", "phase");
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "customer_usage_schedules_customer_routine_id_idx" ON "care"."customer_usage_schedules"("customer_routine_id");
CREATE INDEX IF NOT EXISTS "customer_usage_schedules_product_id_idx" ON "care"."customer_usage_schedules"("product_id");

DO $$ BEGIN
    ALTER TABLE "care"."customer_usage_schedules"
        ADD CONSTRAINT "customer_usage_schedules_weekdays_valid" CHECK (weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "care"."customer_usage_schedules"
        ADD CONSTRAINT "customer_usage_schedules_phase_positive" CHECK (phase >= 1);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "care"."customer_usage_schedules"
        ADD CONSTRAINT "customer_usage_schedules_planned_uses_positive" CHECK (planned_uses_per_occurrence >= 1);
EXCEPTION WHEN duplicate_object THEN null;
END $$;
