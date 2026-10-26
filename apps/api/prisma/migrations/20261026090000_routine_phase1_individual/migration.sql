-- CreateEnum
CREATE TYPE "care"."CareAgeBand" AS ENUM ('UNDER_15', 'AGE_15_17', 'ADULT');

-- CreateEnum
CREATE TYPE "care"."CareExperienceLevel" AS ENUM ('BEGINNER', 'EXPERIENCED');

-- CreateEnum
CREATE TYPE "care"."CareTriState" AS ENUM ('YES', 'NO', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "care"."RoutineTier" AS ENUM ('SMART', 'COMPLETE', 'LUXE');

-- CreateEnum
CREATE TYPE "care"."RoutineKind" AS ENUM ('TREATMENT', 'SUPPORT', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "care"."BlueprintStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "care"."EligibilityReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "care"."IngredientRuleKind" AS ENUM ('SEPARATE_TIMES', 'COMPATIBLE', 'MAX_ONE_PER_AREA', 'EXCLUDE_CONDITION');

-- CreateEnum
CREATE TYPE "care"."IngredientRuleSubject" AS ENUM ('FAMILY', 'INGREDIENT');

-- CreateEnum
CREATE TYPE "care"."IngredientRuleStatus" AS ENUM ('ACTIVE', 'DRAFT');

-- CreateEnum
CREATE TYPE "care"."RoutineActivation" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "care"."RoutineLifecycle" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'STOPPED');

-- CreateEnum
CREATE TYPE "care"."RoutinePurchasePhase" AS ENUM ('IMMEDIATE', 'DEFERRED');

-- AlterTable
ALTER TABLE "care"."customer_care_profiles" ADD COLUMN     "age_band" "care"."CareAgeBand",
ADD COLUMN     "experience_level" "care"."CareExperienceLevel",
ADD COLUMN     "fragrance_free" BOOLEAN;

-- AlterTable
ALTER TABLE "care"."routine_drafts" ADD COLUMN     "age_band" "care"."CareAgeBand",
ADD COLUMN     "allergy_ingredient_ids" TEXT[],
ADD COLUMN     "consent_at" TIMESTAMP(3),
ADD COLUMN     "consent_version" TEXT,
ADD COLUMN     "experience_level" "care"."CareExperienceLevel",
ADD COLUMN     "fragrance_free" BOOLEAN,
ADD COLUMN     "overrides" JSONB,
ADD COLUMN     "owned_role_keys" TEXT[],
ADD COLUMN     "safety" JSONB,
ADD COLUMN     "severity" INTEGER,
ADD COLUMN     "skin_type" "care"."SkinType",
ADD COLUMN     "tier" "care"."RoutineTier";

-- AlterTable
ALTER TABLE "care"."routine_proposals" ADD COLUMN     "draft_version" INTEGER,
ADD COLUMN     "engine_version" TEXT;

-- CreateTable
CREATE TABLE "care"."routine_blueprints" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "concern_slug" TEXT NOT NULL,
    "care_area" "care"."CareArea" NOT NULL,
    "kind" "care"."RoutineKind" NOT NULL,
    "severity_min" INTEGER NOT NULL DEFAULT 1,
    "severity_max" INTEGER NOT NULL DEFAULT 2,
    "title_ar" TEXT NOT NULL,
    "title_en" TEXT NOT NULL,
    "goal_ar" TEXT,
    "timeline_ar" TEXT,
    "safety_notes_ar" TEXT[],
    "sources" JSONB NOT NULL,
    "status" "care"."BlueprintStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "published_at" TIMESTAMP(3),
    "published_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routine_blueprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care"."blueprint_roles" (
    "id" UUID NOT NULL,
    "blueprint_id" UUID NOT NULL,
    "role_key" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "title_ar" TEXT NOT NULL,
    "is_essential" BOOLEAN NOT NULL DEFAULT true,
    "start_week" INTEGER NOT NULL DEFAULT 1,
    "required_actives" TEXT[],
    "concentration_ranges" JSONB,
    "usage_note_ar" TEXT,

    CONSTRAINT "blueprint_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care"."product_role_eligibility" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "role_key" TEXT NOT NULL,
    "tier" "care"."RoutineTier" NOT NULL,
    "concern_slugs" TEXT[],
    "suitable_skin_types" "care"."SkinType"[],
    "review_status" "care"."EligibilityReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_role_eligibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care"."ingredient_rules" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "kind" "care"."IngredientRuleKind" NOT NULL,
    "subject_type" "care"."IngredientRuleSubject" NOT NULL,
    "subject" TEXT NOT NULL,
    "other_type" "care"."IngredientRuleSubject",
    "other" TEXT,
    "condition" TEXT,
    "note_ar" TEXT,
    "source_title" TEXT NOT NULL,
    "source_url" TEXT,
    "source_type" TEXT NOT NULL,
    "status" "care"."IngredientRuleStatus" NOT NULL DEFAULT 'ACTIVE',
    "reviewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingredient_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care"."care_safety_flags" (
    "id" UUID NOT NULL,
    "care_profile_id" UUID NOT NULL,
    "pregnant" "care"."CareTriState" NOT NULL DEFAULT 'UNKNOWN',
    "breastfeeding" "care"."CareTriState" NOT NULL DEFAULT 'UNKNOWN',
    "prescription_topical" "care"."CareTriState" NOT NULL DEFAULT 'UNKNOWN',
    "oral_retinoid" "care"."CareTriState" NOT NULL DEFAULT 'UNKNOWN',
    "fragrance_sensitive" "care"."CareTriState" NOT NULL DEFAULT 'UNKNOWN',
    "allergy_ingredient_ids" TEXT[],
    "consent_version" TEXT NOT NULL,
    "consent_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "care_safety_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care"."customer_routines" (
    "id" UUID NOT NULL,
    "care_profile_id" UUID NOT NULL,
    "blueprint_id" UUID NOT NULL,
    "blueprint_version" INTEGER NOT NULL,
    "concern_slug" TEXT NOT NULL,
    "care_area" "care"."CareArea" NOT NULL,
    "kind" "care"."RoutineKind" NOT NULL,
    "title_ar" TEXT NOT NULL,
    "tier" "care"."RoutineTier",
    "activation" "care"."RoutineActivation" NOT NULL DEFAULT 'INACTIVE',
    "lifecycle" "care"."RoutineLifecycle" NOT NULL DEFAULT 'NOT_STARTED',
    "status_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "budget" DECIMAL(10,2),
    "created_from_proposal_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "stopped_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_routines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care"."customer_routine_items" (
    "id" UUID NOT NULL,
    "routine_id" UUID NOT NULL,
    "role_key" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "is_essential" BOOLEAN NOT NULL,
    "product_id" UUID,
    "sku_id" UUID,
    "tier" "care"."RoutineTier",
    "is_owned" BOOLEAN NOT NULL DEFAULT false,
    "shared_with_routine_id" UUID,
    "purchase_phase" "care"."RoutinePurchasePhase" NOT NULL DEFAULT 'IMMEDIATE',
    "start_week" INTEGER NOT NULL DEFAULT 1,
    "reason_codes" TEXT[],
    "added_at_version" INTEGER NOT NULL,
    "removed_at_version" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_routine_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care"."customer_routine_versions" (
    "id" UUID NOT NULL,
    "routine_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_routine_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "routine_blueprints_key_key" ON "care"."routine_blueprints"("key");

-- CreateIndex
CREATE INDEX "routine_blueprints_concern_slug_status_idx" ON "care"."routine_blueprints"("concern_slug", "status");

-- CreateIndex
CREATE INDEX "blueprint_roles_blueprint_id_idx" ON "care"."blueprint_roles"("blueprint_id");

-- CreateIndex
CREATE UNIQUE INDEX "blueprint_roles_blueprint_id_role_key_key" ON "care"."blueprint_roles"("blueprint_id", "role_key");

-- CreateIndex
CREATE INDEX "product_role_eligibility_role_key_review_status_idx" ON "care"."product_role_eligibility"("role_key", "review_status");

-- CreateIndex
CREATE UNIQUE INDEX "product_role_eligibility_product_id_role_key_key" ON "care"."product_role_eligibility"("product_id", "role_key");

-- CreateIndex
CREATE UNIQUE INDEX "ingredient_rules_key_key" ON "care"."ingredient_rules"("key");

-- CreateIndex
CREATE INDEX "ingredient_rules_kind_status_idx" ON "care"."ingredient_rules"("kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "care_safety_flags_care_profile_id_key" ON "care"."care_safety_flags"("care_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_routines_created_from_proposal_id_key" ON "care"."customer_routines"("created_from_proposal_id");

-- CreateIndex
CREATE INDEX "customer_routines_care_profile_id_activation_idx" ON "care"."customer_routines"("care_profile_id", "activation");

-- CreateIndex
CREATE INDEX "customer_routine_items_routine_id_removed_at_version_idx" ON "care"."customer_routine_items"("routine_id", "removed_at_version");

-- CreateIndex
CREATE UNIQUE INDEX "customer_routine_versions_routine_id_version_key" ON "care"."customer_routine_versions"("routine_id", "version");

-- AddForeignKey
ALTER TABLE "care"."blueprint_roles" ADD CONSTRAINT "blueprint_roles_blueprint_id_fkey" FOREIGN KEY ("blueprint_id") REFERENCES "care"."routine_blueprints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care"."care_safety_flags" ADD CONSTRAINT "care_safety_flags_care_profile_id_fkey" FOREIGN KEY ("care_profile_id") REFERENCES "care"."customer_care_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care"."customer_routines" ADD CONSTRAINT "customer_routines_care_profile_id_fkey" FOREIGN KEY ("care_profile_id") REFERENCES "care"."customer_care_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care"."customer_routine_items" ADD CONSTRAINT "customer_routine_items_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "care"."customer_routines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care"."customer_routine_versions" ADD CONSTRAINT "customer_routine_versions_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "care"."customer_routines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

