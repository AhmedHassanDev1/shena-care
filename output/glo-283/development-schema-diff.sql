-- AlterEnum
ALTER TYPE "sourcing"."PurchaseOrderStatus" ADD VALUE 'expired';

-- DropIndex
DROP INDEX "catalog"."products_search_concerns_idx";

-- DropIndex
DROP INDEX "ingestion"."product_line_drafts_status_idx";

-- AlterTable
ALTER TABLE "accounts"."customer_addresses" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "care"."routine_proposals" DROP COLUMN "currency",
DROP COLUMN "updated_at";

-- AlterTable
ALTER TABLE "catalog"."ingredients" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "name" SET DATA TYPE TEXT,
ALTER COLUMN "name_ar" SET DATA TYPE TEXT,
ALTER COLUMN "slug" SET DATA TYPE TEXT,
ALTER COLUMN "inci_name" SET DATA TYPE TEXT,
ALTER COLUMN "family" SET DATA TYPE TEXT,
ALTER COLUMN "family_slug" SET DATA TYPE TEXT,
ALTER COLUMN "chemical_form" SET DATA TYPE TEXT,
ALTER COLUMN "primary_function" SET DATA TYPE TEXT,
ALTER COLUMN "rating" SET DATA TYPE TEXT,
ALTER COLUMN "visual_status" SET DATA TYPE TEXT,
ALTER COLUMN "visual_url" SET DATA TYPE TEXT,
ALTER COLUMN "status" SET DATA TYPE TEXT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "catalog"."product_ingredients" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "concentration" SET DATA TYPE TEXT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ingestion"."brand_drafts" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "aliases" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ingestion"."export_profiles" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ingestion"."product_line_drafts" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "sourcing"."supplier_offers" ADD COLUMN     "minimum_order_units" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "order_multiple_units" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "shortage_observed_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "sourcing"."supplier_purchase_orders" ADD COLUMN     "expedited" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "response_deadline_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "sourcing"."suppliers" ADD COLUMN     "closed_dates" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "pickup_lead_minutes" INTEGER;

-- CreateTable
CREATE TABLE "sourcing"."sourcing_decisions" (
    "id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "required_quantity" INTEGER NOT NULL,
    "requirement_id" UUID,
    "ranked_offers" JSONB NOT NULL,
    "excluded_offers" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sourcing_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sourcing_decisions_requirement_id_created_at_idx" ON "sourcing"."sourcing_decisions"("requirement_id", "created_at");

-- CreateIndex
CREATE INDEX "sourcing_decisions_sku_id_created_at_idx" ON "sourcing"."sourcing_decisions"("sku_id", "created_at");

-- CreateIndex
CREATE INDEX "purchase_order_lines_distribution_required_created_at_idx" ON "sourcing"."purchase_order_lines"("distribution_required", "created_at");

-- CreateIndex
CREATE INDEX "source_allocations_result_selected_at_idx" ON "sourcing"."source_allocations"("result", "selected_at");

-- CreateIndex
CREATE INDEX "supplier_purchase_orders_status_response_deadline_at_idx" ON "sourcing"."supplier_purchase_orders"("status", "response_deadline_at");

