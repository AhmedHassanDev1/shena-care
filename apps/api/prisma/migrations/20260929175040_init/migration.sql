-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "catalog";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "commerce";

-- CreateEnum
CREATE TYPE "catalog"."MediaType" AS ENUM ('image', 'video');

-- CreateTable
CREATE TABLE "catalog"."brands" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "logo_url" TEXT,
    "website_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."products" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "usage" TEXT,
    "warnings" TEXT,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."skus" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "variant_name" TEXT NOT NULL,
    "size" DECIMAL(10,3),
    "size_unit" TEXT,
    "barcode" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."product_media" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "type" "catalog"."MediaType" NOT NULL,
    "url" TEXT NOT NULL,
    "alt_text" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."listings" (
    "id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "is_listed" BOOLEAN NOT NULL DEFAULT true,
    "listed_at" TIMESTAMP(3),
    "unlisted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."selling_prices" (
    "id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "compare_at_amount" DECIMAL(10,2),
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_until" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "selling_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brands_name_key" ON "catalog"."brands"("name");

-- CreateIndex
CREATE UNIQUE INDEX "brands_slug_key" ON "catalog"."brands"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "catalog"."products"("slug");

-- CreateIndex
CREATE INDEX "products_brand_id_idx" ON "catalog"."products"("brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "skus_code_key" ON "catalog"."skus"("code");

-- CreateIndex
CREATE UNIQUE INDEX "skus_barcode_key" ON "catalog"."skus"("barcode");

-- CreateIndex
CREATE INDEX "skus_product_id_idx" ON "catalog"."skus"("product_id");

-- CreateIndex
CREATE INDEX "skus_barcode_idx" ON "catalog"."skus"("barcode");

-- CreateIndex
CREATE INDEX "product_media_product_id_idx" ON "catalog"."product_media"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "listings_sku_id_key" ON "commerce"."listings"("sku_id");

-- CreateIndex
CREATE INDEX "listings_sku_id_idx" ON "commerce"."listings"("sku_id");

-- CreateIndex
CREATE INDEX "selling_prices_sku_id_idx" ON "commerce"."selling_prices"("sku_id");

-- CreateIndex
CREATE INDEX "selling_prices_sku_id_valid_from_idx" ON "commerce"."selling_prices"("sku_id", "valid_from");

-- AddForeignKey
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "catalog"."brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."skus" ADD CONSTRAINT "skus_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."product_media" ADD CONSTRAINT "product_media_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
