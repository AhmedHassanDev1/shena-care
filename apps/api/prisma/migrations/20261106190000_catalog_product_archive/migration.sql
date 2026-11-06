ALTER TABLE "catalog"."products" ADD COLUMN "archived_at" TIMESTAMP(3);
CREATE INDEX "products_archived_at_idx" ON "catalog"."products"("archived_at");
