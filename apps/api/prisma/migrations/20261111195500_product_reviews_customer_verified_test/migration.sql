-- Associate product reviews with authenticated customers and qualifying orders,
-- make review body optional (rating required, written review optional),
-- enforce one customer review per product, and isolate development test reviews.

ALTER TABLE "commerce"."product_reviews"
  ADD COLUMN "customer_id" UUID,
  ADD COLUMN "order_id" UUID,
  ADD COLUMN "is_test" BOOLEAN NOT NULL DEFAULT false,
  ALTER COLUMN "body" DROP NOT NULL;

-- Test reviews can never be marked as verified purchases.
ALTER TABLE "commerce"."product_reviews"
  ADD CONSTRAINT "product_reviews_test_not_verified_check"
  CHECK (NOT ("is_test" = true AND "is_verified_purchase" = true));

CREATE INDEX "product_reviews_product_id_status_is_test_created_at_idx"
  ON "commerce"."product_reviews"("product_id", "status", "is_test", "created_at");

CREATE INDEX "product_reviews_customer_id_product_id_idx"
  ON "commerce"."product_reviews"("customer_id", "product_id");

-- Enforce duplicate-review protection per customer per product at the DB layer.
CREATE UNIQUE INDEX "product_reviews_product_id_customer_id_key"
  ON "commerce"."product_reviews"("product_id", "customer_id")
  WHERE "customer_id" IS NOT NULL;
