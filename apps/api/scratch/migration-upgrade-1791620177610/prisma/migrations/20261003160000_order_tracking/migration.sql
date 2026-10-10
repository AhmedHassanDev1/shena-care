ALTER TABLE "ordering"."orders"
  ADD COLUMN "guest_access_token_hash" TEXT,
  ADD COLUMN "guest_access_expires_at" TIMESTAMP(3),
  ADD COLUMN "guest_access_revoked_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "orders_guest_access_token_hash_key"
  ON "ordering"."orders"("guest_access_token_hash");

CREATE TABLE "ordering"."order_status_events" (
  "id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "status" "ordering"."OrderStatus" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_status_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_status_events_order_id_created_at_idx"
  ON "ordering"."order_status_events"("order_id", "created_at");

ALTER TABLE "ordering"."order_status_events"
  ADD CONSTRAINT "order_status_events_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "ordering"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
