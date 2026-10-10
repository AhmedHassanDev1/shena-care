-- GLO-190: customer availability resolution + order amendment.
CREATE TYPE "ordering"."OrderItemLineState" AS ENUM ('active', 'removed', 'replaced');
CREATE TYPE "ordering"."AvailabilityDecisionStatus" AS ENUM ('pending', 'resolved', 'review_required', 'superseded');
CREATE TYPE "ordering"."AvailabilityDecisionAction" AS ENUM ('REPLACE_WITH', 'CONTINUE_WITHOUT_ITEM', 'CANCEL_ORDER');

ALTER TABLE "sourcing"."supply_requirements" ADD COLUMN "released_at" TIMESTAMP(3);

ALTER TABLE "ordering"."order_items"
  ADD COLUMN "line_state" "ordering"."OrderItemLineState" NOT NULL DEFAULT 'active',
  ADD COLUMN "replaces_item_id" UUID;

CREATE TABLE "ordering"."availability_decisions" (
  "id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "order_item_id" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "ordering"."AvailabilityDecisionStatus" NOT NULL DEFAULT 'pending',
  "reason_category" VARCHAR(40) NOT NULL,
  "unresolved_quantity" INTEGER NOT NULL,
  "original_snapshot" JSONB NOT NULL,
  "candidates" JSONB NOT NULL,
  "available_actions" JSONB NOT NULL,
  "state_fingerprint" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3),
  "decided_action" "ordering"."AvailabilityDecisionAction",
  "decided_sku_id" UUID,
  "decided_by" TEXT,
  "decided_channel" VARCHAR(30),
  "decided_at" TIMESTAMP(3),
  "decision_key" TEXT,
  "decision_hash" TEXT,
  "receipt" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "availability_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "availability_decisions_order_id_fkey" FOREIGN KEY ("order_id")
    REFERENCES "ordering"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "availability_decisions_decision_key_key" ON "ordering"."availability_decisions"("decision_key");
CREATE UNIQUE INDEX "availability_decisions_order_item_id_version_key" ON "ordering"."availability_decisions"("order_item_id", "version");
CREATE INDEX "availability_decisions_order_id_status_idx" ON "ordering"."availability_decisions"("order_id", "status");
-- Race-proof: at most one open decision per order line.
CREATE UNIQUE INDEX "availability_decisions_one_pending_per_item"
  ON "ordering"."availability_decisions"("order_item_id") WHERE "status" = 'pending';

CREATE TABLE "ordering"."order_amendments" (
  "id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "decision_id" UUID NOT NULL,
  "type" VARCHAR(40) NOT NULL,
  "before" JSONB NOT NULL,
  "after" JSONB NOT NULL,
  "cod_before" DECIMAL(10,2) NOT NULL,
  "cod_after" DECIMAL(10,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_amendments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_amendments_order_id_fkey" FOREIGN KEY ("order_id")
    REFERENCES "ordering"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "order_amendments_decision_id_fkey" FOREIGN KEY ("decision_id")
    REFERENCES "ordering"."availability_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "order_amendments_decision_id_key" ON "ordering"."order_amendments"("decision_id");
CREATE INDEX "order_amendments_order_id_idx" ON "ordering"."order_amendments"("order_id");
