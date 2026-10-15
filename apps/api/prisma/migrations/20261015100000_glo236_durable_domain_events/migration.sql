-- GLO-236: durable cross-module event delivery and honest notification status.

-- A notification with no connected delivery provider is held, never reported as sent.
ALTER TYPE "operations"."NotificationStatus" ADD VALUE 'held';

CREATE TYPE "operations"."DomainEventStatus" AS ENUM ('pending', 'processing', 'delivered', 'failed', 'dead');

CREATE TABLE "operations"."domain_events" (
    "id" UUID NOT NULL,
    "event_type" VARCHAR(80) NOT NULL,
    "aggregate_type" VARCHAR(80) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "consumer" VARCHAR(80) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "operations"."DomainEventStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 8,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMP(3),
    "last_error" TEXT,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "domain_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "domain_events_status_next_attempt_at_idx" ON "operations"."domain_events"("status", "next_attempt_at");
CREATE INDEX "domain_events_aggregate_id_idx" ON "operations"."domain_events"("aggregate_id");
CREATE UNIQUE INDEX "domain_events_event_type_aggregate_id_consumer_key" ON "operations"."domain_events"("event_type", "aggregate_id", "consumer");
