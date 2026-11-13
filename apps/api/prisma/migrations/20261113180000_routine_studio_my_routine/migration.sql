-- Routine Studio + My Routine on the existing GLO-84 routine domain (GLO-311 / GLO-312 / GLO-313).
-- Additive only: no column is dropped or retyped. Routines that exist today are live templates, so they are backfilled PUBLISHED;
-- new rows default to DRAFT and only the Studio publish action makes them public.

-- CreateEnum
CREATE TYPE "care"."RoutineStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'UNPUBLISHED');

-- CreateEnum
CREATE TYPE "care"."RoutineOrigin" AS ENUM ('TEMPLATE', 'USER', 'COPY', 'AI');

-- AlterTable
ALTER TABLE "care"."routines"
    ADD COLUMN "status" "care"."RoutineStatus" NOT NULL DEFAULT 'PUBLISHED',
    ADD COLUMN "origin" "care"."RoutineOrigin" NOT NULL DEFAULT 'TEMPLATE',
    ADD COLUMN "owner_customer_id" TEXT,
    ADD COLUMN "source_routine_id" UUID,
    ADD COLUMN "concern_slug" TEXT,
    ADD COLUMN "title_en" TEXT,
    ADD COLUMN "references" JSONB,
    ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "published_at" TIMESTAMP(3),
    ADD COLUMN "published_by" TEXT,
    ADD COLUMN "import_fingerprint" TEXT;

-- Rows created from now on start as drafts.
ALTER TABLE "care"."routines" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "care"."routine_steps" ADD COLUMN "reason" TEXT;

-- AlterTable
ALTER TABLE "care"."routine_step_recommendations"
    ADD COLUMN "sku_id" UUID,
    ADD COLUMN "is_default" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "care"."routine_revisions" (
    "id" UUID NOT NULL,
    "routine_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "action" VARCHAR(30) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routine_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "routines_import_fingerprint_key" ON "care"."routines"("import_fingerprint");

-- CreateIndex
CREATE INDEX "routines_owner_customer_id_idx" ON "care"."routines"("owner_customer_id");

-- CreateIndex
CREATE INDEX "routines_is_template_status_idx" ON "care"."routines"("is_template", "status");

-- CreateIndex
CREATE INDEX "routine_revisions_routine_id_created_at_idx" ON "care"."routine_revisions"("routine_id", "created_at");

-- AddForeignKey
ALTER TABLE "care"."routine_revisions" ADD CONSTRAINT "routine_revisions_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "care"."routines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
