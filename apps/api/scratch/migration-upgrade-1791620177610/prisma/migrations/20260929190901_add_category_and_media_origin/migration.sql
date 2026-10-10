-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "ingestion";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "sourcing";

-- CreateEnum
CREATE TYPE "catalog"."MediaOriginType" AS ENUM ('verified', 'generated', 'derived');

-- AlterTable
ALTER TABLE "catalog"."product_media" ADD COLUMN     "generation_metadata" JSONB,
ADD COLUMN     "origin_type" "catalog"."MediaOriginType" NOT NULL DEFAULT 'verified';

-- AlterTable
ALTER TABLE "catalog"."products" ADD COLUMN     "category_id" UUID;

-- CreateTable
CREATE TABLE "catalog"."categories" (
    "id" UUID NOT NULL,
    "parent_id" UUID,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "catalog"."categories"("slug");

-- CreateIndex
CREATE INDEX "categories_parent_id_idx" ON "catalog"."categories"("parent_id");

-- CreateIndex
CREATE INDEX "product_media_origin_type_idx" ON "catalog"."product_media"("origin_type");

-- CreateIndex
CREATE INDEX "products_category_id_idx" ON "catalog"."products"("category_id");

-- AddForeignKey
ALTER TABLE "catalog"."categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "catalog"."categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "catalog"."categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
