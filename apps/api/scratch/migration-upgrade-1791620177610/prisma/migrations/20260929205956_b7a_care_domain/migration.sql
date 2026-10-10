-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "care";

-- CreateEnum
CREATE TYPE "care"."CareArea" AS ENUM ('skin', 'hair');

-- CreateEnum
CREATE TYPE "care"."RoutineTiming" AS ENUM ('am', 'pm', 'both', 'as_needed');

-- CreateEnum
CREATE TYPE "care"."RecommendationSource" AS ENUM ('manual', 'rule_engine', 'ai', 'expert');

-- CreateTable
CREATE TABLE "care"."concerns" (
    "id" UUID NOT NULL,
    "care_area" "care"."CareArea" NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "concerns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care"."routines" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "care_area" "care"."CareArea" NOT NULL,
    "is_template" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care"."routine_steps" (
    "id" UUID NOT NULL,
    "routine_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "step_order" INTEGER NOT NULL,
    "timing" "care"."RoutineTiming" NOT NULL,
    "is_optional" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routine_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care"."routine_step_recommendations" (
    "id" UUID NOT NULL,
    "step_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "source" "care"."RecommendationSource" NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routine_step_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "concerns_name_key" ON "care"."concerns"("name");

-- CreateIndex
CREATE UNIQUE INDEX "concerns_slug_key" ON "care"."concerns"("slug");

-- CreateIndex
CREATE INDEX "routine_steps_routine_id_idx" ON "care"."routine_steps"("routine_id");

-- CreateIndex
CREATE UNIQUE INDEX "routine_steps_routine_id_step_order_key" ON "care"."routine_steps"("routine_id", "step_order");

-- CreateIndex
CREATE INDEX "routine_step_recommendations_step_id_idx" ON "care"."routine_step_recommendations"("step_id");

-- CreateIndex
CREATE INDEX "routine_step_recommendations_product_id_idx" ON "care"."routine_step_recommendations"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "routine_step_recommendations_step_id_product_id_key" ON "care"."routine_step_recommendations"("step_id", "product_id");

-- AddForeignKey
ALTER TABLE "care"."routine_steps" ADD CONSTRAINT "routine_steps_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "care"."routines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care"."routine_step_recommendations" ADD CONSTRAINT "routine_step_recommendations_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "care"."routine_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care"."routine_step_recommendations" ADD CONSTRAINT "routine_step_recommendations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
