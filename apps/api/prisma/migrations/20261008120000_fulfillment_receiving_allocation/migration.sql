-- Explicit hub capabilities keep receiving, preparation, dispatch, and owned-stock
-- operations independently enforceable.
CREATE TYPE "fulfillment"."FulfillmentCapability" AS ENUM (
  'RECEIVE_SUPPLIER_GOODS',
  'PREPARE_ORDERS',
  'DISPATCH_SHIPMENTS',
  'MANAGE_OWNED_INVENTORY'
);

CREATE TYPE "fulfillment"."ReceivedGoodsCondition" AS ENUM (
  'ACCEPTABLE',
  'DAMAGED',
  'EXPIRED',
  'QUARANTINED'
);

ALTER TABLE "fulfillment"."fulfillment_locations"
  ADD COLUMN "capabilities" "fulfillment"."FulfillmentCapability"[] NOT NULL
  DEFAULT ARRAY[
    'RECEIVE_SUPPLIER_GOODS'::"fulfillment"."FulfillmentCapability",
    'PREPARE_ORDERS'::"fulfillment"."FulfillmentCapability",
    'DISPATCH_SHIPMENTS'::"fulfillment"."FulfillmentCapability",
    'MANAGE_OWNED_INVENTORY'::"fulfillment"."FulfillmentCapability"
  ];

CREATE TABLE "fulfillment"."fulfillment_location_operators" (
  "id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "operator_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fulfillment_location_operators_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fulfillment_location_operators_location_id_operator_id_key"
  ON "fulfillment"."fulfillment_location_operators"("location_id", "operator_id");
CREATE INDEX "fulfillment_location_operators_operator_id_idx"
  ON "fulfillment"."fulfillment_location_operators"("operator_id");

ALTER TABLE "fulfillment"."fulfillment_location_operators"
  ADD CONSTRAINT "fulfillment_location_operators_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "fulfillment"."fulfillment_locations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "fulfillment"."fulfillment_receipts" (
  "id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "supply_request_id" UUID NOT NULL,
  "source_allocation_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "order_item_id" UUID NOT NULL,
  "sku_id" UUID NOT NULL,
  "variant_name" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "allocation_confirmed_quantity" INTEGER NOT NULL,
  "condition" "fulfillment"."ReceivedGoodsCondition" NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "actor_id" UUID NOT NULL,
  "inventory_transaction_id" UUID NOT NULL,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fulfillment_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fulfillment_receipts_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "fulfillment_receipts_confirmed_quantity_check" CHECK ("allocation_confirmed_quantity" > 0)
);

CREATE UNIQUE INDEX "fulfillment_receipts_idempotency_key_key"
  ON "fulfillment"."fulfillment_receipts"("idempotency_key");
CREATE UNIQUE INDEX "fulfillment_receipts_inventory_transaction_id_key"
  ON "fulfillment"."fulfillment_receipts"("inventory_transaction_id");
CREATE INDEX "fulfillment_receipts_source_allocation_id_idx"
  ON "fulfillment"."fulfillment_receipts"("source_allocation_id");
CREATE INDEX "fulfillment_receipts_order_id_order_item_id_idx"
  ON "fulfillment"."fulfillment_receipts"("order_id", "order_item_id");
CREATE INDEX "fulfillment_receipts_location_id_sku_id_idx"
  ON "fulfillment"."fulfillment_receipts"("location_id", "sku_id");

ALTER TABLE "fulfillment"."fulfillment_receipts"
  ADD CONSTRAINT "fulfillment_receipts_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "fulfillment"."fulfillment_locations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fulfillment"."fulfillment_receipts"
  ADD CONSTRAINT "fulfillment_receipts_inventory_transaction_id_fkey"
  FOREIGN KEY ("inventory_transaction_id") REFERENCES "fulfillment"."inventory_transactions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
