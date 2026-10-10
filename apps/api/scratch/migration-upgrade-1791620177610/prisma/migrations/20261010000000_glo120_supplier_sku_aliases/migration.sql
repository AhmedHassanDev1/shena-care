-- CreateTable
CREATE TABLE "sourcing"."supplier_sku_aliases" (
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "supplier_sku_code" TEXT NOT NULL,
    "sku_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_sku_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_sku_aliases_supplier_id_idx" ON "sourcing"."supplier_sku_aliases"("supplier_id");

-- CreateIndex
CREATE INDEX "supplier_sku_aliases_sku_id_idx" ON "sourcing"."supplier_sku_aliases"("sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_sku_aliases_supplier_id_supplier_sku_code_key" ON "sourcing"."supplier_sku_aliases"("supplier_id", "supplier_sku_code");

-- AddForeignKey
ALTER TABLE "sourcing"."supplier_sku_aliases" ADD CONSTRAINT "supplier_sku_aliases_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "sourcing"."suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing"."supplier_sku_aliases" ADD CONSTRAINT "supplier_sku_aliases_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "catalog"."skus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
