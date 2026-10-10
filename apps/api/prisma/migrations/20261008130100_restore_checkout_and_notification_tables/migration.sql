-- Complete the unrecorded schema additions used by checkout and fulfillment.
-- Existing legacy outbox_events and its enum are intentionally preserved.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE n.nspname = 'commerce' AND t.typname = 'BenefitType') THEN
    CREATE TYPE "commerce"."BenefitType" AS ENUM ('item_discount', 'order_discount', 'free_shipping');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE n.nspname = 'commerce' AND t.typname = 'DiscountType') THEN
    CREATE TYPE "commerce"."DiscountType" AS ENUM ('percentage', 'fixed_amount');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE n.nspname = 'operations' AND t.typname = 'NotificationStatus') THEN
    CREATE TYPE "operations"."NotificationStatus" AS ENUM ('pending', 'processing', 'sent', 'failed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "commerce"."promotions" (
  "id" UUID NOT NULL PRIMARY KEY,
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
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "promotions_code_key" ON "commerce"."promotions"("code");

CREATE TABLE IF NOT EXISTS "operations"."notification_outbox" (
  "id" UUID NOT NULL PRIMARY KEY,
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
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "notification_outbox_deduplication_key_key"
  ON "operations"."notification_outbox"("deduplication_key");
CREATE INDEX IF NOT EXISTS "notification_outbox_status_next_attempt_at_idx"
  ON "operations"."notification_outbox"("status", "next_attempt_at");
CREATE INDEX IF NOT EXISTS "notification_outbox_aggregate_id_event_type_idx"
  ON "operations"."notification_outbox"("aggregate_id", "event_type");
