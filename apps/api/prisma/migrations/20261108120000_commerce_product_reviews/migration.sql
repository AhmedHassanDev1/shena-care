-- Customer product reviews (commerce). Additive only: one enum, one table, indexes, rating check.
CREATE TYPE "commerce"."ProductReviewStatus" AS ENUM ('PENDING', 'PUBLISHED', 'REJECTED');

CREATE TABLE "commerce"."product_reviews" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "sku_id" UUID,
    "rating" SMALLINT NOT NULL,
    "title" VARCHAR(120),
    "body" TEXT NOT NULL,
    "author_name" VARCHAR(60) NOT NULL,
    "skin_type" VARCHAR(20),
    "is_verified_purchase" BOOLEAN NOT NULL DEFAULT false,
    "helpful_count" INTEGER NOT NULL DEFAULT 0,
    "status" "commerce"."ProductReviewStatus" NOT NULL DEFAULT 'PENDING',
    "source" VARCHAR(60) NOT NULL DEFAULT 'customer',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_reviews_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5),
    CONSTRAINT "product_reviews_helpful_check" CHECK ("helpful_count" >= 0)
);

CREATE INDEX "product_reviews_product_id_status_created_at_idx" ON "commerce"."product_reviews"("product_id", "status", "created_at");
CREATE INDEX "product_reviews_source_idx" ON "commerce"."product_reviews"("source");
