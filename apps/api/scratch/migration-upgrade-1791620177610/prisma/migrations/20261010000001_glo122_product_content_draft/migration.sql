-- CreateTable
CREATE TABLE "ingestion"."product_content_drafts" (
    "id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "language" VARCHAR(5) NOT NULL,
    "titleEn" TEXT,
    "titleAr" TEXT,
    "shortDescriptionEn" TEXT,
    "shortDescriptionAr" TEXT,
    "descriptionEn" TEXT,
    "descriptionAr" TEXT,
    "benefitsEn" TEXT[],
    "benefitsAr" TEXT[],
    "usageEn" TEXT[],
    "usageAr" TEXT[],
    "routineStepEn" TEXT,
    "routineStepAr" TEXT,
    "keywords" TEXT[],
    "seoTitleEn" TEXT,
    "seoTitleAr" TEXT,
    "seoDescriptionEn" TEXT,
    "seoDescriptionAr" TEXT,
    "evidenceVersion" TEXT,
    "modelVersion" TEXT,
    "is_approved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_content_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_content_drafts_candidate_id_key" ON "ingestion"."product_content_drafts"("candidate_id");

-- CreateIndex
CREATE INDEX "product_content_drafts_candidate_id_idx" ON "ingestion"."product_content_drafts"("candidate_id");

-- AddForeignKey
ALTER TABLE "ingestion"."product_content_drafts" ADD CONSTRAINT "product_content_drafts_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "ingestion"."ingestion_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
