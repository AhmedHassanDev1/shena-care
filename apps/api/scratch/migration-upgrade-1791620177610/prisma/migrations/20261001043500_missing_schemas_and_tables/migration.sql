-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "accounts";
CREATE SCHEMA IF NOT EXISTS "care";
CREATE SCHEMA IF NOT EXISTS "sourcing";
CREATE SCHEMA IF NOT EXISTS "ingestion";
CREATE SCHEMA IF NOT EXISTS "fulfillment";
CREATE SCHEMA IF NOT EXISTS "ordering";
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "accounts";

-- CreateEnum
CREATE TYPE "sourcing"."PurchaseOrderStatus" AS ENUM ('created', 'sent', 'reviewed', 'confirmed', 'partial', 'ready', 'received_at_hub');

-- CreateEnum
CREATE TYPE "sourcing"."PurchaseOrderLineStatus" AS ENUM ('pending', 'confirmed_full', 'confirmed_partial', 'unavailable');

-- CreateEnum
CREATE TYPE "care"."SkinType" AS ENUM ('normal', 'dry', 'oily', 'combination', 'sensitive');

-- CreateEnum
CREATE TYPE "care"."GuidanceSessionStatus" AS ENUM ('active', 'completed', 'abandoned');

-- CreateEnum
CREATE TYPE "care"."GuidanceMessageRole" AS ENUM ('user', 'assistant', 'system');

-- AlterEnum
ALTER TYPE "fulfillment"."PreparationSessionStatus" ADD VALUE 'failed';

-- AlterTable
ALTER TABLE "fulfillment"."delivery_batches" DROP COLUMN "hub_id",
DROP COLUMN "name",
ADD COLUMN     "completed_at" TIMESTAMP(3),
ADD COLUMN     "dispatched_at" TIMESTAMP(3),
ADD COLUMN     "driver_id" TEXT,
ADD COLUMN     "planned_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "ordering"."orders" ADD COLUMN     "customer_id" TEXT;

-- CreateTable
CREATE TABLE "sourcing"."supplier_purchase_orders" (
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "status" "sourcing"."PurchaseOrderStatus" NOT NULL DEFAULT 'created',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sourcing"."purchase_order_lines" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "requested_quantity" INTEGER NOT NULL,
    "confirmed_quantity" INTEGER,
    "status" "sourcing"."PurchaseOrderLineStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care"."customer_care_profiles" (
    "id" UUID NOT NULL,
    "customer_id" TEXT NOT NULL,
    "skin_type" "care"."SkinType",
    "budget" DECIMAL(10,2),
    "currency" VARCHAR(3),
    "sensitivities" TEXT,
    "routine_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_care_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care"."customer_care_profile_concerns" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "concern_id" UUID NOT NULL,
    "severity" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_care_profile_concerns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care"."guidance_sessions" (
    "id" UUID NOT NULL,
    "customer_id" TEXT NOT NULL,
    "status" "care"."GuidanceSessionStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guidance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care"."guidance_messages" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "role" "care"."GuidanceMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "proposal" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guidance_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts"."customers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts"."identities" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "password_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts"."sessions" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "token" UUID NOT NULL,
    "is_valid" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_purchase_orders_supplier_id_idx" ON "sourcing"."supplier_purchase_orders"("supplier_id");

-- CreateIndex
CREATE INDEX "purchase_order_lines_purchase_order_id_idx" ON "sourcing"."purchase_order_lines"("purchase_order_id");

-- CreateIndex
CREATE INDEX "purchase_order_lines_sku_id_idx" ON "sourcing"."purchase_order_lines"("sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_care_profiles_customer_id_key" ON "care"."customer_care_profiles"("customer_id");

-- CreateIndex
CREATE INDEX "customer_care_profiles_routine_id_idx" ON "care"."customer_care_profiles"("routine_id");

-- CreateIndex
CREATE INDEX "customer_care_profile_concerns_profile_id_idx" ON "care"."customer_care_profile_concerns"("profile_id");

-- CreateIndex
CREATE INDEX "customer_care_profile_concerns_concern_id_idx" ON "care"."customer_care_profile_concerns"("concern_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_care_profile_concerns_profile_id_concern_id_key" ON "care"."customer_care_profile_concerns"("profile_id", "concern_id");

-- CreateIndex
CREATE INDEX "guidance_sessions_customer_id_idx" ON "care"."guidance_sessions"("customer_id");

-- CreateIndex
CREATE INDEX "guidance_messages_session_id_idx" ON "care"."guidance_messages"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_email_key" ON "accounts"."customers"("email");

-- CreateIndex
CREATE INDEX "identities_customer_id_idx" ON "accounts"."identities"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "identities_provider_provider_id_key" ON "accounts"."identities"("provider", "provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "accounts"."sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_customer_id_idx" ON "accounts"."sessions"("customer_id");

-- CreateIndex
CREATE INDEX "sessions_token_idx" ON "accounts"."sessions"("token");

-- CreateIndex
CREATE INDEX "preparation_scan_events_session_id_idx" ON "fulfillment"."preparation_scan_events"("session_id");

-- CreateIndex
CREATE INDEX "shipment_events_shipment_id_idx" ON "fulfillment"."shipment_events"("shipment_id");

-- CreateIndex
CREATE INDEX "shipment_preparation_sessions_shipment_id_idx" ON "fulfillment"."shipment_preparation_sessions"("shipment_id");

-- AddForeignKey
ALTER TABLE "sourcing"."supplier_purchase_orders" ADD CONSTRAINT "supplier_purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "sourcing"."suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "sourcing"."supplier_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care"."customer_care_profiles" ADD CONSTRAINT "customer_care_profiles_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "care"."routines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care"."customer_care_profile_concerns" ADD CONSTRAINT "customer_care_profile_concerns_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "care"."customer_care_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care"."customer_care_profile_concerns" ADD CONSTRAINT "customer_care_profile_concerns_concern_id_fkey" FOREIGN KEY ("concern_id") REFERENCES "care"."concerns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care"."guidance_messages" ADD CONSTRAINT "guidance_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "care"."guidance_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts"."identities" ADD CONSTRAINT "identities_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "accounts"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts"."sessions" ADD CONSTRAINT "sessions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "accounts"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

