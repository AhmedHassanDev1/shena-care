-- CreateEnum
CREATE TYPE "ordering"."OrderStatus" AS ENUM ('placed', 'confirmed', 'packing', 'shipped', 'delivered', 'cancelled');

-- CreateEnum
CREATE TYPE "fulfillment"."ShipmentStatus" AS ENUM ('pending', 'packing', 'dispatched', 'delivered', 'failed');

-- CreateEnum
CREATE TYPE "ingestion"."IngestionStatus" AS ENUM ('pending', 'review_required', 'approved', 'rejected', 'published');

-- CreateTable
CREATE TABLE "ordering"."carts" (
    "id" UUID NOT NULL,
    "session_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordering"."cart_items" (
    "id" UUID NOT NULL,
    "cart_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordering"."orders" (
    "id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT NOT NULL,
    "shipping_address" TEXT NOT NULL,
    "total_amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" "ordering"."OrderStatus" NOT NULL DEFAULT 'placed',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordering"."order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment"."fulfillment_locations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fulfillment_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment"."shipments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "status" "fulfillment"."ShipmentStatus" NOT NULL DEFAULT 'pending',
    "tracking_number" TEXT,
    "dispatched_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment"."shipment_items" (
    "id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion"."ingestion_jobs" (
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "status" "ingestion"."IngestionStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingestion_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion"."ingestion_items" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "supplier_sku_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "barcode" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" "ingestion"."IngestionStatus" NOT NULL DEFAULT 'pending',
    "matched_sku_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingestion_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "carts_session_id_key" ON "ordering"."carts"("session_id");

-- CreateIndex
CREATE INDEX "cart_items_cart_id_idx" ON "ordering"."cart_items"("cart_id");

-- CreateIndex
CREATE INDEX "cart_items_sku_id_idx" ON "ordering"."cart_items"("sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cart_id_sku_id_key" ON "ordering"."cart_items"("cart_id", "sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "ordering"."orders"("order_number");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "ordering"."order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_sku_id_idx" ON "ordering"."order_items"("sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "fulfillment_locations_name_key" ON "fulfillment"."fulfillment_locations"("name");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_order_id_key" ON "fulfillment"."shipments"("order_id");

-- CreateIndex
CREATE INDEX "shipments_location_id_idx" ON "fulfillment"."shipments"("location_id");

-- CreateIndex
CREATE INDEX "shipment_items_shipment_id_idx" ON "fulfillment"."shipment_items"("shipment_id");

-- CreateIndex
CREATE INDEX "shipment_items_sku_id_idx" ON "fulfillment"."shipment_items"("sku_id");

-- CreateIndex
CREATE INDEX "ingestion_jobs_supplier_id_idx" ON "ingestion"."ingestion_jobs"("supplier_id");

-- CreateIndex
CREATE INDEX "ingestion_items_job_id_idx" ON "ingestion"."ingestion_items"("job_id");

-- CreateIndex
CREATE INDEX "ingestion_items_status_idx" ON "ingestion"."ingestion_items"("status");

-- AddForeignKey
ALTER TABLE "ordering"."cart_items" ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "ordering"."carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordering"."order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ordering"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment"."shipments" ADD CONSTRAINT "shipments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "fulfillment"."fulfillment_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment"."shipment_items" ADD CONSTRAINT "shipment_items_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "fulfillment"."shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion"."ingestion_items" ADD CONSTRAINT "ingestion_items_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "ingestion"."ingestion_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
