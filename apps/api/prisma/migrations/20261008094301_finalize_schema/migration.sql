/*
  Warnings:

  - You are about to drop the `outbox_events` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "commerce"."BenefitType" AS ENUM ('item_discount', 'order_discount', 'free_shipping');

-- CreateEnum
CREATE TYPE "commerce"."DiscountType" AS ENUM ('percentage', 'fixed_amount');

-- CreateEnum
CREATE TYPE "operations"."NotificationStatus" AS ENUM ('pending', 'processing', 'sent', 'failed');

-- DropTable
DROP TABLE "operations"."outbox_events";

-- DropEnum
DROP TYPE "operations"."OutboxEventStatus";

-- CreateTable
CREATE TABLE "commerce"."promotions" (
    "id" UUID NOT NULL,
    "campaign_name" TEXT NOT NULL,
    "code" TEXT,
    "benefit_type" "commerce"."BenefitType" NOT NULL,
    "discount_type" "commerce"."DiscountType",
    "discount_value" DECIMAL(10,2),
    "min_basket_value" DECIMAL(10,2),
    "is_stackable" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations"."notification_outbox" (
    "id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "aggregate_id" TEXT,
    "aggregate_type" TEXT,
    "customer_id" TEXT,
    "payload" JSONB NOT NULL,
    "channel_intent" TEXT,
    "template_id" TEXT,
    "template_version" INTEGER,
    "deduplication_key" TEXT NOT NULL,
    "status" "operations"."NotificationStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "next_attempt_at" TIMESTAMP(3),
    "last_error" JSONB,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "promotions_code_key" ON "commerce"."promotions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "notification_outbox_deduplication_key_key" ON "operations"."notification_outbox"("deduplication_key");

-- CreateIndex
CREATE INDEX "notification_outbox_status_next_attempt_at_idx" ON "operations"."notification_outbox"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "notification_outbox_aggregate_id_event_type_idx" ON "operations"."notification_outbox"("aggregate_id", "event_type");
