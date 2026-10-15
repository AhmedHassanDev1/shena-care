-- GLO-242: reviewed manufacturer barcode aliases and recorded identity evidence at receiving/preparation.
-- CreateEnum
CREATE TYPE "catalog"."BarcodeAliasStatus" AS ENUM ('approved', 'retired');

-- AlterTable
ALTER TABLE "fulfillment"."fulfillment_receipts" ADD COLUMN     "barcode_scanned" VARCHAR(64),
ADD COLUMN     "identity_method" VARCHAR(20) NOT NULL DEFAULT 'unverified',
ADD COLUMN     "identity_note" TEXT;

-- AlterTable
ALTER TABLE "fulfillment"."preparation_scan_events" ADD COLUMN     "manual_reason" TEXT,
ADD COLUMN     "operator_id" TEXT,
ADD COLUMN     "verification_method" VARCHAR(20);

-- CreateTable
CREATE TABLE "catalog"."sku_barcode_aliases" (
    "id" UUID NOT NULL,
    "barcode" VARCHAR(64) NOT NULL,
    "sku_id" UUID NOT NULL,
    "status" "catalog"."BarcodeAliasStatus" NOT NULL DEFAULT 'approved',
    "source" VARCHAR(40) NOT NULL,
    "evidence_ref" VARCHAR(255),
    "reason" TEXT NOT NULL,
    "approved_by" TEXT NOT NULL,
    "approved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retired_by" TEXT,
    "retired_at" TIMESTAMP(3),

    CONSTRAINT "sku_barcode_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sku_barcode_aliases_barcode_idx" ON "catalog"."sku_barcode_aliases"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "sku_barcode_aliases_barcode_sku_id_key" ON "catalog"."sku_barcode_aliases"("barcode", "sku_id");

-- AddForeignKey
ALTER TABLE "catalog"."sku_barcode_aliases" ADD CONSTRAINT "sku_barcode_aliases_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "catalog"."skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


