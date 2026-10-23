-- Gate 07 (GLO-279): reviewed, evidence-linked product usage rules and typed stated concentrations. Additive only.
-- CreateEnum
CREATE TYPE "catalog"."UsageTargetArea" AS ENUM ('FACE', 'EYE_CONTOUR', 'LIPS', 'BODY', 'SCALP', 'HAIR');

-- CreateEnum
CREATE TYPE "catalog"."UsageRoutinePeriod" AS ENUM ('AM', 'PM', 'BOTH', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "catalog"."UsageRinseMode" AS ENUM ('RINSE_OFF', 'LEAVE_ON', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "catalog"."UsageFrequencyUnit" AS ENUM ('DAY', 'WEEK', 'AS_NEEDED', 'UNKNOWN');

-- AlterTable
ALTER TABLE "catalog"."product_ingredients" ADD COLUMN     "concentration_evidence" JSONB,
ADD COLUMN     "concentration_unit" VARCHAR(10),
ADD COLUMN     "concentration_value" DECIMAL(7,3);

-- CreateTable
CREATE TABLE "catalog"."product_usage_rules" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "sku_id" UUID,
    "target_area" "catalog"."UsageTargetArea",
    "routine_period" "catalog"."UsageRoutinePeriod" NOT NULL,
    "rinse_mode" "catalog"."UsageRinseMode" NOT NULL,
    "frequency_unit" "catalog"."UsageFrequencyUnit" NOT NULL,
    "uses_min" INTEGER,
    "uses_max" INTEGER,
    "contact_minutes" INTEGER,
    "contact_is_maximum" BOOLEAN NOT NULL DEFAULT false,
    "condition" VARCHAR(40),
    "evidence_text" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "source_type" VARCHAR(40) NOT NULL,
    "retrieved_at" TIMESTAMP(3),
    "reviewed_by" TEXT NOT NULL,
    "reviewed_at" TIMESTAMP(3) NOT NULL,
    "source_candidate_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_usage_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_usage_rules_product_id_idx" ON "catalog"."product_usage_rules"("product_id");

-- CreateIndex
CREATE INDEX "product_usage_rules_sku_id_idx" ON "catalog"."product_usage_rules"("sku_id");

-- AddForeignKey
ALTER TABLE "catalog"."product_usage_rules" ADD CONSTRAINT "product_usage_rules_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."product_usage_rules" ADD CONSTRAINT "product_usage_rules_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "catalog"."skus"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Range guards the application also enforces (defence in depth).
ALTER TABLE "catalog"."product_usage_rules" ADD CONSTRAINT "product_usage_rules_uses_range"
  CHECK ((uses_min IS NULL OR uses_min > 0) AND (uses_max IS NULL OR uses_max > 0)
     AND (uses_min IS NULL OR uses_max IS NULL OR uses_min <= uses_max));
ALTER TABLE "catalog"."product_usage_rules" ADD CONSTRAINT "product_usage_rules_contact_positive"
  CHECK (contact_minutes IS NULL OR contact_minutes > 0);
ALTER TABLE "catalog"."product_ingredients" ADD CONSTRAINT "product_ingredients_concentration_valid"
  CHECK (concentration_value IS NULL OR (concentration_value > 0 AND concentration_unit IS NOT NULL
     AND (concentration_unit <> '%' OR concentration_value <= 100)));
