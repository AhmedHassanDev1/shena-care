-- Repair columns already present in long-lived databases but omitted by the earlier
-- order-submission migration, so a fresh installation can create sourcing requests.
ALTER TABLE "ordering"."orders"
  ADD COLUMN IF NOT EXISTS "area" TEXT,
  ADD COLUMN IF NOT EXISTS "governorate" TEXT,
  ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT,
  ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "location_source" TEXT,
  ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "notes" TEXT,
  ADD COLUMN IF NOT EXISTS "shipping_fee" DECIMAL(10,2) NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS "orders_idempotency_key_key" ON "ordering"."orders"("idempotency_key");

CREATE TYPE "sourcing"."SupplyPlanStatus" AS ENUM ('CONFIRMING', 'COVERED', 'PARTIALLY_UNAVAILABLE', 'UNAVAILABLE');
CREATE TYPE "sourcing"."SourceConfirmationResult" AS ENUM ('pending', 'confirmed_full', 'confirmed_partial', 'unavailable', 'rejected', 'price_changed');

CREATE TABLE "sourcing"."supply_requests" (
  "id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "status" "sourcing"."SupplyPlanStatus" NOT NULL DEFAULT 'CONFIRMING',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "supply_requests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "supply_requests_order_id_key" ON "sourcing"."supply_requests"("order_id");

CREATE TABLE "sourcing"."supply_requirements" (
  "id" UUID NOT NULL,
  "supply_request_id" UUID NOT NULL,
  "order_item_id" UUID NOT NULL,
  "sku_id" UUID NOT NULL,
  "required_quantity" INTEGER NOT NULL,
  "order_snapshot_ref" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supply_requirements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supply_requirements_positive_quantity" CHECK ("required_quantity" > 0)
);
CREATE UNIQUE INDEX "supply_requirements_order_item_id_key" ON "sourcing"."supply_requirements"("order_item_id");
CREATE INDEX "supply_requirements_supply_request_id_idx" ON "sourcing"."supply_requirements"("supply_request_id");
ALTER TABLE "sourcing"."supply_requirements" ADD CONSTRAINT "supply_requirements_supply_request_id_fkey" FOREIGN KEY ("supply_request_id") REFERENCES "sourcing"."supply_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "sourcing"."source_allocations" (
  "id" UUID NOT NULL,
  "requirement_id" UUID NOT NULL,
  "supplier_offer_id" UUID NOT NULL,
  "requested_quantity" INTEGER NOT NULL,
  "allocated_quantity" INTEGER NOT NULL,
  "confirmed_quantity" INTEGER NOT NULL DEFAULT 0,
  "selected_cost" DECIMAL(10,2) NOT NULL,
  "selected_currency" VARCHAR(3) NOT NULL,
  "ranking_decision_id" UUID NOT NULL,
  "result" "sourcing"."SourceConfirmationResult" NOT NULL DEFAULT 'pending',
  "reported_result" "sourcing"."SourceConfirmationResult",
  "reported_quantity" INTEGER,
  "selected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmed_at" TIMESTAMP(3),
  "evidence_ref" VARCHAR(255),
  CONSTRAINT "source_allocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "source_allocations_valid_quantities" CHECK ("requested_quantity" > 0 AND "allocated_quantity" > 0 AND "allocated_quantity" <= "requested_quantity" AND "confirmed_quantity" >= 0 AND "confirmed_quantity" <= "allocated_quantity")
);
CREATE UNIQUE INDEX "source_allocations_requirement_id_supplier_offer_id_key" ON "sourcing"."source_allocations"("requirement_id", "supplier_offer_id");
CREATE INDEX "source_allocations_requirement_id_idx" ON "sourcing"."source_allocations"("requirement_id");
ALTER TABLE "sourcing"."source_allocations" ADD CONSTRAINT "source_allocations_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "sourcing"."supply_requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sourcing"."source_allocations" ADD CONSTRAINT "source_allocations_supplier_offer_id_fkey" FOREIGN KEY ("supplier_offer_id") REFERENCES "sourcing"."supplier_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "sourcing"."availability_action_requirements" (
  "id" UUID NOT NULL,
  "requirement_id" UUID NOT NULL,
  "category" VARCHAR(40) NOT NULL,
  "unresolved_quantity" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "availability_action_requirements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "availability_action_requirements_positive_quantity" CHECK ("unresolved_quantity" > 0)
);
CREATE UNIQUE INDEX "availability_action_requirements_requirement_id_key" ON "sourcing"."availability_action_requirements"("requirement_id");
ALTER TABLE "sourcing"."availability_action_requirements" ADD CONSTRAINT "availability_action_requirements_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "sourcing"."supply_requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "sourcing"."supply_plan_events" (
  "id" UUID NOT NULL,
  "supply_request_id" UUID NOT NULL,
  "status" "sourcing"."SupplyPlanStatus" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supply_plan_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "supply_plan_events_supply_request_id_created_at_idx" ON "sourcing"."supply_plan_events"("supply_request_id", "created_at");
ALTER TABLE "sourcing"."supply_plan_events" ADD CONSTRAINT "supply_plan_events_supply_request_id_fkey" FOREIGN KEY ("supply_request_id") REFERENCES "sourcing"."supply_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
