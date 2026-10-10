-- CreateEnum
CREATE TYPE "care"."RoutineProposalStatus" AS ENUM ('proposed', 'accepted', 'rejected', 'failed', 'expired');

-- CreateTable
CREATE TABLE "care"."routine_drafts" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT,
    "guest_token_hash" TEXT,
    "care_area" "care"."CareArea" NOT NULL DEFAULT 'skin',
    "primary_concern" TEXT,
    "secondary_goals" TEXT[],
    "budget" DECIMAL(10,2),
    "is_budget_strict" BOOLEAN NOT NULL DEFAULT false,
    "max_steps" INTEGER,
    "owned_product_ids" TEXT[],
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routine_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care"."routine_proposals" (
    "id" TEXT NOT NULL,
    "draft_id" TEXT NOT NULL,
    "status" "care"."RoutineProposalStatus" NOT NULL DEFAULT 'proposed',
    "snapshot" JSONB NOT NULL,
    "total_price" DECIMAL(10,2),
    "error" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routine_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "routine_drafts_guest_token_hash_key" ON "care"."routine_drafts"("guest_token_hash");

-- CreateIndex
CREATE INDEX "routine_drafts_customer_id_idx" ON "care"."routine_drafts"("customer_id");

-- CreateIndex
CREATE INDEX "routine_drafts_guest_token_hash_idx" ON "care"."routine_drafts"("guest_token_hash");

-- CreateIndex
CREATE INDEX "routine_proposals_draft_id_idx" ON "care"."routine_proposals"("draft_id");

-- CreateIndex
CREATE INDEX "routine_proposals_status_idx" ON "care"."routine_proposals"("status");

-- AddForeignKey
ALTER TABLE "care"."routine_proposals" ADD CONSTRAINT "routine_proposals_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "care"."routine_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
