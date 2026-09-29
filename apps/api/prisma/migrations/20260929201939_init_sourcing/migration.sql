-- CreateTable
CREATE TABLE "sourcing"."suppliers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sourcing"."supplier_offers" (
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "cost_price" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "last_observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_name_key" ON "sourcing"."suppliers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_slug_key" ON "sourcing"."suppliers"("slug");

-- CreateIndex
CREATE INDEX "supplier_offers_supplier_id_idx" ON "sourcing"."supplier_offers"("supplier_id");

-- CreateIndex
CREATE INDEX "supplier_offers_sku_id_idx" ON "sourcing"."supplier_offers"("sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_offers_supplier_id_sku_id_key" ON "sourcing"."supplier_offers"("supplier_id", "sku_id");

-- AddForeignKey
ALTER TABLE "sourcing"."supplier_offers" ADD CONSTRAINT "supplier_offers_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "sourcing"."suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
