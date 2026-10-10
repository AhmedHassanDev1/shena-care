-- AlterTable
ALTER TABLE "catalog"."brands" ADD COLUMN     "country_of_origin" TEXT;

-- AlterTable
ALTER TABLE "catalog"."products" ADD COLUMN     "product_line_id" UUID;

-- CreateTable
CREATE TABLE "catalog"."product_lines" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_lines_slug_key" ON "catalog"."product_lines"("slug");

-- CreateIndex
CREATE INDEX "product_lines_brand_id_idx" ON "catalog"."product_lines"("brand_id");

-- CreateIndex
CREATE INDEX "products_product_line_id_idx" ON "catalog"."products"("product_line_id");

-- AddForeignKey
ALTER TABLE "catalog"."product_lines" ADD CONSTRAINT "product_lines_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "catalog"."brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_product_line_id_fkey" FOREIGN KEY ("product_line_id") REFERENCES "catalog"."product_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
