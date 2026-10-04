ALTER TABLE "ordering"."orders"
  ADD COLUMN "submission_hash" TEXT,
  ADD COLUMN "subtotal" DECIMAL(10,2),
  ADD COLUMN "cod_amount" DECIMAL(10,2),
  ADD COLUMN "delivery_promise" TEXT,
  ADD COLUMN "availability_certainty" TEXT;

ALTER TABLE "ordering"."order_items"
  ADD COLUMN "product_id" UUID,
  ADD COLUMN "product_name" TEXT,
  ADD COLUMN "sku_code" TEXT,
  ADD COLUMN "variant_name" TEXT,
  ADD COLUMN "discount_amount" DECIMAL(10,2),
  ADD COLUMN "line_total" DECIMAL(10,2);

CREATE TABLE "ordering"."checkout_quotes" (
  "id" UUID NOT NULL,
  "cart_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "order_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "checkout_quotes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "checkout_quotes_order_id_key" ON "ordering"."checkout_quotes"("order_id");
CREATE INDEX "checkout_quotes_cart_id_revision_idx" ON "ordering"."checkout_quotes"("cart_id", "revision");
ALTER TABLE "ordering"."checkout_quotes" ADD CONSTRAINT "checkout_quotes_cart_id_fkey"
  FOREIGN KEY ("cart_id") REFERENCES "ordering"."carts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ordering"."checkout_quotes" ADD CONSTRAINT "checkout_quotes_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "ordering"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
