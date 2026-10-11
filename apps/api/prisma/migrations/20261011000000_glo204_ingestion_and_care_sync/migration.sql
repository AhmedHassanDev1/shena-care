-- AlterEnum
BEGIN;
CREATE TYPE "care"."RoutineProposalStatus_new" AS ENUM ('proposed', 'accepted', 'rejected', 'failed');
ALTER TABLE "care"."routine_proposals" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "care"."routine_proposals" ALTER COLUMN "status" TYPE "care"."RoutineProposalStatus_new" USING ("status"::text::"care"."RoutineProposalStatus_new");
ALTER TYPE "care"."RoutineProposalStatus" RENAME TO "RoutineProposalStatus_old";
ALTER TYPE "care"."RoutineProposalStatus_new" RENAME TO "RoutineProposalStatus";
DROP TYPE "care"."RoutineProposalStatus_old";
ALTER TABLE "care"."routine_proposals" ALTER COLUMN "status" SET DEFAULT 'proposed';
COMMIT;

-- DropForeignKey
ALTER TABLE "care"."routine_proposals" DROP CONSTRAINT "routine_proposals_draft_id_fkey";

-- DropIndex
DROP INDEX IF EXISTS "care"."routine_drafts_customer_id_idx";

-- DropIndex
DROP INDEX IF EXISTS "care"."routine_drafts_guest_token_hash_idx";

-- DropIndex
DROP INDEX IF EXISTS "care"."routine_proposals_status_idx";

-- AlterTable
ALTER TABLE "care"."routine_drafts" DROP CONSTRAINT "routine_drafts_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ALTER COLUMN "preferences" DROP NOT NULL,
ALTER COLUMN "preferences" DROP DEFAULT,
ADD CONSTRAINT "routine_drafts_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "care"."routine_proposals" DROP CONSTRAINT "routine_proposals_pkey",
ADD COLUMN     "currency" VARCHAR(3),
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "draft_id",
ADD COLUMN     "draft_id" UUID NOT NULL,
ADD CONSTRAINT "routine_proposals_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "ingestion"."ingestion_jobs" ADD COLUMN IF NOT EXISTS "source_checksum" TEXT,
ADD COLUMN IF NOT EXISTS "source_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "routine_drafts_customer_id_key" ON "care"."routine_drafts"("customer_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "routine_proposals_draft_id_idx" ON "care"."routine_proposals"("draft_id");

-- AddForeignKey
ALTER TABLE "care"."routine_proposals" ADD CONSTRAINT "routine_proposals_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "care"."routine_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
