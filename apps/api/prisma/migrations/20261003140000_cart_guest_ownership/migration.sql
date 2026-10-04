-- Cart ownership: customer_id | guest_token_hash, optimistic revision, price observation, provenance.

ALTER TABLE "ordering"."carts" ADD COLUMN "customer_id" UUID;
ALTER TABLE "ordering"."carts" ADD COLUMN "guest_token_hash" TEXT;
ALTER TABLE "ordering"."carts" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

-- Backfill: legacy carts used session_id = customer id.
UPDATE "ordering"."carts"
SET "customer_id" = "session_id"::uuid
WHERE "session_id" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

-- Legacy carts that were not UUID-keyed cannot be attributed to an owner.
DELETE FROM "ordering"."carts" WHERE "customer_id" IS NULL;

DROP INDEX IF EXISTS "ordering"."carts_session_id_key";
ALTER TABLE "ordering"."carts" DROP COLUMN "session_id";

CREATE UNIQUE INDEX "carts_customer_id_key" ON "ordering"."carts"("customer_id");
CREATE UNIQUE INDEX "carts_guest_token_hash_key" ON "ordering"."carts"("guest_token_hash");
ALTER TABLE "ordering"."carts"
  ADD CONSTRAINT "carts_single_owner_chk"
  CHECK (("customer_id" IS NOT NULL) <> ("guest_token_hash" IS NOT NULL));

ALTER TABLE "ordering"."cart_items" ADD COLUMN "price_at_add" DECIMAL(10,2);
ALTER TABLE "ordering"."cart_items" ADD COLUMN "price_observed_at" TIMESTAMP(3);
ALTER TABLE "ordering"."cart_items" ADD COLUMN "source_type" TEXT;
ALTER TABLE "ordering"."cart_items"
  ADD CONSTRAINT "cart_items_quantity_positive_chk" CHECK ("quantity" > 0);
