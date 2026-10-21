ALTER TABLE "catalog"."products" ALTER COLUMN "is_published" SET DEFAULT false;
ALTER TABLE "catalog"."skus" ADD COLUMN "pack_count" INTEGER;
ALTER TABLE "catalog"."skus" ADD CONSTRAINT "skus_pack_count_positive" CHECK ("pack_count" IS NULL OR "pack_count" > 0);
